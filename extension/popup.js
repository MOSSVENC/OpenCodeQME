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
  detailBtn: $('#detailBtn'),
};

let currentSnapshot = null;
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

function effectiveQuota(quota) {
  const windows = quota?.windows || [];
  const rolling = windows.find((item) => item.label === '5h Rolling');
  const weekly = windows.find((item) => item.label === 'Weekly');
  const monthly = windows.find((item) => item.label === 'Monthly');
  const source = rolling || weekly || monthly;
  if (!source) return null;
  return {
    used: Math.round(Number(source.used || 0)),
    remaining: Math.round(Number(source.effective_remaining ?? source.remaining ?? 0)),
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

  els.recentList.innerHTML = records.slice(0, 3).map((record, index) => `
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

function renderSnapshot() {
  const snapshot = currentSnapshot;
  if (!snapshot) {
    els.accountName.textContent = '尚未识别账户';
    status('等待后台自动同步', '');
    renderQuota();
    renderRecent();
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
    status('同步完成', 'success');
  } catch (error) {
    status(error.message, 'error');
  } finally {
    els.syncBtn.classList.remove('loading');
    els.syncBtn.disabled = false;
  }
}

function bindEvents() {
  els.syncBtn.addEventListener('click', () => syncNow(50));
  els.detailBtn.addEventListener('click', async () => {
    els.detailBtn.disabled = true;
    els.detailBtn.textContent = '正在打开...';
    try {
      await sendRuntime({ type: 'OPEN_TAB' });
      window.close();
    } catch (error) {
      els.detailBtn.disabled = false;
      els.detailBtn.textContent = '进入详细模式';
      status(error.message, 'error');
    }
  });
}

async function init() {
  bindEvents();
  try {
    const modeResponse = await sendRuntime({ type: 'GET_UI_MODE' });
    if (modeResponse.uiMode === 'tab') {
      await sendRuntime({ type: 'OPEN_TAB' });
      window.close();
      return;
    }
  } catch {
    // If the background cannot answer, keep showing the compact preview.
  }
  await refresh();
  void syncNow(50);
}

init().catch((error) => {
  status(error.message, 'error');
});
