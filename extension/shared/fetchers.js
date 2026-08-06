globalThis.OpenCodeFetcher = (() => {
  const DASHBOARD_BASE = 'https://opencode.ai/workspace';
  const WORKSPACE_SERVER_ID =
    'def39973159c7f0483d8793a822b8dbb10d067e12c65455fcb4608459ba0234f';
  const USAGE_SERVER_ID =
    'bfd684bfc2e4eed05cd0b518f5e4eafd3f3376e3938abb9e536e7c03df831e5c';
  const DEFAULT_WORKSPACE_ID = 'Default';
  const USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136 Safari/537.36';
  const TIMEOUT_MS = 15000;
  const MAX_BYTES = 4 << 20;

  const RE_WORKSPACE_ID = /wrk_[A-Za-z0-9]+/;
  const RE_WORKSPACE_ENTRY =
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

  function extractWorkspaceId(raw) {
    const value = String(raw || '').trim();
    if (!value) return '';
    if (value.startsWith('wrk_') && value.length > 4) return value;
    const match = RE_WORKSPACE_ID.exec(value);
    return match ? match[0] : '';
  }

  async function fetchWorkspaceRefs() {
    const url = `https://opencode.ai/_server?id=${encodeURIComponent(WORKSPACE_SERVER_ID)}`;
    const response = await fetchWithTimeout(url, {
      credentials: 'include',
      headers: {
        'X-Server-Id': WORKSPACE_SERVER_ID,
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
      throw new Error(`工作区查询返回 HTTP ${response.status}`);
    }

    const text = (await response.text()).slice(0, MAX_BYTES);
    const refs = [];
    const seen = new Set();
    RE_WORKSPACE_ENTRY.lastIndex = 0;
    let match;
    while ((match = RE_WORKSPACE_ENTRY.exec(text)) !== null) {
      const workspaceId = match[1];
      const name = match[2].trim();
      if (seen.has(workspaceId)) continue;
      seen.add(workspaceId);
      refs.push([workspaceId, name]);
    }
    if (!refs.length) throw new Error('无法从账号数据解析工作区 ID');
    return refs;
  }

  async function identifyAccount(workspaceHint = DEFAULT_WORKSPACE_ID) {
    const hint = String(workspaceHint || '').trim();
    const extracted = extractWorkspaceId(workspaceHint);
    let refs = [];
    try {
      refs = await fetchWorkspaceRefs();
    } catch {
      // Workspace id is enough; name lookup is optional.
    }

    if (extracted) {
      const found = refs.find(([workspaceId]) => workspaceId === extracted);
      return { workspace_id: extracted, name: found?.[1] || 'OpenCode' };
    }

    const matched = refs.find(([workspaceId, name]) => (
      hint && (
        workspaceId.toLowerCase() === hint.toLowerCase()
        || name.toLowerCase() === hint.toLowerCase()
      )
    ));
    const selected = matched || refs[0];
    if (!selected) throw new Error('无法解析 OpenCode Go 工作区 ID');
    return { workspace_id: selected[0], name: selected[1] || 'OpenCode' };
  }

  async function fetchQuota(workspaceId) {
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
    if (!windows.length) throw new Error('无法从 Dashboard HTML 解析额度数据');
    return {
      workspace_id: workspaceId,
      success: true,
      updated_at: new Date().toISOString(),
      windows: OpenCodeParser.applyOpencodeCascade(windows),
    };
  }

  function buildUsageArgs(workspaceId, page, keyId) {
    const args = [workspaceId];
    if (keyId) {
      if (page > 0) args.push(page, keyId);
      else args.push(keyId);
    } else if (page > 0) {
      args.push(page);
    }
    return args;
  }

  async function fetchUsagePage(workspaceId, page = 0, keyId = null) {
    const args = buildUsageArgs(workspaceId, page, keyId);
    const url =
      `https://opencode.ai/_server?id=${encodeURIComponent(USAGE_SERVER_ID)}` +
      `&args=${encodeURIComponent(JSON.stringify(args))}`;
    const response = await fetchWithTimeout(url, {
      cache: 'no-store',
      credentials: 'include',
      headers: {
        'X-Server-Id': USAGE_SERVER_ID,
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
      throw new Error(`使用记录查询返回 HTTP ${response.status}`);
    }
    const text = (await response.text()).slice(0, MAX_BYTES);
    return OpenCodeParser.parseUsageResponse(text);
  }

  return {
    identifyAccount,
    fetchQuota,
    fetchUsagePage,
  };
})();
