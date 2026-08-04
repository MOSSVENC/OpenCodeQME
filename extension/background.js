importScripts('shared/history.js');

const DEFAULT_SETTINGS = {
  autoSync: true,
  syncPages: 10,
  theme: 'system',
};

const KEY_SETTINGS = '68hub.settings';
const KEY_ACCOUNT = '68hub.account';
const KEY_QUOTA = '68hub.quota';
const KEY_SNAPSHOT = '68hub.snapshot';
const KEY_SYNC_STATE = '68hub.sync_state';
const KEY_RECORD_CACHE = '68hub.record_cache';

async function getSettings() {
  const stored = await chrome.storage.local.get(KEY_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...(stored[KEY_SETTINGS] || {}) };
}

async function setSettings(settings) {
  const next = { ...DEFAULT_SETTINGS, ...settings };
  await chrome.storage.local.set({ [KEY_SETTINGS]: next });
  return next;
}

async function getLocalSyncState(workspaceId) {
  const stored = await chrome.storage.local.get(KEY_SYNC_STATE);
  return stored[KEY_SYNC_STATE]?.[workspaceId] || null;
}

async function saveLocalSyncState(state) {
  const stored = await chrome.storage.local.get(KEY_SYNC_STATE);
  const next = { ...(stored[KEY_SYNC_STATE] || {}), [state.workspace_id]: state };
  await chrome.storage.local.set({ [KEY_SYNC_STATE]: next });
}

async function getRecordCache(workspaceId) {
  const stored = await chrome.storage.local.get(KEY_RECORD_CACHE);
  return stored[KEY_RECORD_CACHE]?.[workspaceId] || { records: [] };
}

async function appendRecordCache(workspaceId, records) {
  if (!records?.length) return;
  const cache = await getRecordCache(workspaceId);
  const byId = new Map(cache.records.map((record) => [record.usg_id, record]));
  for (const record of records) byId.set(record.usg_id, record);
  const nextRecords = [...byId.values()]
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 5000);
  const stored = await chrome.storage.local.get(KEY_RECORD_CACHE);
  const next = {
    ...(stored[KEY_RECORD_CACHE] || {}),
    [workspaceId]: { records: nextRecords, updated_at: new Date().toISOString() },
  };
  await chrome.storage.local.set({ [KEY_RECORD_CACHE]: next });
}

async function clearRecordCache(workspaceId) {
  const stored = await chrome.storage.local.get(KEY_RECORD_CACHE);
  const next = { ...(stored[KEY_RECORD_CACHE] || {}) };
  delete next[workspaceId];
  await chrome.storage.local.set({ [KEY_RECORD_CACHE]: next });
}

function aggregateSnapshot(records) {
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const daily = new Map();
  const models = new Map();
  let todayTokens = 0;
  let todayRequests = 0;

  for (const record of records) {
    const date = String(record.created_at || '').slice(0, 10);
    const model = String(record.model || 'Unknown');
    const input = Number(record.input_tokens || 0);
    const output = Number(record.output_tokens || 0);
    const cost = Number(record.cost_usd || 0);
    if (date === today) {
      todayTokens += input + output;
      todayRequests += 1;
    }
    if (date >= monthStart) {
      const day = daily.get(date) || {
        date,
        request_count: 0,
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: 0,
      };
      day.request_count += 1;
      day.input_tokens += input;
      day.output_tokens += output;
      day.cost_usd += cost;
      daily.set(date, day);

      const item = models.get(model) || {
        model,
        request_count: 0,
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: 0,
      };
      item.request_count += 1;
      item.input_tokens += input;
      item.output_tokens += output;
      item.cost_usd += cost;
      models.set(model, item);
    }
  }

  return {
    total_records: records.length,
    today_tokens: todayTokens,
    today_requests: todayRequests,
    recent_records: [...records].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 50),
    daily_stats: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
    model_stats: [...models.values()].sort(
      (a, b) => b.input_tokens + b.output_tokens - (a.input_tokens + a.output_tokens),
    ),
  };
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('history snapshot timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function refreshSnapshot() {
  const stored = await chrome.storage.local.get([KEY_ACCOUNT, KEY_QUOTA]);
  const account = stored[KEY_ACCOUNT] || null;
  const quota = stored[KEY_QUOTA] || null;
  if (!account?.workspace_id) return null;

  const [cache, sync] = await Promise.all([
    getRecordCache(account.workspace_id),
    getLocalSyncState(account.workspace_id),
  ]);
  const historySnapshot = await withTimeout(
    HistoryStore.buildSnapshot(account.workspace_id),
    1500,
  ).catch(() => null);
  const snapshot = historySnapshot || aggregateSnapshot(cache.records);
  const payload = {
    account,
    quota,
    snapshot,
    sync,
    updated_at: new Date().toISOString(),
  };
  await chrome.storage.local.set({ [KEY_SNAPSHOT]: payload });
  return payload;
}

