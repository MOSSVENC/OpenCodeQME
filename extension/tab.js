const $ = (selector) => document.querySelector(selector);

const PAGE_SIZE = 50;

const els = {
  accountName: $('#accountName'),
  syncStatusChip: $('#syncStatusChip'),
  syncBtn: $('#syncBtn'),
  popupModeBtn: $('#popupModeBtn'),
  overviewKpis: $('#overviewKpis'),
  quotaPanel: $('#quotaPanel'),
  topModelPanel: $('#topModelPanel'),
  overviewRecordCount: $('#overviewRecordCount'),
  overviewRecent: $('#overviewRecent'),
  tokenKpis: $('#tokenKpis'),
  trendChart: $('#trendChart'),
  modelStatsCount: $('#modelStatsCount'),
  modelStatsTable: $('#modelStatsTable'),
  dailyDate: $('#dailyDate'),
  dailyPrevBtn: $('#dailyPrevBtn'),
  dailyNextBtn: $('#dailyNextBtn'),
  dailyTodayBtn: $('#dailyTodayBtn'),
  dailyKpis: $('#dailyKpis'),
  dailyDateLabel: $('#dailyDateLabel'),
  dailyModelTable: $('#dailyModelTable'),
  recordsSummary: $('#recordsSummary'),
  recordsFilter: $('#recordsFilter'),
  recordsRefreshBtn: $('#recordsRefreshBtn'),
  recordsPageLabel: $('#recordsPageLabel'),
  recordsTable: $('#recordsTable'),
  recordsPrevBtn: $('#recordsPrevBtn'),
  recordsNextBtn: $('#recordsNextBtn'),
  settingsSyncBtn: $('#settingsSyncBtn'),
  openSiteBtn: $('#openSiteBtn'),
  settingsStatusChip: $('#settingsStatusChip'),
  syncStatePanel: $('#syncStatePanel'),
  autoSync: $('#autoSync'),
  syncPages: $('#syncPages'),
  usageSyncIntervalSec: $('#usageSyncIntervalSec'),
  quotaRefreshIntervalSec: $('#quotaRefreshIntervalSec'),
  clearHistoryBtn: $('#clearHistoryBtn'),
  themeSegmented: $('#themeSegmented'),
  languageSegmented: $('#languageSegmented'),
  toast: $('#toast'),
};

let snapshot = null;
let records = [];
let stats = null;
let settings = null;
let selectedDate = '';
let recordsPage = 0;
let toastTimer = null;

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

