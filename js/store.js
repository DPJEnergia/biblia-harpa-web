// Estado em localStorage (bh:state:v1). Sem DOM. Tolera storage que lança exceção.
export const KEY = 'bh:state:v1';
export const SCHEMA = 1;
export const COLORS = ['amarelo', 'verde', 'azul', 'rosa'];

export function defaultState() {
  return {
    schema: SCHEMA,
    settings: { theme: 'auto', fontSize: 18, version: 'acf', harpaFont: 20, watermark: true },
    pos: null,            // {book, chap, verse}
    lastHymn: null,       // número
    marks: {},            // "bookId:chap:verse" -> {color, note, fav, t}
    favHymns: [],         // números
    plan: null            // {start:'AAAA-MM-DD', days:30..360 (múltiplo de 30), done:[dias 1..days]}
  };
}

function isObj(o) { return o && typeof o === 'object' && !Array.isArray(o); }
export const ID_RE = /^[a-z0-9]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = t => {
  if (!DATE_RE.test(t)) return false;
  const [y, m, d] = t.split('-').map(Number), x = new Date(Date.UTC(y, m - 1, d));
  return x.getUTCFullYear() === y && x.getUTCMonth() === m - 1 && x.getUTCDate() === d;
};
const REF_RE = /^[a-z0-9]+:\d+:\d+$/;

// Valida e normaliza um estado/backup. Lança Error se inválido.
export function validateState(o) {
  if (!isObj(o)) throw new Error('Backup inválido: não é um objeto');
  if (o.schema !== SCHEMA) throw new Error('Backup inválido: versão de esquema desconhecida');
  const d = defaultState();
  const s = isObj(o.settings) ? o.settings : {};
  if (['auto', 'claro', 'sepia', 'escuro'].includes(s.theme)) d.settings.theme = s.theme;
  if (typeof s.watermark === 'boolean') d.settings.watermark = s.watermark;
  if (Number.isFinite(s.fontSize)) d.settings.fontSize = Math.min(32, Math.max(12, s.fontSize));
  if (Number.isFinite(s.harpaFont)) d.settings.harpaFont = Math.min(36, Math.max(12, s.harpaFont));
  if (s.version !== undefined && (typeof s.version !== 'string' || !ID_RE.test(s.version))) throw new Error('Backup inválido: versão');
  if (typeof s.version === 'string') d.settings.version = s.version;
  if (isObj(o.pos) && o.pos.book !== undefined && (typeof o.pos.book !== 'string' || !ID_RE.test(o.pos.book))) throw new Error('Backup inválido: posição');
  if (isObj(o.pos) && typeof o.pos.book === 'string' && Number.isInteger(o.pos.chap) && o.pos.chap > 0) {
    d.pos = { book: o.pos.book, chap: o.pos.chap, verse: Number.isInteger(o.pos.verse) && o.pos.verse > 0 ? o.pos.verse : 1 };
  }
  if (Number.isInteger(o.lastHymn) && o.lastHymn > 0) d.lastHymn = o.lastHymn;
  if (o.marks !== undefined && !isObj(o.marks)) throw new Error('Backup inválido: marcadores');
  for (const [k, m] of Object.entries(o.marks || {})) {
    if (!REF_RE.test(k) || !isObj(m)) throw new Error('Backup inválido: referência ' + k);
    const color = COLORS.includes(m.color) ? m.color : null;
    const note = typeof m.note === 'string' ? m.note : '';
    const fav = m.fav === true;
    if (color || note || fav) d.marks[k] = { color, note, fav, t: Number.isFinite(m.t) ? m.t : 0 };
  }
  if (o.favHymns !== undefined && !Array.isArray(o.favHymns)) throw new Error('Backup inválido: favoritos');
  d.favHymns = [...new Set((o.favHymns || []).filter(n => Number.isInteger(n) && n > 0))];
  if (o.plan !== undefined && o.plan !== null) {
    if (!isObj(o.plan) || typeof o.plan.start !== 'string' || !validDate(o.plan.start)) throw new Error('Backup inválido: plano');
    const done = Array.isArray(o.plan.done) ? o.plan.done : [];
    const days = o.plan.days === undefined ? 90 : o.plan.days;
    if (!Number.isInteger(days) || days < 30 || days > 360 || days % 30) throw new Error('Backup inválido: plano');
    d.plan = { start: o.plan.start, days, done: [...new Set(done.filter(n => Number.isInteger(n) && n >= 1 && n <= days))].sort((a, b) => a - b) };
  }
  return d;
}

