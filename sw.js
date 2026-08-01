const CACHE_NAME = 'nanoglyph-__NANOGLYPH_VERSION__';
const ASSETS = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './wasm-worker.js',
    './manifest.json',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/whatsapp.svg',
    './icons/telegram.svg',
    './icons/messenger.svg',
    './icons/instagram.svg',
    './icons/github.svg',
    './nanoglyph_core/pkg/nanoglyph_core_bg.wasm',
    './nanoglyph_core/pkg/nanoglyph_core.js',
    './vendor/heic-to-1.5.2.min.js',
    './vendor/heic-to-LICENSE.txt'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(ASSETS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(names => Promise.all(
                names
                    .filter(name => name.startsWith('nanoglyph-') && name !== CACHE_NAME)
                    .map(name => caches.delete(name))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => response || fetch(event.request))
    );
});
