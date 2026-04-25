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

### Connection Errors

| Error Type | Handling |
|------------|----------|
| 401/403 | Session expired → Set `connectionStatus: 'expired'` → UI shows re-login prompt |
| Network failure | Log to console → Retry on next interval |
| Parse error | Skip view → Continue with others |

### Service Worker Resilience

```javascript
// checkLoop() restarts on every SW wake-up
function checkLoop() {
  chrome.alarms.create('checkZendesk', { periodInMinutes: intervalMinutes });
}

// Alarms persist across SW restarts, so checks continue even after browser restart
```

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
