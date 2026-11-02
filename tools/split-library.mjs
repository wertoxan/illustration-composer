// Cuts the flat Figma "Copy as SVG" exports of the library (sizes L and S) into one SVG file per object.
// Shape indices and bounding boxes come from tools/split.html (proximity clustering in the browser).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAD = 2;

const SOURCES = {
  L: {
    file: 'size_L.svg', shapes: 1610, out: 'library',
    indices: {
      main: { book: '164,166-218', lamp: '750-776', phone: '272-426', puzzle: '26-82', lock: '1068-1203', flowers: '1348-1478', headphones: '582-665', wallet: '804-889', folder: '1024-1045', pen: '976-999' },
      bg: { book: '165,219-271', lamp: '777-803', phone: '427-581', puzzle: '83-139', lock: '1204-1339', flowers: '1479-1609', headphones: '666-749', wallet: '890-975', folder: '1046-1067', pen: '1000-1023' },
    },
    boxes: {
      main: { book: [391.64, 3467.37, 1445.89, 976.67], lamp: [1822.23, 4438.75, 945.94, 1128.99], phone: [2038.58, 3718.64, 796.53, 461.67], puzzle: [3100.24, 3827.74, 544.16, 313.54], lock: [4005.3, 3945.82, 286.68, 188.5], flowers: [3036.02, 4712.72, 590.57, 747.11], headphones: [470.02, 4803.09, 888.15, 691.54], wallet: [3868.26, 5095.11, 630.42, 396.31], folder: [365.27, 5920.18, 1240.62, 658.58], pen: [1795.8, 6127.63, 508.43, 285.4] },
      bg: { book: [391.64, 7491.56, 1445.89, 976.66], lamp: [1822.23, 8462.94, 945.94, 1128.98], phone: [2038.58, 7742.82, 796.53, 461.67], puzzle: [3100.24, 7851.93, 544.16, 313.53], lock: [4005.3, 7970, 286.68, 188.5], flowers: [3060.92, 8797.6, 590.57, 747.11], headphones: [470.02, 8827.27, 888.15, 691.54], wallet: [3868.26, 9119.29, 630.42, 396.32], folder: [365.27, 9944.36, 1240.62, 658.61], pen: [1795.8, 10151.84, 508.43, 285.36] },
    },
  },
  S: {
    file: 'size_S.svg', shapes: 1526, out: 'library/s',
    indices: {
      main: { book: '312-362', phone: '363-458', puzzle: '459-515', lock: '516-645', lamp: '725-751', headphones: '646-724', flowers: '2-132', wallet: '796-878', folder: '752-771', pen: '772-795' },
      bg: { book: '879-932', phone: '933-1087', puzzle: '1088-1144', lock: '1145-1280', lamp: '1365-1391', headphones: '1281-1364', flowers: '133-263', wallet: '1438-1523', folder: '1392-1413', pen: '1414-1437' },
    },
    boxes: {
      main: { book: [268.39, 2060.39, 722.95, 488.33], phone: [1294.23, 2253.16, 398.26, 230.84], puzzle: [1925.34, 2284.12, 272.08, 156.76], lock: [2498.23, 2339.8, 152.4, 100.2], lamp: [1192, 2818.27, 472.97, 564.49], headphones: [374.86, 2935.98, 444.07, 345.77], flowers: [1918.91, 2948.58, 323.27, 408.95], wallet: [2399.5, 3187.65, 315.21, 198.15], folder: [261.27, 3741.49, 620.31, 329.29], pen: [1298.06, 3857.54, 254.21, 142.7] },
      bg: { book: [268.39, 5161.8, 722.95, 488.33], phone: [1294.23, 5354.57, 398.26, 230.84], puzzle: [1925.34, 5385.52, 272.08, 156.77], lock: [2498.23, 5441.2, 152.39, 100.21], lamp: [1192, 5919.67, 472.97, 564.49], headphones: [374.86, 6037.39, 444.07, 345.77], flowers: [1891.27, 6051.98, 323.27, 408.95], wallet: [2399.5, 6289.05, 315.21, 198.16], folder: [261.27, 6842.9, 620.31, 329.3], pen: [1298.06, 6958.94, 254.21, 142.7] },
    },
  },
};

const parseRanges = spec => spec.split(',').flatMap(part => {
  const [a, b] = part.split('-').map(Number);
  return b === undefined ? [a] : Array.from({ length: b - a + 1 }, (_, i) => a + i);
});

for (const [size, src] of Object.entries(SOURCES)) {
  const text = readFileSync(join(root, 'source', src.file), 'utf8');
  // Document-order list of drawable elements outside <defs>, matching the browser's querySelectorAll order.
  const body = text.replace(/<defs>[\s\S]*?<\/defs>/g, '');
  const shapes = [...body.matchAll(/<(path|rect|circle|ellipse|line|polygon|polyline)\b[^>]*?\/>/g)].map(m => m[0]);
  if (shapes.length !== src.shapes) throw new Error(`${src.file}: expected ${src.shapes} shapes, found ${shapes.length}`);
  const outDir = join(root, src.out);
  mkdirSync(outDir, { recursive: true });
  for (const [set, objects] of Object.entries(src.indices)) {
    for (const [name, spec] of Object.entries(objects)) {
      const [x, y, w, h] = src.boxes[set][name];
      const vb = [x - PAD, y - PAD, w + PAD * 2, h + PAD * 2].map(v => +v.toFixed(2));
      const content = parseRanges(spec).map(i => shapes[i]).join('\n');
      const file = `${name}${set === 'bg' ? '-bg' : ''}.svg`;
      writeFileSync(join(outDir, file), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(' ')}" width="${vb[2]}" height="${vb[3]}" fill="none">\n${content}\n</svg>\n`);
    }
  }
  console.log(`${size}: 20 files -> ${src.out}/`);
}
