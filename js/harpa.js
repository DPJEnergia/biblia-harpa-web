// Harpa Cristã: lógica pura (sem DOM).
import { norm, loadHarpa } from './data.js';

export function prepareHymns(list) {
  for (const h of list) {
    if (h._t === undefined) {
      h._t = norm(h.t);
      h._l = norm((h.v || []).join(' ') + ' ' + (h.c || ''));
    }
  }
  return list;
}

// Busca por número (exato, depois prefixo), título ou letra. Sem acentos/caixa.
export function searchHymns(list, q) {
  q = q.trim();
  if (!q) return list;
  prepareHymns(list);
  if (/^\d+$/.test(q)) {
    const exact = list.filter(h => String(h.n) === q);
    const pref = list.filter(h => String(h.n) !== q && String(h.n).startsWith(q));
    return exact.concat(pref);
  }
  const terms = norm(q).split(/\s+/).filter(Boolean);
  const inTitle = [], inLyric = [];
  for (const h of list) {
    if (terms.every(t => h._t.includes(t))) inTitle.push(h);
    else if (terms.every(t => (h._t + ' ' + h._l).includes(t))) inLyric.push(h);
  }
  return inTitle.concat(inLyric);
}

// Sequência tradicional: estrofe, coro, estrofe, coro...
export function hymnBlocks(h) {
  const out = [];
  const vs = h.v && h.v.length ? h.v : [];
  const coro = h.c && h.c.trim() ? h.c : null;
  vs.forEach((v, i) => {
    out.push({ type: 'estrofe', num: i + 1, text: v });
    if (coro) out.push({ type: 'coro', text: coro });
  });
  if (!vs.length && coro) out.push({ type: 'coro', text: coro });
  return out;
}

export function hymnNeighbor(list, n, dir) {
  const i = list.findIndex(h => h.n === n);
  if (i < 0) return null;
  const j = i + dir;
  return j >= 0 && j < list.length ? list[j].n : null;
}

export const getHymns = async () => prepareHymns(await loadHarpa());

export function formatHymnText(h) {
  return hymnBlocks(h).map(b => (b.type === 'coro' ? 'Coro:\n' : b.num + '.\n') + b.text).join('\n\n');
}
