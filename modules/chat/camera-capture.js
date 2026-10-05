/* camera-capture.js — chatda kamera bilan rasmga olish (attach-menyudagi "Kamera").
   DM va guruh uchun bitta. Ruxsat har safar yangidan so'raladi (camera-access.js qoidasi). */
import { toast } from '../ui/toast.js';
import { hasCameraDevice, cameraErrorMsg } from './camera-access.js';

let _open = false;

const X_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const FLIP_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 7h-3l-1.5-2h-7L7 7H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1z"/><path d="M9.5 13.5a2.8 2.8 0 0 1 4.7-1.6M14.5 12.5a2.8 2.8 0 0 1-4.7 1.6"/></svg>';

function _getStream(facing) {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 1280 } },
  });
}

/** Kamerani ochadi. Rasm olinsa File (image/jpeg), bekor qilinsa/xato bo'lsa null qaytaradi. */
export async function openCameraCapture() {
  if (_open) return null;
  _open = true;
  let stream = null, facing = 'user';
  try {
    if (!navigator.mediaDevices?.getUserMedia) { toast('Kamera bu brauzerda mavjud emas', 'error'); return null; }
    try { stream = await _getStream(facing); }
    catch (err) { console.error('Kamera xatosi:', err); toast(cameraErrorMsg(err), 'error'); return null; }

    const multi = (await navigator.mediaDevices.enumerateDevices().catch(() => [])).filter(x => x.kind === 'videoinput').length > 1;
    const ov = document.createElement('div');
    ov.id = 'camCapture';
    ov.innerHTML = `<video class="cc-video" autoplay muted playsinline></video>
      <button type="button" class="cc-btn cc-close" aria-label="Yopish">${X_SVG}</button>
      ${multi ? `<button type="button" class="cc-btn cc-flip" aria-label="Kamerani almashtirish">${FLIP_SVG}</button>` : ''}
      <button type="button" class="cc-shutter" aria-label="Rasmga olish"><span></span></button>`;
    document.body.appendChild(ov);
    const video = ov.querySelector('video');
    const setStream = s => { stream = s; video.srcObject = s; video.classList.toggle('mirror', facing === 'user'); video.play().catch(() => {}); };
    setStream(stream);

    return await new Promise(resolve => {
      const done = file => {
        document.removeEventListener('keydown', onKey, true);
        try { stream?.getTracks().forEach(t => t.stop()); } catch (_) {}
        stream = null; video.srcObject = null; ov.remove();
        resolve(file || null);
      };
      const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } };
      document.addEventListener('keydown', onKey, true);
      ov.querySelector('.cc-close').onclick = () => done(null);
      ov.querySelector('.cc-flip')?.addEventListener('click', async () => {
        const next = facing === 'user' ? 'environment' : 'user';
        try {
          const s = await _getStream(next);
          stream?.getTracks().forEach(t => t.stop());
          facing = next; setStream(s);
        } catch (err) { toast(cameraErrorMsg(err), 'error'); }
      });
      ov.querySelector('.cc-shutter').onclick = () => {
        const w = video.videoWidth, h = video.videoHeight;
        if (!w || !h) return;
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(video, 0, 0, w, h);
        c.toBlob(b => done(b ? new File([b], `photo_${Date.now()}.jpg`, { type: 'image/jpeg' }) : null), 'image/jpeg', 0.9);
      };
    });
  } finally { _open = false; }
}

export { hasCameraDevice };
