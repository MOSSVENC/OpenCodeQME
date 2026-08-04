(() => {
  const STORAGE_KEY = '68hub.dock_side';

  const host = document.createElement('div');
  host.id = 'opencodeqme-dock-host';
  const shadow = host.attachShadow({ mode: 'open' });
  const styleLink = document.createElement('link');
  styleLink.rel = 'stylesheet';
  styleLink.href = chrome.runtime.getURL('content-dock.css');

  const root = document.createElement('div');
  root.className = 'dock-root left';
  root.setAttribute('data-expanded', 'false');
  root.innerHTML = `
    <button class="dock" type="button" aria-label="OpenCodeQME 状态与详情">
      <span class="dock-arrow" aria-hidden="true"></span>
      <span class="dock-body">
        <span class="dock-title">OpenCodeQME</span>
        <span class="dock-quota">可用额度 --</span>
        <span class="dock-sync">等待同步</span>
      </span>
      <span class="dock-open">打开详情</span>
    </button>
  `;

  shadow.append(styleLink, root);
  document.documentElement.append(host);

  const dock = root.querySelector('.dock');
  const quotaEl = root.querySelector('.dock-quota');
  const syncEl = root.querySelector('.dock-sync');
  let drag = null;
  let lastMoveDistance = 0;

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function setSide(side, persist = false) {
    const next = side === 'right' ? 'right' : 'left';
    root.classList.toggle('left', next === 'left');
    root.classList.toggle('right', next === 'right');
    if (next === 'left') {
      root.style.left = '0px';
      root.style.right = 'auto';
    } else {
      root.style.left = 'auto';
      root.style.right = '0px';
    }
    if (persist) {
      chrome.storage.local.set({ [STORAGE_KEY]: next }).catch(() => {});
    }
  }

  function snapToEdge() {
    const rect = root.getBoundingClientRect();
    const center = rect.left + rect.width / 2;
    setSide(center < window.innerWidth / 2 ? 'left' : 'right', true);
  }

  function sendMessage(message) {
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

  function effectiveQuota(snapshot) {
    const windows = snapshot?.quota?.windows || [];
    const rolling = windows.find((item) => item.label === '5h Rolling');
    const weekly = windows.find((item) => item.label === 'Weekly');
    const monthly = windows.find((item) => item.label === 'Monthly');
    const source = rolling || weekly || monthly;
    if (!source) return null;
    return {
      remaining: Math.round(Number(source.effective_remaining ?? source.remaining ?? 0)),
      label: source.label,
    };
  }

  function updateDock(snapshot) {
    const quota = effectiveQuota(snapshot);
    if (quota) {
      quotaEl.textContent = `${quota.label} 剩余 ${quota.remaining}%`;
    } else {
      quotaEl.textContent = '可用额度 --';
    }

    const sync = snapshot?.sync || {};
    const totalRecords = snapshot?.snapshot?.total_records || 0;
    if (sync.last_sync_status === 'error') {
      syncEl.textContent = sync.last_sync_error || '同步失败';
    } else if (sync.last_sync_at) {
      syncEl.textContent = `已同步 ${formatTime(sync.last_sync_at)} · ${totalRecords} 条`;
    } else {
      syncEl.textContent = totalRecords ? `${totalRecords} 条本地记录` : '等待同步';
    }
  }

  async function refreshDock() {
    try {
      const response = await sendMessage({ type: 'GET_SNAPSHOT' });
      updateDock(response.snapshot || null);
    } catch (error) {
      quotaEl.textContent = '可用额度 --';
      syncEl.textContent = '扩展后台未就绪';
    }
  }

  async function openDock() {
    try {
      await sendMessage({ type: 'OPEN_BY_MODE' });
    } catch (error) {
      syncEl.textContent = error.message;
    }
  }

  dock.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const rect = root.getBoundingClientRect();
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
    };
    lastMoveDistance = 0;
    root.classList.add('dragging');
    dock.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  dock.addEventListener('pointermove', (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    lastMoveDistance = Math.abs(dx) + Math.abs(dy);
    const maxLeft = Math.max(0, window.innerWidth - root.offsetWidth);
    const maxTop = Math.max(0, window.innerHeight - root.offsetHeight);
    root.style.left = `${clamp(drag.startLeft + dx, 0, maxLeft)}px`;
    root.style.right = 'auto';
    root.style.top = `${clamp(drag.startTop + dy, 0, maxTop)}px`;
    root.classList.add('dragging');
  });

  function finishDrag(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const moved = lastMoveDistance;
    drag = null;
    root.classList.remove('dragging');
    if (moved > 6) {
      snapToEdge();
    }
  }

  dock.addEventListener('pointerup', finishDrag);
  dock.addEventListener('pointercancel', finishDrag);

  dock.addEventListener('click', (event) => {
    if (lastMoveDistance > 6) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    void openDock();
  });

  window.addEventListener('resize', () => {
    if (!drag) snapToEdge();
  });

  chrome.storage.local.get(STORAGE_KEY, ({ [STORAGE_KEY]: side }) => {
    setSide(side, false);
  });

  void refreshDock();
  setInterval(() => {
    void refreshDock();
  }, 60000);
})();
