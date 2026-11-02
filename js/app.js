// Application shell: state, panels, library loading, palettes, export, undo/redo and persistence.

import { OBJECTS, SIZES, fileFor, findObject, libKey } from './core/catalog.js';
import { parseSvg, escapeXml } from './core/svg.js';
import { PRESETS, ROLES, parsePaletteText, paletteFromColors, backgroundConflict } from './core/palette.js';
import { pickByMetaphor, pickByNames } from './core/metaphor.js';
import { compose, convertItemSize, TEMPLATES, CANVASES, OBJECT_SIZES, UNIT, findCanvas } from './core/layout.js';
import { exportSvg, itemSize } from './core/render.js';
import { Editor } from './ui/editor.js';

const $ = sel => document.querySelector(sel);
const STORAGE_KEY = 'illustration-composer:v1';
const PROMPTS = {
  metaphor: ['Как начать копить и защитить сбережения', 'Онлайн-обучение: курсы и подкасты', 'Идея для стартапа', 'Безопасные платежи в приложении', 'Подарок на 8 марта'],
  names: ['книга, лампа, ручка', 'телефон, наушники, пазл', 'кошелёк, монета с замком, папка'],
};

const state = {
  mode: 'metaphor',
  prompt: '',
  template: 'title',
  canvasId: 'og',
  size: 'L',
  bgCount: 1,
  seed: 1,
  palette: [...PRESETS[0].colors],
  presetId: 'lavender',
  background: true,
  items: [],
  selected: null,
  libraryVariant: 'main',
  library: {},
  custom: [],
  explain: null,
};
const history = { past: [], future: [] };

const editor = new Editor({
  svg: $('#stage'),
  getState: () => ({ ...state, canvas: findCanvas(state.canvasId) }),
  update: (patch, opts) => setState(patch, opts),
});

// ---------- state ----------

function snapshot() {
  return JSON.stringify({ items: state.items, palette: state.palette, presetId: state.presetId, canvasId: state.canvasId, background: state.background, size: state.size });
}

function setState(patch, { commit = false, full = false } = {}) {
  if (commit) {
    history.past.push(history.current ?? snapshot());
    if (history.past.length > 60) history.past.shift();
    history.future = [];
  }
  Object.assign(state, patch);
  if (commit) history.current = snapshot();
  if (full || commit || 'items' in patch || 'palette' in patch || 'canvasId' in patch || 'background' in patch) editor.render();
  else editor.drawSelection();
  renderLayers();
  renderToolbar();
  $('#empty').hidden = state.items.length > 0;
  if (commit) persist();
}

function restore(json) {
  const s = JSON.parse(json);
  Object.assign(state, s, { selected: null });
  history.current = json;
  renderPalette();
  syncControls();
  renderLibrary();
  setState({}, { full: true });
  persist();
}

function undo() {
  if (!history.past.length) return;
  history.future.push(history.current ?? snapshot());
  restore(history.past.pop());
}

function redo() {
  if (!history.future.length) return;
  history.past.push(history.current ?? snapshot());
  restore(history.future.pop());
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      items: state.items, palette: state.palette, presetId: state.presetId, canvasId: state.canvasId,
      background: state.background, template: state.template, size: state.size, mode: state.mode, prompt: state.prompt,
      bgCount: state.bgCount, custom: state.custom,
    }));
  } catch { /* storage may be unavailable (private mode, quota) — the app works without it */ }
}

function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// ---------- library ----------

