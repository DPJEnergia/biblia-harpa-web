// Camada fina DOM + Web Speech API sobre audio-core.js.
import { createEngine, createGuard, cleanText, chunkText, clampRate, SLEEP_OPTIONS } from './audio-core.js';

let LAST_BOOK = 'ap';
const PREF_KEY = 'bh:audio:v1';
const INSTALL_MSG = 'Nenhuma voz em português encontrada. No Android, abra Configurações > Sistema > Idiomas > Saída de texto para fala (ou Acessibilidade > Saída de texto para fala), instale o idioma Português (Brasil) e reabra o app.';

function loadPrefs() {
  const d = { voice: '', rate: 1, auto: true, wake: true };
  try { Object.assign(d, JSON.parse(localStorage.getItem(PREF_KEY) || '{}')); } catch (e) { /* ignora */ }
  d.rate = clampRate(d.rate); d.auto = d.auto !== false; d.wake = d.wake !== false;
  return d;
}
function savePrefs(p) { try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch (e) { /* ignora */ } }

export function init(BH) {
  const slot = document.getElementById('audio-slot');
  if (!slot) return;
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
  const supported = !!(synth && typeof window.SpeechSynthesisUtterance === 'function');
  const prefs = loadPrefs();
  const $ = (s, r = panel) => r.querySelector(s);

  // ---------- estilo ----------
  const st = document.createElement('style');
  st.textContent = `
  #audio-panel{position:fixed;left:0;right:0;bottom:calc(58px + env(safe-area-inset-bottom));z-index:9;max-width:720px;margin:0 auto;background:var(--card);color:var(--fg);border:1px solid var(--line);border-radius:14px 14px 0 0;padding:8px 12px;box-shadow:0 -2px 10px rgba(0,0,0,.25)}
  #audio-panel .ap-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
  #audio-panel .ap-ctl{flex:1;min-width:44px}
  #audio-panel .ap-now{font-size:.9rem;color:var(--muted);margin:4px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  #audio-panel .ap-msg{font-size:.9rem;margin:4px 0;color:var(--fg)}
  #audio-panel .ap-msg.warn{color:var(--danger)}
  #audio-panel details{margin-top:4px} #audio-panel summary{min-height:44px;display:flex;align-items:center;cursor:pointer}
  #audio-panel label{display:flex;gap:8px;align-items:center;min-height:44px;flex-wrap:wrap}
  #audio-panel input[type=range]{flex:1;min-width:120px;min-height:44px}
  #audio-panel input[type=checkbox]{width:24px;height:24px}
  body.ap-open main{padding-bottom:calc(240px + env(safe-area-inset-bottom))}
  `;
  document.head.appendChild(st);

  // ---------- botão no topo ----------
  const btn = document.createElement('button');
  btn.className = 'iconbtn'; btn.id = 'audio-btn'; btn.type = 'button';
  btn.textContent = '🔊'; btn.setAttribute('aria-label', 'Ouvir (abrir player de áudio)');
  btn.setAttribute('aria-expanded', 'false');
  slot.appendChild(btn);

  // ---------- painel ----------
  const panel = document.createElement('div');
  panel.id = 'audio-panel'; panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', 'Player de áudio'); panel.hidden = true;
  panel.innerHTML = `
    <div class="ap-msg" id="ap-msg" role="status" aria-live="polite"></div>
    <div id="ap-ui">
      <div class="ap-row">
        <button class="btn ap-ctl" id="ap-prev" aria-label="Versículo anterior">⏮</button>
        <button class="btn ap-ctl" id="ap-play" aria-label="Tocar">▶</button>
        <button class="btn ap-ctl" id="ap-stop" aria-label="Parar">⏹</button>
        <button class="btn ap-ctl" id="ap-next" aria-label="Próximo versículo">⏭</button>
        <button class="btn ap-ctl" id="ap-close" aria-label="Fechar player">✕</button>
      </div>
      <div class="ap-now" id="ap-now"></div>
      <details><summary>Opções</summary>
        <label>Velocidade <span id="ap-ratev"></span><input id="ap-rate" type="range" min="0.7" max="1.5" step="0.1"></label>
        <label>Voz <select id="ap-voice" class="sel"></select></label>
        <label>Dormir em <select id="ap-sleep" class="sel"></select> <span id="ap-sleepleft"></span></label>
        <label><input type="checkbox" id="ap-auto"> Avançar para o próximo capítulo</label>
        <label id="ap-wakel"><input type="checkbox" id="ap-wake"> Manter tela ligada</label>
      </details>
    </div>`;
  document.body.appendChild(panel);
  const ui = $('#ap-ui'), msg = $('#ap-msg');
  let open = false;

  // ---------- voz / Web Speech ----------
  let voices = [], speakSeq = 0, lastCancelAt = -1e9, live = [], emptyTimer = null;
  const normLang = l => String(l || '').replace('_', '-').toLowerCase();

  function refreshVoices() {
    if (!supported) return;
    let all = [];
    try { all = synth.getVoices() || []; } catch (e) { /* ignora */ }
    voices = all.filter(v => /^pt(-|$)/.test(normLang(v.lang)))
      .sort((a, b) => (normLang(b.lang) === 'pt-br') - (normLang(a.lang) === 'pt-br') || (b.localService - a.localService) || a.name.localeCompare(b.name));
    const sel = $('#ap-voice');
    sel.innerHTML = '';
    voices.forEach(v => { const o = document.createElement('option'); o.value = v.voiceURI; o.textContent = `${v.name} (${v.lang})`; sel.appendChild(o); });
    if (voices.length) {
      // voz salva ausente: usa a primeira só nesta sessão, sem sobrescrever a preferência salva
      sel.value = (voices.find(v => v.voiceURI === prefs.voice) || voices[0]).voiceURI;
    }
    sel.disabled = !voices.length;
    voiceMsg(all.length);
  }
  function voiceMsg(total) {
    if (voices.length) { setMsg(''); return; }
    if (!total) {
      setMsg('Carregando vozes…');
      clearTimeout(emptyTimer);
      emptyTimer = setTimeout(() => { let n = 0; try { n = synth.getVoices().length; } catch (e) { /* ignora */ } if (!n) setMsg(INSTALL_MSG, true); }, 2500);
    } else setMsg(INSTALL_MSG, true);
  }
  function setMsg(t, warn) { msg.textContent = t; msg.classList.toggle('warn', !!warn); }
  const currentVoice = () => voices.find(v => v.voiceURI === prefs.voice) || voices[0] || null;

  const guard = createGuard({
    now: () => Date.now(), setTimer: (f, ms) => setTimeout(f, ms), clearTimer: id => clearTimeout(id),
    isSpeaking: () => { try { return synth.speaking || synth.pending; } catch (e) { return false; } }
  });
  function cancelSpeech() {
    guard.cancel(); speakSeq++; lastCancelAt = performance.now();
    try { synth.cancel(); } catch (e) { /* ignora */ }
  }
  // Um item por chamada; textos muito longos são fatiados só aqui (Chrome corta falas longas).
  function speakItem(text, { rate, onend, onerror }) {
    guard.cancel();
    const seq = ++speakSeq;
    const chunks = chunkText(text);
    let i = 0;
    const run = () => {
      if (seq !== speakSeq) return;
      if (i >= chunks.length) return onend();
      const u = new window.SpeechSynthesisUtterance(chunks[i++]);
      const v = currentVoice();
      u.lang = v ? v.lang : 'pt-BR'; if (v) u.voice = v;
      u.rate = rate; u.pitch = 1;
      live.push(u); if (live.length > 4) live.shift(); // referência viva (bug de GC do Chrome)
      // vigia: onend real, silêncio detectado ou timeout; dispara no máximo uma vez por utterance
      let g = null;
      const go = () => {
        if (seq !== speakSeq) return;
        g = guard.begin(chunks[i - 1], rate,
          () => { if (seq === speakSeq) run(); },
          code => { if (seq !== speakSeq) return; if (code === 'timeout') { try { synth.cancel(); } catch (e) { /* ignora */ } } onerror(code); });
        try { if (synth.paused) synth.resume(); synth.speak(u); } catch (e) { g.fail(String(e && e.message || e)); }
      };
      u.onend = () => { if (g) g.done(); };
      u.onerror = e => { if (g) g.fail(e && e.error ? e.error : 'error'); };
      const wait = 90 - (performance.now() - lastCancelAt);
      if (wait > 0 && i === 1) setTimeout(go, wait); else go();
    };
    run();
  }

  // ---------- fontes de texto ----------
  const bookName = (books, id, fb) => { const b = books.find(x => x.id === id); return b ? b.n : fb; };
  async function buildBible(version, book, chap) {
    const ver = await BH.data.loadVersion(version);
    const books = await BH.data.loadBooks();
    const bk = ver.byId[book];
    if (!bk || !bk.c[chap - 1]) return null;
    const name = bookName(books, book, bk.n);
    const items = [];
    bk.c[chap - 1].forEach((t, i) => { const text = cleanText(t, { n: i + 1 }); if (text) items.push({ text, key: i + 1 }); });
    return { items, intro: { text: `${name}, capítulo ${chap}`, key: 0 }, meta: { kind: 'bible', version, book, chap, title: `${name} ${chap}` } };
  }
  async function buildHymn(n) {
    const list = await BH.harpa.getHymns();
    const h = list.find(x => x.n === n);
    if (!h) return null;
    const items = [{ text: cleanText(`Hino ${n}. ${h.t}`), key: 0 }];
    BH.harpa.hymnBlocks(h).forEach((b, i) => {
      const body = cleanText(b.text, { lines: true });
      if (body) items.push({ text: b.type === 'coro' ? 'Coro. ' + body : body, key: i + 1 });
    });
    return { items, intro: null, meta: { kind: 'hymn', n, title: `Hino ${n}` } };
  }
  async function nextChapter(meta) {
    if (!meta || meta.kind !== 'bible') return null;
    const ver = await BH.data.loadVersion(meta.version);
    const nb = BH.data.neighbor(ver, meta.book, meta.chap, 1);
    if (!nb) return null; // fim do Apocalipse
    return buildBible(meta.version, nb.book, nb.chap);
  }

  // ---------- destaque ----------
  function elFor(meta, key) {
    if (!meta) return null;
    if (meta.kind === 'bible') return key > 0 ? document.querySelector(`#text [data-v="${key}"]`) : null;
    if (meta.kind === 'hymn') { const h = document.getElementById('hymn'); return h ? h.children[key] || null : null; }
    return null;
  }
  function clearMark() { document.querySelectorAll('.audio-on').forEach(e => e.classList.remove('audio-on')); }
  function mark(meta, item, scroll) {
    clearMark();
    if (!item) return;
    const el = elFor(meta, item.key);
    if (!el) return;
    el.classList.add('audio-on');
    if (scroll) {
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      try { el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' }); } catch (e) { el.scrollIntoView(); }
    }
  }

  // ---------- motor ----------
  let shownMeta = null;
  const engine = createEngine({
    speak: (text, o) => speakItem(text, o),
    cancel: () => { if (supported) cancelSpeech(); },
    next: nextChapter,
    now: () => Date.now(),
    onItem: (idx, item) => {
      const snap = engine.snapshot();
      const meta = snap.meta;
      // seguiu para outro capítulo: navega a leitura junto (o render confere meta == view)
      if (meta && meta !== shownMeta) {
        shownMeta = meta;
        const v = BH.view;
        if (meta.kind === 'bible' && !(v && v.book === meta.book && v.chap === meta.chap && v.version === meta.version)) {
          BH.navigate(`#/ler/${encodeURIComponent(meta.book)}/${parseInt(meta.chap, 10) || 1}/1`);
        }
        updateMediaMeta(meta);
      }
      mark(meta, item, true);
    },
    onChange: render,
    onEnd: reason => {
      clearMark(); shownMeta = null; wakeSync();
      if (reason === 'sleep') setMsg('Timer de sono: leitura encerrada.');
      else if (reason === 'end') setMsg(lastWasBibleEnd() ? 'Fim da Bíblia (Apocalipse 22).' : 'Leitura concluída.');
      if (mediaOk) navigator.mediaSession.playbackState = 'none';
    },
    onError: code => setMsg('Erro de áudio (' + code + '). Verifique a voz de texto para fala.', true)
  });
  const lastWasBibleEnd = () => { const m = engine.snapshot().meta; return m && m.kind === 'bible' && engine.snapshot().autoAdvance && m.book === LAST_BOOK; };

  function persistPos() {
    const s = engine.snapshot();
    if (s.meta && s.meta.kind === 'bible' && s.item && s.item.key > 0) { try { BH.store.setPos(s.meta.book, s.meta.chap, s.item.key); } catch (e) { /* ignora */ } }
  }

  // ---------- UI ----------
  const sleepSel = $('#ap-sleep');
  SLEEP_OPTIONS.forEach(m => { const o = document.createElement('option'); o.value = m; o.textContent = m ? m + ' min' : 'Desligado'; sleepSel.appendChild(o); });
  $('#ap-rate').value = prefs.rate; $('#ap-ratev').textContent = prefs.rate.toFixed(1) + '×';
  $('#ap-auto').checked = prefs.auto;
  const wakeOk = !!(navigator.wakeLock && navigator.wakeLock.request);
  $('#ap-wake').checked = prefs.wake && wakeOk;
  if (!wakeOk) { $('#ap-wake').disabled = true; $('#ap-wakel').title = 'Este navegador não permite manter a tela ligada'; }

  let tick = null;
  function render(s) {
    s = s || engine.snapshot();
    const active = s.state !== 'idle';
    const play = $('#ap-play');
    play.textContent = s.state === 'playing' ? '⏸' : '▶';
    play.setAttribute('aria-label', s.state === 'playing' ? 'Pausar' : 'Tocar');
    $('#ap-now').textContent = active && s.meta ? `${s.meta.title}${s.item && s.item.key > 0 ? ' — ' + (s.meta.kind === 'bible' ? 'v. ' : '') + s.item.key : ''}` : '';
    if (s.sleepUntil && !tick) tick = setInterval(sleepLabel, 1000);
    if (!s.sleepUntil && tick) { clearInterval(tick); tick = null; }
    sleepLabel();
    sleepSel.value = s.sleepUntil ? sleepSel.value : '0';
    syncVisibility();
    if (s.state !== 'playing') persistPos();
    wakeSync();
    if (mediaOk) navigator.mediaSession.playbackState = s.state === 'playing' ? 'playing' : s.state === 'paused' ? 'paused' : 'none';
  }
  function sleepLabel() {
    const ms = engine.sleepRemainingMs();
    $('#ap-sleepleft').textContent = ms ? `(${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')})` : '';
  }
  function syncVisibility() {
    const active = engine.snapshot().state !== 'idle';
    const show = active || (open && !slot.hidden);
    panel.hidden = !show;
    document.body.classList.toggle('ap-open', show);
    btn.setAttribute('aria-expanded', String(show));
    ui.hidden = !supported;
  }

  btn.onclick = () => {
    open = !(open && !panel.hidden);
    if (!supported) setMsg('Este navegador não suporta leitura em voz alta (Web Speech API). Tente o Chrome.', true);
    syncVisibility();
    if (open && supported) refreshVoices();
  };
  $('#ap-close').onclick = () => { engine.stop(); open = false; syncVisibility(); };
  $('#ap-stop').onclick = () => engine.stop();
  $('#ap-next').onclick = () => engine.next();
  $('#ap-prev').onclick = () => engine.prev();
  $('#ap-play').onclick = () => togglePlay();
  $('#ap-rate').oninput = e => { prefs.rate = clampRate(e.target.value); $('#ap-ratev').textContent = prefs.rate.toFixed(1) + '×'; savePrefs(prefs); engine.setRate(prefs.rate); };
  $('#ap-voice').onchange = e => { prefs.voice = e.target.value; savePrefs(prefs); if (engine.snapshot().state === 'playing') engine.restart(); };
  sleepSel.onchange = e => engine.setSleep(+e.target.value);
  $('#ap-auto').onchange = e => { prefs.auto = e.target.checked; savePrefs(prefs); engine.setAutoAdvance(prefs.auto); };
  $('#ap-wake').onchange = e => { prefs.wake = e.target.checked; savePrefs(prefs); wakeSync(); };

  let starting = 0;
  async function startFromView() {
    const my = ++starting;
    const route = BH.route || [], v = BH.view;
    try {
      let pack = null, index = 0;
      if (route[0] === 'ler' && v) {
        pack = await buildBible(v.version, v.book, v.chap);
        const pos = BH.store.state.pos;
        if (pack && pos && pos.book === v.book && pos.chap === v.chap && pos.verse > 1) index = firstIndexAtOrAfter(pack.items, pos.verse);
      } else if (route[0] === 'harpa' && route[1]) {
        pack = await buildHymn(parseInt(route[1], 10));
      } else { setMsg('Abra um capítulo da Bíblia ou um hino para ouvir.'); return; }
      for (let hop = 0; pack && !pack.items.length && pack.meta.kind === 'bible' && hop < 50; hop++) pack = await nextChapter(pack.meta); // capítulo vazio: pula
      if (my !== starting) return;
      if (!pack || !pack.items.length) { setMsg('Nada para ler aqui.'); return; }
      if ((BH.view !== v) && route[0] === 'ler') return; // trocou de tela enquanto carregava
      setMsg(voices.length ? '' : msg.textContent);
      shownMeta = null; playVersion = BH.store.state.settings.version;
      engine.start({ ...pack, index });
    } catch (e) { setMsg('Não foi possível carregar o texto para leitura.', true); }
  }
  const firstIndexAtOrAfter = (items, key) => { const i = items.findIndex(it => it.key >= key); return i < 0 ? items.length - 1 : i; };

  function togglePlay() {
    if (!supported) return;
    const s = engine.snapshot();
    if (s.state === 'playing') engine.pause();
    else if (s.state === 'paused') engine.play();
    else startFromView();
  }

  // toque em versículo/bloco enquanto toca = pular para ele
  document.getElementById('main').addEventListener('click', e => {
    const s = engine.snapshot();
    if (s.state !== 'playing' || !s.meta) return;
    let key = null;
    if (s.meta.kind === 'bible') { const v = e.target.closest('.verse'); if (v) key = +v.dataset.v; }
    else if (s.meta.kind === 'hymn') {
      const h = document.getElementById('hymn');
      if (h) { const c = e.target.closest('#hymn > *'); if (c) key = Array.prototype.indexOf.call(h.children, c); }
    }
    if (key == null || key < 0) return;
    const idx = firstIndexAtOrAfter(engine.getItems(), key);
    e.stopPropagation(); e.preventDefault();
    engine.jump(idx);
  }, true);
  // qualquer reprodução para se a versão da Bíblia mudar (por qualquer caminho, inclusive store.setSetting)
  let playVersion = null;
  BH.store.subscribe(s => {
    if (engine.snapshot().state !== 'idle' && playVersion != null && s.settings.version !== playVersion) { starting++; engine.invalidate('version'); }
  });

  // ---------- reação a rotas ----------
  function onRender(route, view) {
    slotSync();
    const s = engine.snapshot();
    if (s.state !== 'idle' && s.meta) {
      const m = s.meta;
      let ok = false;
      if (m.kind === 'bible') ok = route[0] === 'ler' && view && view.version === m.version && view.book === m.book && view.chap === m.chap;
      else if (m.kind === 'hymn') ok = route[0] === 'harpa' && parseInt(route[1], 10) === m.n;
      else if (m.kind === 'votd') ok = !route.length || route[0] === 'inicio';
      if (!ok) { starting++; engine.invalidate('route'); }
      else mark(m, s.item, false);
    }
    syncVisibility();
  }
  function slotSync() { /* visibilidade do slot é controlada por app.js (setTitle) */ }
  document.addEventListener('bh:render', e => onRender(e.detail.route, e.detail.view));

  // ---------- wake lock ----------
  let sentinel = null;
  let wakeBusy = false, wakeAgain = false;
  async function wakeSync() {
    if (wakeBusy) { wakeAgain = true; return; }
    wakeBusy = true;
    try { await wakeApply(); } finally { wakeBusy = false; if (wakeAgain) { wakeAgain = false; wakeSync(); } }
  }
  async function wakeApply() {
    const want = wakeOk && prefs.wake && engine.snapshot().state === 'playing' && document.visibilityState === 'visible';
    if (want && !sentinel) {
      try {
        const s = await navigator.wakeLock.request('screen');
        sentinel = s; s.addEventListener('release', () => { if (sentinel === s) sentinel = null; });
      } catch (e) { sentinel = null; }
    } else if (!want && sentinel) {
      const s = sentinel; sentinel = null; try { await s.release(); } catch (e) { /* ignora */ }
    }
  }
  document.addEventListener('visibilitychange', () => {
    wakeSync();
    if (document.visibilityState === 'visible' && engine.snapshot().state === 'playing' && supported && !synth.speaking && !synth.pending) engine.restart();
  });

  // ---------- Media Session ----------
  const mediaOk = 'mediaSession' in navigator && typeof window.MediaMetadata === 'function';
  function updateMediaMeta(meta) {
    if (!mediaOk || !meta) return;
    try { navigator.mediaSession.metadata = new window.MediaMetadata({ title: meta.title, artist: 'Bíblia e Harpa', album: meta.kind === 'bible' ? String(meta.version).toUpperCase() : 'Harpa Cristã' }); } catch (e) { /* ignora */ }
  }
  if (mediaOk) {
    const h = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch (e) { /* ação não suportada */ } };
    h('play', () => { const s = engine.snapshot(); if (s.state === 'paused') engine.play(); else if (s.state === 'idle') startFromView(); });
    h('pause', () => engine.pause());
    h('stop', () => engine.stop());
    h('nexttrack', () => engine.next());
    h('previoustrack', () => engine.prev());
  }

  // ---------- vozes assíncronas ----------
  if (supported) {
    refreshVoices();
    if (typeof synth.addEventListener === 'function') synth.addEventListener('voiceschanged', refreshVoices);
    else synth.onvoiceschanged = refreshVoices;
  } else {
    setMsg('Este navegador não suporta leitura em voz alta (Web Speech API). Tente o Chrome.', true);
    ui.hidden = true;
  }

  // ---------- API para outros módulos (votd.js) ----------
  BH.audio = {
    supported,
    // Lê um texto avulso (ex.: versículo do dia).
    playText(title, text) {
      if (!supported) { BH.toast && BH.toast('Leitura em voz alta indisponível neste navegador'); return false; }
      starting++;
      const body = cleanText(text);
      if (!body) return false;
      shownMeta = null;
      open = true; playVersion = BH.store.state.settings.version;
      engine.start({ items: [{ text: `${title}. ${body}`, key: 0 }], intro: null, meta: { kind: 'votd', title } });
      syncVisibility();
      return true;
    },
    stop: () => engine.stop(),
    engine
  };

  engine.setRate(prefs.rate); engine.setAutoAdvance(prefs.auto);
  render();
  onRender(BH.route || [], BH.view);
}
