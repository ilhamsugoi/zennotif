# ZenNotif Technical Architecture

This document explains the technical decisions and architecture of ZenNotif for developers and technical interviewers.

## Table of Contents

1. [System Overview](#system-overview)
2. [Manifest V3 Architecture](#manifest-v3-architecture)
3. [Component Breakdown](#component-breakdown)
4. [Data Flow](#data-flow)
5. [Authentication Strategy](#authentication-strategy)
6. [State Management](#state-management)
7. [Audio Playback Challenge](#audio-playback-challenge)
8. [Error Handling](#error-handling)
9. [Performance Considerations](#performance-considerations)

## System Overview

ZenNotif is a Chrome extension built on **Manifest V3** that monitors Zendesk views for new tickets and notifies the user via audio and browser notifications.

```
┌─────────────────────────────────────────────────────────────────┐
│                          Chrome Browser                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐ │
│  │  Popup UI    │  │  Zendesk Tab │  │  Other Tabs              │ │
│  │  (popup.js)  │  │  (content.js)│  │                          │ │
│  └──────┬───────┘  └──────┬───────┘  └──────────────────────────┘ │
│         │                 │                                      │
│         │         ┌───────▼───────┐                              │
│         │         │ Service Worker │                              │
│         │         │(background.js) │                              │
│         │         └───────┬───────┘                              │
│         │                 │                                      │
│         │         ┌───────▼───────┐  ┌──────────────────┐     │
│         │         │  Offscreen     │  │  Zendesk API       │     │
│         │         │  Document      │  │  (via cookies)     │     │
│         │         └────────────────┘  └──────────────────┘     │
└─────────────────────────────────────────────────────────────────┘
```

## Manifest V3 Architecture

Chrome migrated from Manifest V2 to V3 for better security and performance. Key differences affecting this extension:

| Aspect | Manifest V2 | Manifest V3 (This Extension) |
|--------|-------------|------------------------------|
| **Background** | Persistent page | Event-driven service worker |
| **Network** | `XMLHttpRequest` | `fetch()` API |
| **Audio** | Direct from background | Requires offscreen document |
| **Lifecycle** | Always running | Wakes up on events |

**Why MV3?**
- Chrome Web Store now requires MV3 for new extensions
- Better security isolation
- Reduced resource consumption

**The Challenge**: Service workers are ephemeral — they sleep after 30 seconds of inactivity. This breaks long-running polling loops.

**The Solution**: Hybrid pinger architecture (see below).

## Component Breakdown

### 1. Service Worker (`background.js`)

The brain of the extension. Responsible for:
- Polling Zendesk API on schedule
- Managing ticket state snapshots
- Coordinating audio playback
- Creating browser notifications

```javascript
// Key function: checkZendesk()
// - Fetches tickets from monitored views
// - Compares with previous snapshot
// - Triggers notifications for new/changed tickets
```

**Lifecycle Management**:
```javascript
// Alarms API replaces setInterval (MV3 requirement)
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkZendesk') checkZendesk();
});

// Restart loop every time SW wakes up
checkLoop();
```

### 2. Content Script (`content.js`)

Runs inside the Zendesk tab to keep the service worker alive.

```javascript
// Ping every 5 seconds to prevent service worker hibernation
setInterval(() => {
  chrome.runtime.sendMessage({ type: 'content-ping' });
}, 5000);
```

**Why this matters**: Without these pings, the service worker would sleep and miss scheduled checks.

**Trade-off**: Requires the user to have at least one Zendesk tab open. This is acceptable because agents typically work with Zendesk open anyway.

### 3. Offscreen Document (`offscreen.js` + `offscreen.html`)

Manifest V3 service workers cannot play audio directly (no DOM access). The offscreen document provides an isolated page for audio playback.

```javascript
// In background.js
async function ensureOffscreen() {
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['AUDIO_PLAYBACK'],
    justification: 'Play ticket notification sounds'
  });
}
```

**Audio Architecture**:
- **Default tone**: Plays MP3 file via HTML5 Audio
- **Generated tones**: Uses Web Audio API for bell/chime/alert/soft tones
- **Volume control**: GainNode in Web Audio API

### 4. Popup (`popup.js` + `popup.html` + `popup.css`)

The settings dashboard. Three screens:

1. **Setup**: Connect to Zendesk subdomain
2. **View Selection**: Choose which queues to monitor
3. **Dashboard**: Monitor status, configure settings, view history

**State Sync**: Popup reads from `chrome.storage.sync` (user settings) and `chrome.storage.local` (runtime state).

## Data Flow

### Ticket Detection Flow

```
1. Alarm fires (10/30/60s interval)
   │
   ▼
2. Service Worker wakes up
   │
   ▼
3. For each monitored view:
   │   a. Fetch tickets from Zendesk API
   │   b. Compare with stored snapshot
   │   c. Detect new tickets or status changes
   │
   ▼
4. If changes detected:
   │   a. Send message to offscreen document
   │   b. Play sound
   │   c. Create browser notification
   │   d. Update badge count
   │   e. Store in history
   │
   ▼
5. Update snapshot with current state
```

### Authentication Flow

```
1. User clicks Connect
   │
   ▼
2. Validate session with /api/v2/users/me.json
   │   (Uses browser's cookies automatically)
   │
   ▼
3. If valid:
   │   a. Store subdomain and user info
   │   b. Fetch available views
   │   c. Show view selection screen
   │
   ▼
4. User selects views and saves
   │
   ▼
5. Start monitoring with alarm
```

## Authentication Strategy

### The API Token Problem

Traditional Zendesk integrations require:
1. Admin to generate API token
2. Secure storage of token
3. Token rotation for security
4. Scope management

**Friction**: Support agents often don't have admin access. IT bottlenecks kill adoption.

### Session Cookie Approach

ZenNotif uses the user's existing Zendesk session:

```javascript
// fetch() with credentials: 'include' sends cookies automatically
const response = await fetch(
  `https://${subdomain}.zendesk.com/api/v2/views/${viewId}/tickets.json`,
  { credentials: 'include', cache: 'no-cache' }
);
```

**Pros**:
- Zero setup for agents
- Respects existing Zendesk permissions
- No token management
- No admin involvement needed

**Cons**:
- Requires user to be logged in
- Session can expire (handled gracefully)
- Only works with browser (not headless)

**Security Consideration**: The extension never sees or stores credentials — the browser handles cookie transmission securely.

## State Management

### Storage Areas

| Storage | Scope | Use Case |
|---------|-------|----------|
| `chrome.storage.sync` | Cross-device | User settings (subdomain, views, interval, tone, volume) |
| `chrome.storage.local` | Device-only | Runtime state (snapshots, history, connection status) |

### Ticket Snapshot Format

```javascript
// Key: `snapshot_${viewId}`
// Value: { ticketId: status, ... }

{
  "12345": "new",
  "12346": "open",
  "12347": "pending"
}
```

**Why this format?**
- Fast lookup: O(1) to check if ticket exists
- Easy comparison: Compare previous status to detect changes
- Minimal storage: Only ID and status (not full ticket data)

### Notification History

```javascript
// Key: `history`
// Value: Array of notification events (max 50)
[
  {
    tickets: [
      { id: 12345, subject: "...", reason: "New ticket (new)", viewName: "..." }
    ],
    time: "2026-04-25T12:30:00.000Z"
  }
]
```

## Audio Playback Challenge

### The MV3 Audio Problem

Service workers in Manifest V3 have no DOM, so they cannot:
- Create `<audio>` elements
- Use the Web Audio API
- Play sounds directly

### Solution: Offscreen Document

The offscreen document is a hidden page that stays alive for audio playback:

```javascript
// background.js sends message to offscreen
chrome.runtime.sendMessage({
  target: 'offscreen',
  type: 'play-sound',
  url: 'notifikasi.mp3',
  volume: 0.8,
  tone: 'default'
});

// offscreen.js receives and plays
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== 'offscreen') return;
  if (msg.type === 'play-sound') {
    const audio = new Audio(msg.url);
    audio.volume = msg.volume;
    audio.play();
  }
});
```

### Tone Generation

For custom tones, the offscreen document uses Web Audio API:

```javascript
function generateTone(type, volume) {
  const ctx = new AudioContext();
  const gain = ctx.createGain();
  gain.gain.value = volume;
  gain.connect(ctx.destination);

  // Bell: 880Hz -> 660Hz (ding-dong)
  playNote(ctx, gain, 880, 0, 0.15);
  playNote(ctx, gain, 660, 0.2, 0.25);
}
```

## Error Handling

### Typed Error Tokens

As of v5.1.0, `fetchTickets()` returns a typed token on failure rather than a generic `null`, so callers can set the appropriate UI state and decide whether to retry.

```javascript
async function fetchTickets(subdomain, viewId) {
  // ... fetch loop with Retry-After honouring for 429 ...
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) return 'unauthorized';
    if (response.status === 429) return 'rate-limited';
    return 'error';
  }
  // success path
  return allTickets;
}
```

The main check function aggregates these across views and resolves a single connection status:

```javascript
let connectionStatus = 'connected';
if (hadUnauthorized) connectionStatus = 'expired';
else if (hadRateLimited) connectionStatus = 'rate-limited';
else if (hadError && allNewTickets.length === 0) connectionStatus = 'error';
```

### Connection Errors

| Error Type | Handling |
|------------|----------|
| 401 / 403 | Session expired → `connectionStatus: 'expired'` → UI shows re-login prompt |
| 429 | Retry once honouring `Retry-After` (cap 10s) → if still 429, `connectionStatus: 'rate-limited'` |
| Network failure | Log once → `connectionStatus: 'error'` → retry on next interval |
| Parse error | Skip view → continue with others |

### Reentrancy Guard

The extension has three independent triggers that can all fire near-simultaneously:

1. `chrome.alarms` periodic tick
2. `content.js` keep-alive ping (every 5s, throttled by `lastCheckedTime`)
3. Manual `Check Now` from the popup

Without coordination, two concurrent `checkZendesk()` runs could both read the old snapshot, fetch, and then overwrite each other — losing notifications in the window between reads and writes.

The fix is a single in-flight promise:

```javascript
let checkInFlight = null;

function checkZendesk() {
  if (checkInFlight) return checkInFlight;
  checkInFlight = _checkZendesk().finally(() => { checkInFlight = null; });
  return checkInFlight;
}
```

All three triggers go through this shim, so a second call while the first is in-flight just awaits the same promise.

### Service Worker Resilience

```javascript
// checkLoop() restarts on every SW wake-up
function checkLoop() {
  chrome.alarms.create('checkZendesk', { periodInMinutes: intervalMinutes });
}

// Alarms persist across SW restarts, so checks continue even after browser restart
```

## Notification Context & Deep Linking

When a Chrome notification fires, clicking it triggers `chrome.notifications.onClicked`. Extensions can't introspect what the notification represented — they only receive the notification ID.

v5.1.0 introduces a lookup map keyed by notification ID:

```javascript
// chrome.storage.local key: 'notificationContext'
{
  "zennotif-1715311245123": { ticketId: 12345 },   // single-ticket notification
  "zennotif-1715311256789": { ticketId: null }     // multi-ticket → dashboard
}
```

When a notification batch contains exactly one ticket, clicking it deep-links to `/agent/tickets/<id>`. Multi-ticket batches route to `/agent/dashboard`. The map is pruned to the last 20 entries to avoid unbounded growth.

## Storage Quota Management

`chrome.storage.local` has a hard 10 MB quota per extension. A support org running an "Unassigned" view with 50k+ tickets could push a single snapshot past 5 MB on its own, exhausting the quota.

v5.1.0 adds a per-view cap:

```javascript
const MAX_SNAPSHOT_ENTRIES = 5000;

function trimSnapshot(map) {
  const keys = Object.keys(map);
  if (keys.length <= MAX_SNAPSHOT_ENTRIES) return map;
  // Keep the newest ticket IDs (numerically highest = newest in Zendesk).
  const sorted = keys.map(Number).sort((a, b) => b - a).slice(0, MAX_SNAPSHOT_ENTRIES);
  const trimmed = {};
  for (const id of sorted) trimmed[id] = map[id];
  return trimmed;
}
```

This preserves correctness for detection of *new* tickets (the most-recent IDs are always retained) while bounding snapshot size at roughly 100-200 KB per view.

## Rate Limit Handling

Zendesk returns HTTP 429 with a `Retry-After` header when request rates exceed per-endpoint limits. v5.1.0 honours the header with a bounded retry:

```javascript
for (let attempt = 0; attempt < 2; attempt++) {
  response = await fetch(nextUrl, { credentials: 'include', cache: 'no-cache' });
  if (response.status !== 429) break;
  const retryAfter = parseInt(response.headers.get('Retry-After') || '2', 10);
  await new Promise(r => setTimeout(r, Math.min(retryAfter, 10) * 1000));
}
```

The retry cap (10s) keeps a stuck endpoint from blocking the service worker indefinitely. After two failed attempts, the function returns `'rate-limited'` and the UI surfaces the state.

## Session Cache

`validateSession()` is called every time the popup opens. On a busy day that's dozens of unnecessary `/users/me.json` hits. v5.1.0 caches the result for 5 minutes per subdomain:

```javascript
const USER_CACHE_TTL_MS = 5 * 60 * 1000;

async function validateSession(subdomain, { force = false } = {}) {
  if (!force) {
    const cached = await chrome.storage.local.get('userCache');
    const entry = cached.userCache && cached.userCache[subdomain];
    if (entry && (Date.now() - entry.ts) < USER_CACHE_TTL_MS) {
      return { name: entry.name, email: entry.email };
    }
  }
  // ... fallback to network fetch + cache update ...
}
```

Callers that need a fresh check can pass `{ force: true }`.

## Performance Considerations

### API Rate Limiting

- Zendesk: 700 requests per minute per account
- ZenNotif: Maximum 6 requests per minute (10s interval × ~5 views)
- **Headroom**: 99%+ of rate limit available for other integrations

### Memory Management

- Snapshots store only `{id: status}` (minimal data)
- History capped at 50 entries (prevents unbounded growth)
- Offscreen document closes audio context after playback

### Battery & Resource Usage

- Alarms API is more efficient than `setInterval`
- Service worker sleeps between checks
- Content script pinger only runs when Zendesk tab is open

## Future Technical Improvements

1. **Web Push API**: Replace polling with server-sent events (requires backend)
2. **IndexedDB**: Replace storage.local for larger history
3. **Service Worker Precache**: Preload assets for offline capability
4. **Web Workers**: Move snapshot comparison off main thread

## Related Documentation

- [Chrome Extension Documentation](https://developer.chrome.com/docs/extensions/)
- [Manifest V3 Migration Guide](https://developer.chrome.com/docs/extensions/mv3/intro/)
- [Zendesk API Documentation](https://developer.zendesk.com/api-reference/)
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