async function loadLibrary() {
  const jobs = OBJECTS.flatMap(o => Object.keys(SIZES).flatMap(size => ['main', 'bg'].map(async variant => {
    const url = fileFor(o.id, variant, size);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Не удалось загрузить ${url}`);
    state.library[libKey(o.id, variant, size)] = parseSvg(await res.text());
  })));
  await Promise.all(jobs);
}

function addCustomObject(name, text, persistIt = true) {
  const parsed = parseSvg(text);
  const id = `custom-${slug(name)}-${state.custom.length + 1}`;
  // An uploaded drawing has one level of detail, so it serves every size and variant.
  for (const size of Object.keys(SIZES)) {
    for (const variant of ['main', 'bg']) state.library[libKey(id, variant, size)] = parsed;
  }
  const entry = { id, title: name.replace(/\.svg$/i, ''), svg: text };
  state.custom.push(entry);
  if (persistIt) persist();
  return entry;
}

const slug = s => s.toLowerCase().replace(/\.svg$/i, '').replace(/[^a-z0-9а-яё]+/gi, '-').slice(0, 24) || 'object';
const titleOf = id => findObject(id)?.title ?? state.custom.find(c => c.id === id)?.title ?? id;

function renderLibrary() {
  const host = $('#library');
  const variant = state.libraryVariant;
  const builtIn = OBJECTS.map(o => ({ id: o.id, title: o.title, src: fileFor(o.id, variant, state.size) }));
  const custom = state.custom.map(c => ({ id: c.id, title: c.title, src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(c.svg)}` }));
  host.innerHTML = [...builtIn, ...custom].map(o => `
    <button class="thumb" draggable="true" data-id="${escapeXml(o.id)}" title="Добавить на холст">
      <img src="${o.src}" alt="">${escapeXml(o.title)}
    </button>`).join('');
}

function addItem(id, variant, at) {
  const canvas = findCanvas(state.canvasId);
  const size = state.size;
  const lib = state.library[libKey(id, variant, size)];
  const custom = id.startsWith('custom-');
  // Library objects get the template scale; an uploaded SVG is fitted to about a quarter of the canvas.
  const scale = custom
    ? Math.min(canvas.width * 0.25 / lib.viewBox[2], canvas.height * 0.35 / lib.viewBox[3]) * (OBJECT_SIZES[size] / OBJECT_SIZES.L)
    : OBJECT_SIZES[size] * Math.min(canvas.width / 1200, 1.5) * (lib.viewBox[2] * UNIT[size] > 1000 ? 0.8 : 1.1);
  const w = lib.viewBox[2] * scale;
  const h = lib.viewBox[3] * scale;
  const cx = at?.x ?? canvas.width / 2;
  const cy = at?.y ?? canvas.height / 2;
  const item = { uid: `${id}-${variant}-${Date.now().toString(36)}`, id, variant, size, x: cx - w / 2, y: cy - h / 2, scale, rotation: 0, flip: false };
  setState({ items: [...state.items, item], selected: item.uid }, { commit: true });
  toast(`Добавлено: ${titleOf(id)}${variant === 'bg' ? ' (фон)' : ''}`);
  if (!at) $('#stage').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/** Size switch: swaps every object on the canvas to the matching L/S drawing, keeping the user's edits. */
function switchSize(size) {
  if (size === state.size) return;
  if (state.items.length) {
    // The size goes through setState so that undo restores the drawings and the switch together.
    setState({ size, items: state.items.map(i => convertItemSize(i, size, state.library)) }, { commit: true });
    toast(size === 'S' ? 'Размер S: упрощённые элементы для небольших иллюстраций' : 'Размер L: детализированные элементы');
  } else {
    state.size = size;
  }
  syncControls();
  renderLibrary();
  persist();
}

// ---------- composition ----------

function runCompose(newSeed = false, userAction = true) {
  const text = $('#prompt').value.trim();
  state.prompt = text;
  if (!text) { toast(state.mode === 'metaphor' ? 'Введите метафору или заголовок' : 'Перечислите объекты'); return; }
  let ids;
  let explain;
  if (state.mode === 'metaphor') {
    const r = pickByMetaphor(text);
    ids = r.ids;
    explain = { mode: 'metaphor', list: r.explain, matched: r.matched };
  } else {
    const r = pickByNames(text);
    ids = r.ids;
    explain = { mode: 'names', list: ids.map(id => ({ id, reasons: [] })), unknown: r.unknown };
    if (!ids.length) { state.explain = explain; renderExplain(); toast('Ни одного объекта из библиотеки не найдено'); return; }
  }
  if (newSeed) state.seed = Math.floor(Math.random() * 1e6) + 1;
  // Background (monochrome) objects: companions that are not already in the scene.
  const rest = OBJECTS.map(o => o.id).filter(id => !ids.includes(id));
  const bg = shuffle(rest, state.seed).slice(0, state.bgCount);
  const picks = [...ids.map(id => ({ id, variant: 'main' })), ...bg.map(id => ({ id, variant: 'bg' }))];
  const items = compose({ picks, library: state.library, template: state.template, canvas: state.canvasId, size: state.size, seed: state.seed });
  state.explain = { ...explain, bg };
  renderExplain();
  setState({ items, selected: null }, { commit: true });
  // On narrow screens the canvas sits below the controls — bring the result into view.
  if (userAction && window.innerWidth <= 1180) $('#stage').scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function shuffle(list, seed) {
  const a = [...list];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function renderExplain() {
  const e = state.explain;
  const host = $('#explain');
  if (!e) { host.innerHTML = ''; return; }
  const rows = e.list.map(p => {
    const why = e.mode === 'names' ? 'по названию'
      : p.reasons.length ? `совпало: ${p.reasons.slice(0, 4).join(', ')}` : 'добавлен для полноты сцены';
    return `<div class="pick"><b>${escapeXml(titleOf(p.id))}</b><span class="why">${escapeXml(why)}</span></div>`;
  });
  if (e.bg?.length) rows.push(`<div class="pick"><b>Фон</b><span class="why">${e.bg.map(titleOf).map(escapeXml).join(', ')}</span></div>`);
  if (e.mode === 'metaphor' && !e.matched) rows.unshift('<div class="warn">Прямых совпадений нет — собрана нейтральная сцена. Попробуйте другие слова.</div>');
  if (e.unknown?.length) rows.push(`<div class="warn">Нет в библиотеке: ${e.unknown.map(escapeXml).join(', ')}</div>`);
  host.innerHTML = rows.join('');
}

// ---------- palette ----------

function renderPalette() {
  $('#presets').innerHTML = PRESETS.map(p => `
    <button class="preset ${p.id === state.presetId ? 'active' : ''}" data-preset="${p.id}">
      <span class="strip">${p.colors.slice(0, 7).map(c => `<i style="background:${c}"></i>`).join('')}</span>${p.title}
    </button>`).join('');
  $('#swatches').innerHTML = ROLES.map((r, i) => `
    <label class="swatch"><input type="color" data-role="${i}" value="${state.palette[i].toLowerCase()}">${r.title}</label>`).join('');
}

function setPalette(colors, presetId = null) {
  state.presetId = presetId;
  setState({ palette: colors.map(c => c.toUpperCase()) }, { commit: true });
  renderPalette();
}

// ---------- panels ----------

function renderLayers() {
  $('#layers').innerHTML = state.items.map(item => `
    <li class="${item.uid === state.selected ? 'active' : ''}" data-uid="${item.uid}">
      ${escapeXml(titleOf(item.id))}<span class="tag">${item.variant === 'bg' ? 'фон' : ''}</span>
      <button data-remove="${item.uid}" title="Удалить">✕</button>
    </li>`).join('');
}

function renderToolbar() {
  const item = state.items.find(i => i.uid === state.selected);
  $('#selection-title').textContent = item ? `${titleOf(item.id)}${item.variant === 'bg' ? ' (фон)' : ''}` : 'Ничего не выбрано';
  document.querySelectorAll('#item-toolbar [data-action]').forEach(b => { b.disabled = !item; });
  $('#undo').disabled = !history.past.length;
  $('#redo').disabled = !history.future.length;
}

function syncControls() {
  document.querySelectorAll('.tab').forEach(t => {
    const on = t.dataset.mode === state.mode;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', String(on));
  });
  $('#prompt-label').textContent = state.mode === 'metaphor' ? 'Метафора или заголовок' : 'Названия объектов';
  $('#prompt').placeholder = state.mode === 'metaphor' ? 'Например: Как начать копить и защитить сбережения' : 'Например: книга, лампа, ручка';
  $('#prompt-hint').textContent = state.mode === 'metaphor'
    ? 'Сервис разбирает слова, находит связанные по смыслу объекты и сам собирает сцену.'
    : `Доступно: ${OBJECTS.map(o => o.title.toLowerCase()).join(', ')}.`;
  $('#prompt-examples').innerHTML = PROMPTS[state.mode].map(p => `<button class="chip">${escapeXml(p)}</button>`).join('');
  $('#prompt').value = state.prompt;
  $('#templates').innerHTML = TEMPLATES.map(t => `<button data-template="${t.id}" class="${t.id === state.template ? 'active' : ''}">${t.title}</button>`).join('');
  const sizeTitles = { L: 'Детальный, для крупных иллюстраций', S: 'Упрощённый, для мелких иллюстраций' };
  $('#sizes').innerHTML = Object.keys(OBJECT_SIZES).map(s => `<button data-size="${s}" title="${sizeTitles[s]}" class="${s === state.size ? 'active' : ''}">${s}</button>`).join('');
  $('#canvas-select').innerHTML = CANVASES.map(c => `<option value="${c.id}" ${c.id === state.canvasId ? 'selected' : ''}>${c.title}</option>`).join('');
  $('#bg-count').value = state.bgCount;
  $('#bg-count-label').textContent = state.bgCount;
  $('#show-bg').checked = state.background;
  document.querySelectorAll('#variant-switch button').forEach(b => b.classList.toggle('active', b.dataset.variant === state.libraryVariant));
}

// ---------- item actions ----------

function act(action) {
  const idx = state.items.findIndex(i => i.uid === state.selected);
  if (idx < 0) return;
  const items = state.items.map(i => ({ ...i }));
  const item = items[idx];
  if (action === 'delete') {
    items.splice(idx, 1);
    setState({ items, selected: null }, { commit: true });
    return;
  }
  if (action === 'duplicate') {
    const copy = { ...item, uid: `${item.id}-${item.variant}-${Date.now().toString(36)}`, x: item.x + 24, y: item.y + 24 };
    items.splice(idx + 1, 0, copy);
    setState({ items, selected: copy.uid }, { commit: true });
    return;
  }
  if (action === 'flip') item.flip = !item.flip;
  if (action === 'rotate-reset') item.rotation = 0;
  if (action === 'forward' && idx < items.length - 1) [items[idx], items[idx + 1]] = [items[idx + 1], items[idx]];
  if (action === 'backward' && idx > 0) [items[idx], items[idx - 1]] = [items[idx - 1], items[idx]];
  setState({ items }, { commit: true });
}

function nudge(dx, dy) {
  const item = state.items.find(i => i.uid === state.selected);
  if (!item) return;
  item.x += dx;
  item.y += dy;
  editor.patch(item);
  clearTimeout(nudge.t);
  nudge.t = setTimeout(() => setState({}, { commit: true }), 300);
}

// ---------- export ----------

function currentSvg() {
  return exportSvg({
    items: state.items, library: state.library, palette: state.palette,
    canvas: findCanvas(state.canvasId), background: state.background, title: state.prompt || 'Композиция',
  });
}

function download() {
  if (!state.items.length) { toast('Холст пуст'); return; }
  const blob = new Blob([currentSvg()], { type: 'image/svg+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `composition-${slug(state.prompt || 'svg')}.svg`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function copySvg() {
  if (!state.items.length) { toast('Холст пуст'); return; }
  try {
    await navigator.clipboard.writeText(currentSvg());
    toast('SVG скопирован — можно вставить прямо в Figma');
  } catch {
    toast('Браузер не дал доступ к буферу обмена — скачайте файл');
  }
}

function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------- events ----------

function bind() {
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
    state.mode = t.dataset.mode;
    state.prompt = '';
    syncControls();
  }));
  $('#prompt-examples').addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    $('#prompt').value = chip.textContent;
    runCompose();
  });
  $('#prompt').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runCompose(); } });
  $('#templates').addEventListener('click', e => {
    const b = e.target.closest('[data-template]');
    if (!b) return;
    state.template = b.dataset.template;
    syncControls();
    if (state.items.length && $('#prompt').value.trim()) runCompose();
  });
  $('#sizes').addEventListener('click', e => {
    const b = e.target.closest('[data-size]');
    if (b) switchSize(b.dataset.size);
  });
  $('#canvas-select').addEventListener('change', e => {
    state.canvasId = e.target.value;
    if ($('#prompt').value.trim()) runCompose();
    else setState({ canvasId: e.target.value }, { commit: true });
  });
  $('#bg-count').addEventListener('input', e => {
    state.bgCount = +e.target.value;
    $('#bg-count-label').textContent = state.bgCount;
  });
  $('#bg-count').addEventListener('change', () => { if ($('#prompt').value.trim()) runCompose(); });
  $('#compose').addEventListener('click', () => runCompose());
  $('#variant').addEventListener('click', () => runCompose(true));

  $('#presets').addEventListener('click', e => {
    const b = e.target.closest('[data-preset]');
    if (b) setPalette(PRESETS.find(p => p.id === b.dataset.preset).colors, b.dataset.preset);
  });
  $('#swatches').addEventListener('change', e => {
    const input = e.target.closest('[data-role]');
    if (!input) return;
    const colors = [...state.palette];
    colors[+input.dataset.role] = input.value;
    const clash = backgroundConflict(colors);
    if (clash) {
      toast(`Цвет «${clash}» относится к объектам и не может быть фоном — выберите другой`);
      renderPalette();
      return;
    }
    setPalette(colors);
  });
  $('#palette-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const colors = paletteFromColors(parsePaletteText(await file.text()));
      setPalette(colors);
      toast(`Палитра применена: ${file.name}`);
    } catch (err) { toast(err.message); }
  });
  $('#show-bg').addEventListener('change', e => setState({ background: e.target.checked }, { commit: true }));

  $('#variant-switch').addEventListener('click', e => {
    const b = e.target.closest('[data-variant]');
    if (!b) return;
    state.libraryVariant = b.dataset.variant;
    syncControls();
    renderLibrary();
  });
  $('#library').addEventListener('click', e => {
    const t = e.target.closest('.thumb');
    if (t) addItem(t.dataset.id, t.dataset.id.startsWith('custom-') ? 'main' : state.libraryVariant);
  });
  $('#library').addEventListener('dragstart', e => {
    const t = e.target.closest('.thumb');
    if (t) e.dataTransfer.setData('text/plain', t.dataset.id);
  });
  const stage = $('#stage');
  stage.addEventListener('dragover', e => e.preventDefault());
  stage.addEventListener('drop', e => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    if (!id || !state.library[libKey(id, 'main', state.size)]) return;
    const p = editor.point(e);
    addItem(id, id.startsWith('custom-') ? 'main' : state.libraryVariant, p);
  });
  $('#svg-file').addEventListener('change', async e => {
    const files = [...e.target.files];
    e.target.value = '';
    for (const f of files) {
      try {
        addCustomObject(f.name, await f.text());
        toast(`Добавлено в библиотеку: ${f.name}`);
      } catch (err) { toast(`${f.name}: ${err.message}`); }
    }
    renderLibrary();
  });

  $('#layers').addEventListener('click', e => {
    const rm = e.target.closest('[data-remove]');
    if (rm) { setState({ items: state.items.filter(i => i.uid !== rm.dataset.remove), selected: null }, { commit: true }); return; }
    const li = e.target.closest('li[data-uid]');
    if (li) setState({ selected: li.dataset.uid });
  });
  $('#item-toolbar').addEventListener('click', e => {
    const b = e.target.closest('[data-action]');
    if (b) act(b.dataset.action);
  });
  $('#download-svg').addEventListener('click', download);
  $('#copy-svg').addEventListener('click', copySvg);
  $('#undo').addEventListener('click', undo);
  $('#redo').addEventListener('click', redo);

  document.addEventListener('keydown', e => {
    if (e.target.closest('textarea, input, select')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (!state.selected) return;
    const step = e.shiftKey ? 10 : 1;
    const keys = {
      Delete: () => act('delete'), Backspace: () => act('delete'), ']': () => act('forward'), '[': () => act('backward'),
      ArrowLeft: () => nudge(-step, 0), ArrowRight: () => nudge(step, 0), ArrowUp: () => nudge(0, -step), ArrowDown: () => nudge(0, step),
      Escape: () => setState({ selected: null }),
    };
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); act('duplicate'); return; }
    if (keys[e.key]) { e.preventDefault(); keys[e.key](); }
  });
  window.addEventListener('resize', () => editor.drawSelection());
}

// ---------- start ----------

async function start() {
  bind();
  try {
    await loadLibrary();
  } catch (err) {
    $('#empty').textContent = `Ошибка загрузки библиотеки: ${err.message}`;
    return;
  }
  const saved = loadPersisted();
  if (saved) {
    for (const c of saved.custom || []) {
      try { addCustomObject(c.title, c.svg, false); } catch { /* skip a broken stored object */ }
    }
    const known = saved.items?.filter(i => state.library[libKey(i.id, i.variant, i.size ?? 'L')]) ?? [];
    Object.assign(state, { ...saved, custom: state.custom, items: known });
  }
  syncControls();
  renderPalette();
  renderLibrary();
  history.current = snapshot();
  if (!state.items.length) {
    $('#prompt').value = state.prompt || PROMPTS.metaphor[0];
    runCompose(false, false);
    history.past = [];
  } else {
    setState({}, { full: true });
  }
  renderToolbar();
}

start();

// Exposed for debugging and automated checks.
window.__composer = { state, itemSize };
