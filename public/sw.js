'use strict';

/**
 * JanApp service worker.
 * - cache-first voor statics (shell blijft werken offline)
 * - network-first voor /api/*  (data mag stalen, val terug op cache)
 * - cache-first voor /uploads/* (UUID-bestandsnamen zijn immutable)
 * - SSE (/events) wordt met rust gelaten (streams cachen breekt de flow)
 *
 * Bump CACHE_VERSION zodra statics zichtbaar wijzigen — dan wist activate
 * de oude cache en fetchen clients de nieuwe versie.
 */

// v6: nieuws-curatie (dedup + headlines/fold-out), sparkline-periode-label.
const CACHE_VERSION = 'janapp-v23';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(STATIC_ASSETS)),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Alleen same-origin GET-verzoeken behandelen.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // SSE-stream nooit aanraken.
  if (url.pathname === '/events') return;

  // API: network-first met cache-fallback en offline JSON-fallback.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() =>
          caches.match(req).then(
            (cached) =>
              cached ||
              new Response(JSON.stringify({ error: 'offline' }), {
                status: 503,
                headers: { 'Content-Type': 'application/json' },
              }),
          ),
        ),
    );
    return;
  }

  // Uploads (immutable UUID's): cache-first.
  if (url.pathname.startsWith('/uploads/')) {
    event.respondWith(
      caches.open(CACHE_VERSION).then((cache) =>
        cache.match(req).then(
          (cached) =>
            cached ||
            fetch(req).then((res) => {
              if (res.ok) cache.put(req, res.clone());
              return res;
            }),
        ),
      ),
    );
    return;
  }

  // Statics: cache-first, val terug op netwerk.
  event.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req).then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, clone));
          }
          return res;
        }),
    ),
  );
});
