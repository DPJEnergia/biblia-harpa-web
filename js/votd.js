// Versículo do dia: escolha determinística pela data LOCAL; card em #votd-slot (tela Início).
import { firstWithText } from './audio-core.js';

// Nº de dia inteiro da data civil local (imune a horário de verão/fuso: usa só Y/M/D).
export function dayNumber(d) {
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
}
// Dias consecutivos => índices consecutivos (mod len): nunca repete em dias seguidos,
// percorre toda a lista a cada `len` dias e é igual em qualquer aparelho para a mesma data.
export function votdIndex(date, len) {
  if (!(len > 0)) return -1;
  return ((dayNumber(date) % len) + len) % len;
}
export const dateKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function pickVotd(list, date) {
  const i = votdIndex(date, Array.isArray(list) ? list.length : 0);
  return i < 0 ? null : list[i];
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function init(BH) {
  let list = null, loadErr = null;
  let shownKey = null, shownVer = null, busy = 0;

  async function loadList() {
    if (list) return list;
    try {
      const r = await fetch('./data/votd.json');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (!Array.isArray(j) || !j.length) throw new Error('lista vazia');
      list = j; loadErr = null;
    } catch (e) { loadErr = e; throw e; }
    return list;
  }

  // versão do usuário; se não carregar ou o versículo vier vazio, a primeira que tiver texto (sem mudar a preferência)
  async function pickVersion(ref) {
    const ids = [BH.store.state.settings.version];
    try { (await BH.data.loadVersions()).forEach(v => ids.push(v.id)); } catch (e) { /* segue só com a preferida */ }
    return firstWithText(ids, id => BH.data.loadVersion(id), BH.data.verseText, ref);
  }

  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); return true; } catch (e) { /* fallback */ }
    try {
      const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok;
    } catch (e) { return false; }
  }

  async function draw(el, force) {
    const now = new Date(), key = dateKey(now), my = ++busy;
    const ver0 = BH.store.state.settings.version;
    if (!force && el.dataset.k === key + '|' + ver0 && el.firstChild) return;
    let ref, found, books;
    try {
      const l = await loadList();
      ref = pickVotd(l, now);
      books = await BH.data.loadBooks();
      found = await pickVersion(ref);
    } catch (e) {
      if (my !== busy) return;
      el.innerHTML = `<section class="card" aria-label="Versículo do dia"><span class="eyebrow">Versículo do dia</span><p class="muted">Não foi possível carregar o versículo do dia.</p><button class="btn small" id="votd-retry">Tentar de novo</button></section>`;
      el.dataset.k = '';
      el.querySelector('#votd-retry').onclick = () => draw(el, true);
      return;
    }
    if (my !== busy) return;
    const [book, chap, verse] = ref;
    const ver = found ? found.ver : null, text = found ? found.text : '';
    const label = BH.reader.refLabel(books, { book, chap, verse });
    const rk = BH.reader.refKey(book, chap, verse);
    const fav = !!(BH.store.getMark(rk) || {}).fav;
    const audioOk = !!(BH.audio && BH.audio.supported);
    el.dataset.k = key + '|' + ver0;
    shownKey = key; shownVer = ver0;
    if (!found) {
      el.innerHTML = `<section class="card votd" aria-label="Versículo do dia"><span class="eyebrow">Versículo do dia</span>
        <strong>${esc(label)}</strong><p class="muted">Texto indisponível nas versões carregadas.</p>
        <div class="row wrap"><button class="btn small" data-a="read">Ler capítulo</button></div></section>`;
      el.onclick = e => { if (e.target.closest('[data-a=read]')) BH.navigate(`#/ler/${encodeURIComponent(book)}/${parseInt(chap, 10) || 1}/${parseInt(verse, 10) || 1}`); };
      return;
    }
    el.innerHTML = `<section class="card votd" aria-label="Versículo do dia">
      <span class="eyebrow">Versículo do dia</span>
      <p class="quote">“${esc(text)}”</p>
      <strong>${esc(label)} <span class="muted">(${esc(ver.id.toUpperCase())})</span></strong>
      <div class="row wrap" style="margin-top:10px">
        <button class="btn small" data-a="read">Ler capítulo</button>
        <button class="btn small" data-a="copy">Copiar</button>
        <button class="btn small" data-a="share">Compartilhar</button>
        <button class="btn small" data-a="fav" aria-pressed="${fav}">${fav ? '★ Favorito' : '☆ Favoritar'}</button>
        ${audioOk ? '<button class="btn small" data-a="listen">Ouvir</button>' : ''}
      </div></section>`;
    el.onclick = async e => {
      const b = e.target.closest('[data-a]'); if (!b) return;
      const a = b.dataset.a;
      const share = BH.reader.shareText(ver, books, book, chap, verse);
      if (a === 'read') BH.navigate(`#/ler/${encodeURIComponent(book)}/${parseInt(chap, 10) || 1}/${parseInt(verse, 10) || 1}`);
      else if (a === 'copy') BH.toast(await copyText(share) ? 'Copiado' : 'Não foi possível copiar');
      else if (a === 'share') {
        try { if (navigator.share) { await navigator.share({ text: share }); return; } } catch (err) { if (err && err.name === 'AbortError') return; }
        BH.toast(await copyText(share) ? 'Copiado' : 'Não foi possível copiar');
      } else if (a === 'fav') {
        const cur = !!(BH.store.getMark(rk) || {}).fav;
        BH.store.setMark(rk, { fav: !cur });
        b.setAttribute('aria-pressed', String(!cur)); b.textContent = !cur ? '★ Favorito' : '☆ Favoritar';
      } else if (a === 'listen') {
        if (BH.audio) BH.audio.playText(label, text);
      }
    };
  }

  const slotEl = () => document.getElementById('votd-slot');
  function refresh(force) { const el = slotEl(); if (el) draw(el, force === true); }

  // A cada render da Início o app reanexa #votd-slot; (re)desenhamos se preciso.
  document.addEventListener('bh:render', () => refresh(false));
  // Virou a meia-noite / voltou ao app.
  const check = () => { if (shownKey && dateKey(new Date()) !== shownKey) refresh(true); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  window.addEventListener('focus', check);
  setInterval(check, 60000);
  // Troca de versão.
  BH.store.subscribe(s => { if (shownVer && s.settings.version !== shownVer) refresh(true); });

  refresh(false);
}
