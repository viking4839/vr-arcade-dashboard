// =============================================================================
// public/service-worker.js
// =============================================================================
// Handles background push notifications for Jump Zone.
// This file must live in the /public folder so Next.js serves it at the root.
// It runs in the background even when the browser tab is closed.
// =============================================================================

const CACHE_NAME = 'jump-zone-v1';

// ── Install event — cache the notification sounds ─────────────────────────────
self.addEventListener('install', event => {
  self.skipWaiting(); // activate immediately
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Pre-cache notification icons if you have them
      return cache.addAll(['/icon-192.png'].filter(Boolean)).catch(() => {});
    })
  );
});

// ── Activate event — clean up old caches ─────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim(); // take control of all tabs immediately
});

// ── Push event — triggered when the server sends a message ───────────────────
self.addEventListener('push', event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'Jump Zone Alert', body: event.data ? event.data.text() : '' };
  }

  const type    = data.type || 'urgent';      // 'urgent' | 'overdue'
  const isOverdue = type === 'overdue';

  const title   = data.title || (isOverdue ? '⏰ Session Overdue!' : '⚠️ Leaving Soon');
  const body    = data.body  || 'A group needs attention.';
  const tag     = data.tag   || `session-${Date.now()}`;
  const url     = data.url   || '/';

  const options = {
    body,
    icon:    '/icon-192.png',
    badge:   '/badge-72.png',
    vibrate: isOverdue ? [300, 100, 300, 100, 300] : [200, 100, 200],
    tag,                           // same tag = replace duplicate notifications
    renotify: true,                // always show even if same tag already exists
    requireInteraction: isOverdue, // overdue stays until dismissed
    silent: false,
    data: { url, type, sessionId: data.sessionId },
    actions: [
      { action: 'view',    title: '👀 View session' },
      { action: 'dismiss', title: '✓ Dismiss' },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// ── Notification click — open or focus the app ────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const urlToOpen = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(windowClients => {
        // If app already open, focus it
        for (const client of windowClients) {
          if ('focus' in client) {
            client.postMessage({
              type: 'NOTIFICATION_CLICK',
              sessionId: event.notification.data && event.notification.data.sessionId,
            });
            return client.focus();
          }
        }
        // Otherwise open a new window
        if (self.clients.openWindow) {
          return self.clients.openWindow(urlToOpen);
        }
      })
  );
});

// ── Notification close — track dismissals if needed ──────────────────────────
self.addEventListener('notificationclose', () => {
  // Optional: log analytics
});