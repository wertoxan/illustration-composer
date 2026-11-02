// Canvas editor: renders items into the stage SVG and handles move / rotate / scale gestures.
// The editor never edits geometry inside an object — only its transform.

import { renderInner, itemSize, outerTransform, placeTransform } from '../core/render.js';

const HANDLE = 9;

export class Editor {
  /**
   * @param {object} opts
   * @param {SVGSVGElement} opts.svg
   * @param {() => object} opts.getState returns { items, library, palette, canvas, background, selected }
   * @param {(patch: object, opts?: {commit?: boolean}) => void} opts.update applies a state change
   */
  constructor({ svg, getState, update }) {
    this.svg = svg;
    this.itemsLayer = svg.querySelector('#stage-items');
    this.overlay = svg.querySelector('#stage-overlay');
    this.bg = svg.querySelector('#stage-bg');
    this.getState = getState;
    this.update = update;
    this.cache = new Map();
    this.gesture = null;
    svg.addEventListener('pointerdown', e => this.onDown(e));
    svg.addEventListener('pointermove', e => this.onMove(e));
    svg.addEventListener('pointerup', e => this.onUp(e));
    svg.addEventListener('pointercancel', e => this.onUp(e));
  }

  /** Full redraw: used after structural changes (items added/removed, palette, canvas). */
  render() {
    const { items, library, palette, canvas, background } = this.getState();
    this.svg.setAttribute('viewBox', `0 0 ${canvas.width} ${canvas.height}`);
    this.bg.setAttribute('width', canvas.width);
    this.bg.setAttribute('height', canvas.height);
    this.bg.setAttribute('fill', background ? palette[0] : '#ffffff');
    const paletteKey = palette.join('');
    this.itemsLayer.innerHTML = items.map(item => {
      // Recolored markup is cached per object + palette; transforms are patched separately.
      const ck = `${item.id}:${item.variant}:${item.size ?? 'L'}:${item.flip}:${paletteKey}`;
      if (!this.cache.has(ck)) this.cache.set(ck, renderInner(item, library, palette));
      return `<g class="item" data-uid="${item.uid}" transform="${outerTransform(item, library)}">${this.cache.get(ck)}</g>`;
    }).join('');
    this.drawSelection();
  }

  /** Cheap update during a gesture: only the moving item's transform and the selection frame. */
  patch(item) {
    const node = this.itemsLayer.querySelector(`[data-uid="${CSS.escape(item.uid)}"]`);
    if (node) node.setAttribute('transform', outerTransform(item, this.getState().library));
    this.drawSelection();
  }

  drawSelection() {
    const { items, library, selected } = this.getState();
    const item = items.find(i => i.uid === selected);
    if (!item) { this.overlay.innerHTML = ''; return; }
    const { w, h } = itemSize(item, library);
    const z = this.zoom();
    const hs = HANDLE / z;
    const stroke = 1.5 / z;
    this.overlay.innerHTML = `
      <g transform="${placeTransform(item, library)}">
        <rect x="0" y="0" width="${w}" height="${h}" fill="none" stroke="#7864D7" stroke-width="${stroke}" stroke-dasharray="${6 / z} ${4 / z}"/>
        <line x1="${w / 2}" y1="0" x2="${w / 2}" y2="${-28 / z}" stroke="#7864D7" stroke-width="${stroke}"/>
        <circle data-handle="rotate" cx="${w / 2}" cy="${-28 / z}" r="${hs * 0.75}" fill="#fff" stroke="#7864D7" stroke-width="${stroke}" style="cursor:grab"/>
        <rect data-handle="scale" x="${w - hs / 2}" y="${h - hs / 2}" width="${hs}" height="${hs}" fill="#fff" stroke="#7864D7" stroke-width="${stroke}" style="cursor:nwse-resize"/>
      </g>`;
  }

  zoom() {
    const { canvas } = this.getState();
    return (this.svg.clientWidth || canvas.width) / canvas.width;
  }

  /** Screen point -> canvas coordinates. */
  point(e) {
    const p = this.svg.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    return p.matrixTransform(this.svg.getScreenCTM().inverse());
  }

  onDown(e) {
    const state = this.getState();
    const handle = e.target.closest('[data-handle]')?.dataset.handle;
    const node = e.target.closest('.item');
    const uid = handle ? state.selected : node?.dataset.uid;
    if (!uid) { this.update({ selected: null }); return; }
    const item = state.items.find(i => i.uid === uid);
    if (!item) return;
    if (uid !== state.selected) this.update({ selected: uid });
    const p = this.point(e);
    const { w, h } = itemSize(item, state.library);
    this.gesture = {
      mode: handle || 'move', uid, start: p, moved: false,
      orig: { ...item }, center: { x: item.x + w / 2, y: item.y + h / 2 },
    };
    this.svg.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  onMove(e) {
    const g = this.gesture;
    if (!g) return;
    const state = this.getState();
    const item = state.items.find(i => i.uid === g.uid);
    if (!item) return;
    const p = this.point(e);
    g.moved = true;
    if (g.mode === 'move') {
      item.x = g.orig.x + (p.x - g.start.x);
      item.y = g.orig.y + (p.y - g.start.y);
    } else if (g.mode === 'rotate') {
      let angle = Math.atan2(p.y - g.center.y, p.x - g.center.x) * 180 / Math.PI + 90;
      if (e.shiftKey) angle = Math.round(angle / 15) * 15;
      item.rotation = ((angle % 360) + 360) % 360;
    } else if (g.mode === 'scale') {
      const d0 = Math.hypot(g.start.x - g.center.x, g.start.y - g.center.y) || 1;
      const d1 = Math.hypot(p.x - g.center.x, p.y - g.center.y);
      item.scale = Math.max(0.02, g.orig.scale * d1 / d0);
      const { w, h } = itemSize(item, state.library);
      item.x = g.center.x - w / 2;
      item.y = g.center.y - h / 2;
    }
    this.patch(item);
  }

  onUp(e) {
    const g = this.gesture;
    this.gesture = null;
    if (this.svg.hasPointerCapture?.(e.pointerId)) this.svg.releasePointerCapture(e.pointerId);
    if (g?.moved) this.update({}, { commit: true });
  }
}
