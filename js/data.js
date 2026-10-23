// Carregamento de dados e lógica pura (sem DOM) de busca/mapeamento.
let BASE = './data/';
export function setBase(b) { BASE = b.endsWith('/') ? b : b + '/'; }

// minúsculas, sem acentos
export function norm(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

let fetchJSON = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error('Falha ao carregar ' + url + ' (' + r.status + ')');
  return r.json();
};
export function setFetcher(f) { fetchJSON = f; }

const cache = { books: null, versions: null, harpa: null, meta: null, plano: null, bibles: new Map() };

export async function loadBooks() { return cache.books || (cache.books = await fetchJSON(BASE + 'books.json')); }
export async function loadVersions() { return cache.versions || (cache.versions = await fetchJSON(BASE + 'versions.json')); }
export async function loadMeta() {
  if (!cache.meta) { try { cache.meta = await fetchJSON(BASE + 'meta.json'); } catch (e) { cache.meta = {}; } }
  return cache.meta;
}
export async function loadPlano() { return cache.plano || (cache.plano = await fetchJSON(BASE + 'plano.json')); }
export async function loadHarpa() { return cache.harpa || (cache.harpa = await fetchJSON(BASE + 'harpa.json')); }

// Carrega versão sob demanda e indexa livros por id.
export async function loadVersion(id) {
  if (cache.bibles.has(id)) return cache.bibles.get(id);
  const versions = await loadVersions();
  const meta = versions.find(v => v.id === id);
  if (!meta) throw new Error('Versão desconhecida: ' + id);
  const p = fetchJSON(BASE + meta.file).then(b => {
    b.byId = {};
    for (const bk of b.books) b.byId[bk.id] = bk;
    b.meta = meta;
    return b;
  });
  cache.bibles.set(id, p);
  try { return await p; } catch (e) { cache.bibles.delete(id); throw e; }
}

export const chapterCount = (ver, bookId) => (ver.byId[bookId] ? ver.byId[bookId].c.length : 0);
export const verseCount = (ver, bookId, chap) => {
  const b = ver.byId[bookId]; return b && b.c[chap - 1] ? b.c[chap - 1].length : 0;
};

// Mapeia posição entre versões: mantém livro+capítulo, limita capítulo e versículo.
export function clampPos(ver, book, chap, verse) {
  if (!ver.byId[book]) { book = ver.books[0].id; chap = 1; verse = 1; }
  const nc = chapterCount(ver, book);
  chap = Math.min(Math.max(1, chap | 0 || 1), nc);
  const nv = verseCount(ver, book, chap);
  verse = Math.min(Math.max(1, verse | 0 || 1), Math.max(1, nv));
  return { book, chap, verse };
}

// Capítulo anterior/seguinte atravessando livros. dir = -1 | 1. Retorna null nas pontas.
export function neighbor(ver, book, chap, dir) {
  const i = ver.books.findIndex(b => b.id === book);
  if (i < 0) return null;
  const nc = ver.books[i].c.length;
  if (dir > 0) {
    if (chap < nc) return { book, chap: chap + 1 };
    return i + 1 < ver.books.length ? { book: ver.books[i + 1].id, chap: 1 } : null;
  }
  if (chap > 1) return { book, chap: chap - 1 };
  if (i === 0) return null;
  const pb = ver.books[i - 1];
  return { book: pb.id, chap: pb.c.length };
}

// Índice lazy: normaliza em fatias para não travar a UI.
export async function buildIndex(ver, yieldFn = () => new Promise(r => setTimeout(r, 0))) {
  if (ver._idx) return ver._idx;
  if (ver._idxP) return ver._idxP;
  ver._idxP = (async () => {
    const idx = [];
    let n = 0;
    for (const b of ver.books) {
      for (let c = 0; c < b.c.length; c++) {
        const ch = b.c[c];
        for (let v = 0; v < ch.length; v++) {
          idx.push({ b: b.id, c: c + 1, v: v + 1, n: norm(ch[v]) });
          if (++n % 4000 === 0) await yieldFn();
        }
      }
    }
    ver._idx = idx;
    return idx;
  })();
  return ver._idxP;
}

// Todos os termos (AND), sem acento/caixa. Retorna {total, items} com paginação.
export function searchIndex(idx, query, { offset = 0, limit = 50 } = {}) {
  const terms = norm(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return { total: 0, items: [] };
  // Palavra inteira antes de substring ("amor" antes de "amorreus"); ordem canônica dentro de cada grupo.
  const whole = [], part = [];
  for (const e of idx) {
    let ok = true;
    for (const t of terms) if (!e.n.includes(t)) { ok = false; break; }
    if (!ok) continue;
    const padded = ' ' + e.n.replace(/[^a-z0-9]+/g, ' ') + ' ';
    (terms.every(t => padded.includes(' ' + t + ' ')) ? whole : part).push(e);
  }
  const all = whole.length ? (part.length ? whole.concat(part) : whole) : part;
  return { total: all.length, items: all.slice(offset, offset + limit) };
}

export function verseText(ver, book, chap, verse) {
  const b = ver.byId[book];
  return b && b.c[chap - 1] ? b.c[chap - 1][verse - 1] || null : null;
}
