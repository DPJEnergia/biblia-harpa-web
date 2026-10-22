// Roteamento e UI. Lógica pura está em store/data/reader/harpa.
import { createStore, COLORS, refKey } from './store.js';
import * as data from './data.js';
import * as reader from './reader.js';
import * as harpa from './harpa.js';
import * as plano from './plano.js';

const store = createStore(() => window.localStorage);
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const main = $('#main'), title = $('#title'), topbar = $('#topbar');
const tabsOrder = ['inicio', 'biblia', 'harpa', 'marcadores', 'mais'];

// Slots persistentes para módulos externos (audio.js / votd.js).
const votdSlot = document.createElement('div');
votdSlot.id = 'votd-slot';
const audioSlot = $('#audio-slot');

const BH = { store, data, reader, harpa, navigate, route: null, view: null, toast };
window.BH = BH;

function navigate(hash) {
  if (location.hash === hash) render(true); else location.hash = hash;
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 2600);
}

// ---------- tema / fonte ----------
function applyTheme() {
  const s = store.state.settings;
  document.documentElement.dataset.theme = s.theme;
  document.documentElement.dataset.wm = s.watermark ? 'on' : 'off';
  document.documentElement.style.setProperty('--fs', s.fontSize + 'px');
  document.documentElement.style.setProperty('--fs-h', s.harpaFont + 'px');
  const meta = $('meta[name=theme-color]');
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--bar').trim() || '#1b2a4a';
}

