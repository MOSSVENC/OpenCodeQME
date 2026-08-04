(() => {
  let syncing = false;

  function notifyBackground(message) {
    try {
      chrome.runtime.sendMessage(message, () => {});
    } catch {
      // storage notifications must not block usage fetching
    }
  }

  function sendToBackground(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        if (!response?.ok) {
          reject(new Error(response?.error || 'background error'));
          return;
        }
        resolve(response);
      });
    });
  }

  function workspaceFromUrl() {
    const match = location.pathname.match(/\/workspace\/(wrk_[A-Za-z0-9]+)/);
    return match ? match[1] : '';
  }

  async function readAutoSyncSettings() {
    const stored = await chrome.storage.local.get('68hub.settings');
    return stored['68hub.settings'] || {};
  }

  async function fetchPage(workspaceId, page, syncAt) {
    const records = await OpenCodeFetcher.fetchUsagePage(workspaceId, page);
    for (const record of records) {
      record.workspace_id = workspaceId;
      record.synced_at = syncAt;
    }
    return records;
  }

  async function autoSync({ maxPages = 10, includeUpdates = true } = {}) {
    if (syncing) return { skipped: true };
    syncing = true;
    const syncAt = new Date().toISOString();
    let pagesFetched = 0;
    let recordsWritten = 0;

    try {
      const hint = workspaceFromUrl() || 'Default';
      const account = await OpenCodeFetcher.identifyAccount(hint);
      const workspaceId = account.workspace_id;
      const quota = await OpenCodeFetcher.fetchQuota(workspaceId);

      const storedState = await chrome.storage.local.get('68hub.sync_state');
      const state = storedState['68hub.sync_state']?.[workspaceId] || null;
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
        const records = await fetchPage(workspaceId, page, syncAt);
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
          const records = await fetchPage(workspaceId, page, syncAt);
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

      await sendToBackground({
        type: 'SAVE_ACCOUNT',
        account: {
          workspace_id: workspaceId,
          name: account.name,
          recognized_at: syncAt,
        },
      });
      await sendToBackground({ type: 'SAVE_QUOTA', quota });
      await sendToBackground({
        type: 'SAVE_USAGE',
        workspace_id: workspaceId,
        records: allRecords,
        sync_state: {
          workspace_id: workspaceId,
          deepest_page: Math.max(deepest, deepestPage),
          last_sync_at: syncAt,
          last_sync_status: 'ok',
          reached_end: reachedEnd,
        },
      });

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
        const workspaceId = workspaceFromUrl() || 'unknown';
        notifyBackground({
          type: 'SAVE_USAGE',
          workspace_id: workspaceId,
          records: [],
          sync_state: {
            workspace_id: workspaceId,
            deepest_page: -1,
            last_sync_at: syncAt,
            last_sync_status: 'error',
            last_sync_error: message,
          },
        });
      } catch {
        // keep the original sync failure visible to the popup
      }
      throw error;
    } finally {
      syncing = false;
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'SYNC_NOW') return false;
    autoSync({
      maxPages: message.maxPages || 50,
      includeUpdates: true,
    })
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({
        ok: false,
        error: String(error?.message || error),
      }));
    return true;
  });

  document.addEventListener('visibilitychange', async () => {
    if (!document.hidden) {
      const settings = await readAutoSyncSettings();
      if (settings.autoSync === false) return;
      autoSync({
        maxPages: settings.syncPages || 10,
        includeUpdates: true,
      }).catch(() => {});
    }
  });

  setTimeout(async () => {
    const settings = await readAutoSyncSettings();
    if (settings.autoSync === false) return;
    autoSync({
      maxPages: settings.syncPages || 10,
      includeUpdates: true,
    }).catch(() => {});
  }, 1200);
})();
