// Service worker: shell pré-cacheado; dados em cache em tempo de execução (cache-first).
const VERSION = '041a4d8a7fee';
const SHELL_CACHE = 'bh-shell-' + VERSION;
const DATA_CACHE = 'bh-data-' + VERSION;
const SHELL = ['./', 'index.html', 'manifest.json', 'icon-192.png', 'icon-512.png', 'css/app.css',
  'js/app.js', 'js/store.js', 'js/data.js', 'js/reader.js', 'js/harpa.js', 'js/audio.js', 'js/audio-core.js', 'js/votd.js', 'js/plano.js'];
const IMG_FILES = ["img/livros/1co.jpg", "img/livros/1cr.jpg", "img/livros/1jo.jpg", "img/livros/1pe.jpg", "img/livros/1rs.jpg", "img/livros/1sm.jpg", "img/livros/1tm.jpg", "img/livros/1ts.jpg", "img/livros/2co.jpg", "img/livros/2cr.jpg", "img/livros/2jo.jpg", "img/livros/2pe.jpg", "img/livros/2rs.jpg", "img/livros/2sm.jpg", "img/livros/2tm.jpg", "img/livros/2ts.jpg", "img/livros/3jo.jpg", "img/livros/ag.jpg", "img/livros/am.jpg", "img/livros/ap.jpg", "img/livros/at.jpg", "img/livros/cl.jpg", "img/livros/creditos.json", "img/livros/ct.jpg", "img/livros/dn.jpg", "img/livros/dt.jpg", "img/livros/ec.jpg", "img/livros/ef.jpg", "img/livros/esd.jpg", "img/livros/et.jpg", "img/livros/ex.jpg", "img/livros/ez.jpg", "img/livros/fm.jpg", "img/livros/fp.jpg", "img/livros/gl.jpg", "img/livros/gn.jpg", "img/livros/hb.jpg", "img/livros/hc.jpg", "img/livros/is.jpg", "img/livros/jd.jpg", "img/livros/jl.jpg", "img/livros/jn.jpg", "img/livros/joao.jpg", "img/livros/job.jpg", "img/livros/jr.jpg", "img/livros/js.jpg", "img/livros/jz.jpg", "img/livros/lc.jpg", "img/livros/lm.jpg", "img/livros/lv.jpg", "img/livros/mc.jpg", "img/livros/ml.jpg", "img/livros/mq.jpg", "img/livros/mt.jpg", "img/livros/na.jpg", "img/livros/ne.jpg", "img/livros/nm.jpg", "img/livros/ob.jpg", "img/livros/os.jpg", "img/livros/pv.jpg", "img/livros/rm.jpg", "img/livros/rt.jpg", "img/livros/sf.jpg", "img/livros/sl.jpg", "img/livros/tg.jpg", "img/livros/tt.jpg", "img/livros/zc.jpg"]; // preenchido por tools/build.py (img/livros/*.jpg)
const EXTRA_DATA = ["data/books.json", "data/versions.json", "data/meta.json", "data/harpa.json", "data/votd.json", "data/plano.json", "data/bible-alm1911.json"]; // preenchido por tools/build.py (todos os arquivos de dados do build)
const CORE_DATA = ['data/books.json', 'data/versions.json', 'data/meta.json', 'data/harpa.json', 'data/votd.json', 'data/plano.json'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    // Cada arquivo isolado: ausência (ex.: audio.js, data/) nunca quebra a instalação.
    await Promise.all([...SHELL, ...IMG_FILES].map(u => shell.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    const data = await caches.open(DATA_CACHE);
    const failed = [];
    await Promise.all([...new Set([...CORE_DATA, ...EXTRA_DATA])].map(u => data.add(new Request(u, { cache: 'reload' })).catch(() => failed.push(u))));
    if (failed.length) console.warn('SW: falha ao pré-cachear', failed);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (![SHELL_CACHE, DATA_CACHE].includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const isData = url.pathname.includes('/data/');
  e.respondWith((async () => {
    const cacheName = isData ? DATA_CACHE : SHELL_CACHE;
    const hit = await caches.match(req, { cacheName });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res && res.ok) { const c = await caches.open(cacheName); c.put(req, res.clone()).catch(() => {}); }
      return res;
    } catch (err) {
      if (req.mode === 'navigate') { const i = await caches.match('index.html'); if (i) return i; }
      return new Response('', { status: 503, statusText: 'Offline' });
    }
  })());
});