// ---------- helpers ----------
async function currentVersion() {
  const id = store.state.settings.version;
  try { return await data.loadVersion(id); }
  catch (e) {
    const vs = await data.loadVersions();
    for (const v of vs) { try { const b = await data.loadVersion(v.id); store.setSetting('version', v.id); return b; } catch (e2) { /* tenta próxima */ } }
    throw e;
  }
}
function errorView(e, retry) {
  main.innerHTML = `<div class="card"><p>Não foi possível carregar os dados.</p><p class="muted">${esc(e.message || e)}</p><button class="btn" id="retry">Tentar de novo</button></div>`;
  $('#retry').onclick = retry;
}
function setTitle(t, opts = {}) {
  title.textContent = t;
  $('#back').hidden = !opts.back;
  $('#back').onclick = () => history.length > 1 ? history.back() : navigate('#/inicio');
  audioSlot.hidden = !opts.audio;
}
function setNav(tab) {
  document.querySelectorAll('#nav a').forEach(a => {
    const on = a.dataset.tab === tab;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}
function readHash() { return location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent); }
const enc = s => encodeURIComponent(String(s));
const num = n => String(parseInt(n, 10) || 0);
const readHref = p => (`#/ler/${enc(p.book)}/${num(p.chap)}/${num(p.verse) === '0' ? 1 : num(p.verse)}`);

// ---------- roteador ----------
let renderToken = 0;
async function render(keep = false) {
  const token = ++renderToken;
  const parts = readHash();
  const name = parts[0] || 'inicio';
  BH.route = parts;
  if (keep !== true) window.scrollTo(0, 0);
  try {
    if (name === 'inicio') await viewHome();
    else if (name === 'ler') await viewRead(parts, token);
    else if (name === 'biblia') await viewBooks(parts);
    else if (name === 'busca') await viewSearch();
    else if (name === 'harpa') await viewHarpa(parts);
    else if (name === 'marcadores') await viewMarks(parts);
    else if (name === 'plano') await viewPlan();
    else if (name === 'mais') await viewSettings();
    else { location.hash = '#/inicio'; return; }
  } catch (e) { errorView(e, render); }
  if (token === renderToken) document.dispatchEvent(new CustomEvent('bh:render', { detail: { route: parts, view: BH.view } }));
}
window.addEventListener('hashchange', () => render());

// ---------- Início ----------
async function viewHome() {
  setTitle('Bíblia e Harpa'); setNav('inicio'); BH.view = null;
  const st = store.state;
  let cont = '', hymn = '';
  try {
    const books = await data.loadBooks();
    const p = st.pos || { book: books[0].id, chap: 1, verse: 1 };
    const lab = reader.refLabel(books, { book: p.book, chap: p.chap, verse: 1 }).replace(/:1$/, '');
    cont = `<a class="card link" href="${esc(readHref(p))}"><span class="eyebrow">${st.pos ? 'Continuar lendo' : 'Começar a ler'}</span><strong>${esc(lab)}</strong></a>`;
  } catch (e) { cont = `<div class="card"><p class="muted">Dados indisponíveis: ${esc(e.message)}</p></div>`; }
  if (st.lastHymn) {
    try {
      const list = await harpa.getHymns(); const h = list.find(x => x.n === st.lastHymn);
      if (h) hymn = `<a class="card link" href="#/harpa/${num(h.n)}"><span class="eyebrow">Último hino</span><strong>${num(h.n)}. ${esc(h.t)}</strong></a>`;
    } catch (e) { /* ignora */ }
  }
  main.innerHTML = `<div id="home"></div>`;
  const home = $('#home');
  home.appendChild(votdSlot);
  home.insertAdjacentHTML('beforeend', cont + hymn +
    planCard() +
    `<a class="card link" href="#/busca"><span class="eyebrow">Pesquisar</span><strong>Buscar na Bíblia</strong></a>` +
    (store.persisted ? '' : `<p class="muted warn">Armazenamento indisponível: seus dados não serão salvos neste navegador.</p>`));
}

function planCard() {
  const pl = store.state.plan;
  if (!pl) return `<a class="card link" href="#/plano"><span class="eyebrow">Plano de leitura</span><strong>Bíblia em 90 dias</strong></a>`;
  const sm = plano.summary(pl);
  const txt = sm.finished ? 'Plano concluído' : sm.notStarted ? 'Começa em ' + esc(pl.start) : `Dia ${sm.today} de 90 · ${sm.count} lidos`;
  return `<a class="card link" href="#/plano"><span class="eyebrow">Plano de 90 dias</span><strong>${txt}</strong></a>`;
}

// ---------- Plano de 90 dias ----------
async function viewPlan() {
  setTitle('Plano de 90 dias', { back: true }); setNav('inicio'); BH.view = null;
  const [books, days] = await Promise.all([data.loadBooks(), data.loadPlano()]);
  const pl = store.state.plan;
  if (!pl) {
    main.innerHTML = `<section class="card"><h2>Bíblia inteira em 90 dias</h2>
      <p>São cerca de 13 capítulos por dia (uns 20 a 30 minutos), do Gênesis ao Apocalipse, em ordem. Você marca cada dia lido e o app mostra o que falta.</p>
      <button class="btn" id="pstart">Começar hoje</button></section>`;
    $('#pstart').onclick = () => { store.startPlan(plano.dateStr()); render(true); };
    return;
  }
  const sm = plano.summary(pl);
  const done = new Set(pl.done);
  const row = d => {
    const runs = days[d - 1];
    const lab = plano.dayLabel(books, runs);
    const on = done.has(d);
    const href = readHref({ book: runs[0][0], chap: runs[0][1] });
    return `<div class="mrow"><a class="res${d === sm.today ? ' today' : ''}" href="${esc(href)}"><strong>Dia ${d}</strong><em>${esc(lab)}</em></a>` +
      `<button class="btn small" data-d="${num(d)}" aria-pressed="${on ? 'true' : 'false'}" aria-label="Dia ${num(d)} lido">${on ? '✓' : '○'}</button></div>`;
  };
  let head;
  if (sm.finished) head = `<p><strong>Plano concluído. Parabéns!</strong></p>`;
  else if (sm.notStarted) head = `<p>O plano começa em ${esc(pl.start)}.</p>`;
  else head = `<p><strong>Hoje: dia ${sm.today} de 90.</strong> ${sm.late ? `Atrasados: ${sm.late} dia(s). Próximo pendente: dia ${sm.next}.` : 'Você está em dia.'}</p>`;
  const nextDay = sm.finished ? '' : `<h2>${sm.notStarted ? 'Primeira leitura' : sm.next === sm.today ? 'Leitura de hoje' : 'Próxima leitura (dia ' + sm.next + ')'}</h2>` + row(sm.next);
  main.innerHTML = `<section class="card">${head}
      <progress max="90" value="${num(sm.count)}" aria-label="Progresso do plano"></progress>
      <p class="muted">${sm.count} de 90 dias lidos · começou em ${esc(pl.start)}</p></section>
    ${nextDay}
    <h2>Todos os dias</h2>
    ${days.map((_, i) => row(i + 1)).join('')}
    <section class="card"><button class="btn danger" id="preset">Reiniciar plano</button></section>`;
  main.querySelectorAll('button[data-d]').forEach(b => { b.onclick = () => { store.togglePlanDay(+b.dataset.d); render(true); }; });
  $('#preset').onclick = () => {
    if (confirm('Reiniciar o plano? As marcações de dias lidos serão apagadas.')) { store.resetPlan(); render(true); }
  };
}

// ---------- Livros / capítulos ----------
async function viewBooks(parts) {
  setNav('biblia'); BH.view = null;
  const books = await data.loadBooks();
  if (parts[1]) {
    const b = books.find(x => x.id === parts[1]);
    if (!b) return navigate('#/biblia');
    const ver = await currentVersion();
    const n = data.chapterCount(ver, b.id);
    setTitle(b.n, { back: true });
    main.innerHTML = `<div class="grid">${Array.from({ length: n }, (_, i) => `<a class="cell" href="#/ler/${enc(b.id)}/${i + 1}/1" aria-label="${esc(b.n)} capítulo ${i + 1}">${i + 1}</a>`).join('')}</div>`;
    return;
  }
  setTitle('Livros', { back: true });
  const sec = (t, name) => `<h2>${name}</h2><div class="books">${books.filter(b => b.t === t).map(b => `<a class="bk" href="#/biblia/${enc(b.id)}">${esc(b.n)}</a>`).join('')}</div>`;
  main.innerHTML = sec('AT', 'Antigo Testamento') + sec('NT', 'Novo Testamento');
}

// ---------- Leitura ----------
async function viewRead(parts, token) {
  setNav('biblia');
  const books = await data.loadBooks();
  const ver = await currentVersion();
  const st = store.state;
  let book = parts[1] || (st.pos && st.pos.book) || books[0].id;
  let chap = parseInt(parts[2] || (st.pos && st.pos.chap) || 1, 10);
  const verseWanted = parts[3] ? parseInt(parts[3], 10) : (parts[1] ? 1 : (st.pos && st.pos.verse) || 1);
  const p = data.clampPos(ver, book, chap, verseWanted);
  book = p.book; chap = p.chap;
  const bk = ver.byId[book], bookMeta = books.find(b => b.id === book);
  const verses = bk.c[chap - 1];
  store.setPos(book, chap, p.verse);
  BH.view = { version: ver.id, book, chap, count: verses.length };
  setTitle(`${bookMeta ? bookMeta.n : bk.n} ${chap}`, { audio: true });
  const prev = data.neighbor(ver, book, chap, -1), next = data.neighbor(ver, book, chap, 1);
  const versions = await data.loadVersions();
  const marks = store.state.marks;
  const vhtml = verses.map((t, i) => {
    const m = marks[refKey(book, chap, i + 1)];
    const cls = 'verse' + (m && m.color ? ' hl hl-' + m.color : '');
    const ind = (m && m.fav ? '<span class="ind" aria-label="favorito">★</span>' : '') + (m && m.note ? '<span class="ind" aria-label="com nota">✎</span>' : '');
    return `<p class="${esc(cls)}" data-v="${i + 1}" tabindex="0" role="button" aria-label="Versículo ${i + 1}: abrir opções"><sup>${i + 1}</sup> ${esc(t)} ${ind}</p>`;
  }).join('');
  main.innerHTML = `
    <div class="readbar">
      <a class="btn small" href="#/biblia" aria-label="Escolher livro">Livros</a>
      <a class="btn small" href="#/biblia/${enc(book)}" aria-label="Escolher capítulo">Cap. ${chap}</a>
      <label class="sr" for="vsel">Versão</label>
      <select id="vsel" class="sel">${versions.map(v => `<option value="${esc(v.id)}"${v.id === ver.id ? ' selected' : ''}>${esc(v.id.toUpperCase())}</option>`).join('')}</select>
      <a class="btn small" href="#/busca" aria-label="Buscar">Buscar</a>
    </div>
    <article id="text" class="text">${vhtml}</article>
    <div class="pager">
      <a class="btn" ${prev ? `href="#/ler/${enc(prev.book)}/${num(prev.chap)}/1"` : 'aria-disabled="true"'} aria-label="Capítulo anterior">‹ Anterior</a>
      <a class="btn" ${next ? `href="#/ler/${enc(next.book)}/${num(next.chap)}/1"` : 'aria-disabled="true"'} aria-label="Próximo capítulo">Próximo ›</a>
    </div>`;
  if (/^[a-z0-9]+$/.test(book)) $('#text').style.setProperty('--wm', `url("${new URL('img/livros/' + book + '.jpg', document.baseURI).href}")`);
  $('#vsel').onchange = async e => {
    const old = ver.id;
    try {
      const nv = await data.loadVersion(e.target.value);
      const q = data.clampPos(nv, book, chap, store.state.pos ? store.state.pos.verse : 1);
      store.setSetting('version', nv.id);
      navigate(readHref(q));
    } catch (err) { toast('Versão indisponível'); e.target.value = old; }
  };
  const text = $('#text');
  text.onclick = e => { const v = e.target.closest('.verse'); if (v) openSheet(ver, books, book, chap, +v.dataset.v); };
  text.onkeydown = e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('verse')) { e.preventDefault(); e.target.click(); } };
  attachSwipe(text, () => next && navigate(`#/ler/${enc(next.book)}/${num(next.chap)}/1`), () => prev && navigate(`#/ler/${enc(prev.book)}/${num(prev.chap)}/1`));
  if (parts[3] && p.verse > 1) {
    const el = text.querySelector(`[data-v="${p.verse}"]`);
    if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); }
  }
}
function attachSwipe(el, onLeft, onRight) {
  let x0 = 0, y0 = 0, t0 = 0;
  el.addEventListener('touchstart', e => { const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; t0 = Date.now(); }, { passive: true });
  el.addEventListener('touchend', e => {
    const t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0;
    if (Date.now() - t0 < 700 && Math.abs(dx) > 70 && Math.abs(dy) < 50) (dx < 0 ? onLeft : onRight)();
  }, { passive: true });
}

