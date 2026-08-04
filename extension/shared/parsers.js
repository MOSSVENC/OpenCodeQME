globalThis.OpenCodeParser = (() => {
  const LABEL_ROLLING = '5h Rolling';
  const LABEL_WEEKLY = 'Weekly';
  const LABEL_MONTHLY = 'Monthly';

  const RE_ROLLING_PCT_FIRST =
    /rollingUsage:\s*\$R\[\d+\]\s*=\s*\{[^}]*usagePercent\s*:\s*(-?\d+(?:\.\d+)?)[^}]*resetInSec\s*:\s*(-?\d+(?:\.\d+)?)[^}]*\}/;
  const RE_ROLLING_RESET_FIRST =
    /rollingUsage:\s*\$R\[\d+\]\s*=\s*\{[^}]*resetInSec\s*:\s*(-?\d+(?:\.\d+)?)[^}]*usagePercent\s*:\s*(-?\d+(?:\.\d+)?)[^}]*\}/;
  const RE_WEEKLY_PCT_FIRST =
    /weeklyUsage:\s*\$R\[\d+\]\s*=\s*\{[^}]*usagePercent\s*:\s*(-?\d+(?:\.\d+)?)[^}]*resetInSec\s*:\s*(-?\d+(?:\.\d+)?)[^}]*\}/;
  const RE_WEEKLY_RESET_FIRST =
    /weeklyUsage:\s*\$R\[\d+\]\s*=\s*\{[^}]*resetInSec\s*:\s*(-?\d+(?:\.\d+)?)[^}]*usagePercent\s*:\s*(-?\d+(?:\.\d+)?)[^}]*\}/;
  const RE_MONTHLY_PCT_FIRST =
    /monthlyUsage:\s*\$R\[\d+\]\s*=\s*\{[^}]*usagePercent\s*:\s*(-?\d+(?:\.\d+)?)[^}]*resetInSec\s*:\s*(-?\d+(?:\.\d+)?)[^}]*\}/;
  const RE_MONTHLY_RESET_FIRST =
    /monthlyUsage:\s*\$R\[\d+\]\s*=\s*\{[^}]*resetInSec\s*:\s*(-?\d+(?:\.\d+)?)[^}]*usagePercent\s*:\s*(-?\d+(?:\.\d+)?)[^}]*\}/;

  const RECORD_RE =
    /id:"(usg_[^"]+)"([\s\S]*?)(?=,\$R\[\d+\]=\{id:"usg_|$)/g;
  const PLAN_RE =
    /id:"(usg_[^"]+)"[^}]*?enrichment:\$R\[\d+\]=\{plan:"([^"]+)"\}/gs;

  function parseWindow(pctFirst, resetFirst, html) {
    let match = pctFirst.exec(html);
    if (match) return [parseFloat(match[1]), Math.trunc(parseFloat(match[2]))];
    match = resetFirst.exec(html);
    if (match) return [parseFloat(match[2]), Math.trunc(parseFloat(match[1]))];
    return null;
  }

  function clampPercent(value) {
    return Math.max(0, Math.min(100, value));
  }

  function normalizeWindow(label, usagePercent, resetInSec, now) {
    const used = clampPercent(usagePercent);
    const resetAt = new Date(now.getTime() + resetInSec * 1000);
    return {
      label,
      used,
      remaining: 100 - used,
      total: 100,
      unit: '%',
      reset_at: resetAt.toISOString().replace(/\.\d{3}Z$/, 'Z'),
      reset_in_sec: resetInSec,
    };
  }

  function parseQuotaHtml(html, now = new Date()) {
    const windows = [];
    const pairs = [
      [LABEL_ROLLING, RE_ROLLING_PCT_FIRST, RE_ROLLING_RESET_FIRST],
      [LABEL_WEEKLY, RE_WEEKLY_PCT_FIRST, RE_WEEKLY_RESET_FIRST],
      [LABEL_MONTHLY, RE_MONTHLY_PCT_FIRST, RE_MONTHLY_RESET_FIRST],
    ];
    for (const [label, pctRe, resetRe] of pairs) {
      const parsed = parseWindow(pctRe, resetRe, html);
      if (parsed) windows.push(normalizeWindow(label, parsed[0], parsed[1], now));
    }
    return windows;
  }

  function windowByLabel(windows, label) {
    for (const window of windows) {
      if (window.label === label) return window;
    }
    return null;
  }

  function applyOpencodeCascade(windows) {
    const monthly = windowByLabel(windows, LABEL_MONTHLY);
    const weekly = windowByLabel(windows, LABEL_WEEKLY);
    const monthlyFull = monthly != null && Number(monthly.used || 0) >= 100;
    const weeklyFull = weekly != null && Number(weekly.used || 0) >= 100;

    return windows.map((window) => {
      const item = { ...window };
      let blocked = false;
      let blockedBy = '';
      if (item.label === LABEL_WEEKLY && monthlyFull) {
        blocked = true;
        blockedBy = LABEL_MONTHLY;
      } else if (item.label === LABEL_ROLLING && (monthlyFull || weeklyFull)) {
        blocked = true;
        blockedBy = monthlyFull ? LABEL_MONTHLY : LABEL_WEEKLY;
      }
      if (blocked) {
        item.blocked = true;
        item.blocked_by = blockedBy;
        item.effective_remaining = 0;
      } else {
        item.blocked = false;
        item.effective_remaining = Number(item.remaining || 0);
      }
      return item;
    });
  }

  function opencodeEffectiveRemaining(windows) {
    const cascaded = applyOpencodeCascade(windows);
    const rolling = windowByLabel(cascaded, LABEL_ROLLING);
    if (rolling != null) return Number(rolling.effective_remaining || 0);
    const weekly = windowByLabel(cascaded, LABEL_WEEKLY);
    if (weekly != null) return Number(weekly.effective_remaining || 0);
    const monthly = windowByLabel(cascaded, LABEL_MONTHLY);
    if (monthly != null) return Number(monthly.effective_remaining || 0);
    return 0;
  }

  function parseOptionalToken(value) {
    if (value === 'null' || value === '') return 0;
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function parseUsageResponse(text) {
    const plans = new Map();
    PLAN_RE.lastIndex = 0;
    let planMatch;
    while ((planMatch = PLAN_RE.exec(text)) !== null) {
      plans.set(planMatch[1], planMatch[2]);
    }

    const records = [];
    RECORD_RE.lastIndex = 0;
    let match;
    while ((match = RECORD_RE.exec(text)) !== null) {
      const body = match[2];
      const readString = (name) => {
        const found = body.match(new RegExp(`${name}:"([^"]+)"`));
        return found ? found[1] : '';
      };
      const readNumber = (name) => {
        const found = body.match(new RegExp(`${name}:(\\d+|null)`));
        return found ? found[1] : '0';
      };
      const createdAt = body.match(/timeCreated:\$R\[\d+\]=new Date\("([^"]+)"\)/)?.[1];
      if (!createdAt) continue;

      const costInt = parseOptionalToken(readNumber('cost'));
      const usgId = match[1];
      const cacheWrite5m = parseOptionalToken(readNumber('cacheWrite5mTokens'));
      const cacheWrite1h = parseOptionalToken(readNumber('cacheWrite1hTokens'));
      const input = parseOptionalToken(readNumber('inputTokens'));
      const output = parseOptionalToken(readNumber('outputTokens'));
      const cacheRead = parseOptionalToken(readNumber('cacheReadTokens'));

      records.push({
        usg_id: usgId,
        created_at: createdAt,
        model: readString('model'),
        provider: readString('provider'),
        input_tokens: input + cacheRead + cacheWrite5m + cacheWrite1h,
        output_tokens: output,
        uncached_input_tokens: input,
        cache_read_tokens: cacheRead,
        cache_write_tokens: cacheWrite5m + cacheWrite1h,
        cost_raw: costInt,
        cost_usd: costInt / 1_000_000_000,
        key_id: readString('keyID'),
        plan: plans.get(usgId) || null,
      });
    }
    return records;
  }

  return {
    LABEL_ROLLING,
    LABEL_WEEKLY,
    LABEL_MONTHLY,
    parseQuotaHtml,
    applyOpencodeCascade,
    opencodeEffectiveRemaining,
    parseUsageResponse,
  };
})();
