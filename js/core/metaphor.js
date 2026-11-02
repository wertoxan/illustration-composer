// Scenario 1 (metaphor/headline -> objects) and scenario 2 (object names -> objects).
// Matching is done on word stems, so "сбережений", "сбережения" and "сберегать" hit the same concept.

import { OBJECTS, COMPANIONS } from './catalog.js';

const ENDINGS = [
  'иями', 'ями', 'ами', 'ого', 'его', 'ому', 'ему', 'ыми', 'ими', 'иях', 'ях', 'ах', 'ией',
  'ов', 'ев', 'ей', 'ой', 'ий', 'ый', 'ая', 'яя', 'ое', 'ее', 'ые', 'ие', 'ую', 'юю', 'ом', 'ем', 'им', 'ым',
  'ия', 'ие', 'ию', 'ии', 'ть', 'ться', 'ешь', 'ет', 'ут', 'ют', 'ишь', 'ит', 'ат', 'ят', 'ла', 'ли', 'ло',
  'а', 'я', 'о', 'е', 'ы', 'и', 'у', 'ю', 'ь', 'й',
].sort((a, b) => b.length - a.length);

const STOP = new Set(['и', 'в', 'во', 'на', 'с', 'со', 'к', 'по', 'для', 'от', 'до', 'из', 'за', 'о', 'об', 'не',
  'как', 'что', 'это', 'а', 'но', 'или', 'ваш', 'ваши', 'наш', 'наши', 'мы', 'вы', 'ты', 'он', 'она', 'они', 'все',
  'всё', 'без', 'при', 'про', 'то', 'же', 'ли', 'бы', 'так', 'уже', 'еще', 'ещё', 'свой', 'свои', 'своих']);

/** Lowercases, folds ё and strips the longest known ending, keeping at least 3 letters. */
export function stem(word) {
  const w = word.toLowerCase().replace(/ё/g, 'е');
  for (const end of ENDINGS) {
    if (w.length - end.length >= 3 && w.endsWith(end)) return w.slice(0, -end.length);
  }
  return w;
}

export function tokenize(text) {
  return (text.toLowerCase().replace(/ё/g, 'е').match(/[a-zа-я0-9]+/g) || []).filter(t => !STOP.has(t) && t.length > 1);
}

// Prefix matches only between close word forms ("защит"/"защити"), not "копи"/"копирайтинг".
const stemsMatch = (a, b) => {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 4 && long.length - short.length <= 2 && long.startsWith(short);
};

const INDEX = OBJECTS.map(o => ({
  id: o.id,
  names: o.aliases.map(stem),
  concepts: o.concepts.map(c => ({ raw: c.replace(/ё/g, 'е'), stems: (c.match(/[a-zа-яё0-9]+/gi) || []).map(stem) })),
}));

/**
 * Scores every object against the text. Names weigh more than associations;
 * multi-word concepts ("8 марта", "база знаний") count only when the whole phrase is present.
 */
export function scoreObjects(text) {
  const tokens = tokenize(text);
  const stems = tokens.map(stem);
  const lower = text.toLowerCase().replace(/ё/g, 'е');
  return INDEX.map(entry => {
    let score = 0;
    const reasons = [];
    stems.forEach((s, i) => {
      if (entry.names.some(n => stemsMatch(n, s))) { score += 5; reasons.push(tokens[i]); }
    });
    for (const concept of entry.concepts) {
      const hit = concept.stems.length > 1
        ? lower.includes(concept.raw)
        : stems.some(s => stemsMatch(concept.stems[0], s));
      if (hit) { score += 2; reasons.push(concept.raw); }
    }
    return { id: entry.id, score, reasons: [...new Set(reasons)] };
  }).filter(r => r.score > 0).sort((a, b) => b.score - a.score);
}

/** Adds companion objects until the composition has at least `min` items. */
function complete(ids, min, max) {
  const result = [...ids];
  for (const id of ids) {
    for (const c of COMPANIONS[id] || []) {
      if (result.length >= min) break;
      if (!result.includes(c)) result.push(c);
    }
  }
  for (const o of OBJECTS) {
    if (result.length >= min) break;
    if (!result.includes(o.id)) result.push(o.id);
  }
  return result.slice(0, max);
}

/** Scenario 1: metaphor or headline. Returns picked ids plus a human-readable explanation. */
export function pickByMetaphor(text, { min = 3, max = 4 } = {}) {
  const scored = scoreObjects(text);
  const direct = scored.slice(0, max).map(s => s.id);
  const ids = complete(direct, min, max);
  const explain = ids.map(id => {
    const s = scored.find(r => r.id === id);
    return { id, reasons: s ? s.reasons : [], companion: !s };
  });
  return { ids, explain, matched: scored.length > 0 };
}

/** Scenario 2: explicit object names ("книга, лампа и ручка"). Unknown words are reported back. */
export function pickByNames(text) {
  const ids = [];
  const unknown = [];
  for (const token of tokenize(text)) {
    const s = stem(token);
    const hit = INDEX.find(e => e.names.some(n => stemsMatch(n, s)));
    if (hit) { if (!ids.includes(hit.id)) ids.push(hit.id); } else unknown.push(token);
  }
  return { ids, unknown };
}
