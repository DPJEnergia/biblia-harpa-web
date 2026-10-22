// Motor de áudio SEM DOM: fila, máquina de estados, avanço de capítulo, timer de sono.
// Tudo que é do ambiente (fala, relógio, timers) é injetado, para testar em Node.
//
// Estados: 'idle' | 'playing' | 'paused'.
// Posição idx: -1 = introdução ("Livro, capítulo N"), 0..n-1 = itens (versículos/blocos).
// Cada chamada de fala captura o token atual; qualquer ação que muda a fala (stop, pause,
// pular, trocar de fonte) incrementa o token, então callbacks atrasados são ignorados.

// Remove ruído de marcação do texto falado.
// opts.n: nº do versículo (remove "16 " no início só se for exatamente esse número).
// opts.lines: quebras de linha viram pausa (vírgula) — para letras de hino.
export function cleanText(raw, opts = {}) {
  let s = String(raw == null ? '' : raw);
  s = s.replace(/<[^>]*>/g, ' ');            // tags / números de Strong
  s = s.replace(/\{[^}]*\}/g, ' ');          // notas {…}
  s = s.replace(/[\[\]¶§†‡*_#]/g, '');       // colchetes de palavras acrescentadas etc.
  if (opts.n != null) {
    const re = new RegExp('^\\s*' + String(opts.n).replace(/\W/g, '') + '(?![\\d])[\\s.:)\\-–]+');
    s = s.replace(re, '');
  }
  if (opts.lines) s = s.replace(/([^.,;:!?…\s])[ \t]*\r?\n[ \t]*/g, '$1, ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

// Divide texto longo em pedaços (≤ max) em pontuação/espaço. Usado só pela camada Web Speech.
export function chunkText(text, max = 240) {
  const out = [];
  let rest = String(text).trim();
  while (rest.length > max) {
    let cut = -1;
    for (const re of [/[.!?…;:]\s/g, /,\s/g, /\s/g]) {
      let m, last = -1;
      re.lastIndex = 0;
      while ((m = re.exec(rest)) && m.index < max) last = m.index + 1;
      if (last > max * 0.3) { cut = last; break; }
    }
    if (cut < 0) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

export const RATE_MIN = 0.7, RATE_MAX = 1.5;
export const clampRate = r => Math.min(RATE_MAX, Math.max(RATE_MIN, Number.isFinite(+r) ? +r : 1));
export const SLEEP_OPTIONS = [0, 15, 30, 60];

// opts:
//  speak(text, {rate, onend, onerror})  — inicia a fala (um item por vez)
//  cancel()                              — interrompe qualquer fala em curso
//  next(meta) -> Promise<{items,intro,meta}|null> — próximo capítulo (null = fim)
//  now() -> ms ; setTimer(fn, ms) -> id ; clearTimer(id)
//  onChange(snapshot), onItem(idx, item|intro), onEnd(reason), onError(code)
export function createEngine(opts) {
  const now = opts.now || Date.now;
  const setTimer = opts.setTimer || ((f, ms) => setTimeout(f, ms));
  const clearTimer = opts.clearTimer || (id => clearTimeout(id));
  const emit = () => { try { opts.onChange && opts.onChange(snapshot()); } catch (e) { /* ignora */ } };

  let state = 'idle', token = 0, items = [], intro = null, meta = null, idx = 0;
  let rate = 1, autoAdvance = true, sleepUntil = 0, sleepTimer = null, errCount = 0, lastEnd = null;

  function snapshot() {
    return { state, idx, total: items.length, meta, rate, autoAdvance, sleepUntil, hasIntro: !!intro, lastEnd,
      item: idx === -1 ? intro : (items[idx] || null) };
  }
  const cur = () => (idx === -1 ? intro : items[idx]);

  function say(doCancel) {
    const item = cur();
    if (!item) return finish('end');
    const t = ++token;
    if (doCancel) { try { opts.cancel(); } catch (e) { /* ignora */ } }
    try { opts.onItem && opts.onItem(idx, item); } catch (e) { /* ignora */ }
    emit();
    try {
      opts.speak(item.text, {
        rate,
        onend: () => { if (t === token) itemDone(); },
        onerror: code => { if (t === token) itemError(code); }
      });
    } catch (e) { itemError(String(e && e.message || e)); }
  }

  function sleepExpired() { return sleepUntil && now() >= sleepUntil; }

  function itemDone() {
    errCount = 0;
    if (state !== 'playing') return;
    if (sleepExpired()) return finish('sleep');
    if (idx + 1 < items.length) { idx++; return say(false); }
    advance(false);
  }

  function itemError(code) {
    // 'interrupted'/'canceled' causados por nós chegam com token velho (já filtrados); se chegam aqui, são reais.
    if (state !== 'playing') return;
    if (errCount++ < 1) return say(true); // tenta de novo uma vez
    try { opts.onError && opts.onError(code); } catch (e) { /* ignora */ }
    finish('error');
  }

  // Pede o próximo capítulo; capítulos vazios (items=[]) são pulados (máx. 50 seguidos).
  function fetchNext(m, hops) {
    let p;
    try { p = Promise.resolve(opts.next ? opts.next(m) : null); } catch (e) { p = Promise.reject(e); }
    return p.then(res => (res && res.items && !res.items.length && res.meta && hops < 50 ? fetchNext(res.meta, hops + 1) : res));
  }

  // Passa para o próximo capítulo. manual=true: pedido do usuário (ignora o toggle).
  function advance(manual) {
    if (!manual && !autoAdvance) return finish('end');
    const t = ++token;
    try { opts.cancel(); } catch (e) { /* ignora */ }
    fetchNext(meta, 0).then(res => {
      if (t !== token || state !== 'playing') return;
      if (!res || !res.items || !res.items.length) return finish('end');
      items = res.items; intro = res.intro || null; meta = res.meta; idx = intro ? -1 : 0;
      say(false);
    }, () => { if (t === token) { try { opts.onError && opts.onError('next-failed'); } catch (e) { /* ignora */ } finish('error'); } });
  }

  function finish(reason) {
    token++;
    try { opts.cancel(); } catch (e) { /* ignora */ }
    state = 'idle'; lastEnd = reason; idx = Math.max(idx, 0);
    clearSleep();
    try { opts.onEnd && opts.onEnd(reason); } catch (e) { /* ignora */ }
    emit();
  }

  function clearSleep() { if (sleepTimer != null) { clearTimer(sleepTimer); sleepTimer = null; } sleepUntil = 0; }

  const api = {
    snapshot,
    getItems: () => items,
    // Carrega e começa a tocar. index>0 => sem introdução.
    start({ items: its, intro: intr = null, meta: m = null, index = 0 }) {
      token++;
      try { opts.cancel(); } catch (e) { /* ignora */ }
      items = its || []; meta = m; lastEnd = null; errCount = 0;
      if (!items.length) { intro = null; state = 'idle'; return emit(); }
      idx = Math.min(Math.max(0, index | 0), items.length - 1);
      intro = idx === 0 ? intr : null;
      if (intro) idx = -1;
      state = 'playing';
      say(false);
    },
    play() {
      if (state === 'playing') return;
      if (!items.length) return;
      if (state === 'idle') { idx = Math.max(idx, 0); }
      state = 'playing'; lastEnd = null; errCount = 0;
      say(true); // cancel + re-fala do item atual (contorna bugs de pause/resume do Chrome)
    },
    // Re-fala o item atual se estiver tocando (ex.: voltou à tela e o SO silenciou a fala).
    restart() { if (state === 'playing') say(true); },
    pause() {
      if (state !== 'playing') return;
      token++; state = 'paused';
      try { opts.cancel(); } catch (e) { /* ignora */ }
      emit();
    },
    stop() {
      if (state === 'idle' && !items.length) return;
      finish('stop');
    },
    next() {
      if (state === 'idle' || !items.length) return;
      if (idx + 1 < items.length) { idx++; return state === 'playing' ? say(true) : (emit(), onItemSilent()); }
      if (state === 'playing') advance(true);
    },
    prev() {
      if (state === 'idle' || !items.length) return;
      idx = Math.max(0, idx - 1);
      if (state === 'playing') say(true); else { emit(); onItemSilent(); }
    },
    jump(i) {
      if (!items.length || i < 0 || i >= items.length) return;
      idx = i;
      if (state === 'idle') state = 'playing';
      if (state === 'playing') say(true); else { emit(); onItemSilent(); }
    },
    setRate(r) {
      rate = clampRate(r);
      if (state === 'playing') say(true); else emit();
    },
    setAutoAdvance(b) { autoAdvance = !!b; emit(); },
    // minutos: 0 = desligado
    setSleep(min) {
      clearSleep();
      const m = +min;
      if (m > 0) {
        sleepUntil = now() + m * 60000;
        sleepTimer = setTimer(() => {
          sleepTimer = null;
          if (state === 'idle') { sleepUntil = 0; emit(); } // nada tocando: só limpa o timer
          else if (sleepExpired()) finish('sleep');
        }, m * 60000);
      }
      emit();
    },
    sleepRemainingMs() { return sleepUntil ? Math.max(0, sleepUntil - now()) : 0; },
    // Invalida tudo (troca de versão/rota). Equivale a stop silencioso.
    invalidate(reason = 'invalidated') { if (state !== 'idle' || items.length) finish(reason); }
  };
  function onItemSilent() { try { opts.onItem && opts.onItem(idx, cur()); } catch (e) { /* ignora */ } }
  return api;
}

// Vigia de fala (Chrome às vezes nunca dispara onend). Lógica sem DOM, relógio/timers injetados.
// begin(texto, rate, onDone, onFail) devolve {done, fail}: cada utterance dispara no máximo UMA vez
// (onend real, silêncio detectado ou timeout), então não há avanço duplicado.
//  - 'silent': passou graceMs e isSpeaking() é falso => onDone
//  - 'timeout': passou texto*120ms/rate + 5s => onFail('timeout')
export function createGuard({ now, setTimer, clearTimer, isSpeaking, graceMs = 1500, pollMs = 500 }) {
  let id = null, cur = null;
  const clear = () => { if (id != null) { clearTimer(id); id = null; } };
  function cancel() { clear(); if (cur) { cur.fired = true; cur = null; } }
  function begin(text, rate, onDone, onFail) {
    cancel();
    const h = { fired: false }; cur = h;
    const t0 = now();
    const cap = String(text).length * 120 / Math.max(0.1, rate || 1) + 5000;
    const finish = (fn, arg) => { if (h.fired) return; h.fired = true; if (cur === h) { cur = null; clear(); } fn(arg); };
    const poll = () => {
      id = null;
      if (h.fired || cur !== h) return;
      const el = now() - t0;
      if (el >= cap) return finish(onFail, 'timeout');
      if (el >= graceMs && !isSpeaking()) return finish(onDone, 'silent');
      id = setTimer(poll, pollMs);
    };
    id = setTimer(poll, pollMs);
    return { done: () => finish(onDone), fail: c => finish(onFail, c) };
  }
  return { begin, cancel };
}

// Primeira versão (na ordem dada) com texto não vazio para a referência. loader(id) -> versão|throws.
export async function firstWithText(ids, loader, textOf, ref) {
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) continue; seen.add(id);
    try { const v = await loader(id); const t = textOf(v, ref[0], ref[1], ref[2]); if (t && String(t).trim()) return { ver: v, text: String(t) }; } catch (e) { /* próxima */ }
  }
  return null;
}
