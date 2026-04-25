// =====================================================================
// === ZenNotif - Popup Logic ===
// =====================================================================

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function showScreen(id) {
  $$('.screen').forEach(s => s.hidden = true);
  $(`#screen-${id}`).hidden = false;
}

document.addEventListener('DOMContentLoaded', async () => {
  const config = await chrome.storage.sync.get(['subdomain', 'views', 'volume', 'userName', 'userEmail', 'interval', 'tone']);
  if (config.subdomain && config.views && config.views.length > 0) {
    showDashboard(config);
  } else if (config.subdomain) {
    showViewSelection(config.subdomain, config.userName);
  } else {
    showScreen('setup');
  }
  chrome.runtime.sendMessage({ type: 'clear-badge' });
});

// ==================== SETUP SCREEN ====================

$('#btn-connect').addEventListener('click', async () => {
  const subdomain = $('#input-subdomain').value.trim().toLowerCase();
  if (!subdomain) return;
  const btn = $('#btn-connect');
  const btnText = btn.querySelector('.btn-text');
  const btnLoader = btn.querySelector('.btn-loader');
  const errorEl = $('#connect-error');
  btn.disabled = true;
  btnText.textContent = 'Connecting...';
  btnLoader.hidden = false;
  errorEl.hidden = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'validate-session', subdomain });
    if (response.user) {
      await chrome.storage.sync.set({ subdomain, userName: response.user.name, userEmail: response.user.email });
      showViewSelection(subdomain, response.user.name);
    } else {
      errorEl.textContent = `Failed to connect to ${subdomain}.zendesk.com. Make sure you are logged in.`;
      errorEl.hidden = false;
    }
  } catch (e) {
    errorEl.textContent = 'An error occurred. Check your internet connection.';
    errorEl.hidden = false;
  }
  btn.disabled = false;
  btnText.textContent = 'Connect';
  btnLoader.hidden = true;
});

$('#input-subdomain').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#btn-connect').click();
});

// ==================== VIEW SELECTION ====================

async function showViewSelection(subdomain, userName, fromDashboard = false) {
  showScreen('views');
  $('#btn-back').hidden = !fromDashboard;
  $('#user-info').textContent = userName ? `${userName} — ${subdomain}.zendesk.com` : `${subdomain}.zendesk.com`;
  const listEl = $('#views-list');
  listEl.innerHTML = '<div class="loader-inline">Loading views...</div>';
  const response = await chrome.runtime.sendMessage({ type: 'fetch-views', subdomain });
  const views = response.views || [];
  if (views.length === 0) {
    listEl.innerHTML = '<div class="loader-inline">No views found. Make sure you are logged into Zendesk.</div>';
    return;
  }
  const saved = await chrome.storage.sync.get(['views']);
  const savedIds = (saved.views || []).map(v => v.id);
  listEl.innerHTML = '';
  views.forEach(view => {
    const item = document.createElement('div');
    item.className = 'view-item';
    item.innerHTML = `<input type="checkbox" id="view-${view.id}" value="${view.id}" ${savedIds.includes(view.id) ? 'checked' : ''}><label for="view-${view.id}">${view.name}</label>`;
    item.addEventListener('click', (e) => {
      if (e.target.tagName !== 'INPUT') { item.querySelector('input').checked = !item.querySelector('input').checked; }
      updateSaveButton();
    });
    listEl.appendChild(item);
  });
  window._allViews = views;
  updateSaveButton();
}

function updateSaveButton() {
  $('#btn-save-views').disabled = $$('#views-list input:checked').length === 0;
}

$('#btn-save-views').addEventListener('click', async () => {
  const checkedInputs = $$('#views-list input:checked');
  const selectedViews = Array.from(checkedInputs).map(input => {
    const view = window._allViews.find(v => v.id === input.value);
    return { id: view.id, name: view.name };
  });
  await chrome.storage.sync.set({ views: selectedViews });
  chrome.runtime.sendMessage({ type: 'config-updated', views: selectedViews });
  const config = await chrome.storage.sync.get(['subdomain', 'views', 'volume', 'userName', 'userEmail']);
  showDashboard(config);
});

// ==================== DASHBOARD ====================

async function showDashboard(config) {
  showScreen('dashboard');
  const userText = config.userName ? `${config.userName} — ${config.subdomain}.zendesk.com` : `${config.subdomain}.zendesk.com`;
  $('#dash-user-info').textContent = userText;
  const vol = config.volume ?? 80;
  $('#volume-slider').value = vol;
  $('#volume-label').textContent = `${vol}%`;
  let interval = config.interval ?? 60;
  if (interval < 10) interval = interval * 60;
  $('#select-interval').value = String(interval);
  const tone = config.tone ?? 'default';
  $('#select-tone').value = tone;
  const notifyStatuses = config.notifyStatuses ?? ['new', 'open'];
  document.querySelectorAll('.status-chk').forEach(chk => { chk.checked = notifyStatuses.includes(chk.value); });
  const toggleData = await chrome.storage.sync.get(['enabled']);
  const isEnabled = toggleData.enabled !== false;
  $('#toggle-enabled').checked = isEnabled;
  updateDashboardState(isEnabled);
  await renderMonitoredViews(config.views);
  await renderStatus();
  await renderHistory();
}

