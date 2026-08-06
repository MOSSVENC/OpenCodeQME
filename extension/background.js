importScripts('shared/parsers.js', 'shared/fetchers.js', 'shared/history.js');

const SYNC_ALARM = '68hub-sync';
const QUOTA_ALARM = '68hub-quota';
const OPENCODE_URL = 'https://opencode.ai';

const DEFAULT_SETTINGS = {
  autoSync: true,
  syncPages: 10,
  theme: 'system',
  language: 'auto',
  usageSyncIntervalSec: 300,
  quotaRefreshIntervalSec: 60,
};

const KEY_SETTINGS = '68hub.settings';
const KEY_ACCOUNT = '68hub.account';
const KEY_QUOTA = '68hub.quota';
const KEY_SNAPSHOT = '68hub.snapshot';
const KEY_SYNC_STATE = '68hub.sync_state';
const KEY_RECORD_CACHE = '68hub.record_cache';

let syncing = false;

async function getSettings() {
  const stored = await chrome.storage.local.get(KEY_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...(stored[KEY_SETTINGS] || {}) };
}

async function setSettings(settings) {
  const next = { ...DEFAULT_SETTINGS, ...settings };
  await chrome.storage.local.set({ [KEY_SETTINGS]: next });
  return next;
}

async function openTabMode() {
  await chrome.tabs.create({ url: chrome.runtime.getURL('tab.html') });
  return {};
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
  const snapshot = historySnapshot || HistoryStore.aggregateSnapshot(cache.records);
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

async function fetchPage(workspaceId, page) {
  const records = await OpenCodeFetcher.fetchUsagePage(workspaceId, page);
  for (const record of records) {
    record.workspace_id = workspaceId;
  }
  return records;
}

async function syncOnce({ maxPages = 10, includeUpdates = true } = {}) {
  if (syncing) return { skipped: true };
  syncing = true;
  const syncAt = new Date().toISOString();
  let pagesFetched = 0;
  let recordsWritten = 0;
  let workspaceId = 'Default';

  try {
    const account = await OpenCodeFetcher.identifyAccount('Default');
    workspaceId = account.workspace_id;
    const quota = await OpenCodeFetcher.fetchQuota(workspaceId);

    const state = await getLocalSyncState(workspaceId);
    const deepest = state && Number.isFinite(Number(state.deepest_page))
      ? Number(state.deepest_page)
      : -1;
    let reachedEnd = Boolean(state?.reached_end);
    let deepestPage = deepest;
    const allRecords = [];

    const updatePages = includeUpdates && deepest >= 0
      ? Math.min(deepest + 1, 5)
      : 0;
    for (let page = 0; page < updatePages; page += 1) {
      const records = await fetchPage(workspaceId, page);
      pagesFetched += 1;
      recordsWritten += records.length;
      allRecords.push(...records);
      deepestPage = Math.max(deepestPage, page);
      if (!records.length) {
        reachedEnd = true;
        deepestPage = page;
        break;
      }
    }

    if (!reachedEnd) {
      const limit = Math.max(1, Number(maxPages) || 10);
      const startPage = Math.max(0, deepest + 1);
      let page = startPage;
      while (page < startPage + limit) {
        const records = await fetchPage(workspaceId, page);
        pagesFetched += 1;
        recordsWritten += records.length;
        allRecords.push(...records);
        deepestPage = page;
        if (!records.length) {
          reachedEnd = true;
          break;
        }
        page += 1;
      }
    }

    const syncState = {
      workspace_id: workspaceId,
      deepest_page: Math.max(deepest, deepestPage),
      last_sync_at: syncAt,
      last_sync_status: 'ok',
      reached_end: reachedEnd,
    };

    await chrome.storage.local.set({
      [KEY_ACCOUNT]: {
        workspace_id: workspaceId,
        name: account.name,
        recognized_at: syncAt,
      },
      [KEY_QUOTA]: quota,
    });
    await HistoryStore.saveRecords(allRecords);
    await saveLocalSyncState(syncState);
    await appendRecordCache(workspaceId, allRecords);
    await refreshSnapshot();
    updateBadge(quota);

    return {
      workspace_id: workspaceId,
      pages_fetched: pagesFetched,
      records_written: recordsWritten,
      reached_end: reachedEnd,
      sync_at: syncAt,
    };
  } catch (error) {
    const message = String(error?.message || error);
    try {
      const state = await getLocalSyncState(workspaceId);
      const syncState = {
        workspace_id: workspaceId,
        deepest_page: state?.deepest_page ?? -1,
        last_sync_at: syncAt,
        last_sync_status: 'error',
        last_sync_error: message,
      };
      await saveLocalSyncState(syncState);
      await refreshSnapshot();
    } catch {
      // keep the original sync failure visible to the popup
    }
    throw error;
  } finally {
    syncing = false;
  }
}

async function refreshQuotaOnly() {
  if (syncing) return { skipped: true };
  syncing = true;
  try {
    const stored = await chrome.storage.local.get(KEY_ACCOUNT);
    const existing = stored[KEY_ACCOUNT] || null;
    const account = existing?.workspace_id
      ? { workspace_id: existing.workspace_id, name: existing.name || 'OpenCode' }
      : await OpenCodeFetcher.identifyAccount('Default');
    const quota = await OpenCodeFetcher.fetchQuota(account.workspace_id);
    await chrome.storage.local.set({
      [KEY_ACCOUNT]: {
        ...account,
        recognized_at: existing?.recognized_at || new Date().toISOString(),
      },
      [KEY_QUOTA]: quota,
    });
    await chrome.storage.local.remove(KEY_SNAPSHOT);
    await refreshSnapshot();
    updateBadge(quota);
    return { ok: true };
  } finally {
    syncing = false;
  }
}

async function scheduleAlarm() {
  const settings = await getSettings();
  if (!settings.autoSync) {
    await chrome.alarms.create(SYNC_ALARM, {
      delayInMinutes: 0.5,
      periodInMinutes: 30,
    });
    await chrome.alarms.create(QUOTA_ALARM, {
      delayInMinutes: 0.5,
      periodInMinutes: 30,
    });
    return;
  }
  const intervalMinutes = Math.max(
    0.5,
    Number(settings.usageSyncIntervalSec || 300) / 60,
  );
  const quotaIntervalMinutes = Math.max(
    0.5,
    Number(settings.quotaRefreshIntervalSec || 60) / 60,
  );
  await chrome.alarms.create(SYNC_ALARM, {
    periodInMinutes: intervalMinutes,
  });
  await chrome.alarms.create(QUOTA_ALARM, {
    periodInMinutes: quotaIntervalMinutes,
  });
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
    case 'GET_SNAPSHOT': {
      const snapshot = await refreshSnapshot();
      return { snapshot };
    }
    case 'GET_SETTINGS': {
      const settings = await getSettings();
      return { settings };
    }
    case 'OPEN_TAB': {
      return openTabMode();
    }
    case 'GET_RECORDS': {
      const stored = await chrome.storage.local.get(KEY_ACCOUNT);
      const workspaceId = stored[KEY_ACCOUNT]?.workspace_id;
      const records = workspaceId ? await HistoryStore.getAllRecords(workspaceId) : [];
      return { records };
    }
    case 'UPDATE_SETTINGS': {
      const settings = await setSettings(message.settings);
      await scheduleAlarm();
      return { settings };
    }
    case 'SYNC_NOW': {
      const result = await syncOnce({ maxPages: message.maxPages || 50 });
      return { ...result };
    }
    case 'OPEN_OPENCODE': {
      await chrome.tabs.create({ url: OPENCODE_URL });
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
  await scheduleAlarm();
  if (navigator.storage?.persist) {
    await navigator.storage.persist();
  }
  void syncOnce({ maxPages: DEFAULT_SETTINGS.syncPages }).catch((error) => {
    console.error('[68hub initial sync failed]', error);
  });
});

chrome.runtime.onStartup.addListener(async () => {
  await scheduleAlarm();
  const settings = await getSettings();
  if (settings.autoSync) {
    void syncOnce({ maxPages: settings.syncPages }).catch((error) => {
      console.error('[68hub startup sync failed]', error);
    });
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  void getSettings().then((settings) => {
    if (!settings.autoSync) return;
    if (alarm.name === SYNC_ALARM) {
      void syncOnce({ maxPages: settings.syncPages }).catch((error) => {
        console.error('[68hub scheduled sync failed]', error);
      });
    } else if (alarm.name === QUOTA_ALARM) {
      void refreshQuotaOnly().catch((error) => {
        console.error('[68hub quota refresh failed]', error);
      });
    }
  });
});