// ---------- Folha de versículo ----------
function openSheet(ver, books, book, chap, verse) {
  const ref = refKey(book, chap, verse);
  const sheet = $('#sheet');
  const label = reader.refLabel(books, { book, chap, verse });
  const draw = () => {
    const m = store.getMark(ref) || { color: null, note: '', fav: false };
    sheet.innerHTML = `<div class="panel" role="dialog" aria-modal="true" aria-label="Opções de ${esc(label)}">
      <div class="row between"><strong>${esc(label)}</strong><button class="btn small" data-a="close" aria-label="Fechar">Fechar</button></div>
      <p class="quote">${esc(data.verseText(ver, book, chap, verse) || '')}</p>
      <div class="row colors" role="group" aria-label="Cor do destaque">
        ${COLORS.map(c => `<button class="swatch hl-${c}${m.color === c ? ' sel' : ''}" data-a="color" data-c="${c}" aria-label="Destacar ${c}" aria-pressed="${m.color === c}">${m.color === c ? '✓' : ''}</button>`).join('')}
        <button class="btn small" data-a="color" data-c="" aria-label="Remover destaque">Sem cor</button>
      </div>
      <label for="note" class="sr">Nota</label>
      <textarea id="note" rows="3" placeholder="Nota (opcional)">${esc(m.note || '')}</textarea>
      <div class="row wrap">
        <button class="btn" data-a="note">Salvar nota</button>
        <button class="btn" data-a="fav" aria-pressed="${m.fav}">${m.fav ? '★ Favorito' : '☆ Favoritar'}</button>
        <button class="btn" data-a="copy">Copiar</button>
        <button class="btn" data-a="share">Compartilhar</button>
      </div></div>`;
  };
  const close = () => { sheet.hidden = true; sheet.innerHTML = ''; const y = window.scrollY; render(true).then(() => window.scrollTo(0, y)); };
  draw(); sheet.hidden = false;
  const first = sheet.querySelector('button'); if (first) first.focus();
  sheet.onclick = async e => {
    if (e.target === sheet) return close();
    const b = e.target.closest('[data-a]'); if (!b) return;
    const a = b.dataset.a, m = store.getMark(ref) || {};
    const text = reader.shareText(ver, books, book, chap, verse);
    if (a === 'close') return close();
    if (a === 'color') { store.setMark(ref, { color: b.dataset.c || null }); draw(); }
    else if (a === 'note') { store.setMark(ref, { note: $('#note').value.trim() }); draw(); toast('Nota salva'); }
    else if (a === 'fav') { store.setMark(ref, { fav: !m.fav, note: $('#note').value.trim() }); draw(); }
    else if (a === 'copy') { toast(await copyText(text) ? 'Copiado' : 'Não foi possível copiar'); }
    else if (a === 'share') {
      try { if (navigator.share) { await navigator.share({ text }); return; } } catch (err) { if (err && err.name === 'AbortError') return; }
      toast(await copyText(text) ? 'Copiado' : 'Não foi possível copiar');
    }
  };
  sheet.onkeydown = e => { if (e.key === 'Escape') close(); };
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; } catch (e) { /* fallback */ }
  try {
    const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok;
  } catch (e) { return false; }
}

