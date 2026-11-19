// Service worker do Reader: deixa abrir o app sem internet, com as últimas
// notícias baixadas.
//
// Tudo do próprio site (HTML, CSS, JS, reader.json) vem da rede quando há
// internet, para nunca ficar preso numa versão velha; a cópia guardada só
// entra quando a rede falha ou demora demais. O app pede reader.json com
// ?t=<horário> para fugir do cache do navegador: aqui todas essas versões
// viram uma cópia só. Imagens e links das notícias são de outros sites e não
// passam por aqui.

const CACHE = 'reader-site-v1';
const ESPERA_REDE_MS = 4000; // rede ruim no celular: depois disso, usa a cópia guardada
const ESCOPO = new URL('./', self.location).href;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', 'style.css', 'app.js'])));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      for (const nome of await caches.keys()) if (nome.startsWith('reader-') && nome !== CACHE) await caches.delete(nome);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith(ESCOPO)) return;
  const url = new URL(req.url);
  let chave = req;
  if (req.mode === 'navigate') chave = ESCOPO;
  else if (url.search) chave = url.origin + url.pathname; // reader.json?t=… → reader.json
  e.respondWith(redePrimeiro(req, chave));
});

async function redePrimeiro(req, chave) {
  const cache = await caches.open(CACHE);
  const rede = fetch(req).then((r) => {
    if (r.ok) cache.put(chave, r.clone()).catch(() => {});
    return r;
  });
  const guardada = await cache.match(chave);
  if (!guardada) return rede;
  const prazo = new Promise((ok) => setTimeout(() => ok(guardada), ESPERA_REDE_MS));
  return Promise.race([rede, prazo]).catch(() => guardada);
}