function updateBadge(quota) {
  if (!quota || !chrome.action) return;
  const windows = quota.windows || [];
  const rolling = windows.find((item) => item.label === '5h Rolling');
  const weekly = windows.find((item) => item.label === 'Weekly');
  const monthly = windows.find((item) => item.label === 'Monthly');
  const source = rolling || weekly || monthly;
  const used = source ? Math.max(0, Math.min(100, Math.round(Number(source.used || 0)))) : null;
  const text = used == null ? '…' : `${used}%`;
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color: used == null || used < 80 ? '#006a6a' : '#ba1a1a' });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void handleMessage(message).then((result) => {
    sendResponse({ ok: true, ...result });
  }).catch((error) => {
    console.error('[68hub background error]', error);
    sendResponse({ ok: false, error: String(error?.message || error) });
  });
  return true;
});

async function handleMessage(message) {
  switch (message?.type) {
    case 'SAVE_ACCOUNT': {
      await chrome.storage.local.set({ [KEY_ACCOUNT]: message.account });
      await chrome.storage.local.remove(KEY_SNAPSHOT);
      return {};
    }
    case 'SAVE_QUOTA': {
      await chrome.storage.local.set({ [KEY_QUOTA]: message.quota });
      updateBadge(message.quota);
      await chrome.storage.local.remove(KEY_SNAPSHOT);
      return {};
    }
    case 'SAVE_USAGE': {
      await HistoryStore.saveRecords(message.records || []);
      await HistoryStore.saveSyncState(message.sync_state);
      await saveLocalSyncState(message.sync_state);
      await appendRecordCache(message.workspace_id, message.records || []);
      await chrome.storage.local.remove(KEY_SNAPSHOT);
      return {};
    }
    case 'GET_STATE': {
      const state = await getLocalSyncState(message.workspace_id);
      return { state };
    }
    case 'GET_SNAPSHOT': {
      const snapshot = await refreshSnapshot();
      return { snapshot };
    }
    case 'GET_SETTINGS': {
      const settings = await getSettings();
      return { settings };
    }
    case 'UPDATE_SETTINGS': {
      const settings = await setSettings(message.settings);
      return { settings };
    }
    case 'SYNC_TAB': {
      if (!message.tab_id) throw new Error('缺少 tab_id');
      await chrome.tabs.sendMessage(message.tab_id, {
        type: 'SYNC_NOW',
        maxPages: message.maxPages || 50,
      });
      return {};
    }
    case 'OPEN_OPENCODE': {
      await chrome.tabs.create({ url: 'https://opencode.ai' });
      return {};
    }
    case 'CLEAR_HISTORY': {
      await HistoryStore.clearHistory(message.workspace_id);
      const stored = await chrome.storage.local.get(KEY_SYNC_STATE);
      const next = { ...(stored[KEY_SYNC_STATE] || {}) };
      delete next[message.workspace_id];
      await chrome.storage.local.set({ [KEY_SYNC_STATE]: next });
      await clearRecordCache(message.workspace_id);
      await chrome.storage.local.remove(KEY_SNAPSHOT);
      return {};
    }
    default:
      return {};
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await setSettings(DEFAULT_SETTINGS);
  if (navigator.storage?.persist) {
    await navigator.storage.persist();
  }
});