// ---------- Busca ----------
let lastQuery = '';
async function viewSearch() {
  setTitle('Buscar', { back: true }); setNav('biblia'); BH.view = null;
  const ver = await currentVersion();
  const books = await data.loadBooks();
  main.innerHTML = `<form id="sf" class="searchbar" role="search"><label class="sr" for="q">Buscar na Bíblia (${esc(ver.id.toUpperCase())})</label>
    <input id="q" type="search" enterkeyhint="search" placeholder="Palavras, ex.: amor perfeito" autocomplete="off" value="${esc(lastQuery)}"><button class="btn" type="submit">Buscar</button></form>
    <p class="muted" id="sinfo">Versão: ${esc(ver.name)}</p><div id="res" aria-live="polite"></div>`;
  let q = '', shown = 0;
  const PAGE = 40;
  const res = $('#res'), info = $('#sinfo');
  async function run(more) {
    if (!more) { q = $('#q').value.trim(); lastQuery = q; shown = 0; res.innerHTML = ''; }
    if (!q) { info.textContent = 'Digite algo para buscar.'; return; }
    info.textContent = 'Preparando índice…';
    const idx = await data.buildIndex(ver);
    const r = data.searchIndex(idx, q, { offset: shown, limit: PAGE });
    const old = $('#more'); if (old) old.remove();
    res.insertAdjacentHTML('beforeend', r.items.map(it => {
      const t = data.verseText(ver, it.b, it.c, it.v) || '';
      return `<a class="res" href="#/ler/${enc(it.b)}/${num(it.c)}/${num(it.v)}"><strong>${esc(reader.refLabel(books, { book: it.b, chap: it.c, verse: it.v }))}</strong><span>${esc(t)}</span></a>`;
    }).join(''));
    shown += r.items.length;
    info.textContent = r.total ? `${r.total} resultado(s) — mostrando ${shown}` : 'Nenhum resultado.';
    if (shown < r.total) {
      res.insertAdjacentHTML('beforeend', '<button class="btn" id="more">Mais resultados</button>');
      $('#more').onclick = () => run(true);
    }
  }
  $('#sf').onsubmit = e => { e.preventDefault(); run(false); };
  if (lastQuery) run(false);
  else data.buildIndex(ver).catch(() => {});
}

