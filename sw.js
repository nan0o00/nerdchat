// Service worker do NEXO: guarda o "casco" do app para abrir rápido e funcionar sem rede.
// Nunca guarda chamadas ao servidor (Supabase) nem dados de conversa.
const CACHE = 'nexo-v1'; // (avisos v2: abre a conversa certa)
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // Supabase e outros: direto na rede
  // páginas: rede primeiro (pega a versão nova), cache se estiver sem internet
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('./index.html', copy)); return res; })
      .catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; })));
});

// ---- avisos ----
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// endereço seguro: só o próprio app, com no máximo ?chat=<id válido>
const safeUrl = (u) => {
  try {
    const url = new URL(u || './', self.registration.scope);
    if (url.origin !== self.location.origin) return './';
    const c = url.searchParams.get('chat');
    return c && UUID.test(c) ? './?chat=' + c.toLowerCase() : './';
  } catch (_) { return './'; }
};
// aviso de mensagem do servidor: etiqueta "msg-<id do remetente>" (ou "match-<id>") aponta a conversa
const urlFromTag = (tag) => { const m = /^(?:msg|match)-(.+)$/.exec(tag || ''); return m && UUID.test(m[1]) ? './?chat=' + m[1].toLowerCase() : null; };
// texto do aviso: tira a linha de citação de respostas ("↩ Nome: “trecho”") e corta com segurança
const cleanBody = (b) => {
  let t = String(b || '');
  if (t.startsWith('↩ ')) { const i = t.indexOf('\n'); t = i >= 0 ? '↩ ' + t.slice(i + 1) : 'Respondeu a uma mensagem'; }
  t = t.replace(/\s+/g, ' ').trim();
  if (t === 'Foto') t = '📷 Foto'; else if (t === 'Mensagem de voz') t = '🎤 Mensagem de voz';
  const a = Array.from(t); return a.length > 120 ? a.slice(0, 119).join('') + '…' : t;
};

// toque num aviso: abre a conversa certa (ou só o app)
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = safeUrl(e.notification.data && e.notification.data.url);
  const chat = new URL(url, self.registration.scope).searchParams.get('chat');
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if ('focus' in c) {
        if (chat) c.postMessage({ type: 'nexo-open-chat', uid: chat });
        return c.focus();
      }
    }
    return self.clients.openWindow(url);
  }));
});

// aviso que chega do servidor (funciona com o app fechado)
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: 'NEXO', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    if (list.some((c) => c.visibilityState === 'visible' && c.focused)) return undefined; // app aberto na frente: o aviso aparece dentro do app
    const title = String(d.title || '').trim().slice(0, 60) || 'NEXO';
    const url = urlFromTag(d.tag) || safeUrl(d.url);
    return self.registration.showNotification(title, {
      body: cleanBody(d.body), tag: d.tag || undefined, renotify: !!d.tag, icon: 'icon-192.png', badge: 'icon-192.png', data: { url },
    });
  }));
});