function formatCount(value) {
  return Number(value || 0).toLocaleString();
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

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
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

function cacheRate(uncached, cacheHit, cacheWrite) {
  const total = Number(uncached || 0) + Number(cacheHit || 0) + Number(cacheWrite || 0);
  return total > 0 ? (Number(cacheHit || 0) / total) * 100 : 0;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function effectiveRemaining(window) {
  const value = window.effective_remaining ?? window.remaining;
  return Math.max(0, Math.round(Number(value || 0)));
}

function computeStats(allRecords) {
  const today = todayKey();
  const daily = new Map();
  const dailyModels = new Map();
  const models = new Map();
  const totals = {
    requests: 0,
    input: 0,
    output: 0,
    uncached: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    todayTokens: 0,
    todayRequests: 0,
  };

  for (const record of allRecords) {
    const date = String(record.created_at || '').slice(0, 10);
    const model = String(record.model || 'Unknown');
    const input = Number(record.input_tokens || 0);
    const output = Number(record.output_tokens || 0);
    const cacheRead = Number(record.cache_read_tokens || 0);
    const cacheWrite = Number(record.cache_write_tokens || 0);
    const uncached = Number(
      record.uncached_input_tokens ?? Math.max(0, input - cacheRead - cacheWrite),
    );
    const cost = Number(record.cost_usd || 0);

    totals.requests += 1;
    totals.input += input;
    totals.output += output;
    totals.uncached += uncached;
    totals.cacheRead += cacheRead;
    totals.cacheWrite += cacheWrite;
    totals.cost += cost;
    if (date === today) {
      totals.todayTokens += input + output;
      totals.todayRequests += 1;
    }

    const day = daily.get(date) || {
      date,
      request_count: 0,
      total_input_tokens: 0,
      uncached_input_tokens: 0,
      cache_hit_tokens: 0,
      cache_write_tokens: 0,
      total_output_tokens: 0,
      total_cost_usd: 0,
    };
    day.request_count += 1;
    day.total_input_tokens += input;
    day.uncached_input_tokens += uncached;
    day.cache_hit_tokens += cacheRead;
    day.cache_write_tokens += cacheWrite;
    day.total_output_tokens += output;
    day.total_cost_usd += cost;
    daily.set(date, day);

    const dayModelKey = `${date}|${model}`;
    const dayModel = dailyModels.get(dayModelKey) || {
      date,
      model,
      request_count: 0,
      total_input_tokens: 0,
      uncached_input_tokens: 0,
      cache_hit_tokens: 0,
      cache_write_tokens: 0,
      total_output_tokens: 0,
      total_cost_usd: 0,
    };
    dayModel.request_count += 1;
    dayModel.total_input_tokens += input;
    dayModel.uncached_input_tokens += uncached;
    dayModel.cache_hit_tokens += cacheRead;
    dayModel.cache_write_tokens += cacheWrite;
    dayModel.total_output_tokens += output;
    dayModel.total_cost_usd += cost;
    dailyModels.set(dayModelKey, dayModel);

    const item = models.get(model) || {
      model,
      request_count: 0,
      total_input_tokens: 0,
      uncached_input_tokens: 0,
      cache_hit_tokens: 0,
      cache_write_tokens: 0,
      total_output_tokens: 0,
      total_cost_usd: 0,
    };
    item.request_count += 1;
    item.total_input_tokens += input;
    item.uncached_input_tokens += uncached;
    item.cache_hit_tokens += cacheRead;
    item.cache_write_tokens += cacheWrite;
    item.total_output_tokens += output;
    item.total_cost_usd += cost;
    models.set(model, item);
  }

  const dailyStats = [...daily.values()].sort((a, b) => a.date.localeCompare(b.date));
  const dailyByDate = new Map();
  for (const row of dailyModels.values()) {
    const rows = dailyByDate.get(row.date) || [];
    rows.push(row);
    dailyByDate.set(row.date, rows);
  }
  for (const rows of dailyByDate.values()) {
    rows.sort(
      (a, b) =>
        (b.total_input_tokens + b.total_output_tokens) -
        (a.total_input_tokens + a.total_output_tokens),
    );
  }

  const modelStats = [...models.values()].sort(
    (a, b) =>
      (b.total_input_tokens + b.total_output_tokens) -
      (a.total_input_tokens + a.total_output_tokens),
  );

  return { totals, dailyStats, dailyByDate, modelStats };
}

function kpi(label, value, sub, extraClass = '') {
  return `
    <article class="kpi-card ${extraClass}">
      <span class="kpi-label">${esc(label)}</span>
      <strong class="kpi-value">${esc(value)}</strong>
      <span class="kpi-sub">${esc(sub)}</span>
    </article>
  `;
}

function emptyRow(columns, message = '暂无数据') {
  return `<tr><td class="empty-cell" colspan="${columns}">${esc(message)}</td></tr>`;
}

function renderOverview() {
  const windows = snapshot?.quota?.windows || [];
  const account = snapshot?.account || null;
  const anyBlocked = windows.some(
    (item) => item.blocked || Number(item.used || 0) >= 100,
  );
  const available = account && !anyBlocked ? 1 : 0;
  const blocked = account && anyBlocked ? 1 : 0;
  const averageRemaining = windows.length
    ? windows.reduce((sum, item) => sum + effectiveRemaining(item), 0) / windows.length
    : 0;
  const accountLabel = account
    ? account.name || account.workspace_id || 'OpenCode'
    : '尚未识别';
  const totals = stats.totals;
  const totalTokens = totals.input + totals.output;
  const todayTokens = totals.todayTokens || snapshot?.snapshot?.today_tokens || 0;
  const todayRequests = totals.todayRequests || snapshot?.snapshot?.today_requests || 0;
  const totalRecords = records.length || snapshot?.snapshot?.total_records || 0;

  els.overviewKpis.innerHTML = [
    kpi('当前账户', accountLabel, account ? `${available} 可用 · ${blocked} 阻塞` : '等待后台同步'),
    kpi('平均剩余配额', `${averageRemaining.toFixed(1)}%`, '三个配额窗口均值'),
    kpi('总 Token', formatTokens(totalTokens), `${formatCount(totals.requests)} 次请求`),
    kpi('今日 Token', formatTokens(todayTokens), `${formatCount(todayRequests)} 次请求`),
    kpi('请求数', formatCount(totals.requests), `费用 ${formatMoney(totals.cost)}`),
    kpi('本地记录', formatCount(totalRecords), '完整历史条数'),
  ].join('');

  els.quotaPanel.innerHTML = windows.length
    ? windows.map((item, index) => {
        const used = Math.max(0, Math.min(100, Math.round(Number(item.used || 0))));
        const tone = used >= 100 ? 'exhausted' : used >= 80 ? 'warning' : '';
        const resetText = item.label === '5h Rolling'
          ? formatReset(item.reset_in_sec)
          : item.reset_at
            ? `${formatDateTime(item.reset_at)} 重置`
            : '';
        const blockedText = item.blocked
          ? `已阻塞${item.blocked_by ? `：${item.blocked_by}` : ''}`
          : '';
        return `
          <div class="quota-item" style="animation-delay:${index * 45}ms">
            <div class="quota-row">
              <span class="quota-label">${esc(item.label)}</span>
              <span class="quota-value">${used}% · 剩余 ${effectiveRemaining(item)}%</span>
            </div>
            <div class="progress-track">
              <div class="progress-fill ${tone}" data-used="${used}"></div>
            </div>
            ${resetText ? `<div class="quota-reset">${esc(resetText)}</div>` : ''}
            ${blockedText ? `<div class="quota-blocked">${esc(blockedText)}</div>` : ''}
          </div>
        `;
      }).join('')
    : '<div class="empty-state">尚未同步到额度数据</div>';

  const topModels = stats.modelStats.slice(0, 3);
  const maxTopTokens = Math.max(
    ...topModels.map((item) => item.total_input_tokens + item.total_output_tokens),
    1,
  );
  els.topModelPanel.innerHTML = topModels.length
    ? topModels.map((item, index) => {
        const total = item.total_input_tokens + item.total_output_tokens;
        const width = Math.max(3, Math.round((total / maxTopTokens) * 100));
        return `
          <div class="model-rank-row">
            <span class="model-rank-name">${esc(item.model)}</span>
            <span class="model-rank-tokens">${formatTokens(total)}</span>
            <span class="model-rank-sub">
              <span class="progress-track"><span class="progress-fill" data-used="${width}"></span></span>
              <span>${item.request_count} 次</span>
            </span>
          </div>
        `;
      }).join('')
    : '<div class="empty-state">暂无模型数据</div>';

  els.overviewRecordCount.textContent = `${formatCount(totalRecords)} 条`;
  const recent = records.slice(0, 10);
  els.overviewRecent.innerHTML = recent.length
    ? recent.map((record) => `
        <tr>
          <td>${esc(formatTime(record.created_at))}</td>
          <td>${esc(record.model || 'Unknown')}</td>
          <td class="num">${formatCount(record.input_tokens)}</td>
          <td class="num">${formatCount(record.output_tokens)}</td>
          <td class="num">${esc(formatMoney(record.cost_usd))}</td>
          <td>${record.plan ? `<span class="badge">${esc(record.plan)}</span>` : '—'}</td>
        </tr>
      `).join('')
    : emptyRow(6);

  requestAnimationFrame(() => {
    document.querySelectorAll('.progress-fill[data-used]').forEach((fill) => {
      fill.style.width = `${fill.dataset.used}%`;
    });
  });
}

function renderTokenStats() {
  const totals = stats.totals;
  const totalTokens = totals.input + totals.output;
  const hitRate = cacheRate(totals.uncached, totals.cacheRead, totals.cacheWrite);

  els.tokenKpis.innerHTML = [
    kpi('请求数', formatCount(totals.requests), '本地完整历史', 'wide'),
    kpi('总 Token', formatTokens(totalTokens), `${formatTokens(totals.uncached)} uncached`, 'wide'),
    kpi('总费用', formatMoney(totals.cost), '全部记录累计', 'wide'),
    kpi('缓存命中率', `${hitRate.toFixed(1)}%`, `${formatTokens(totals.cacheRead)} cache read`, 'wide'),
    kpi('缓存写入', formatTokens(totals.cacheWrite), '5m + 1h 写入', 'wide'),
  ].join('');

  const recentDaily = stats.dailyStats.slice(-14);
  const maxDailyTokens = Math.max(
    ...recentDaily.map((item) => item.total_input_tokens + item.total_output_tokens),
    1,
  );
  els.trendChart.innerHTML = recentDaily.length
    ? recentDaily.map((item) => {
        const total = item.total_input_tokens + item.total_output_tokens;
        const height = Math.max(2, Math.round((total / maxDailyTokens) * 100));
        return `
          <div class="chart-col" title="${esc(item.date)} · ${esc(formatTokens(total))} tokens · ${esc(formatCount(item.request_count))} 次">
            <div class="chart-track">
              <div class="chart-bar" data-height="${height}"></div>
            </div>
            <span class="chart-label">${esc(item.date.slice(5))}</span>
          </div>
        `;
      }).join('')
    : '<div class="empty-state">暂无每日数据</div>';

  els.modelStatsCount.textContent = `${stats.modelStats.length} 个模型`;
  els.modelStatsTable.innerHTML = stats.modelStats.length
    ? stats.modelStats.map((item) => {
        const total = item.total_input_tokens + item.total_output_tokens;
        const rate = cacheRate(
          item.uncached_input_tokens,
          item.cache_hit_tokens,
          item.cache_write_tokens,
        );
        return `
          <tr>
            <td>${esc(item.model)}</td>
            <td class="num">${formatCount(item.request_count)}</td>
            <td class="num">${formatCount(item.total_input_tokens)}</td>
            <td class="num">${formatCount(item.total_output_tokens)}</td>
            <td class="num">${formatCount(total)}</td>
            <td class="num">${esc(formatMoney(item.total_cost_usd))}</td>
            <td class="num">${formatCount(item.cache_hit_tokens)}</td>
            <td class="num">${formatCount(item.cache_write_tokens)}</td>
            <td class="num">${rate.toFixed(1)}%</td>
          </tr>
        `;
      }).join('')
    : emptyRow(9);

  requestAnimationFrame(() => {
    document.querySelectorAll('.chart-bar[data-height]').forEach((bar) => {
      bar.style.height = `${bar.dataset.height}%`;
    });
  });
}

function renderDaily() {
  if (!selectedDate) {
    selectedDate = stats.dailyStats.length
      ? stats.dailyStats[stats.dailyStats.length - 1].date
      : todayKey();
  }
  const today = todayKey();
  if (selectedDate > today) selectedDate = today;
  els.dailyDate.value = selectedDate;
  els.dailyDate.max = today;

  const rows = stats.dailyByDate.get(selectedDate) || [];
  const day = rows.reduce((acc, row) => {
    acc.request_count += row.request_count;
    acc.total_input_tokens += row.total_input_tokens;
    acc.total_output_tokens += row.total_output_tokens;
    acc.uncached_input_tokens += row.uncached_input_tokens;
    acc.cache_hit_tokens += row.cache_hit_tokens;
    acc.cache_write_tokens += row.cache_write_tokens;
    acc.total_cost_usd += row.total_cost_usd;
    return acc;
  }, {
    request_count: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
    uncached_input_tokens: 0,
    cache_hit_tokens: 0,
    cache_write_tokens: 0,
    total_cost_usd: 0,
  });
  const rate = cacheRate(
    day.uncached_input_tokens,
    day.cache_hit_tokens,
    day.cache_write_tokens,
  );

  els.dailyKpis.innerHTML = [
    kpi('请求数', formatCount(day.request_count), formatDate(selectedDate), 'wide'),
    kpi('输入', formatTokens(day.total_input_tokens), `${formatTokens(day.uncached_input_tokens)} uncached`, 'wide'),
    kpi('输出', formatTokens(day.total_output_tokens), '本地记录汇总', 'wide'),
    kpi('缓存 Token', formatTokens(day.cache_hit_tokens), `${formatTokens(day.cache_write_tokens)} write`, 'wide'),
    kpi('缓存率', `${rate.toFixed(1)}%`, '输入侧命中比例', 'wide'),
    kpi('费用', formatMoney(day.total_cost_usd), `${rows.length} 个模型`, 'wide'),
  ].join('');

  els.dailyDateLabel.textContent = formatDate(selectedDate);
  els.dailyPrevBtn.disabled = false;
  els.dailyNextBtn.disabled = selectedDate >= today;

  els.dailyModelTable.innerHTML = rows.length
    ? rows.map((row) => {
        const total = row.total_input_tokens + row.total_output_tokens;
        const rowRate = cacheRate(
          row.uncached_input_tokens,
          row.cache_hit_tokens,
          row.cache_write_tokens,
        );
        return `
          <tr>
            <td>${esc(row.model)}</td>
            <td class="num">${formatCount(row.request_count)}</td>
            <td class="num">${formatCount(row.total_input_tokens)}</td>
            <td class="num">${formatCount(row.total_output_tokens)}</td>
            <td class="num">${formatCount(row.cache_hit_tokens)}</td>
            <td class="num">${rowRate.toFixed(1)}%</td>
            <td class="num">${formatCount(total)}</td>
            <td class="num">${esc(formatMoney(row.total_cost_usd))}</td>
          </tr>
        `;
      }).join('')
    : emptyRow(8, '该日期暂无记录');
}

function renderRecords() {
  const query = els.recordsFilter.value.trim().toLowerCase();
  const filtered = query
    ? records.filter((record) =>
        [record.model, record.provider, record.usg_id]
          .some((value) => String(value || '').toLowerCase().includes(query)),
      )
    : records;
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  recordsPage = Math.min(recordsPage, pages - 1);
  const pageRecords = filtered.slice(
    recordsPage * PAGE_SIZE,
    recordsPage * PAGE_SIZE + PAGE_SIZE,
  );
  const accountName = snapshot?.account?.name || snapshot?.account?.workspace_id || 'Default';

  els.recordsSummary.textContent = `共 ${formatCount(filtered.length)} 条记录${query ? '（已筛选）' : ''}`;
  els.recordsPageLabel.textContent = `第 ${recordsPage + 1} / ${pages} 页`;
  els.recordsPrevBtn.disabled = recordsPage === 0;
  els.recordsNextBtn.disabled = recordsPage + 1 >= pages;

  els.recordsTable.innerHTML = pageRecords.length
    ? pageRecords.map((record) => `
        <tr>
          <td class="mono">${esc(record.usg_id || '—')}</td>
          <td>${esc(accountName)}</td>
          <td>${esc(formatTime(record.created_at))}</td>
          <td>${esc(record.model || 'Unknown')}</td>
          <td>${esc(record.provider || '—')}</td>
          <td class="num">${formatCount(record.input_tokens)}</td>
          <td class="num">${formatCount(record.output_tokens)}</td>
          <td class="num">${formatCount(record.uncached_input_tokens ?? record.input_tokens)}</td>
          <td class="num">${formatCount(record.cache_read_tokens)}</td>
          <td class="num">${formatCount(record.cache_write_tokens)}</td>
          <td class="num">${esc(formatMoney(record.cost_usd))}</td>
          <td class="mono">${esc(record.key_id || '—')}</td>
          <td>${record.plan ? `<span class="badge">${esc(record.plan)}</span>` : '—'}</td>
        </tr>
      `).join('')
    : emptyRow(13, query ? '没有匹配记录' : '暂无使用记录');
}

function renderSyncStatus() {
  const sync = snapshot?.sync || {};
  const totalRecords = records.length || snapshot?.snapshot?.total_records || 0;
  const statusText = sync.last_sync_status === 'error'
    ? '同步失败'
    : sync.last_sync_at
      ? '已同步'
      : '未同步';
  const statusClass = sync.last_sync_status === 'error'
    ? 'error'
    : sync.last_sync_at
      ? 'success'
      : '';

  els.syncStatusChip.className = `sync-chip ${statusClass}`.trim();
  els.syncStatusChip.textContent = statusText;
  els.settingsStatusChip.className = `status-chip ${statusClass}`.trim();
  els.settingsStatusChip.textContent = statusText;

  els.syncStatePanel.innerHTML = [
    ['last_sync_at', sync.last_sync_at ? formatDateTime(sync.last_sync_at) : '—'],
    ['last_sync_status', statusText],
    ['deepest_page', sync.deepest_page ?? '—'],
    ['总记录数', formatCount(totalRecords)],
    ['错误信息', sync.last_sync_error || '无'],
  ].map(([label, value]) => `
    <div class="sync-state-item">
      <span>${esc(label)}</span>
      <strong>${esc(value)}</strong>
    </div>
  `).join('');
}

function setTheme(theme) {
  const resolved = theme === 'dark'
    ? 'dark'
    : theme === 'light'
      ? 'light'
      : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = resolved;
  els.themeSegmented.querySelectorAll('button').forEach((button) => {
    button.classList.toggle('active', button.dataset.theme === theme);
  });
}

function setLanguage(language) {
  const resolved = language === 'en'
    ? 'en'
    : language === 'zh'
      ? 'zh'
      : navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  document.documentElement.lang = resolved;
  els.languageSegmented.querySelectorAll('button').forEach((button) => {
    button.classList.toggle('active', button.dataset.language === language);
  });
}

function renderSettings() {
  const current = settings || {};
  els.autoSync.checked = current.autoSync !== false;
  els.syncPages.value = String(current.syncPages || 10);
  els.usageSyncIntervalSec.value = String(current.usageSyncIntervalSec || 300);
  els.quotaRefreshIntervalSec.value = String(current.quotaRefreshIntervalSec || 60);
  setTheme(current.theme || 'system');
  setLanguage(current.language || 'auto');
}

function renderAccountName() {
  const account = snapshot?.account || null;
  els.accountName.textContent = account?.name || account?.workspace_id || '尚未识别账户';
}

function renderAll() {
  renderAccountName();
  renderOverview();
  renderTokenStats();
  renderDaily();
  renderRecords();
  renderSyncStatus();
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.classList.remove('show');
  }, 2400);
}

