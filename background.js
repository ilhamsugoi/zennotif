// =====================================================================
// === ZenNotif - Background Service Worker ===
// =====================================================================

// --- Offscreen Document Management ---
async function ensureOffscreen() {
  try {
    if (chrome.runtime.getContexts) {
      const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
      if (contexts.length > 0) return;
    } else if (chrome.offscreen.hasDocument) {
      const hasDoc = await chrome.offscreen.hasDocument();
      if (hasDoc) return;
    }
  } catch (e) {}

  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Play ticket notification sounds',
    });
  } catch (e) {
    // Ignore if already exists
  }
}

// --- Play Sound ---
async function playSound() {
  const config = await chrome.storage.sync.get(['volume', 'tone']);
  const volume = (config.volume ?? 80) / 100;
  const tone = config.tone ?? 'default';
  const soundURL = chrome.runtime.getURL('notifikasi.mp3');
  await ensureOffscreen();
  setTimeout(() => {
    chrome.runtime.sendMessage({ target: 'offscreen', type: 'play-sound', url: soundURL, volume, tone });
  }, 100);
}

// --- Fetch Tickets (Session Cookie Auth — NO API Token!) ---
async function fetchTickets(subdomain, viewId) {
  const allTickets = [];
  let nextUrl = `https://${subdomain}.zendesk.com/api/v2/views/${viewId}/tickets.json?per_page=100`;
  let page = 0;

  try {
    while (nextUrl && page < 10) {
      page++;
      const response = await fetch(nextUrl, { credentials: 'include', cache: 'no-cache' });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          await chrome.storage.local.set({ connectionStatus: 'expired' });
        }
        return null;
      }

      const data = await response.json();
      allTickets.push(...data.tickets.map(t => ({
        id: t.id,
        status: t.status,
        subject: t.subject || `Ticket #${t.id}`
      })));
      nextUrl = data.next_page || null;
    }
    return allTickets;
  } catch (error) {
    console.error("Network error:", error);
    await chrome.storage.local.set({ connectionStatus: 'error' });
    return null;
  }
}

// --- Main Check ---
async function checkZendesk() {
  const { subdomain, views = [], enabled = true, notifyStatuses = ['new', 'open'] } = await chrome.storage.sync.get(['subdomain', 'views', 'enabled', 'notifyStatuses']);
  
  if (!subdomain || views.length === 0) return;
  if (!enabled) {
    return;
  }

  const allNewTickets = [];

  for (const view of views) {
    const currentTickets = await fetchTickets(subdomain, view.id);
    if (!currentTickets) continue;

    const storageKey = `snapshot_${view.id}`;
    const stored = await chrome.storage.local.get(storageKey);
    const previousMap = stored[storageKey] || null;

    // First run: snapshot only, no notification
    if (previousMap === null) {
      const initMap = {};
      currentTickets.forEach(t => { initMap[t.id] = t.status; });
      await chrome.storage.local.set({ [storageKey]: initMap, [`count_${view.id}`]: currentTickets.length });
      continue;
    }

    // Detect new tickets & status changes based on selected notifyStatuses
    for (const ticket of currentTickets) {
      const prevStatus = previousMap[ticket.id];
      const currentStatus = ticket.status; // e.g., 'new', 'open', 'pending'

      if (prevStatus === undefined) {
        // Completely new ticket in this view
        if (notifyStatuses.includes(currentStatus)) {
          allNewTickets.push({ ...ticket, reason: `New ticket (${currentStatus})`, viewName: view.name });
        }
      } else if (prevStatus !== currentStatus) {
        // Status changed while inside the view
        if (notifyStatuses.includes(currentStatus)) {
          allNewTickets.push({ ...ticket, reason: `Changed to ${currentStatus.toUpperCase()}`, viewName: view.name });
        }
      }
    }

    // Update snapshot
    const newMap = {};
    currentTickets.forEach(t => { newMap[t.id] = t.status; });
    await chrome.storage.local.set({ [storageKey]: newMap, [`count_${view.id}`]: currentTickets.length });
  }

  // Update status
  await chrome.storage.local.set({ 
    connectionStatus: 'connected', 
    lastChecked: new Date().toISOString(),
    lastCheckedTime: Date.now()
  });

  if (allNewTickets.length > 0) {
    playSound();
    
    // Accumulate badge count (don't clear)
    chrome.action.getBadgeText({}, (currentText) => {
      const currentCount = parseInt(currentText) || 0;
      chrome.action.setBadgeText({ text: String(currentCount + allNewTickets.length) });
    });
    
    chrome.action.setBadgeBackgroundColor({ color: '#E74C3C' });

    const lines = allNewTickets.slice(0, 3).map(t => `[${t.reason}] ${t.subject}`);
    const message = lines.join('\n') + (allNewTickets.length > 3 ? `\n+${allNewTickets.length - 3} more` : '');
    chrome.notifications.create(`zennotif-${Date.now()}`, {
      type: 'basic',
      title: `🔔 ${allNewTickets.length} ticket(s) need attention`,
      message,
      iconUrl: chrome.runtime.getURL('icon.png'),
      priority: 2
    });

    // Store for popup history
    const historyData = await chrome.storage.local.get('history');
    const history = historyData.history || [];
    history.unshift({ tickets: allNewTickets, time: new Date().toISOString() });
    await chrome.storage.local.set({ history: history.slice(0, 50) });
  }
}