async function renderMonitoredViews(views) {
  const container = $('#monitored-views');
  container.innerHTML = '';
  for (const view of views) {
    const countData = await chrome.storage.local.get(`count_${view.id}`);
    const count = countData[`count_${view.id}`] ?? '—';
    const item = document.createElement('div');
    item.className = 'mv-item';
    item.innerHTML = `<span class="mv-name">${view.name}</span><span class="mv-count">${count}</span>`;
    container.appendChild(item);
  }
}

async function renderStatus() {
  const data = await chrome.storage.local.get(['connectionStatus', 'lastChecked']);
  const dot = $('#status-dot');
  const text = $('#status-text');
  const status = data.connectionStatus || 'connecting';
  dot.className = `status-dot ${status === 'connected' ? 'connected' : status === 'expired' ? 'expired' : 'error'}`;
  if (status === 'connected') text.textContent = 'Connected';
  else if (status === 'expired') text.textContent = 'Session expired — log in to Zendesk';
  else text.textContent = 'Connecting...';
  if (data.lastChecked) {
    const time = new Date(data.lastChecked).toLocaleTimeString('en-US');
    $('#last-checked').textContent = `Last checked: ${time}`;
  }
}

async function renderHistory() {
  const data = await chrome.storage.local.get('history');
  const config = await chrome.storage.sync.get(['subdomain']);
  const subdomain = config.subdomain || '';
  const history = data.history || [];
  const container = $('#history-list');
  if (history.length === 0) {
    container.innerHTML = '<p class="hint">No notifications yet.</p>';
    return;
  }
  container.innerHTML = '';
  history.slice(0, 10).forEach(entry => {
    const time = new Date(entry.time).toLocaleTimeString('en-US');
    entry.tickets.forEach(ticket => {
      const item = document.createElement('div');
      item.className = 'history-item';
      const reason = ticket.reason || '';
      const isNew = reason.toLowerCase().includes('new');
      const ticketUrl = subdomain ? `https://${subdomain}.zendesk.com/agent/tickets/${ticket.id}` : '#';
      item.innerHTML = `<div class="history-time">${time}</div><div class="history-ticket"><span class="history-reason ${isNew ? 'new' : 'reopened'}">${reason.toUpperCase()}</span><a class="history-subject ticket-link" href="${ticketUrl}" target="_blank">#${ticket.id}: ${ticket.subject}</a></div>`;
      container.appendChild(item);
    });
  });
}

// --- Event Listeners ---
$('#volume-slider').addEventListener('input', (e) => {
  const val = e.target.value;
  $('#volume-label').textContent = `${val}%`;
  chrome.storage.sync.set({ volume: parseInt(val) });
});

$('#select-interval').addEventListener('change', (e) => {
  const interval = parseInt(e.target.value);
  chrome.storage.sync.set({ interval });
  chrome.runtime.sendMessage({ type: 'interval-changed', interval });
});

$('#select-tone').addEventListener('change', (e) => {
  chrome.storage.sync.set({ tone: e.target.value });
});

document.querySelectorAll('.status-chk').forEach(chk => {
  chk.addEventListener('change', () => {
    const selected = Array.from(document.querySelectorAll('.status-chk')).filter(c => c.checked).map(c => c.value);
    chrome.storage.sync.set({ notifyStatuses: selected });
  });
});

$('#btn-test-tone').addEventListener('click', () => {
  const tone = $('#select-tone').value;
  const volume = parseInt($('#volume-slider').value);
  chrome.runtime.sendMessage({ type: 'test-tone', tone, volume });
});

$('#btn-clear-history').addEventListener('click', async () => {
  await chrome.storage.local.set({ history: [] });
  await renderHistory();
});

$('#btn-check-now').addEventListener('click', async () => {
  const btn = $('#btn-check-now');
  btn.textContent = '⏳ Checking...';
  btn.disabled = true;
  await chrome.runtime.sendMessage({ type: 'check-now' });
  const config = await chrome.storage.sync.get(['subdomain', 'views', 'volume', 'userName', 'userEmail', 'interval', 'tone']);
  await renderMonitoredViews(config.views);
  await renderStatus();
  await renderHistory();
  btn.textContent = '🔄 Check Now';
  btn.disabled = false;
});

$('#btn-settings').addEventListener('click', async () => {
  const config = await chrome.storage.sync.get(['subdomain', 'userName']);
  showViewSelection(config.subdomain, config.userName, true);
});

$('#btn-back').addEventListener('click', async () => {
  const config = await chrome.storage.sync.get(['subdomain', 'views', 'volume', 'userName', 'userEmail']);
  showDashboard(config);
});

$('#toggle-enabled').addEventListener('change', async (e) => {
  const enabled = e.target.checked;
  await chrome.storage.sync.set({ enabled });
  chrome.runtime.sendMessage({ type: 'toggle-enabled', enabled });
  updateDashboardState(enabled);
});

function updateDashboardState(enabled) {
  const dashboard = $('#screen-dashboard');
  const dot = $('#status-dot');
  const text = $('#status-text');
  if (enabled) {
    dashboard.classList.remove('dashboard-disabled');
    dot.className = 'status-dot connected';
    text.textContent = 'Connected';
  } else {
    dashboard.classList.add('dashboard-disabled');
    dot.className = 'status-dot expired';
    text.textContent = 'Paused';
  }
}
