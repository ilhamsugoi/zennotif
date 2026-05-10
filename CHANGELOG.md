# Changelog

All notable changes to ZenNotif will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [5.1.0] — 2026-05-10

Hardening release focused on reliability under real-world conditions: flaky networks, concurrent timers, rate-limited instances, and enterprise deployments.

### Added

- **Rate-limit handling (HTTP 429).** The fetcher now reads `Retry-After` from Zendesk and backs off (capped at 10s, two attempts per page) before surfacing the error.
- **New `rate-limited` connection status** shown in the popup so agents can tell throttling apart from session expiry.
- **Deep-link on notification click.** When a notification covers a single new ticket, clicking it opens that ticket directly. Multi-ticket notifications still open the Agent Dashboard.
- **Validate-session cache (5 minutes per subdomain).** Rapid popup open/close no longer re-hits `/users/me.json` every time.
- **Snapshot size cap (5,000 entries per view).** Large views can no longer approach the 10 MB `chrome.storage.local` quota. Oldest ticket IDs are evicted first, newest retained.
- **Subdomain normalizer in setup.** Accepts `company`, `company.zendesk.com`, or a full URL like `https://company.zendesk.com/agent/tickets/123`.
- **Enterprise readiness documentation** covering VPN, host-mapped Help Centers, SSO/SAML, SSL inspection, and CASB.

### Changed

- `fetchTickets()` now returns typed error tokens (`'unauthorized'`, `'rate-limited'`, `'error'`) instead of `null`, allowing callers to distinguish causes and set the right UI state.
- Notification click handler reads a new `notificationContext` map in `chrome.storage.local` to resolve the correct destination.
- Popup drops the Google Fonts `@import` and uses the OS font stack — removes an external network dependency and fixes a CSS ordering bug where Inter was never actually loading.

### Fixed

- **Invalid `offscreen` key removed from `manifest.json`.** Manifest V3 does not accept a top-level `offscreen` declaration; the offscreen document is created at runtime. Chrome was silently ignoring the key.
- **Race condition between `chrome.alarms` and pinger.** A new `checkInFlight` guard ensures `checkZendesk()` cannot run in parallel. Previously, two concurrent runs could overwrite each other's snapshots and lose notifications.
- **Unhandled promise rejections** in `sendMessage` (when the offscreen document was still spinning up) and `audio.play()` (when Chrome's autoplay policy delayed playback) no longer pollute the service worker console.
- **Duplicate keep-alive pinger.** The offscreen document's 5-second pinger has been removed; `content.js` running inside Zendesk tabs is sufficient. Eliminates redundant `chrome.runtime` message churn.

### Security & Privacy

- No new permissions added. `host_permissions` remains `https://*.zendesk.com/*`.
- All state — snapshots, history, notification context, user cache — remains local to the browser profile. No network calls to third parties.

---

## [5.0.0] — 2026-04-25

Initial public release.

### Added

- Manifest V3 Chrome extension with service-worker background polling.
- Selective view monitoring via Zendesk session cookie (no API tokens).
- Cross-tab audio alerts via offscreen document.
- Five notification tones (Default MP3 + Bell, Chime, Alert, Soft generated with Web Audio API).
- Badge counter on toolbar icon with accumulation across unacknowledged batches.
- Popup dashboard with monitored views, settings (interval, tone, volume, statuses), and notification history.
- Keep-alive content script to prevent service worker hibernation during long sessions.

[5.1.0]: https://github.com/ilhamsugoi/zennotif/releases/tag/v5.1.0
[5.0.0]: https://github.com/ilhamsugoi/zennotif/releases/tag/v5.0.0