function switchPage(page) {
  document.querySelectorAll('.nav-tab').forEach((tab) => {
    const active = tab.dataset.page === page;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('.page').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `page-${page}`);
  });
}

async function loadAll() {
  try {
    const [snapshotResponse, recordsResponse] = await Promise.all([
      sendRuntime({ type: 'GET_SNAPSHOT' }),
      sendRuntime({ type: 'GET_RECORDS' }),
    ]);
    snapshot = snapshotResponse.snapshot || null;
    records = recordsResponse.records || [];
    stats = computeStats(records);
  } catch (error) {
    console.error('[OpenCodeQME tab] load failed', error);
  }
  if (!stats) {
    records = [];
    stats = computeStats(records);
  }
  renderAll();
}

async function loadSettings() {
  try {
    const response = await sendRuntime({ type: 'GET_SETTINGS' });
    settings = response.settings || {};
  } catch (error) {
    settings = {};
    console.error('[OpenCodeQME tab] settings load failed', error);
  }
  renderSettings();
}

async function updateSettings(patch) {
  try {
    const response = await sendRuntime({
      type: 'UPDATE_SETTINGS',
      settings: { ...(settings || {}), ...patch },
    });
    settings = response.settings || {};
    renderSettings();
    showToast('设置已保存');
  } catch (error) {
    showToast(error.message);
  }
}

