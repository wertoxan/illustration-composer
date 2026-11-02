// Palettes are 8 colors in fixed roles, exactly as the library's style guide lays them out.
// The source illustrations are drawn in the "Лаванда" palette, so recoloring is a role-to-role swap.

export const ROLES = [
  { key: 'light', title: 'Фон' },
  { key: 'mid', title: 'Средний' },
  { key: 'dark', title: 'Тёмный' },
  { key: 'ink', title: 'Контур' },
  { key: 'accent1', title: 'Акцент 1' },
  { key: 'accent2', title: 'Акцент 2' },
  { key: 'accent3', title: 'Акцент 3' },
  { key: 'white', title: 'Белый' },
];

export const PRESETS = [
  { id: 'lavender', title: 'Лаванда', colors: ['#D7CDF5', '#AA9BF0', '#7864D7', '#181817', '#F9ECB0', '#F9A3AA', '#FFE3E1', '#FFFFFF'] },
  { id: 'peach', title: 'Персик', colors: ['#FDD7B9', '#FAC896', '#D27532', '#181817', '#F9ECB0', '#80DADA', '#BEEBEB', '#FFFFFF'] },
  { id: 'mint', title: 'Мята', colors: ['#BEEBEB', '#80DADA', '#5ABEBE', '#181817', '#FFD4F2', '#6D7BFC', '#B6C6FE', '#FFFFFF'] },
];

export const SOURCE = PRESETS[0].colors;

const hexToRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const luminance = hex => {
  const [r, g, b] = hexToRgb(hex).map(v => v / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const distance = (a, b) => {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return (r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2;
};

/**
 * Style-guide rule: background colors may appear in objects, object colors may not be used as a background.
 * Returns the role title whose color clashes with the background, or null.
 */
export function backgroundConflict(palette) {
  const bg = palette[0].toUpperCase();
  const clash = palette.findIndex((c, i) => i > 0 && i < 7 && c.toUpperCase() === bg);
  return clash > 0 ? ROLES[clash].title : null;
}

/** Index of the source role closest to `hex`; used for colors that are not exact palette colors. */
export function nearestRole(hex) {
  let best = 0;
  SOURCE.forEach((c, i) => { if (distance(c, hex) < distance(SOURCE[best], hex)) best = i; });
  return best;
}

/**
 * Builds a color map for the given object colors.
 * Exact palette colors move role-to-role; other colors follow their nearest role, except
 * when the target is the source palette itself (then they stay untouched).
 */
export function buildColorMap(objectColors, palette) {
  const map = new Map();
  const isSource = palette.every((c, i) => c.toUpperCase() === SOURCE[i]);
  for (const color of objectColors) {
    const exact = SOURCE.indexOf(color);
    if (exact >= 0) map.set(color, palette[exact].toUpperCase());
    else if (!isSource) map.set(color, palette[nearestRole(color)].toUpperCase());
  }
  return map;
}

/** Extracts hex colors from any text: JSON, CSS variables, a .gpl file, a plain list. */
export function parsePaletteText(text) {
  const found = [...text.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)].map(m => {
    const h = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1];
    return `#${h.toUpperCase()}`;
  });
  return [...new Set(found)];
}

/**
 * Turns an arbitrary list of colors into the 8 roles.
 * 8 colors are taken in role order (the format the style guide uses). Otherwise the
 * near-black and near-white colors fill ink/white, the rest are sorted by lightness:
 * lightest -> background, darkest -> dark, middle -> mid, remaining -> accents.
 */
export function paletteFromColors(colors) {
  if (colors.length === 0) throw new Error('В файле не найдено ни одного цвета (#RRGGBB)');
  if (colors.length === 8) return [...colors];
  const byLum = [...colors].sort((a, b) => luminance(a) - luminance(b));
  const ink = luminance(byLum[0]) < 0.08 ? byLum[0] : SOURCE[3];
  const white = luminance(byLum[byLum.length - 1]) > 0.97 ? byLum[byLum.length - 1] : SOURCE[7];
  const rest = colors.filter(c => c !== ink && c !== white).sort((a, b) => luminance(b) - luminance(a));
  const pool = rest.length ? rest : [ink];
  const pick = i => pool[Math.min(i, pool.length - 1)];
  const light = pick(0);
  const dark = pool[pool.length - 1];
  const mid = pick(Math.floor((pool.length - 1) / 2));
  const accents = pool.filter(c => c !== light && c !== dark && c !== mid);
  // With few colors the accents reuse other palette colors instead of repeating one.
  const fallback = [mid, light, dark];
  const accent = i => accents[i] ?? fallback[(i - accents.length) % fallback.length];
  return [light, mid, dark, ink, accent(0), accent(1), accent(2), white];
}
