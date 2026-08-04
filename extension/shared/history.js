globalThis.HistoryStore = (() => {
  const DB_NAME = '68hub-history';
  const DB_VERSION = 1;
  const RECORDS = 'usage_records';
  const SYNC_STATE = 'sync_state';

  let dbPromise = null;

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(RECORDS)) {
          const store = db.createObjectStore(RECORDS, { keyPath: 'usg_id' });
          store.createIndex('workspace_id', 'workspace_id', { unique: false });
          store.createIndex('workspace_time', ['workspace_id', 'created_at'], {
            unique: false,
          });
        }
        if (!db.objectStoreNames.contains(SYNC_STATE)) {
          db.createObjectStore(SYNC_STATE, { keyPath: 'workspace_id' });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        dbPromise = null;
        reject(request.error);
      };
    });
    return dbPromise;
  }

  async function saveRecords(records) {
    if (!records || !records.length) return 0;
    const db = await openDb();
    const tx = db.transaction(RECORDS, 'readwrite');
    const store = tx.objectStore(RECORDS);
    for (const record of records) {
      store.put(record);
    }
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return records.length;
  }

  async function saveSyncState(state) {
    const db = await openDb();
    const tx = db.transaction(SYNC_STATE, 'readwrite');
    tx.objectStore(SYNC_STATE).put(state);
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async function getSyncState(workspaceId) {
    const db = await openDb();
    const tx = db.transaction(SYNC_STATE, 'readonly');
    return requestToPromise(tx.objectStore(SYNC_STATE).get(workspaceId));
  }

  async function getAllRecords(workspaceId) {
    const db = await openDb();
    const tx = db.transaction(RECORDS, 'readonly');
    const index = tx.objectStore(RECORDS).index('workspace_id');
    const records = await requestToPromise(index.getAll(IDBKeyRange.only(workspaceId)));
    records.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return records;
  }

  async function getRecentRecords(workspaceId, limit = 50) {
    const db = await openDb();
    const tx = db.transaction(RECORDS, 'readonly');
    const index = tx.objectStore(RECORDS).index('workspace_time');
    const range = IDBKeyRange.bound(
      [workspaceId, ''],
      [workspaceId, '\uffff'],
      false,
      false,
    );
    const records = [];
    await new Promise((resolve, reject) => {
      const cursorRequest = index.openCursor(range, 'prev');
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor || records.length >= limit) {
          resolve();
          return;
        }
        records.push(cursor.value);
        cursor.continue();
      };
      cursorRequest.onerror = () => reject(cursorRequest.error);
    });
    return records;
  }

  function todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  function daysAgoKey(days) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - days);
    return date.toISOString().slice(0, 10);
  }

  async function buildSnapshot(workspaceId) {
    const records = await getAllRecords(workspaceId);
    const today = todayKey();
    const monthStart = daysAgoKey(30);
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
      recent_records: records.slice(0, 50),
      daily_stats: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
      model_stats: [...models.values()].sort(
        (a, b) => b.input_tokens + b.output_tokens - (a.input_tokens + a.output_tokens),
      ),
    };
  }

  async function clearHistory(workspaceId) {
    const db = await openDb();
    const tx = db.transaction(RECORDS, 'readwrite');
    const store = tx.objectStore(RECORDS);
    const index = store.index('workspace_id');
    const keys = await requestToPromise(index.getAllKeys(IDBKeyRange.only(workspaceId)));
    for (const key of keys) store.delete(key);
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  return {
    saveRecords,
    saveSyncState,
    getSyncState,
    getAllRecords,
    getRecentRecords,
    buildSnapshot,
    clearHistory,
  };
})();
