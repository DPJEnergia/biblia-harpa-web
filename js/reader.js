// Lógica de leitura (sem DOM): referências, formatação, agrupamento.
import { refKey, parseRef, COLORS } from './store.js';
import { verseText } from './data.js';

export { refKey, parseRef, COLORS };

export function refLabel(books, ref) {
  const { book, chap, verse } = typeof ref === 'string' ? parseRef(ref) : ref;
  const b = books.find(x => x.id === book);
  return `${b ? b.n : book} ${chap}:${verse}`;
}

// Agrupa marcas por livro (ordem canônica). filter: null (cores/notas), cor, ou 'fav'.
export function groupMarks(books, marks, filter = null) {
  const order = new Map(books.map((b, i) => [b.id, i]));
  const rows = Object.entries(marks)
    .filter(([, m]) => !filter ? (m.color || m.note) : filter === 'fav' ? m.fav : m.color === filter)
    .map(([k, m]) => ({ key: k, ...parseRef(k), m }))
    .sort((a, b) => (order.get(a.book) ?? 999) - (order.get(b.book) ?? 999) || a.chap - b.chap || a.verse - b.verse);
  const groups = [];
  for (const r of rows) {
    const last = groups[groups.length - 1];
    if (last && last.book === r.book) last.rows.push(r);
    else groups.push({ book: r.book, rows: [r] });
  }
  return groups;
}

export function shareText(ver, books, book, chap, verse) {
  const t = verseText(ver, book, chap, verse) || '';
  return `“${t}” — ${refLabel(books, { book, chap, verse })} (${ver.id.toUpperCase()})`;
}
