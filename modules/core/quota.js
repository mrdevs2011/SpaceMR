// Tarmoq kiritish/chiqarish (Bandwidth) limiti menejeri (49 MB/daqiqa)
const LIMIT_BYTES = Math.floor(49 * 1024 * 1024); // 49 MB
const WINDOW_MS = 60 * 1000; // 1 minut

export function initQuota() {
  let browserId = localStorage.getItem('mr_browser_id');
  if (!browserId) {
    browserId = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2);
    localStorage.setItem('mr_browser_id', browserId);
  }

  function getUsage() {
    const now = Date.now();
    let start = parseInt(localStorage.getItem('mr_quota_start') || '0', 10);
    let rx = parseInt(localStorage.getItem('mr_quota_rx') || '0', 10);
    let tx = parseInt(localStorage.getItem('mr_quota_tx') || '0', 10);

    if (now - start > WINDOW_MS) {
      start = now;
      rx = 0;
      tx = 0;
      saveUsage(start, rx, tx);
    }
    return { start, rx, tx };
  }

  function saveUsage(start, rx, tx) {
    localStorage.setItem('mr_quota_start', start);
    localStorage.setItem('mr_quota_rx', rx);
    localStorage.setItem('mr_quota_tx', tx);
  }

  function addUsage(type, bytes) {
    if (!bytes || bytes <= 0) return;
    const u = getUsage();
    if (type === 'rx') u.rx += bytes;
    if (type === 'tx') u.tx += bytes;
    saveUsage(u.start, u.rx, u.tx);
    checkLimit();
  }

  let isBlocked = false;
  let checkTimer = null;

  function checkLimit() {
    const u = getUsage();
    if (u.rx > LIMIT_BYTES || u.tx > LIMIT_BYTES) {
      if (!isBlocked) {
        isBlocked = true;
        showBlocker();
      }
      const remain = Math.ceil((u.start + WINDOW_MS - Date.now()) / 1000);
      const tEl = document.getElementById('quotaTimer');
      if (tEl) {
        tEl.textContent = remain > 0 ? remain + ' soniya qoldi' : 'Qulf ochilmoqda...';
      }
    } else {
      if (isBlocked) {
        isBlocked = false;
        hideBlocker();
      }
    }
  }

  function showBlocker() {
    let b = document.getElementById('quotaBlocker');
    if (!b) {
      b = document.createElement('div');
      b.id = 'quotaBlocker';
      b.style = "position:fixed;inset:0;background:rgba(0,0,0,0.95);color:#fff;z-index:999999;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:20px;backdrop-filter:blur(10px);";
      b.innerHTML = `
        <img src="./svg/extra/icon-d269b370c5cf.svg" alt="" class="icon" width="64" height="64" style="margin-bottom:20px;">
        <h2 style="margin:0 0 10px 0;font-size:24px;color:#f4212e;">Trafik limiti oshdi</h2>
        <p style="margin:0;font-size:16px;color:#8899a6;max-width:400px;line-height:1.5;">
          1 daqiqa ichida maksimal 49 MB ma'lumot uzatishga ruxsat etiladi (qabul qilish yoki yuborish).
          <br>Sayt tarmog'i vaqtincha bloklandi.
        </p>
        <div id="quotaTimer" style="margin-top:20px;font-size:20px;font-family:monospace;color:#1d9bf0;"></div>
      `;
      document.body.appendChild(b);
    }
    b.style.display = 'flex';
    if (!checkTimer) checkTimer = setInterval(checkLimit, 1000);
  }

  function hideBlocker() {
    const b = document.getElementById('quotaBlocker');
    if (b) b.style.display = 'none';
    if (checkTimer) { clearInterval(checkTimer); checkTimer = null; }
  }

  // 1. Download tracking via PerformanceObserver
  try {
    const po = new PerformanceObserver((list) => {
      let totalRx = 0;
      for (const entry of list.getEntries()) {
        if (entry.transferSize) totalRx += entry.transferSize;
      }
      if (totalRx > 0) addUsage('rx', totalRx);
    });
    po.observe({ type: 'resource', buffered: true });
  } catch (e) {
    console.warn('PerformanceObserver is not supported', e);
  }

  // 2. Upload tracking and Fetch interception
  const origFetch = window.fetch;
  window.fetch = async function(...args) {
    const u = getUsage();
    if (u.rx > LIMIT_BYTES || u.tx > LIMIT_BYTES) {
      throw new Error("Tarmoq limiti (49MB/min) oshib ketdi. Iltimos kuting.");
    }
    
    const opts = args[1] || {};
    let txBytes = 0;
    
    if (opts.body) {
      if (opts.body instanceof File || opts.body instanceof Blob) {
        txBytes = opts.body.size;
      } else if (typeof opts.body === 'string') {
        txBytes = opts.body.length;
      } else if (opts.body instanceof FormData) {
        let fdSize = 0;
        for (let [key, val] of opts.body.entries()) {
          fdSize += key.length;
          if (val instanceof File || val instanceof Blob) fdSize += val.size;
          else fdSize += String(val).length;
        }
        txBytes = fdSize;
      } else if (opts.body.byteLength) {
        txBytes = opts.body.byteLength;
      }
    }
    
    if (txBytes > 0) {
      if (txBytes > LIMIT_BYTES) {
        throw new Error("Bitta urinishda 49MB dan ortiq ma'lumot yuborish taqiqlanadi.");
      }
      addUsage('tx', txBytes);
    }

    return origFetch.apply(this, args);
  };

  checkLimit();
}
