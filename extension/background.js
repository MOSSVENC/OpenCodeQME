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

async function getSettings() {
  const stored = await chrome.storage.local.get(KEY_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...(stored[KEY_SETTINGS] || {}) };
}

async function setSettings(settings) {
  const next = { ...DEFAULT_SETTINGS, ...settings };
  await chrome.storage.local.set({ [KEY_SETTINGS]: next });
  return next;
}

async function refreshSnapshot() {
  const stored = await chrome.storage.local.get([KEY_ACCOUNT, KEY_QUOTA]);
  const account = stored[KEY_ACCOUNT] || null;
  const quota = stored[KEY_QUOTA] || null;
  if (!account?.workspace_id) return null;

  const [snapshot, sync] = await Promise.all([
    HistoryStore.buildSnapshot(account.workspace_id),
    HistoryStore.getSyncState(account.workspace_id),
  ]);
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
    sendResponse({ ok: false, error: String(error?.message || error) });
  });
  return true;
});

async function handleMessage(message) {
  switch (message?.type) {
    case 'SAVE_ACCOUNT': {
      await chrome.storage.local.set({ [KEY_ACCOUNT]: message.account });
      await refreshSnapshot();
      return {};
    }
    case 'SAVE_QUOTA': {
      await chrome.storage.local.set({ [KEY_QUOTA]: message.quota });
      updateBadge(message.quota);
      await refreshSnapshot();
      return {};
    }
    case 'SAVE_USAGE': {
      await HistoryStore.saveRecords(message.records || []);
      await HistoryStore.saveSyncState(message.sync_state);
      await refreshSnapshot();
      return {};
    }
    case 'GET_STATE': {
      const state = await HistoryStore.getSyncState(message.workspace_id);
      return { state };
    }
    case 'GET_SNAPSHOT': {
      const stored = await chrome.storage.local.get(KEY_SNAPSHOT);
      if (stored[KEY_SNAPSHOT]) return { snapshot: stored[KEY_SNAPSHOT] };
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
      await refreshSnapshot();
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
