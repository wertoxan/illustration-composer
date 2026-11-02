// Automatic composition: places library objects on the canvas following one of the style-guide templates.
// Objects keep their proportions; only translate/rotate/uniform scale are ever applied.

export const CANVASES = [
  { id: 'og', title: '1200 × 630 (обложка)', width: 1200, height: 630 },
  { id: 'square', title: '1080 × 1080 (пост)', width: 1080, height: 1080 },
  { id: 'wide', title: '1920 × 1080 (слайд)', width: 1920, height: 1080 },
  { id: 'story', title: '1080 × 1920 (сторис)', width: 1080, height: 1920 },
];

import { libKey } from './catalog.js';

// S drawings are half the size of L ones (UNIT); on the canvas an S object appears ~0.72 of its L twin.
export const UNIT = { L: 1, S: 2 };
export const OBJECT_SIZES = { L: 0.24, S: 0.24 * 2 * 0.72 };

/** Swaps an item to the other size's drawing, keeping its center and proportional on-canvas size. */
export function convertItemSize(item, size, library) {
  const from = item.size ?? 'L';
  if (from === size) return item;
  const a = library[libKey(item.id, item.variant, from)];
  const b = library[libKey(item.id, item.variant, size)];
  if (!a || !b) return item;
  // Built-in S drawings are half as wide (the width ratio cancels UNIT); uploaded objects share one drawing.
  const scale = item.scale * (a.viewBox[2] / b.viewBox[2]) * (UNIT[from] / UNIT[size]) * (OBJECT_SIZES[size] / OBJECT_SIZES[from]);
  const cx = item.x + a.viewBox[2] * item.scale / 2;
  const cy = item.y + a.viewBox[3] * item.scale / 2;
  return { ...item, size, scale, x: cx - b.viewBox[2] * scale / 2, y: cy - b.viewBox[3] * scale / 2 };
}

// Regions are fractions of the canvas reserved for the composition.
export const TEMPLATES = [
  { id: 'title', title: 'Под заголовок', region: [0.3, 0.3, 0.68, 0.62], anchor: 'right-bottom', arrange: 'row' },
  { id: 'offset', title: 'Со смещением', region: [0.5, 0.08, 0.46, 0.84], anchor: 'right', arrange: 'zigzag' },
  { id: 'compact', title: 'Собранно', region: [0.18, 0.12, 0.64, 0.76], anchor: 'center', arrange: 'cluster' },
];

export const findTemplate = id => TEMPLATES.find(t => t.id === id) ?? TEMPLATES[0];
export const findCanvas = id => CANVASES.find(c => c.id === id) ?? CANVASES[0];

