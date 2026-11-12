/**
 * Toast bildirishnomalari — foydalanuvchiga faqat tushunarli, aniq o'zbekcha matn.
 * Texnik tafsilot (Failed to fetch, e.message, SQL) hech qachon ekranga chiqmaydi.
 */
let _toastTimer = null;

const TECHNICAL_PATTERNS = [
  { re: /failed to fetch|networkerror|net::|load failed|err_internet|offline/i, text: "Internet yo'q, qayta urinib ko'ring", type: 'error' },
  { re: /server|503|502|500|timeout|timed out|gateway/i, text: "Server javob bermadi, birozdan keyin urinib ko'ring", type: 'error' },
  { re: /permission|forbidden|401|403|RLS|policy|unauthorized/i, text: "Bu amalga ruxsat yo'q", type: 'error' },
  { re: /null is not an object|undefined is not an object|cannot read properties|typeerror|referenceerror/i, text: "Kutilmagan xatolik yuz berdi", type: 'error' },
];

function _logTech(raw) {
  try {
    import('../core/error-log.js').then(m => m?.logError?.(raw, 'toast')).catch(() => {});
  } catch (_) {}
  try { console.warn('[toast]', raw); } catch (_) {}
}

export function toast(msg, type = 'info', dur = 2400) {
  const raw = String(msg || '').trim();
  if (!raw) return;

  let displayMsg = raw;
  let toastType = type || 'info';

  // Texnik xatolarni inson tushunadigan o'zbekchaga o'giramiz
  const techHit = TECHNICAL_PATTERNS.find(p => p.re.test(raw));
  if (techHit) {
    displayMsg = techHit.text;
    toastType = techHit.type;
    _logTech(raw);
  } else if (toastType === 'error' && /error|exception|fail/i.test(raw) && !/[a-z]'/i.test(raw)) {
    // Faqat inglizcha xom xatolar bo'lsa
    displayMsg = 'Amal bajarilmadi';
    _logTech(raw);
  }

  const el = document.getElementById('toast');
  if (!el) {
    console.warn('[toast]', raw);
    return;
  }
  el.textContent = displayMsg;
  el.className = `toast-${toastType} show`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    el.classList.remove('show');
  }, Math.max(800, dur | 0));
}
