globalThis.OpenCodeFetcher = (() => {
  const CONSOLE_API_BASE = 'https://opencode.ai/console/api';
  const DASHBOARD_BASE = 'https://opencode.ai/workspace';
  const LEGACY_WORKSPACE_SERVER_ID =
    'def39973159c7f0483d8793a822b8dbb10d067e12c65455fcb4608459ba0234f';
  const LEGACY_USAGE_SERVER_ID =
    'bfd684bfc2e4eed05cd0b518f5e4eafd3f3376e3938abb9e536e7c03df831e5c';
  const DEFAULT_WORKSPACE_ID = 'Default';
  const ORG_HEADER = 'x-org-id';
  const USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136 Safari/537.36';
  const TIMEOUT_MS = 15000;
  const MAX_BYTES = 4 << 20;
  const MICRO_CENTS_PER_DOLLAR = 100_000_000;
  const USAGE_RANGE = '30d';

  const RE_WORKSPACE_ID = /\b(?:wrk|org)_[A-Za-z0-9_-]+\b/;
  const RE_LEGACY_WORKSPACE_ENTRY =
    /id\s*:\s*"(wrk_[^"]+)"[^{}]*?name\s*:\s*"([^"]*)"/gs;

  function fetchWithTimeout(url, init, timeoutMs = TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { ...init, signal: controller.signal })
      .catch((error) => {
        if (error.name === 'AbortError') {
          throw new Error(`请求超时: ${url}`);
        }
        throw error;
      })
      .finally(() => clearTimeout(timer));
  }

  function toNumber(value) {
    if (typeof value === 'bigint') return Number(value);
    if (typeof value === 'string' && value.trim() === '') return 0;
    if (value && typeof value === 'object' && typeof value.toString === 'function') {
      const parsed = Number(value.toString());
      return Number.isFinite(parsed) ? parsed : 0;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function unwrapData(value) {
    return value && typeof value === 'object' && value.data !== undefined
      ? value.data
      : value;
  }

  function pick(value, ...keys) {
    for (const key of keys) {
      if (value?.[key] !== undefined && value?.[key] !== null) return value[key];
    }
    return undefined;
  }

  function clampPercent(value) {
    return Math.max(0, Math.min(100, value));
  }

  function extractWorkspaceId(raw) {
    const value = String(raw || '').trim();
    if (!value) return '';
    if (/^(?:wrk|org)_[A-Za-z0-9_-]+$/.test(value)) return value;
    const match = RE_WORKSPACE_ID.exec(value);
    return match ? match[0] : '';
  }

  async function parseJsonResponse(response, label) {
    const text = (await response.text()).slice(0, MAX_BYTES);
    if (response.status === 401 || response.status === 403) {
      throw new Error(`认证失败，请先登录 opencode.ai 控制台（${response.status}）`);
    }
    if (response.status === 404) {
      throw new Error(`${label}不存在 (HTTP 404)`);
    }
    if (!response.ok) {
      throw new Error(`${label}返回 HTTP ${response.status}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`${label}返回了非 JSON 数据`);
    }
  }

  async function consoleRequest(path, orgId) {
    const headers = { Accept: 'application/json' };
    if (orgId) headers[ORG_HEADER] = orgId;
    const response = await fetchWithTimeout(`${CONSOLE_API_BASE}${path}`, {
      cache: 'no-store',
      credentials: 'include',
      headers,
      redirect: 'manual',
    });
    return parseJsonResponse(response, 'OpenCode 控制台接口');
  }

  async function fetchOrgs() {
    const payload = unwrapData(await consoleRequest('/me/orgs'));
    const rows = Array.isArray(payload) ? payload : payload?.orgs;
    if (!Array.isArray(rows)) throw new Error('无法解析 OpenCode 工作区列表');
    return rows
      .map((row) => ({
        workspace_id: String(pick(row, 'id', 'workspace_id') || ''),
        name: String(pick(row, 'name') || 'OpenCode'),
      }))
      .filter((row) => row.workspace_id);
  }

  async function fetchLegacyWorkspaceRefs() {
    const url = `https://opencode.ai/_server?id=${encodeURIComponent(LEGACY_WORKSPACE_SERVER_ID)}`;
    const response = await fetchWithTimeout(url, {
      credentials: 'include',
      headers: {
        'X-Server-Id': LEGACY_WORKSPACE_SERVER_ID,
        'X-Server-Instance': `server-fn:${crypto.randomUUID()}`,
        'User-Agent': USER_AGENT,
        Accept: 'text/javascript, application/json;q=0.9, */*;q=0.8',
      },
      redirect: 'manual',
    });
    if (response.status === 401 || response.status === 403) {
      throw new Error('认证失败，请先登录 opencode.ai');
    }
    if (!response.ok) {
      throw new Error(`旧版工作区查询返回 HTTP ${response.status}`);
    }

    const text = (await response.text()).slice(0, MAX_BYTES);
    const refs = [];
    const seen = new Set();
    RE_LEGACY_WORKSPACE_ENTRY.lastIndex = 0;
    let match;
    while ((match = RE_LEGACY_WORKSPACE_ENTRY.exec(text)) !== null) {
      if (seen.has(match[1])) continue;
      seen.add(match[1]);
      refs.push([match[1], match[2].trim()]);
    }
    if (!refs.length) throw new Error('无法从旧版账号数据解析工作区 ID');
    return refs;
  }

  function selectWorkspace(refs, workspaceHint) {
    const hint = String(workspaceHint || '').trim();
    const extracted = extractWorkspaceId(hint);
    if (extracted) {
      const found = refs.find(([workspaceId]) => workspaceId === extracted);
      return found || refs[0] || [extracted, 'OpenCode'];
    }
    const matched = refs.find(([workspaceId, name]) => (
      hint && (
        workspaceId.toLowerCase() === hint.toLowerCase()
        || name.toLowerCase() === hint.toLowerCase()
      )
    ));
    return matched || refs[0] || null;
  }

  async function identifyAccount(workspaceHint = DEFAULT_WORKSPACE_ID) {
    try {
      const orgs = await fetchOrgs();
      const selected = selectWorkspace(
        orgs.map((org) => [org.workspace_id, org.name]),
        workspaceHint,
      );
      if (!selected) throw new Error('当前账号没有可用的 OpenCode 工作区');
      return {
        workspace_id: selected[0],
        name: selected[1] || 'OpenCode',
        api: 'console-v2',
      };
    } catch (consoleError) {
      try {
        const refs = await fetchLegacyWorkspaceRefs();
        const selected = selectWorkspace(refs, workspaceHint);
        if (!selected) throw new Error('无法解析 OpenCode Go 工作区 ID');
        return {
          workspace_id: selected[0],
          name: selected[1] || 'OpenCode',
          api: 'legacy',
        };
      } catch (legacyError) {
        const message = String(consoleError?.message || consoleError || '');
        if (message.includes('认证失败')) throw consoleError;
        throw new Error(`${message || legacyError.message}`);
      }
    }
  }

  function meterWindow(label, meter, now) {
    const usedMicroCents = toNumber(pick(meter, 'usedMicroCents', 'used_micro_cents'));
    const limitMicroCents = toNumber(pick(meter, 'limitMicroCents', 'limit_micro_cents'));
    const used = limitMicroCents > 0
      ? clampPercent((usedMicroCents / limitMicroCents) * 100)
      : 0;
    const resetValue = pick(meter, 'resetsAt', 'resets_at');
    const resetMs = typeof resetValue === 'number'
      ? resetValue
      : Date.parse(String(resetValue || ''));
    const resetAt = Number.isFinite(resetMs) ? new Date(resetMs) : null;
    return {
      label,
      used,
      remaining: 100 - used,
      total: 100,
      unit: '%',
      reset_at: resetAt ? resetAt.toISOString().replace(/\.\d{3}Z$/, 'Z') : '',
      reset_in_sec: resetAt ? Math.max(0, Math.trunc((resetAt.getTime() - now.getTime()) / 1000)) : 0,
      used_micro_cents: usedMicroCents,
      limit_micro_cents: limitMicroCents,
    };
  }

  function normalizeQuotaStatus(status, now = new Date()) {
    const payload = unwrapData(status);
    const meters = payload?.access?.meters;
    if (!meters) {
      if (payload?.access === null) {
        throw new Error('当前工作区没有 OpenCode Go 订阅或额度数据');
      }
      throw new Error('新版 Go 状态接口没有返回额度 meters');
    }
    const windows = [
      meterWindow('5h Rolling', meters.fiveHour, now),
      meterWindow('Weekly', meters.week, now),
      meterWindow('Monthly', meters.month, now),
    ].filter((item) => item.limit_micro_cents > 0);
    if (!windows.length) throw new Error('OpenCode Go 额度数据为空');
    return {
      product: String(pick(payload, 'product') || ''),
      windows: OpenCodeParser.applyOpencodeCascade(windows),
    };
  }

  async function fetchQuotaFromConsole(workspaceId) {
    const payload = await consoleRequest('/go/status?fresh=true', workspaceId);
    const normalized = normalizeQuotaStatus(payload);
    return {
      workspace_id: workspaceId,
      success: true,
      source: 'console-v2',
      product: normalized.product,
      updated_at: new Date().toISOString(),
      windows: normalized.windows,
    };
  }

  async function fetchLegacyQuota(workspaceId) {
    const dashboardUrl = `${DASHBOARD_BASE}/${encodeURIComponent(workspaceId)}/go`;
    const response = await fetchWithTimeout(dashboardUrl, {
      cache: 'no-store',
      credentials: 'include',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html, application/xhtml+xml',
      },
      redirect: 'manual',
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('Location') || '';
      throw new Error(
        location
          ? `Dashboard 重定向 (HTTP ${response.status} → ${location})，请检查登录状态`
          : `Dashboard 重定向 (HTTP ${response.status})，请检查登录状态`,
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error('认证失败，请先登录 opencode.ai');
    }
    if (response.status === 404) {
      throw new Error('工作区不存在 (HTTP 404)');
    }
    if (!response.ok) {
      throw new Error(`Dashboard 返回 HTTP ${response.status}`);
    }

    const html = (await response.text()).slice(0, MAX_BYTES);
    const windows = OpenCodeParser.parseQuotaHtml(html);
    if (!windows.length) throw new Error('无法从旧版 Dashboard HTML 解析额度数据');
    return {
      workspace_id: workspaceId,
      success: true,
      source: 'legacy-html',
      updated_at: new Date().toISOString(),
      windows: OpenCodeParser.applyOpencodeCascade(windows),
    };
  }

  async function fetchQuota(workspaceId) {
    try {
      return await fetchQuotaFromConsole(workspaceId);
    } catch (consoleError) {
      if (String(consoleError?.message || '').includes('认证失败')) throw consoleError;
      try {
        return await fetchLegacyQuota(workspaceId);
      } catch {
        throw consoleError;
      }
    }
  }

  function normalizeUsageSnapshot(summaryRaw, dailyRaw, modelsRaw, now = new Date()) {
    const summary = unwrapData(summaryRaw) || {};
    const daily = Array.isArray(dailyRaw) ? dailyRaw : (dailyRaw?.items || []);
    const models = Array.isArray(modelsRaw) ? modelsRaw : (modelsRaw?.items || []);
    const today = now.toISOString().slice(0, 10);

    const dailyStats = daily.map((row) => {
      const tokens = toNumber(pick(row, 'totalTokens', 'total_tokens'));
      return {
        date: String(pick(row, 'date') || '').slice(0, 10),
        request_count: toNumber(pick(row, 'totalRequests', 'total_requests')),
        input_tokens: tokens,
        output_tokens: 0,
        cost_usd: toNumber(pick(row, 'totalCostMicroCents', 'total_cost_micro_cents')) / MICRO_CENTS_PER_DOLLAR,
        total_tokens: tokens,
        total_cost_usd: toNumber(pick(row, 'totalCostMicroCents', 'total_cost_micro_cents')) / MICRO_CENTS_PER_DOLLAR,
      };
    }).filter((row) => row.date).sort((a, b) => a.date.localeCompare(b.date));

    const modelStats = models.map((row) => {
      const cacheRead = toNumber(pick(row, 'totalCacheReadTokens', 'total_cache_read_tokens'));
      const cacheWrite = toNumber(pick(row, 'totalCacheWrite5mTokens', 'total_cache_write5m_tokens'))
        + toNumber(pick(row, 'totalCacheWrite1hTokens', 'total_cache_write1h_tokens'));
      const uncachedInput = toNumber(pick(row, 'totalInputTokens', 'total_input_tokens'));
      const input = uncachedInput + cacheRead + cacheWrite;
      const output = toNumber(pick(row, 'totalOutputTokens', 'total_output_tokens'));
      return {
        model: String(pick(row, 'model') || 'Unknown'),
        provider: String(pick(row, 'provider') || ''),
        request_count: toNumber(pick(row, 'totalRequests', 'total_requests')),
        total_input_tokens: input,
        uncached_input_tokens: uncachedInput,
        cache_hit_tokens: cacheRead,
        cache_write_tokens: cacheWrite,
        total_output_tokens: output,
        total_cost_usd: toNumber(pick(row, 'totalCostMicroCents', 'total_cost_micro_cents')) / MICRO_CENTS_PER_DOLLAR,
      };
    }).sort((a, b) => (
      (b.total_input_tokens + b.total_output_tokens)
      - (a.total_input_tokens + a.total_output_tokens)
    ));

    const todayRow = dailyStats.find((row) => row.date === today);
    const totalRequests = toNumber(pick(summary, 'totalRequests', 'total_requests'))
      || modelStats.reduce((sum, row) => sum + row.request_count, 0);
    return {
      source: 'console-v2',
      range: USAGE_RANGE,
      total_records: totalRequests,
      today_tokens: todayRow?.total_tokens || 0,
      today_requests: todayRow?.request_count || 0,
      recent_records: [],
      daily_stats: dailyStats,
      model_stats: modelStats,
    };
  }

  async function fetchUsageSnapshot(workspaceId) {
    const query = `range=${USAGE_RANGE}&includeLegacyKeys=true`;
    const [summary, daily, models] = await Promise.all([
      consoleRequest(`/usage/summary?${query}&comparison=current`, workspaceId),
      consoleRequest(`/usage/cost-by-day?${query}&bucket=day`, workspaceId),
      consoleRequest(`/usage/models?${query}&page=1&pageSize=100&costOrder=desc`, workspaceId),
    ]);
    return normalizeUsageSnapshot(summary, daily, models);
  }

  function buildLegacyUsageArgs(workspaceId, page, keyId) {
    const args = [workspaceId];
    if (keyId) {
      if (page > 0) args.push(page, keyId);
      else args.push(keyId);
    } else if (page > 0) {
      args.push(page);
    }
    return args;
  }

  async function fetchLegacyUsagePage(workspaceId, page = 0, keyId = null) {
    const args = buildLegacyUsageArgs(workspaceId, page, keyId);
    const url =
      `https://opencode.ai/_server?id=${encodeURIComponent(LEGACY_USAGE_SERVER_ID)}` +
      `&args=${encodeURIComponent(JSON.stringify(args))}`;
    const response = await fetchWithTimeout(url, {
      cache: 'no-store',
      credentials: 'include',
      headers: {
        'X-Server-Id': LEGACY_USAGE_SERVER_ID,
        'X-Server-Instance': `server-fn:${crypto.randomUUID()}`,
        'User-Agent': USER_AGENT,
        Accept: 'text/javascript, application/json;q=0.9, */*;q=0.8',
      },
      redirect: 'manual',
    });

    if (response.status === 401 || response.status === 403) {
      throw new Error('认证失败，请先登录 opencode.ai');
    }
    if (!response.ok) {
      throw new Error(`旧版使用记录查询返回 HTTP ${response.status}`);
    }
    const text = (await response.text()).slice(0, MAX_BYTES);
    return OpenCodeParser.parseUsageResponse(text);
  }

  return {
    identifyAccount,
    fetchQuota,
    fetchUsageSnapshot,
    fetchUsagePage: fetchLegacyUsagePage,
    __test: {
      extractWorkspaceId,
      meterWindow,
      normalizeQuotaStatus,
      normalizeUsageSnapshot,
      toNumber,
    },
  };
})();
