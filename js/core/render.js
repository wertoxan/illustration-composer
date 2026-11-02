// Turns a composition (items + palette) into SVG markup. Used both by the editor canvas and the export.

import { recolorBody, escapeXml } from './svg.js';
import { buildColorMap } from './palette.js';
import { libKey } from './catalog.js';

/** Item size on the canvas (before rotation). */
export function itemSize(item, library) {
  const [, , w, h] = library[key(item)].viewBox;
  return { w: w * item.scale, h: h * item.scale };
}

export const key = item => libKey(item.id, item.variant, item.size ?? 'L');

/** Position plus rotation around the item's center (the frame the selection box is drawn in). */
export function placeTransform(item, library) {
  const { w, h } = itemSize(item, library);
  const r = item.rotation ? ` rotate(${round(item.rotation)} ${round(w / 2)} ${round(h / 2)})` : '';
  return `translate(${round(item.x)} ${round(item.y)})${r}`;
}

/** Everything that changes during editing lives here, so gestures only patch one attribute. */
export function outerTransform(item, library) {
  return `${placeTransform(item, library)} scale(${+item.scale.toFixed(5)})`;
}

/** Optional mirror and shift of the source viewBox to the origin; independent of position and size. */
export function innerTransform(item, library) {
  const [vx, vy, vw] = library[key(item)].viewBox;
  const flip = item.flip ? `translate(${round(vw)} 0) scale(-1 1) ` : '';
  return `${flip}translate(${round(-vx)} ${round(-vy)})`;
}

/** Inner markup of an item (recolored body inside the viewBox shift); cacheable per object + palette. */
export function renderInner(item, library, palette) {
  const lib = library[key(item)];
  const body = recolorBody(lib.body, buildColorMap(lib.colors, palette));
  return `<g transform="${innerTransform(item, library)}">${body}</g>`;
}

export function renderItem(item, library, palette, attrs = '') {
  return `<g ${attrs} transform="${outerTransform(item, library)}">${renderInner(item, library, palette)}</g>`;
}

/** Standalone, editable SVG: every object stays a separate named group of original vector paths. */
export function exportSvg({ items, library, palette, canvas, background = true, title = 'Композиция' }) {
  const parts = items.map(item => renderItem(item, library, palette,
    `id="${escapeXml(item.uid)}" data-object="${escapeXml(item.id)}" data-size="${item.size ?? 'L'}" data-variant="${item.variant}"`));
  const bg = background ? `<rect id="background" width="${canvas.width}" height="${canvas.height}" fill="${palette[0]}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}" fill="none">\n` +
    `<title>${escapeXml(title)}</title>\n${bg}\n${parts.join('\n')}\n</svg>\n`;
}

const round = v => Math.round(v * 100) / 100;