// --- API: Validate Session ---
async function validateSession(subdomain) {
  try {
    const res = await fetch(`https://${subdomain}.zendesk.com/api/v2/users/me.json`, { credentials: 'include', cache: 'no-cache' });
    if (!res.ok) return null;
    const data = await res.json();
    return { name: data.user.name, email: data.user.email };
  } catch { return null; }
}

// --- API: Fetch Views ---
async function fetchViews(subdomain) {
  try {
    const res = await fetch(`https://${subdomain}.zendesk.com/api/v2/views.json?per_page=100`, { credentials: 'include', cache: 'no-cache' });
    if (!res.ok) return [];
    const data = await res.json();
    return data.views.filter(v => v.active).map(v => ({ id: String(v.id), name: v.title }));
  } catch { return []; }
}

// --- Message Handler ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'validate-session') {
    validateSession(msg.subdomain).then(user => sendResponse({ user }));
    return true;
  }
  if (msg.type === 'fetch-views') {
    fetchViews(msg.subdomain).then(views => sendResponse({ views }));
    return true;
  }
  if (msg.type === 'config-updated') {
    // Only remove snapshots for views that are no longer selected
    // Active view snapshots are preserved to avoid duplicate notifications
    const newViews = msg.views || [];
    const newViewIds = newViews.map(v => v.id);
    chrome.storage.local.get(null, (all) => {
      const keysToRemove = Object.keys(all).filter(k => {
        if (!k.startsWith('snapshot_') && !k.startsWith('count_')) return false;
        const viewId = k.replace('snapshot_', '').replace('count_', '');
        return !newViewIds.includes(viewId);
      });
      if (keysToRemove.length > 0) {
        chrome.storage.local.remove(keysToRemove);
      }
      checkZendesk();
    });
  }
  if (msg.type === 'check-now') {
    checkZendesk().then(() => sendResponse({ done: true }));
    return true;
  }
  if (msg.type === 'clear-badge') {
    chrome.action.setBadgeText({ text: '' });
  }
  if (msg.type === 'toggle-enabled') {
    if (!msg.enabled) {
      chrome.action.setBadgeText({ text: '' });
    } else {
      checkZendesk();
      checkLoop();
    }
  }
  if (msg.type === 'interval-changed') {
    loopActive = false; // force reset
    checkLoop();
  }
  if (msg.type === 'test-tone') {
    ensureOffscreen().then(() => {
      setTimeout(() => {
        chrome.runtime.sendMessage({
          target: 'offscreen',
          type: 'play-sound',
          url: chrome.runtime.getURL('notifikasi.mp3'),
          volume: (msg.volume ?? 80) / 100,
          tone: msg.tone ?? 'default'
        });
      }, 100);
    });
  }
  if (msg.type === 'content-ping' || msg.type === 'offscreen-ping') {
    chrome.storage.sync.get(['interval', 'enabled'], (config) => {
      if (config.enabled === false) return;
      const intervalSec = (config.interval && config.interval < 10) ? config.interval * 60 : (config.interval || 60);
      
      chrome.storage.local.get(['lastCheckedTime'], (data) => {
        const last = data.lastCheckedTime || 0;
        const now = Date.now();
        if (now - last >= intervalSec * 1000) {
          checkZendesk();
        }
      });
    });
  }
});

// --- Interval & Lifecycle Management ---
let loopActive = false;

async function checkLoop() {
  if (loopActive) return;
  
  const config = await chrome.storage.sync.get(['interval', 'enabled']);
  if (config.enabled === false) {
    chrome.alarms.clear('checkZendesk');
    return;
  }
  
  const intervalSec = (config.interval && config.interval < 10) ? config.interval * 60 : (config.interval || 60);
  const intervalMin = Math.max(1, Math.round(intervalSec / 60));
  
  chrome.alarms.create('checkZendesk', { periodInMinutes: intervalMin });

  if (intervalSec < 60) {
    loopActive = true;
    
    // Check if we need to run now
    const data = await chrome.storage.local.get(['lastCheckedTime']);
    const last = data.lastCheckedTime || 0;
    if (Date.now() - last >= intervalSec * 1000) {
      await checkZendesk();
    }
    
    setTimeout(() => {
      loopActive = false;
      checkLoop();
    }, intervalSec * 1000);
  }
}

// --- Events ---
chrome.runtime.onInstalled.addListener(async () => {
  ensureOffscreen();
  await checkLoop();
});

chrome.runtime.onStartup.addListener(async () => {
  ensureOffscreen();
  await checkLoop();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkZendesk') checkZendesk();
});

// Open Zendesk ticket when notification clicked
chrome.notifications.onClicked.addListener(async (notifId) => {
  if (notifId.startsWith('zennotif-')) {
    const config = await chrome.storage.sync.get(['subdomain']);
    if (config.subdomain) {
      chrome.tabs.create({ url: `https://${config.subdomain}.zendesk.com/agent/dashboard` });
    }
  }
});

// Restart loop every time Service Worker wakes up from sleep
checkLoop();