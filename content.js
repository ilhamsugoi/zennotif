// =====================================================================
// === ZenNotif - Content Script (Keep-Alive Pinger) ===
// =====================================================================

// This script runs INSIDE Zendesk pages (*.zendesk.com).
// Its ONLY job is to keep the Service Worker alive and act as a
// "Pinger" to trigger fast polling checks (10/15 seconds).
// Core logic (fetching, comparison) remains in background.js,
// so it's safe from API spam even with multiple Zendesk tabs open.

setInterval(() => {
  try {
    // Send ping to background script every 5 seconds
    chrome.runtime.sendMessage({ type: 'content-ping' });
  } catch (e) {
    // Ignore errors (usually happens briefly after extension reload or update)
  }
}, 5000);

// ZenNotif: Content script active for keep-alive pinging
