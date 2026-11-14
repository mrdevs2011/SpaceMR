/* poll-dialog.js — Telegram uslubidagi So‘rovnoma (Poll) yaratish modal oynasi */
import { toast } from './toast.js';

let _activePollModal = null;

export function closePollModal() {
  if (_activePollModal) {
    _activePollModal.remove();
    _activePollModal = null;
  }
}

/**
 * So‘rovnoma yaratish dialogini ochadi
 * @param {(pollData: { question: string, options: string[], anonymous: boolean, multiple: boolean }) => void} onSubmit
 */
export function openPollModal(onSubmit) {
  closePollModal();

  const overlay = document.createElement('div');
  overlay.className = 'poll-modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  overlay.innerHTML = `
    <div class="poll-modal-card">
      <div class="poll-modal-header">
        <h3 class="poll-modal-title">Yangi so‘rovnoma</h3>
        <button type="button" class="poll-modal-close" aria-label="Yopish">✕</button>
      </div>

      <div class="poll-modal-body">
        <div class="poll-field-group">
          <label class="poll-field-label" for="pollQuestionInput">Savol</label>
          <textarea id="pollQuestionInput" class="poll-text-input" placeholder="Savol bering..." rows="2" maxlength="255"></textarea>
        </div>

        <div class="poll-field-group">
          <label class="poll-field-label">Variantlar</label>
          <div id="pollOptionsContainer" class="poll-options-container">
            <div class="poll-option-row">
              <input type="text" class="poll-opt-input" placeholder="1-variant" maxlength="100">
            </div>
            <div class="poll-option-row">
              <input type="text" class="poll-opt-input" placeholder="2-variant" maxlength="100">
            </div>
          </div>
          <button type="button" id="pollAddOptionBtn" class="poll-add-opt-btn">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
            <span>Variant qo‘shish</span>
          </button>
        </div>

        <div class="poll-settings-group">
          <label class="poll-toggle-row">
            <span class="poll-toggle-label">
              <b>Anonim ovoz berish</b>
              <small>Hech kim kim ovoz berganini ko‘ra olmaydi</small>
            </span>
            <input type="checkbox" id="pollAnonCheckbox" class="poll-switch-input" checked>
            <span class="poll-switch-slider"></span>
          </label>

          <label class="poll-toggle-row">
            <span class="poll-toggle-label">
              <b>Bir nechta javob</b>
              <small>Foydalanuvchilar bir nechta variant tanlay oladi</small>
            </span>
            <input type="checkbox" id="pollMultiCheckbox" class="poll-switch-input">
            <span class="poll-switch-slider"></span>
          </label>
        </div>
      </div>

      <div class="poll-modal-footer">
        <button type="button" class="poll-btn poll-btn-cancel">Bekor qilish</button>
        <button type="button" class="poll-btn poll-btn-create">Yaratish</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  _activePollModal = overlay;

  const qInp = overlay.querySelector('#pollQuestionInput');
  const optContainer = overlay.querySelector('#pollOptionsContainer');
  const addBtn = overlay.querySelector('#pollAddOptionBtn');
  const anonChk = overlay.querySelector('#pollAnonCheckbox');
  const multiChk = overlay.querySelector('#pollMultiCheckbox');
  const closeBtn = overlay.querySelector('.poll-modal-close');
  const cancelBtn = overlay.querySelector('.poll-btn-cancel');
  const createBtn = overlay.querySelector('.poll-btn-create');

  setTimeout(() => qInp?.focus(), 50);

  function updateRemoveButtons() {
    const rows = optContainer.querySelectorAll('.poll-option-row');
    rows.forEach((row, idx) => {
      let rm = row.querySelector('.poll-opt-remove');
      if (rows.length > 2) {
        if (!rm) {
          rm = document.createElement('button');
          rm.type = 'button';
          rm.className = 'poll-opt-remove';
          rm.setAttribute('aria-label', 'Variantni o‘chirish');
          rm.innerHTML = '✕';
          rm.onclick = () => {
            row.remove();
            updateRemoveButtons();
          };
          row.appendChild(rm);
        }
      } else if (rm) {
        rm.remove();
      }
    });
    if (rows.length >= 10) {
      addBtn.style.display = 'none';
    } else {
      addBtn.style.display = 'inline-flex';
    }
  }

  addBtn.onclick = () => {
    const rows = optContainer.querySelectorAll('.poll-option-row');
    if (rows.length >= 10) {
      toast('Eng ko‘pi bilan 10 ta variant qo‘shish mumkin', 'warning');
      return;
    }
    const nextIdx = rows.length + 1;
    const row = document.createElement('div');
    row.className = 'poll-option-row';
    row.innerHTML = `<input type="text" class="poll-opt-input" placeholder="${nextIdx}-variant" maxlength="100">`;
    optContainer.appendChild(row);
    updateRemoveButtons();
    row.querySelector('input')?.focus();
  };

  function submit() {
    const question = (qInp?.value || '').trim();
    if (!question) {
      toast('Savol matnini kiriting', 'warning');
      qInp?.focus();
      return;
    }

    const optInputs = [...optContainer.querySelectorAll('.poll-opt-input')];
    const options = optInputs.map(i => (i.value || '').trim()).filter(Boolean);

    if (options.length < 2) {
      toast('Kamida 2 ta variant kiriting', 'warning');
      optInputs.find(i => !i.value.trim())?.focus();
      return;
    }

    const anonymous = !!anonChk?.checked;
    const multiple = !!multiChk?.checked;

    closePollModal();
    if (typeof onSubmit === 'function') {
      onSubmit({ question, options, anonymous, multiple });
    }
  }

  createBtn.onclick = submit;
  cancelBtn.onclick = closePollModal;
  closeBtn.onclick = closePollModal;

  overlay.onclick = e => {
    if (e.target === overlay) closePollModal();
  };

  const onKey = e => {
    if (e.key === 'Escape') {
      closePollModal();
      document.removeEventListener('keydown', onKey);
    }
  };
  document.addEventListener('keydown', onKey);
}
