import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSvg, recolorBody, collectColors } from '../js/core/svg.js';
import { PRESETS, SOURCE, buildColorMap, parsePaletteText, paletteFromColors, backgroundConflict } from '../js/core/palette.js';
import { pickByMetaphor, pickByNames, stem } from '../js/core/metaphor.js';
import { compose, convertItemSize } from '../js/core/layout.js';
import { exportSvg, itemSize } from '../js/core/render.js';
import { OBJECTS, SIZES, fileFor, libKey } from '../js/core/catalog.js';

const library = {};
for (const o of OBJECTS) {
  for (const size of Object.keys(SIZES)) {
    for (const v of ['main', 'bg']) {
      library[libKey(o.id, v, size)] = parseSvg(readFileSync(new URL(`../${fileFor(o.id, v, size)}`, import.meta.url), 'utf8'));
    }
  }
}

test('library: 10 objects x main/background x L/S, all in style-guide colors', () => {
  assert.equal(Object.keys(library).length, 40);
  for (const key of Object.keys(library)) {
    const extra = library[key].colors.filter(c => !SOURCE.includes(c) && c !== '#000000');
    assert.deepEqual(extra, [], `${key} has off-palette colors`);
  }
});

test('S drawings are simplified versions at half the size of L', () => {
  for (const o of OBJECTS) {
    const l = library[libKey(o.id, 'main', 'L')];
    const s = library[libKey(o.id, 'main', 'S')];
    assert.ok(Math.abs(s.viewBox[2] / l.viewBox[2] - 0.5) < 0.07, `${o.id} width ratio`);
  }
  const shapes = k => (library[k].body.match(/<path\b/g) || []).length;
  assert.ok(shapes(libKey('phone', 'main', 'S')) < shapes(libKey('phone', 'main', 'L')), 'phone S has less detail');
});

test('parseSvg rejects scripts and accepts plain shapes', () => {
  assert.throws(() => parseSvg('<svg viewBox="0 0 1 1"><path d="M0 0" onload="x()"/></svg>'), /скрипт/);
  assert.throws(() => parseSvg('<svg viewBox="0 0 1 1"><script>x()</script><path d="M0 0"/></svg>'), /скрипт/);
  assert.throws(() => parseSvg('<svg viewBox="0 0 1 1"><a href="javascript:x()"><path d="M0 0"/></a></svg>'), /скрипт/);
  assert.deepEqual(parseSvg('<svg width="10" height="20"><rect width="1" height="1" fill="white"/></svg>').viewBox, [0, 0, 10, 20]);
});

test('recoloring swaps colors role-to-role and never touches geometry', () => {
  const body = library[libKey('puzzle', 'main', 'L')].body;
  const peach = PRESETS.find(p => p.id === 'peach').colors;
  const out = recolorBody(body, buildColorMap(collectColors(body), peach));
  assert.equal(out.replace(/(fill|stroke)="[^"]*"/g, ''), body.replace(/(fill|stroke)="[^"]*"/g, ''));
  assert.ok(!collectColors(out).includes('#F9A3AA'), 'pink accent is replaced');
  assert.ok(collectColors(out).includes('#80DADA'), 'by the peach palette accent');
});

test('palette files: 8 colors keep role order, other counts are distributed by lightness', () => {
  const eight = parsePaletteText(PRESETS[1].colors.join(' '));
  assert.deepEqual(paletteFromColors(eight), PRESETS[1].colors);
  const p = paletteFromColors(parsePaletteText('{"a":"#101010","b":"#fafafa","c":"#ff8800","d":"#ffe0c0","e":"#803000"}'));
  assert.equal(p.length, 8);
  assert.equal(p[0], '#FFE0C0');
  assert.equal(p[2], '#803000');
  assert.equal(p[3], '#101010');
  assert.throws(() => paletteFromColors([]), /цвет/);
});

test('object colors are never allowed as the background', () => {
  for (const p of PRESETS) assert.equal(backgroundConflict(p.colors), null, p.id);
  const bad = [...PRESETS[0].colors];
  bad[0] = bad[5];
  assert.equal(backgroundConflict(bad), 'Акцент 2');
});

test('metaphor matching works on word forms and explains the choice', () => {
  assert.equal(stem('сбережения'), stem('сбережений'));
  const r = pickByMetaphor('Как начать копить деньги и защитить свои сбережения');
  assert.equal(r.ids[0], 'lock');
  assert.ok(r.ids.includes('wallet'));
  assert.ok(r.explain[0].reasons.includes('сбережения'));
  assert.equal(pickByMetaphor('Подарок маме на 8 марта').ids[0], 'flowers');
  assert.ok(pickByMetaphor('абвгд').ids.length >= 3, 'falls back to a neutral scene');
});

test('names scenario finds objects and reports unknown words', () => {
  const r = pickByNames('монета с замком, кошелёк и жираф');
  assert.deepEqual(r.ids, ['lock', 'wallet']);
  assert.deepEqual(r.unknown, ['жираф']);
});

test('compose keeps every object inside the canvas for every template, format and size', () => {
  const dims = { og: [1200, 630], square: [1080, 1080], wide: [1920, 1080], story: [1080, 1920] };
  for (const size of ['L', 'S']) {
    for (const template of ['title', 'offset', 'compact']) {
      for (const canvas of Object.keys(dims)) {
        const picks = [{ id: 'book', variant: 'main' }, { id: 'lamp', variant: 'main' }, { id: 'pen', variant: 'main' }, { id: 'flowers', variant: 'bg' }];
        const items = compose({ picks, library, template, canvas, size, seed: 5 });
        assert.equal(items.length, 4);
        assert.equal(items[0].variant, 'bg');
        for (const it of items.filter(i => i.variant === 'main')) {
          assert.equal(it.size, size);
          const { w, h } = itemSize(it, library);
          const tag = `${size}/${template}/${canvas}: ${it.id}`;
          assert.ok(it.x >= -1 && it.y >= -1, `${tag} starts inside`);
          assert.ok(it.x + w <= dims[canvas][0] + 1 && it.y + h <= dims[canvas][1] + 1, `${tag} ends inside`);
        }
      }
    }
  }
});

test('switching size swaps the drawing and keeps the object centered at a smaller footprint', () => {
  const [item] = compose({ picks: [{ id: 'phone', variant: 'main' }], library, size: 'L' });
  const s = convertItemSize(item, 'S', library);
  const a = itemSize(item, library);
  const b = itemSize(s, library);
  assert.equal(s.size, 'S');
  assert.ok(Math.abs(item.x + a.w / 2 - (s.x + b.w / 2)) < 0.01, 'same center x');
  assert.ok(Math.abs(b.w / a.w - 0.72) < 0.01, 'S appears at 72% of L');
  const back = convertItemSize(s, 'L', library);
  assert.ok(Math.abs(back.scale - item.scale) < 1e-9, 'round trip restores the scale');
});

test('export is a standalone vector SVG with one group per object', () => {
  const items = compose({ picks: [{ id: 'phone', variant: 'main' }, { id: 'wallet', variant: 'main' }], library });
  const svg = exportSvg({ items, library, palette: PRESETS[2].colors, canvas: { width: 1200, height: 630 } });
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="1200" height="630"/);
  assert.equal((svg.match(/data-object="/g) || []).length, 2);
  assert.ok(!/<image/.test(svg), 'no raster images');
  assert.ok(svg.includes('fill="#BEEBEB"'), 'background uses palette');
});
