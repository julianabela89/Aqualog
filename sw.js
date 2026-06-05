// AquaLog Service Worker v1.0
const CACHE = 'aqualog-v1';
const ASSETS = [
  './index.html',
  './manifest.json',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
  'https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600&family=DM+Sans:wght@300;400;500&display=swap'
];

// ── Install: cache core assets ──────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => {
      // Cache what we can; ignore failures for external resources
      return Promise.allSettled(ASSETS.map(url => c.add(url).catch(() => {})));
    }).then(() => self.skipWaiting())
  );
});

// ── Activate: clean old caches ──────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: serve from cache, fallback to network ────────
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return response;
      }).catch(() => cached);
    })
  );
});

// ── Push notifications ──────────────────────────────────
self.addEventListener('push', e => {
  let data = { title: 'AquaLog Reminder', body: 'Check your aquarium!' };
  try { if (e.data) data = { ...data, ...e.data.json() }; } catch {}
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      tag: data.tag || 'aqualog',
      renotify: true,
      data: data,
      actions: [
        { action: 'open', title: '🐠 Open App' },
        { action: 'dismiss', title: 'Dismiss' }
      ]
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'dismiss') return;
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('./index.html');
    })
  );
});

// ── Scheduled reminder checks (via periodic background sync if supported) ──
self.addEventListener('periodicsync', e => {
  if (e.tag === 'aqualog-reminders') {
    e.waitUntil(checkReminders());
  }
});

async function checkReminders() {
  // Read data from IndexedDB (set by the app)
  try {
    const db = await openDB();
    const tx = db.transaction('reminders', 'readonly');
    const store = tx.objectStore('reminders');
    const reminders = await getAllFromStore(store);
    const today = new Date(); today.setHours(0,0,0,0);

    for (const r of reminders) {
      if (!r.enabled || !r.nextDue) continue;
      const due = new Date(r.nextDue);
      if (due <= today) {
        await self.registration.showNotification('🐠 AquaLog Reminder', {
          body: r.message,
          icon: './icons/icon-192.png',
          tag: r.id,
          renotify: true,
        });
      }
    }
  } catch (err) {
    console.warn('SW checkReminders error:', err);
  }
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('aqualog', 1);
    req.onsuccess  = () => resolve(req.result);
    req.onerror    = () => reject(req.error);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('reminders')) {
        db.createObjectStore('reminders', { keyPath: 'id' });
      }
    };
  });
}

function getAllFromStore(store) {
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}
