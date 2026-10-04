/** File type icons — feed + chat shared (badge SVGs under ./svg/ui/) */
export function getFileIcon(name = '', mime = '') {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const m   = (mime || '').toLowerCase();
  const img = (file) => `<img src="./svg/ui/${file}" alt="" class="icon" width="48" height="48">`;

  if (m.startsWith('audio') || ['mp3','wav','ogg','aac','flac','m4a','wma','opus','aiff','mid','midi'].includes(ext))
    return img('badge-b6e69f.svg');
  if (['html','htm'].includes(ext) || m === 'text/html')
    return img('badge-f60274.svg');
  if (['ts','tsx'].includes(ext))
    return img('badge-23b1be.svg');
  if (['js','mjs','cjs','jsx'].includes(ext) || m.includes('javascript'))
    return img(ext === 'jsx' ? 'badge-jsx.svg' : 'badge-js.svg');
  if (ext === 'pdf' || m === 'application/pdf')
    return img('badge-24a745.svg');
  if (['zip','rar','7z','tar','gz','bz2','xz','lz','lzma'].includes(ext))
    return img('badge-0df66a.svg');
  if (['doc','docx'].includes(ext) || m.includes('msword') || m.includes('wordprocessingml'))
    return img('badge-565e81.svg');
  if (['xls','xlsx','csv','ods'].includes(ext) || m.includes('spreadsheet') || m.includes('excel') || m === 'text/csv')
    return img('badge-b2c645.svg');
  if (ext === 'py' || m === 'text/x-python')
    return img('badge-1ba5e2.svg');
  if (ext === 'json' || m === 'application/json')
    return img('badge-99c369.svg');
  if (['css','scss','sass','less'].includes(ext))
    return img('badge-e167e6.svg');
  if (['md','mdx'].includes(ext))
    return img('badge-b29dd9.svg');
  if (m.startsWith('video/') || ['mp4','webm','mov','mkv','avi'].includes(ext))
    return img('badge-3e3dc0.svg');
  // default document
  return img('badge-bca863.svg');
}

/** Chat alias */
export function getChatFileIcon(name, mime) {
  return getFileIcon(name, mime);
}