// ---------- Harpa ----------
async function viewHarpa(parts) {
  setNav('harpa'); BH.view = null;
  const list = await harpa.getHymns();
  const meta = await data.loadMeta();
  const foot = meta.harpa_license === 'unverified' ? '<footer class="foot">Letras: status de direitos não verificado</footer>' : '';
  if (parts[1]) {
    const n = parseInt(parts[1], 10);
    const h = list.find(x => x.n === n);
    if (!h) return navigate('#/harpa');
    store.setLastHymn(n);
    setTitle(`Hino ${n}`, { back: true, audio: true });
    const prev = harpa.hymnNeighbor(list, n, -1), next = harpa.hymnNeighbor(list, n, 1);
    const fav = store.isHymnFav(n);
    const fs = store.state.settings.harpaFont;
    main.innerHTML = `<div class="readbar">
        <button class="btn small" id="fm" aria-label="Diminuir letra">A−</button>
        <button class="btn small" id="fp" aria-label="Aumentar letra">A+</button>
        <button class="btn small" id="hf" aria-pressed="${fav}" aria-label="${fav ? 'Remover dos favoritos' : 'Favoritar hino'}">${fav ? '★ Favorito' : '☆ Favoritar'}</button>
        <button class="btn small" id="hc">Copiar</button></div>
      <article class="hymn" id="hymn"><h2>${num(n)}. ${esc(h.t)}</h2>
      ${harpa.hymnBlocks(h).map(b => `<div class="${esc(b.type)}">${b.type === 'estrofe' ? `<span class="num">${esc(b.num)}</span>` : '<span class="lbl">Coro</span>'}<p>${esc(b.text).replace(/\n/g, '<br>')}</p></div>`).join('')}</article>
      <div class="pager">
        <a class="btn" ${prev ? `href="#/harpa/${num(prev)}"` : 'aria-disabled="true"'} aria-label="Hino anterior">‹ Anterior</a>
        <a class="btn" ${next ? `href="#/harpa/${num(next)}"` : 'aria-disabled="true"'} aria-label="Próximo hino">Próximo ›</a></div>${foot}`;
    const setF = d => { store.setSetting('harpaFont', Math.min(36, Math.max(12, store.state.settings.harpaFont + d))); applyTheme(); };
    $('#fm').onclick = () => setF(-2); $('#fp').onclick = () => setF(2);
    $('#hf').onclick = () => { store.toggleHymnFav(n); render(true); };
    $('#hc').onclick = async () => toast(await copyText(`${n}. ${h.t}\n\n${harpa.formatHymnText(h)}`) ? 'Copiado' : 'Não foi possível copiar');
    attachSwipe($('#hymn'), () => next && navigate('#/harpa/' + next), () => prev && navigate('#/harpa/' + prev));
    return;
  }
  setTitle('Harpa Cristã');
  main.innerHTML = `<div class="searchbar"><label class="sr" for="hq">Buscar hino por número, título ou letra</label>
    <input id="hq" type="search" placeholder="Número, título ou letra" autocomplete="off" value="${esc(harpaQuery)}"></div>
    <p class="muted" id="hinfo"></p><div id="hlist"></div>${foot}`;
  const draw = () => {
    harpaQuery = $('#hq').value;
    const r = harpa.searchHymns(list, harpaQuery);
    $('#hinfo').textContent = harpaQuery.trim() ? `${r.length} hino(s)` : `${list.length} hinos`;
    const cap = r.slice(0, 700);
    $('#hlist').innerHTML = cap.map(h => `<a class="res hy" href="#/harpa/${num(h.n)}"><strong>${num(h.n)}</strong><span>${esc(h.t)}${store.isHymnFav(h.n) ? ' ★' : ''}</span></a>`).join('');
  };
  $('#hq').oninput = draw; draw();
}
let harpaQuery = '';