/** Deterministic PRNG so "Ещё вариант" is reproducible from its seed. */
export function random(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const ARRANGERS = {
  // One row standing on a gently rising "floor" with light overlaps, like the "Под заголовок" sample.
  row(items, rnd) {
    let x = 0;
    return items.map(it => {
      const pos = { x, y: -it.h - x * 0.1 + (rnd() - 0.5) * it.h * 0.12 };
      x += it.w * (0.88 + rnd() * 0.08);
      return pos;
    });
  },
  // Two staggered rows: the second row is lower and shifted by half a step.
  zigzag(items, rnd) {
    const rowH = items.reduce((s, i) => s + i.h, 0) / items.length;
    const cursor = [0, 0];
    return items.map((it, i) => {
      const r = i % 2;
      if (r === 1 && cursor[1] === 0) cursor[1] = items[0].w * 0.45;
      const pos = { x: cursor[r], y: r * rowH * 0.6 - it.h + (rnd() - 0.5) * it.h * 0.1 };
      cursor[r] += it.w * (0.95 + rnd() * 0.1);
      return pos;
    });
  },
  // The largest object in the middle, the rest around it.
  cluster(items, rnd) {
    const hero = items[0];
    const angles = [-150, -30, 150, 30, 95, -95].map(a => (a + (rnd() - 0.5) * 16) * Math.PI / 180);
    return items.map((it, i) => {
      if (i === 0) return { x: -hero.w / 2, y: -hero.h / 2 };
      const a = angles[(i - 1) % angles.length];
      // Neighbours overlap the hero's edge a little, which reads as one assembled scene.
      const rx = (hero.w + it.w) * 0.34;
      const ry = (hero.h + it.h) * 0.36;
      return { x: Math.cos(a) * rx - it.w / 2, y: Math.sin(a) * ry - it.h / 2 };
    });
  },
};

// Library objects differ in size a lot (the coin is 5x smaller than the book). Sizes are
// compressed towards the median so small objects stay readable while keeping their hierarchy.
const MEDIAN_SIDE = 620;
const sizeFactor = (w, h) => (MEDIAN_SIDE / Math.sqrt(w * h)) ** 0.35;
const MAX_UPSCALE = 1.5;

/**
 * @param {object} opts
 * @param {Array<{id:string, variant:'main'|'bg'}>} opts.picks objects to place, most important first
 * @param {Record<string, {viewBox:number[]}>} opts.library parsed SVG per `${id}:${variant}`
 * @returns {Array<{uid, id, variant, x, y, scale, rotation, flip}>} items in paint order (back to front)
 */
export function compose({ picks, library, template = 'title', canvas = 'og', size = 'L', seed = 1 }) {
  const t = findTemplate(template);
  const c = findCanvas(canvas);
  const rnd = random(seed);
  const base = OBJECT_SIZES[size] ?? OBJECT_SIZES.L;
  const unit = UNIT[size] ?? 1;
  const sized = picks.map(p => {
    const [, , w, h] = library[libKey(p.id, p.variant, size)].viewBox;
    const k = base * sizeFactor(w * unit, h * unit) * (p.variant === 'bg' ? 0.75 : 1);
    return { ...p, w: w * k, h: h * k, k };
  });
  const main = sized.filter(p => p.variant === 'main');
  const back = sized.filter(p => p.variant === 'bg');
  // The cluster puts the biggest object in the middle; other arrangements keep the semantic order.
  const ordered = t.arrange === 'cluster' ? [...main].sort((a, b) => b.w * b.h - a.w * a.h) : main;
  const placed = ARRANGERS[t.arrange](ordered, rnd).map((pos, i) => ({ ...ordered[i], ...pos }));

  // Background objects sit behind the group: one peeks out top-left, the next bottom-right.
  const box0 = bounds(placed);
  back.forEach((b, i) => {
    const left = i % 2 === 0;
    placed.unshift({ ...b, x: left ? box0.x0 - b.w * 0.3 : box0.x1 - b.w * 0.7, y: left ? box0.y0 - b.h * 0.35 : box0.y1 - b.h * 0.75 });
  });

  // Fit the whole group into the template region.
  const box = bounds(placed);
  const [rx, ry, rw, rh] = [t.region[0] * c.width, t.region[1] * c.height, t.region[2] * c.width, t.region[3] * c.height];
  const fit = Math.min(MAX_UPSCALE * Math.min(c.width / 1200, c.height / 630, 1.6), rw / (box.x1 - box.x0), rh / (box.y1 - box.y0));
  const gw = (box.x1 - box.x0) * fit;
  const gh = (box.y1 - box.y0) * fit;
  const ox = t.anchor === 'center' ? rx + (rw - gw) / 2 : rx + rw - gw;
  const oy = t.anchor === 'right-bottom' ? ry + rh - gh : ry + (rh - gh) / 2;

  const items = placed.map((p, i) => ({
    uid: `${p.id}-${p.variant}-${seed}-${i}`,
    id: p.id,
    variant: p.variant,
    size,
    x: round(ox + (p.x - box.x0) * fit),
    y: round(oy + (p.y - box.y0) * fit),
    scale: round(p.k * fit, 4),
    rotation: 0,
    flip: false,
  }));
  // Isometric depth: whatever stands lower on the canvas is closer to the viewer.
  const bg = items.filter(i => i.variant === 'bg');
  const fg = items.filter(i => i.variant === 'main').sort((a, b) => bottom(a, library) - bottom(b, library));
  return [...bg, ...fg];
}

function bounds(list) {
  return list.reduce((b, p) => ({
    x0: Math.min(b.x0, p.x), y0: Math.min(b.y0, p.y), x1: Math.max(b.x1, p.x + p.w), y1: Math.max(b.y1, p.y + p.h),
  }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
}

const bottom = (item, library) => item.y + library[libKey(item.id, item.variant, item.size)].viewBox[3] * item.scale;
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
