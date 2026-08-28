// Minimal service worker, existing for exactly one reason: Chrome on Android
// only fires `beforeinstallprompt` — the event that powers the "התקנה" button
// and the logo's install click in nav-bar.tsx — for a page that is controlled
// by a service worker with a fetch handler. Without this file the event never
// fires at all, which is why tapping the logo appeared to do nothing.
//
// It deliberately does NOT cache anything. The fetch handler never calls
// respondWith, so every request falls straight through to the network exactly
// as it would with no service worker registered — the shift data is live
// Supabase data and must never be served stale from a cache.
self.addEventListener("install", () => {
  // Don't sit in "waiting" behind an older worker — a first-time visitor
  // needs this controlling the page promptly for the install prompt to fire.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Take control of the already-open page instead of waiting for the next
  // navigation, so the prompt can appear on this visit rather than the next.
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Intentionally empty — presence is what Chrome's installability check
  // looks for. Falling through keeps normal network behavior.
});