// ---------- Marcadores / Favoritos ----------
let marksFilter = null;
async function viewMarks(parts) {
  setTitle('Marcadores'); setNav('marcadores'); BH.view = null;
  const tab = parts[1] || 'marcas';
  const books = await data.loadBooks();
  const tabs = [['marcas', 'Marcadores'], ['favv', 'Fav. versículos'], ['favh', 'Fav. hinos']];
  let html = `<div class="tabs" role="tablist">${tabs.map(([k, n]) => `<a role="tab" aria-selected="${k === tab}" class="${k === tab ? 'on' : ''}" href="#/marcadores/${esc(k)}">${n}</a>`).join('')}</div>`;
  const ver = await currentVersion().catch(() => null);
  const row = r => {
    const t = ver ? data.verseText(ver, r.book, r.chap, r.verse) : null;
    return `<div class="mrow"><a class="res hl-${esc(r.m.color || 'none')}" href="${esc(readHref(r))}"><strong>${esc(reader.refLabel(books, r))}${r.m.fav ? ' ★' : ''}</strong><span>${esc(t || '(texto indisponível nesta versão)')}</span>${r.m.note ? `<em>✎ ${esc(r.m.note)}</em>` : ''}</a>
      <button class="btn small del" data-k="${esc(r.key)}" aria-label="Excluir marcação de ${esc(reader.refLabel(books, r))}">Excluir</button></div>`;
  };
  const groups = fl => reader.groupMarks(books, store.state.marks, fl).map(g => `<h2>${esc((books.find(b => b.id === g.book) || { n: g.book }).n)}</h2>${g.rows.map(row).join('')}`).join('');
  if (tab === 'marcas') {
    html += `<div class="chips" role="group" aria-label="Filtrar por cor"><button class="chip${!marksFilter ? ' on' : ''}" data-f="">Todas</button>${COLORS.map(c => `<button class="chip hl-${c}${marksFilter === c ? ' on' : ''}" data-f="${c}">${c}</button>`).join('')}</div>`;
    const g = groups(marksFilter);
    html += g || '<p class="muted">Nenhum marcador. Toque em um versículo na leitura para destacar ou anotar.</p>';
  } else if (tab === 'favv') {
    html += groups('fav') || '<p class="muted">Nenhum versículo favorito.</p>';
  } else {
    const list = await harpa.getHymns();
    const fs = store.state.favHymns.map(n => list.find(h => h.n === n)).filter(Boolean).sort((a, b) => a.n - b.n);
    html += fs.map(h => `<a class="res hy" href="#/harpa/${num(h.n)}"><strong>${num(h.n)}</strong><span>${esc(h.t)}</span></a>`).join('') || '<p class="muted">Nenhum hino favorito.</p>';
  }
  main.innerHTML = html;
  main.querySelectorAll('.chip').forEach(c => c.onclick = () => { marksFilter = c.dataset.f || null; render(); });
  main.querySelectorAll('.del').forEach(b => b.onclick = () => {
    if (confirm('Excluir esta marcação (cor, nota e favorito)?')) { store.deleteMark(b.dataset.k); render(); }
  });
}