async function runSync() {
  els.syncBtn.classList.add('loading');
  els.syncBtn.disabled = true;
  els.settingsSyncBtn.disabled = true;
  showToast('正在同步完整历史...');
  try {
    await sendRuntime({ type: 'SYNC_NOW', maxPages: Number(settings?.syncPages || 50) });
    await loadAll();
    showToast('同步完成');
  } catch (error) {
    showToast(error.message);
  } finally {
    els.syncBtn.classList.remove('loading');
    els.syncBtn.disabled = false;
    els.settingsSyncBtn.disabled = false;
  }
}

async function backToPopup() {
  try {
    await sendRuntime({ type: 'OPEN_POPUP' });
    window.close();
  } catch (error) {
    showToast(error.message);
  }
}

function shiftSelectedDate(delta) {
  const date = new Date(`${selectedDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  selectedDate = date.toISOString().slice(0, 10);
  renderDaily();
}

function bindEvents() {
  document.querySelectorAll('.nav-tab').forEach((tab) => {
    tab.addEventListener('click', () => switchPage(tab.dataset.page));
  });

  els.syncBtn.addEventListener('click', () => runSync());
  els.settingsSyncBtn.addEventListener('click', () => runSync());
  els.popupModeBtn.addEventListener('click', () => backToPopup());
  els.openSiteBtn.addEventListener('click', () => sendRuntime({ type: 'OPEN_OPENCODE' }));

  els.themeSegmented.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-theme]');
    if (button) updateSettings({ theme: button.dataset.theme });
  });
  els.languageSegmented.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-language]');
    if (button) updateSettings({ language: button.dataset.language });
  });

  els.autoSync.addEventListener('change', () => {
    updateSettings({ autoSync: els.autoSync.checked });
  });
  els.syncPages.addEventListener('change', () => {
    const value = Math.max(1, Math.min(100, Number(els.syncPages.value) || 10));
    els.syncPages.value = String(value);
    updateSettings({ syncPages: value });
  });
  els.usageSyncIntervalSec.addEventListener('change', () => {
    updateSettings({ usageSyncIntervalSec: Number(els.usageSyncIntervalSec.value) });
  });
  els.quotaRefreshIntervalSec.addEventListener('change', () => {
    updateSettings({ quotaRefreshIntervalSec: Number(els.quotaRefreshIntervalSec.value) });
  });

  els.clearHistoryBtn.addEventListener('click', async () => {
    const workspaceId = snapshot?.account?.workspace_id;
    if (!workspaceId) {
      showToast('还没有可清空的历史');
      return;
    }
    if (!window.confirm('确定清空本地完整历史？此操作不可撤销。')) return;
    try {
      await sendRuntime({ type: 'CLEAR_HISTORY', workspace_id: workspaceId });
      await loadAll();
      showToast('本地历史已清空');
    } catch (error) {
      showToast(error.message);
    }
  });

  els.dailyPrevBtn.addEventListener('click', () => shiftSelectedDate(-1));
  els.dailyNextBtn.addEventListener('click', () => shiftSelectedDate(1));
  els.dailyTodayBtn.addEventListener('click', () => {
    selectedDate = todayKey();
    renderDaily();
  });
  els.dailyDate.addEventListener('change', () => {
    if (els.dailyDate.value) {
      selectedDate = els.dailyDate.value;
      renderDaily();
    }
  });

  els.recordsPrevBtn.addEventListener('click', () => {
    if (recordsPage > 0) {
      recordsPage -= 1;
      renderRecords();
    }
  });
  els.recordsNextBtn.addEventListener('click', () => {
    recordsPage += 1;
    renderRecords();
  });
  els.recordsFilter.addEventListener('input', () => {
    recordsPage = 0;
    renderRecords();
  });
  els.recordsRefreshBtn.addEventListener('click', () => loadAll());
}

async function init() {
  bindEvents();
  await Promise.all([loadSettings(), loadAll()]);
  setInterval(() => {
    void loadAll().catch(() => {});
  }, 60000);
}

init().catch((error) => {
  showToast(error.message);
});
