/** File type icons — feed + chat shared */
export function getFileIcon(name, mime) {
  const n = (name || '').toLowerCase();
  const m = (mime || '').toLowerCase();
  if (m.startsWith('image/') || /\.(jpe?g|png|gif|webp|heic)$/i.test(n)) {
    return '<img src="./svg/extra/icon-2875c154aeb6.svg" alt="" class="icon" width="20" height="20">';
  }
  return '<img src="./svg/extra/icon-e3ece82ff84d.svg" alt="" class="icon" width="20" height="20">';
}

/** Chat alias */
export function getChatFileIcon(name, mime) {
  return getFileIcon(name, mime);
}
