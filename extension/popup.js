const $ = (selector) => document.querySelector(selector);

const els = {
  accountName: $('#accountName'),
  statusBanner: $('#statusBanner'),
  statusText: $('#statusText'),
  syncBtn: $('#syncBtn'),
  syncChip: $('#syncChip'),
  todayTokens: $('#todayTokens'),
  todayRequests: $('#todayRequests'),
  quotaValue: $('#quotaValue'),
  quotaSub: $('#quotaSub'),
  quotaList: $('#quotaList'),
  recentList: $('#recentList'),
  recordCount: $('#recordCount'),
  modelStats: $('#modelStats'),
  modelCount: $('#modelCount'),
  dailyStats: $('#dailyStats'),
  autoSync: $('#autoSync'),
  syncPages: $('#syncPages'),
  backfillBtn: $('#backfillBtn'),
  clearHistoryBtn: $('#clearHistoryBtn'),
  openSiteBtn: $('#openSiteBtn'),
  snackbar: $('#snackbar'),
};

let currentSnapshot = null;
let currentSettings = null;
const numberAnimations = new Map();

function sendRuntime(message) {
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

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatTokens(value) {
  const v = Number(value || 0);
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toLocaleString();
}

function formatMoney(value) {
  return `$${Number(value || 0).toFixed(6)}`;
}

function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatReset(value) {
  const seconds = Number(value || 0);
  if (seconds <= 0) return '';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m 后重置`;
  return `${minutes}m 后重置`;
}

function animateNumber(element, value, formatter = (v) => v.toLocaleString()) {
  const target = Number(value || 0);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) {
    element.textContent = formatter(target);
    return;
  }

  const previous = Number(element.dataset.value || 0);
  const start = performance.now();
  const duration = 700;
  const frame = (now) => {
    const progress = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = previous + (target - previous) * eased;
    element.textContent = formatter(current);
    element.dataset.value = String(target);
    if (progress < 1) {
      requestAnimationFrame(frame);
    } else {
      element.textContent = formatter(target);
    }
  };
  const id = requestAnimationFrame(frame);
  const oldId = numberAnimations.get(element);
  if (oldId) cancelAnimationFrame(oldId);
  numberAnimations.set(element, id);
}

function status(message, type = '') {
  els.statusBanner.className = `status-banner ${type}`.trim();
  els.statusText.textContent = message;
}

function snackbar(message) {
  els.snackbar.textContent = message;
  els.snackbar.classList.add('show');
  clearTimeout(snackbar.timer);
  snackbar.timer = setTimeout(() => {
    els.snackbar.classList.remove('show');
  }, 2400);
}

function effectiveQuota(quota) {
  const windows = quota?.windows || [];
  const rolling = windows.find((item) => item.label === '5h Rolling');
  const weekly = windows.find((item) => item.label === 'Weekly');
  const monthly = windows.find((item) => item.label === 'Monthly');
  const source = rolling || weekly || monthly;
  if (!source) return null;
  return {
    used: Math.round(Number(source.used || 0)),
    remaining: Math.round(Number(source.remaining || 0)),
    label: source.label,
  };
}

function renderQuota() {
  const quota = currentSnapshot?.quota;
  const windows = quota?.windows || [];
  if (!windows.length) {
    els.quotaList.innerHTML = '<div class="empty-state">尚未同步到额度数据</div>';
    return;
  }

  els.quotaList.innerHTML = windows.map((window, index) => {
    const used = Math.max(0, Math.min(100, Math.round(Number(window.used || 0))));
    const tone = used >= 100 ? 'exhausted' : used >= 80 ? 'warning' : '';
    const resetText = window.label === '5h Rolling'
      ? formatReset(window.reset_in_sec)
      : window.reset_at
        ? `${formatTime(window.reset_at)} 重置`
        : '';
    return `
      <div class="quota-item" style="animation-delay:${index * 45}ms">
        <div class="quota-row">
          <span class="quota-label">${esc(window.label)}${window.blocked ? ' · 已阻塞' : ''}</span>
          <span class="quota-value">${used}%</span>
        </div>
        <div class="progress-track">
          <div class="progress-fill ${tone}" data-used="${used}"></div>
        </div>
        <div class="quota-reset">${esc(resetText)}</div>
      </div>
    `;
  }).join('');

  requestAnimationFrame(() => {
    document.querySelectorAll('.progress-fill').forEach((fill) => {
      fill.style.width = `${fill.dataset.used}%`;
    });
  });
}

function renderRecent() {
  const records = currentSnapshot?.snapshot?.recent_records || [];
  els.recordCount.textContent = `${formatTokens(currentSnapshot?.snapshot?.total_records || 0)} 条`;
  if (!records.length) {
    els.recentList.innerHTML = '<div class="empty-state">暂无使用记录</div>';
    return;
  }

  els.recentList.innerHTML = records.slice(0, 8).map((record, index) => `
    <div class="record-item" style="animation-delay:${index * 35}ms">
      <span class="record-model">${esc(record.model || 'Unknown')}</span>
      <span class="record-tokens">${formatTokens((record.input_tokens || 0) + (record.output_tokens || 0))}</span>
      <span class="record-meta">
        <span>${esc(formatTime(record.created_at))}</span>
        <span>${esc(formatMoney(record.cost_usd))}</span>
      </span>
    </div>
  `).join('');
}

function renderStats() {
  const modelStats = currentSnapshot?.snapshot?.model_stats || [];
  const dailyStats = currentSnapshot?.snapshot?.daily_stats || [];
  els.modelCount.textContent = `${modelStats.length} 个模型`;

  if (!modelStats.length) {
    els.modelStats.innerHTML = '<div class="empty-state">暂无模型数据</div>';
  } else {
    const maxTokens = Math.max(...modelStats.map((item) => (item.input_tokens || 0) + (item.output_tokens || 0)), 1);
    els.modelStats.innerHTML = modelStats.slice(0, 6).map((item, index) => {
      const total = (item.input_tokens || 0) + (item.output_tokens || 0);
      const width = Math.max(4, Math.round((total / maxTokens) * 100));
      return `
        <div class="stat-item" style="animation-delay:${index * 45}ms">
          <div class="stat-head">
            <span class="stat-name">${esc(item.model)}</span>
            <span class="stat-tokens">${formatTokens(total)} tokens</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill" data-used="${width}"></div>
          </div>
        </div>
      `;
    }).join('');
  }

  if (!dailyStats.length) {
    els.dailyStats.innerHTML = '<div class="empty-state">暂无每日数据</div>';
  } else {
    const recent = dailyStats.slice(-14);
    const maxTokens = Math.max(...recent.map((item) => (item.input_tokens || 0) + (item.output_tokens || 0)), 1);
    els.dailyStats.innerHTML = recent.map((item) => {
      const total = (item.input_tokens || 0) + (item.output_tokens || 0);
      const width = Math.max(3, Math.round((total / maxTokens) * 100));
      return `
        <div class="bar-item">
          <div class="bar-head">
            <span class="bar-label">${esc(item.date || '')}</span>
            <span class="bar-value">${formatTokens(total)} · ${item.request_count} 次</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill" data-used="${width}"></div>
          </div>
        </div>
      `;
    }).join('');
  }

  requestAnimationFrame(() => {
    document.querySelectorAll('.stat-item .progress-fill, .bar-item .progress-fill').forEach((fill) => {
      fill.style.width = `${fill.dataset.used}%`;
    });
  });
}

function renderSnapshot() {
  const snapshot = currentSnapshot;
  if (!snapshot) {
    els.accountName.textContent = '尚未识别账户';
    status('等待后台自动同步', '');
    renderQuota();
    renderRecent();
    renderStats();
    return;
  }

  const account = snapshot.account || {};
  const quota = snapshot.quota || null;
  const sync = snapshot.sync || null;
  const data = snapshot.snapshot || {};

  els.accountName.textContent = account.name || account.workspace_id || 'OpenCode';
  animateNumber(els.todayTokens, data.today_tokens || 0, formatTokens);
  els.todayRequests.textContent = `${(data.today_requests || 0).toLocaleString()} 次请求`;

  const effective = effectiveQuota(quota);
  if (effective) {
    animateNumber(els.quotaValue, effective.remaining, (v) => `${Math.round(v)}%`);
    els.quotaSub.textContent = `${effective.label} 可用`;
  } else {
    els.quotaValue.textContent = '—';
    els.quotaSub.textContent = quota?.error || '当前账户';
  }

  const syncLabel = sync?.last_sync_status === 'error'
    ? '同步失败'
    : sync?.last_sync_at
      ? `${formatTime(sync.last_sync_at)} 已同步`
      : `${formatTokens(data.total_records || 0)} 条记录`;
  els.syncChip.textContent = syncLabel;

  renderQuota();
  renderRecent();
  renderStats();

  if (sync?.last_sync_status === 'error') {
    status(sync.last_sync_error || '同步失败', 'error');
  } else if (quota?.success === false) {
    status(quota.error || '配额获取失败', 'error');
  } else if (data.total_records) {
    status(`已保存 ${formatTokens(data.total_records)} 条完整历史`, 'success');
  } else {
    status('等待首次同步', '');
  }
}

function setTheme(theme) {
  const resolved = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;
  document.documentElement.dataset.theme = resolved;
  document.querySelectorAll('.theme-segmented .segmented-item').forEach((button) => {
    button.classList.toggle('active', button.dataset.theme === theme);
  });
}

function renderSettings(settings) {
  currentSettings = settings;
  els.autoSync.checked = settings.autoSync !== false;
  els.syncPages.value = settings.syncPages || 10;
  setTheme(settings.theme || 'system');
}

async function refresh() {
  const response = await sendRuntime({ type: 'GET_SNAPSHOT' });
  currentSnapshot = response.snapshot || null;
  renderSnapshot();
}

async function syncNow(maxPages = 50) {
  els.syncBtn.classList.add('loading');
  els.syncBtn.disabled = true;
  status('正在同步完整历史...', '');
  try {
    await sendRuntime({ type: 'SYNC_NOW', maxPages });
    await refresh();
    snackbar('同步完成');
  } catch (error) {
    status(error.message, 'error');
    snackbar(error.message);
  } finally {
    els.syncBtn.classList.remove('loading');
    els.syncBtn.disabled = false;
  }
}

async function updateSettings(patch) {
  const response = await sendRuntime({
    type: 'UPDATE_SETTINGS',
    settings: { ...currentSettings, ...patch },
  });
  currentSettings = response.settings;
  renderSettings(currentSettings);
}

function bindEvents() {
  document.querySelector('nav.segmented').addEventListener('click', (event) => {
    const button = event.target.closest('.segmented-item');
    if (!button) return;
    document.querySelectorAll('nav.segmented .segmented-item').forEach((item) => {
      item.classList.toggle('active', item === button);
      item.setAttribute('aria-selected', item === button ? 'true' : 'false');
    });
    document.querySelectorAll('.tab').forEach((panel) => {
      panel.classList.toggle('active', panel.id === `tab-${button.dataset.tab}`);
    });
  });

  els.syncBtn.addEventListener('click', () => syncNow(50));
  els.backfillBtn.addEventListener('click', () => syncNow(50));
  els.openSiteBtn.addEventListener('click', () => sendRuntime({ type: 'OPEN_OPENCODE' }));

  els.autoSync.addEventListener('change', () => {
    updateSettings({ autoSync: els.autoSync.checked });
  });

  els.syncPages.addEventListener('change', () => {
    const value = Math.max(1, Math.min(100, Number(els.syncPages.value) || 10));
    els.syncPages.value = String(value);
    updateSettings({ syncPages: value });
  });

  document.querySelector('.theme-segmented').addEventListener('click', (event) => {
    const button = event.target.closest('.segmented-item');
    if (!button) return;
    updateSettings({ theme: button.dataset.theme });
  });

  els.clearHistoryBtn.addEventListener('click', async () => {
    if (!currentSnapshot?.account?.workspace_id) {
      snackbar('还没有可清空的历史');
      return;
    }
    if (!window.confirm('确定清空本地完整历史？此操作不可撤销。')) return;
    await sendRuntime({
      type: 'CLEAR_HISTORY',
      workspace_id: currentSnapshot.account.workspace_id,
    });
    await refresh();
    snackbar('本地历史已清空');
  });
}

async function init() {
  bindEvents();
  const settingsResponse = await sendRuntime({ type: 'GET_SETTINGS' });
  renderSettings(settingsResponse.settings);
  await refresh();
  void syncNow(50);
}

init().catch((error) => {
  status(error.message, 'error');
});
