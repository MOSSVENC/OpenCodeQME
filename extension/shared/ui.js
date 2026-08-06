globalThis.OpenCodeUI = (() => {
  const $ = (selector) => document.querySelector(selector);

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
    const locale = globalThis.OpenCodeI18n.getLanguage() === 'en' ? 'en-US' : 'zh-CN';
    return date.toLocaleString(locale, {
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
    const locale = globalThis.OpenCodeI18n.getLanguage() === 'en' ? 'en-US' : 'zh-CN';
    return date.toLocaleString(locale, {
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
    const locale = globalThis.OpenCodeI18n.getLanguage() === 'en' ? 'en-US' : 'zh-CN';
    return date.toLocaleDateString(locale, {
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
    const time = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
    return globalThis.OpenCodeI18n.t('resetAfter', { time });
  }

  function displayAccountName(account) {
    const name = String(account?.name || '').trim();
    if (name) return name;
    const workspaceId = String(account?.workspace_id || '').trim();
    if (workspaceId) return workspaceId;
    return globalThis.OpenCodeI18n.t('accountDefault');
  }

  return {
    $,
    sendRuntime,
    esc,
    formatTokens,
    formatMoney,
    formatCount,
    formatTime,
    formatDateTime,
    formatDate,
    formatReset,
    displayAccountName,
  };
})();
