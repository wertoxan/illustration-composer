// Generates the sample compositions in examples/ with exactly the same core code the web app uses.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OBJECTS, SIZES, fileFor, libKey } from '../js/core/catalog.js';
import { parseSvg } from '../js/core/svg.js';
import { PRESETS } from '../js/core/palette.js';
import { pickByMetaphor, pickByNames } from '../js/core/metaphor.js';
import { compose, findCanvas } from '../js/core/layout.js';
import { exportSvg } from '../js/core/render.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const library = {};
for (const o of OBJECTS) {
  for (const size of Object.keys(SIZES)) {
    for (const variant of ['main', 'bg']) {
      library[libKey(o.id, variant, size)] = parseSvg(readFileSync(join(root, fileFor(o.id, variant, size)), 'utf8'));
    }
  }
}

export const EXAMPLES = [
  { file: '01-metaphor-savings.svg', mode: 'metaphor', text: 'Как начать копить деньги и защитить свои сбережения', template: 'title', palette: 'peach', canvas: 'og', size: 'L', background: 1, seed: 3 },
  { file: '02-metaphor-learning.svg', mode: 'metaphor', text: 'Онлайн-обучение: курсы, вебинары и подкасты', template: 'compact', palette: 'mint', canvas: 'og', size: 'L', background: 1, seed: 7 },
  { file: '03-names-office.svg', mode: 'names', text: 'папка, ручка, лампа, пазл', template: 'offset', palette: 'lavender', canvas: 'og', size: 'S', background: 2, seed: 11 },
];

export function buildExample(ex) {
  const picked = ex.mode === 'names' ? pickByNames(ex.text).ids : pickByMetaphor(ex.text).ids;
  const extras = OBJECTS.map(o => o.id).filter(id => !picked.includes(id)).slice(0, ex.background);
  const picks = [...picked.map(id => ({ id, variant: 'main' })), ...extras.map(id => ({ id, variant: 'bg' }))];
  const items = compose({ picks, library, template: ex.template, canvas: ex.canvas, size: ex.size, seed: ex.seed });
  const palette = PRESETS.find(p => p.id === ex.palette).colors;
  return { picked, svg: exportSvg({ items, library, palette, canvas: findCanvas(ex.canvas), title: ex.text }) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  mkdirSync(join(root, 'examples'), { recursive: true });
  for (const ex of EXAMPLES) {
    const { picked, svg } = buildExample(ex);
    writeFileSync(join(root, 'examples', ex.file), svg);
    console.log(`${ex.file}: ${picked.join(', ')} (${Math.round(svg.length / 1024)} KB)`);
  }
}
