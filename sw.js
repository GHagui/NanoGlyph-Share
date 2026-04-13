const CACHE_NAME = 'nanoglyph-v5';
const ASSETS = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './manifest.json',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/whatsapp.svg',
    './icons/telegram.svg',
    './icons/messenger.svg',
    './icons/instagram.svg',
    './icons/github.svg',
    './nanoglyph_core/pkg/nanoglyph_core_bg.wasm',
    './nanoglyph_core/pkg/nanoglyph_core.js'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(ASSETS))
    );
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => response || fetch(event.request))
    );
});