export function parseBackup(text) {
  let o;
  try { o = JSON.parse(text); } catch (e) { throw new Error('Backup inválido: JSON malformado'); }
  return validateState(o);
}

export const refKey = (book, chap, verse) => `${book}:${chap}:${verse}`;
export function parseRef(k) { const [b, c, v] = k.split(':'); return { book: b, chap: +c, verse: +v }; }

// getStorage: função que devolve o objeto Storage (pode lançar).
export function createStore(getStorage = () => globalThis.localStorage) {
  let state = defaultState();
  let persistOk = true;
  const subs = new Set();
  const safe = fn => { try { return fn(getStorage()); } catch (e) { return undefined; } };

  function load() {
    const raw = safe(s => s.getItem(KEY));
    if (raw) { try { state = validateState(JSON.parse(raw)); } catch (e) { state = defaultState(); } }
    return state;
  }
  function save() {
    const r = safe(s => { s.setItem(KEY, JSON.stringify(state)); return true; });
    persistOk = r === true;
    return persistOk;
  }
  function emit() { subs.forEach(f => { try { f(state); } catch (e) { /* ignora */ } }); }
  function update(fn) { fn(state); save(); emit(); }

  load();
  // Sonda o armazenamento já na abertura (detecta storage bloqueado/cheio).
  persistOk = safe(s => { s.setItem(KEY + ':probe', '1'); s.removeItem(KEY + ':probe'); return true; }) === true;
  return {
    get state() { return state; },
    get persisted() { return persistOk; },
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
    reload: load,
    setSetting(k, v) { update(s => { s.settings[k] = v; }); },
    setPos(book, chap, verse = 1) { update(s => { s.pos = { book, chap, verse }; }); },
    setLastHymn(n) { update(s => { s.lastHymn = n; }); },
    getMark(ref) { return state.marks[ref] || null; },
    setMark(ref, patch) {
      update(s => {
        const m = Object.assign({ color: null, note: '', fav: false, t: 0 }, s.marks[ref], patch, { t: Date.now() });
        if (!m.color && !m.note && !m.fav) delete s.marks[ref]; else s.marks[ref] = m;
      });
    },
    deleteMark(ref) { update(s => { delete s.marks[ref]; }); },
    toggleHymnFav(n) {
      update(s => { const i = s.favHymns.indexOf(n); if (i >= 0) s.favHymns.splice(i, 1); else s.favHymns.push(n); });
    },
    startPlan(start, days = 90) { update(s => { s.plan = { start, days, done: [] }; }); },
    togglePlanDay(day) {
      update(s => {
        if (!s.plan || !Number.isInteger(day) || day < 1 || day > s.plan.days) return;
        const i = s.plan.done.indexOf(day);
        if (i >= 0) s.plan.done.splice(i, 1); else { s.plan.done.push(day); s.plan.done.sort((a, b) => a - b); }
      });
    },
    resetPlan() { update(s => { s.plan = null; }); },
    isHymnFav(n) { return state.favHymns.includes(n); },
    exportJSON() { return JSON.stringify(state, null, 1); },
    importJSON(text) { const ns = parseBackup(text); update(s => { state = ns; }); return state; },
    clear() { state = defaultState(); safe(s => s.removeItem(KEY)); emit(); }
  };
}
