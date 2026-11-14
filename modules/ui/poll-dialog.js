/* poll-dialog.js — Telegram uslubidagi So‘rovnoma (Poll) va Viktorina (Quiz) yaratish modal oynasi */
import { toast } from './toast.js';

let _activePollModal = null;

export function closePollModal() {
  if (_activePollModal) {
    _activePollModal.remove();
    _activePollModal = null;
  }
}

/**
 * So‘rovnoma / Viktorina yaratish dialogini ochadi
 * @param {(pollData: { question: string, options: string[], anonymous: boolean, multiple: boolean, isQuiz?: boolean, correctOptionIndex?: number, explanation?: string }) => void} onSubmit
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
              <label class="poll-opt-radio-wrap" style="display:none;" title="To‘g‘ri javob deb belgilash">
                <input type="radio" name="pollCorrectOpt" class="poll-correct-radio" checked>
                <span class="poll-correct-radio-dot"></span>
              </label>
              <input type="text" class="poll-opt-input" placeholder="1-variant" maxlength="100">
            </div>
            <div class="poll-option-row">
              <label class="poll-opt-radio-wrap" style="display:none;" title="To‘g‘ri javob deb belgilash">
                <input type="radio" name="pollCorrectOpt" class="poll-correct-radio">
                <span class="poll-correct-radio-dot"></span>
              </label>
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

          <label class="poll-toggle-row" id="pollMultiToggleRow">
            <span class="poll-toggle-label">
              <b>Bir nechta javob</b>
              <small>Foydalanuvchilar bir nechta variant tanlay oladi</small>
            </span>
            <input type="checkbox" id="pollMultiCheckbox" class="poll-switch-input">
            <span class="poll-switch-slider"></span>
          </label>

          <label class="poll-toggle-row" id="pollQuizToggleRow">
            <span class="poll-toggle-label">
              <b>Viktorina (Quiz) rejimi</b>
              <small>To‘g‘ri javobni belgilash (faqat 1 ta to‘g‘ri javob)</small>
            </span>
            <input type="checkbox" id="pollQuizCheckbox" class="poll-switch-input">
            <span class="poll-switch-slider"></span>
          </label>
        </div>

        <div class="poll-field-group poll-quiz-explanation-group" id="pollExplanationGroup" style="display:none;">
          <label class="poll-field-label" for="pollExplanationInput">Tushuntirish izohi (ixtiyoriy)</label>
          <input type="text" id="pollExplanationInput" class="poll-text-input" placeholder="Noto‘g‘ri javob berilganda chiqadigan izoh..." maxlength="200">
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
  const multiRow = overlay.querySelector('#pollMultiToggleRow');
  const quizChk = overlay.querySelector('#pollQuizCheckbox');
  const expGroup = overlay.querySelector('#pollExplanationGroup');
  const expInp = overlay.querySelector('#pollExplanationInput');
  const closeBtn = overlay.querySelector('.poll-modal-close');
  const cancelBtn = overlay.querySelector('.poll-btn-cancel');
  const createBtn = overlay.querySelector('.poll-btn-create');

  setTimeout(() => qInp?.focus(), 50);

  function syncQuizMode() {
    const isQuiz = !!quizChk?.checked;
    const radioWraps = optContainer.querySelectorAll('.poll-opt-radio-wrap');
    radioWraps.forEach(rw => {
      rw.style.display = isQuiz ? 'inline-flex' : 'none';
    });

    if (isQuiz) {
      if (multiChk) multiChk.checked = false;
      if (multiRow) {
        multiRow.style.opacity = '0.45';
        multiRow.style.pointerEvents = 'none';
      }
      if (expGroup) expGroup.style.display = 'flex';

      // Agar birorta radio tanlanmagan bo'lsa, 1-sini tanlab qo'yish
      const checkedRadio = optContainer.querySelector('.poll-correct-radio:checked');
      if (!checkedRadio) {
        const firstRadio = optContainer.querySelector('.poll-correct-radio');
        if (firstRadio) firstRadio.checked = true;
      }
    } else {
      if (multiRow) {
        multiRow.style.opacity = '';
        multiRow.style.pointerEvents = '';
      }
      if (expGroup) expGroup.style.display = 'none';
    }
  }

  quizChk?.addEventListener('change', syncQuizMode);

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
            syncQuizMode();
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
    const isQuiz = !!quizChk?.checked;
    row.innerHTML = `
      <label class="poll-opt-radio-wrap" style="display:${isQuiz ? 'inline-flex' : 'none'};" title="To‘g‘ri javob deb belgilash">
        <input type="radio" name="pollCorrectOpt" class="poll-correct-radio">
        <span class="poll-correct-radio-dot"></span>
      </label>
      <input type="text" class="poll-opt-input" placeholder="${nextIdx}-variant" maxlength="100">
    `;
    optContainer.appendChild(row);
    updateRemoveButtons();
    row.querySelector('input.poll-opt-input')?.focus();
  };

  function submit() {
    const question = (qInp?.value || '').trim();
    if (!question) {
      toast('Savol matnini kiriting', 'warning');
      qInp?.focus();
      return;
    }

    const rows = [...optContainer.querySelectorAll('.poll-option-row')];
    const options = [];
    let correctOptionIndex = -1;
    const isQuiz = !!quizChk?.checked;

    rows.forEach((row, idx) => {
      const inp = row.querySelector('.poll-opt-input');
      const val = (inp?.value || '').trim();
      if (val) {
        const optIdx = options.length;
        options.push(val);
        const radio = row.querySelector('.poll-correct-radio');
        if (radio && radio.checked) {
          correctOptionIndex = optIdx;
        }
      }
    });

    if (options.length < 2) {
      toast('Kamida 2 ta variant kiriting', 'warning');
      rows.find(r => !r.querySelector('.poll-opt-input')?.value.trim())?.querySelector('.poll-opt-input')?.focus();
      return;
    }

    if (isQuiz && (correctOptionIndex < 0 || correctOptionIndex >= options.length)) {
      toast('Iltimos, bitta to‘g‘ri javobni belgilang (radio tugmani bosing)', 'warning');
      return;
    }

    const anonymous = !!anonChk?.checked;
    const multiple = isQuiz ? false : !!multiChk?.checked;
    const explanation = isQuiz ? (expInp?.value || '').trim() : '';

    closePollModal();
    if (typeof onSubmit === 'function') {
      onSubmit({ question, options, anonymous, multiple, isQuiz, correctOptionIndex, explanation });
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