// ---------- Mais / Configurações ----------
async function viewSettings() {
  setTitle('Mais'); setNav('mais'); BH.view = null;
  const s = store.state.settings;
  const versions = await data.loadVersions().catch(() => []);
  const cur = versions.find(v => v.id === s.version);
  const licTxt = v => !v ? '' : v.license === 'PD' ? 'Domínio público.' : 'Texto protegido por direitos autorais: uso pessoal, não distribuir.';
  let src = '';
  try { const b = await data.loadVersion(s.version); if (b.source) src = ` Fonte: ${esc(b.source)}`; } catch (e) { /* ignora */ }
  main.innerHTML = `
    <section class="card"><h2>Aparência</h2>
      <label for="th">Tema</label>
      <select id="th" class="sel">${[['auto', 'Automático'], ['claro', 'Claro'], ['sepia', 'Sépia'], ['escuro', 'Escuro']].map(([v, n]) => `<option value="${esc(v)}"${s.theme === v ? ' selected' : ''}>${n}</option>`).join('')}</select>
      <label for="fs">Tamanho da letra: <span id="fsv">${s.fontSize}</span> px</label>
      <input id="fs" type="range" min="14" max="30" step="1" value="${num(s.fontSize)}">
      <label class="row"><input id="wm" type="checkbox"${s.watermark ? ' checked' : ''}> Foto de fundo na leitura</label>
      <p class="sample">“Porque Deus amou o mundo de tal maneira…”</p></section>
    <section class="card"><h2>Versão padrão</h2>
      <label for="dv">Versão da Bíblia</label>
      <select id="dv" class="sel">${versions.map(v => `<option value="${esc(v.id)}"${v.id === s.version ? ' selected' : ''}>${esc(v.name)} (${esc(v.id.toUpperCase())})</option>`).join('')}</select>
      <p class="muted" id="lic">${cur ? esc(licTxt(cur)) + src : ''}</p></section>
    <section class="card"><h2>Backup</h2>
      <div class="row wrap"><button class="btn" id="ex">Exportar backup</button>
      <button class="btn" id="im">Importar backup</button></div>
      <input id="imf" type="file" accept="application/json,.json" hidden>
      <p class="muted">Marcadores, notas, favoritos e preferências ficam apenas neste aparelho.</p></section>
    <section class="card"><h2>Créditos das fotos</h2>
      <details id="cred"><summary>Ver autores e licenças</summary><div id="credl" class="muted">Carregando…</div></details></section>
    <section class="card"><h2>Dados</h2><button class="btn danger" id="cl">Apagar todos os dados</button></section>
    <p class="muted center">Bíblia e Harpa — funciona sem internet.</p>`;
  $('#th').onchange = e => { store.setSetting('theme', e.target.value); applyTheme(); };
  $('#cred').addEventListener('toggle', async e => {
    if (!e.target.open || e.target.dataset.ok) return;
    try {
      const r = await fetch('./img/livros/creditos.json'); if (!r.ok) throw new Error('x');
      const list = await r.json(); const nm = new Map((await data.loadBooks()).map(b => [b.id, b.n]));
      $('#credl').innerHTML = list.map(c => `<p><strong>${esc(nm.get(c.id) || c.id)}</strong>: ${esc(c.titulo)}, ${esc(c.autor)}, ${esc(c.licenca)}. <a href="${esc(/^https:\/\//.test(c.url_pagina) ? c.url_pagina : '#')}" target="_blank" rel="noopener noreferrer">origem</a></p>`).join('');
      e.target.dataset.ok = '1';
    } catch (err) { $('#credl').textContent = 'Créditos indisponíveis agora.'; }
  });
  $('#wm').onchange = e => { store.setSetting('watermark', e.target.checked); applyTheme(); };
  $('#fs').oninput = e => { $('#fsv').textContent = e.target.value; store.setSetting('fontSize', +e.target.value); applyTheme(); };
  $('#dv').onchange = async e => {
    try { await data.loadVersion(e.target.value); store.setSetting('version', e.target.value); render(); }
    catch (err) { toast('Versão indisponível'); e.target.value = s.version; }
  };
  $('#ex').onclick = () => {
    try {
      const blob = new Blob([store.exportJSON()], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = `biblia-harpa-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) { toast('Falha ao exportar'); }
  };
  $('#im').onclick = () => $('#imf').click();
  $('#imf').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const text = await f.text();
      store.importJSON(text); applyTheme(); toast('Backup importado'); render();
    } catch (err) { toast(err.message || 'Backup inválido'); }
    e.target.value = '';
  };
  $('#cl').onclick = () => {
    if (confirm('Apagar TODOS os marcadores, notas, favoritos e preferências deste aparelho? Isso não pode ser desfeito.')) {
      store.clear(); applyTheme(); toast('Dados apagados'); render();
    }
  };
}

// ---------- módulos opcionais ----------
async function loadOptional() {
  for (const name of ['./audio.js', './votd.js']) {
    try {
      const mod = await import(name);
      if (mod && typeof mod.init === 'function') await mod.init(window.BH);
    } catch (e) { /* módulo ausente ou com erro: ignora silenciosamente */ }
  }
}

// ---------- start ----------
applyTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
if (!location.hash) history.replaceState(null, '', '#/inicio');
// Aba "Bíblia" retoma a leitura.
$('#nav a[data-tab=biblia]').addEventListener('click', e => {
  const p = store.state.pos;
  e.preventDefault(); navigate(p ? readHref(p) : '#/biblia');
});
render().then(loadOptional);
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
