// DOM-free SVG helpers so the same code runs in the browser and in Node (example generation, tests).

const SHAPE_TAGS = 'path|rect|circle|ellipse|line|polygon|polyline';

/** Parses an SVG document into its viewBox and drawable body, keeping every shape as-is (vector, untouched). */
export function parseSvg(text) {
  const open = text.match(/<svg\b[^>]*>/i);
  if (!open) throw new Error('Файл не похож на SVG');
  const vbMatch = open[0].match(/viewBox="([^"]+)"/i);
  let viewBox;
  if (vbMatch) {
    viewBox = vbMatch[1].trim().split(/[\s,]+/).map(Number);
  } else {
    const w = parseFloat(open[0].match(/width="([\d.]+)/i)?.[1] ?? '0');
    const h = parseFloat(open[0].match(/height="([\d.]+)/i)?.[1] ?? '0');
    viewBox = [0, 0, w, h];
  }
  if (viewBox.length !== 4 || viewBox.some(Number.isNaN) || viewBox[2] <= 0 || viewBox[3] <= 0) {
    throw new Error('У SVG нет корректного viewBox или размеров');
  }
  const start = open.index + open[0].length;
  const end = text.lastIndexOf('</svg>');
  const body = text.slice(start, end < 0 ? undefined : end).trim();
  if (!new RegExp(`<(${SHAPE_TAGS})\\b`, 'i').test(body)) throw new Error('В SVG нет векторных фигур');
  // The body is injected into the page, so anything executable is rejected outright.
  if (/<script\b|<foreignObject\b|\son\w+\s*=|javascript:/i.test(body)) throw new Error('SVG содержит скрипты — такой файл не принимаем');
  return { viewBox, body, colors: collectColors(body) };
}

const NAMED = { white: '#FFFFFF', black: '#000000' };

/** Normalizes a paint value to #RRGGBB, or returns null for none/url()/currentColor. */
export function normalizeColor(value) {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (NAMED[v]) return NAMED[v];
  const short = v.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toUpperCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v.toUpperCase();
  return null;
}

/** Unique solid colors used in fill/stroke attributes. */
export function collectColors(body) {
  const set = new Set();
  for (const m of body.matchAll(/\s(?:fill|stroke)="([^"]+)"/g)) {
    const c = normalizeColor(m[1]);
    if (c) set.add(c);
  }
  return [...set];
}

/** Replaces fill/stroke colors through `map` (normalized hex -> hex). Geometry is never touched. */
export function recolorBody(body, map) {
  if (!map || map.size === 0) return body;
  return body.replace(/(\s(?:fill|stroke)=")([^"]+)(")/g, (all, a, value, b) => {
    const to = map.get(normalizeColor(value));
    return to ? `${a}${to}${b}` : all;
  });
}

export const escapeXml = s => String(s).replace(/[<>&"']/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[ch]));
