import fs from 'fs';

let utils = fs.readFileSync('modules/core/utils.js', 'utf8');

// 1. We need to replace the entire renderMarkdown function.
// Let's locate it.
const start = utils.indexOf('export function renderMarkdown(rawText) {');
const nextExport = utils.indexOf('\nexport', start + 10);
const end = utils.lastIndexOf('}', nextExport > -1 ? nextExport : utils.length) + 1;

let newFn = `export function renderMarkdown(rawText) {
  if (!rawText) return '';
  let s = esc(String(rawText));

  // 1. Code blocks (Multi-line) with Copy Button
  const codeBlocks = [];
  s = s.replace(/\`\`\`([a-z0-9]*)\\n([\\s\\S]*?)\`\`\`/gi, (_m, lang, code) => {
    const safeCode = code.trim();
    const idx = codeBlocks.push(
      '<div class="md-code-wrapper">' +
        '<div class="md-code-header">' +
          '<span class="md-code-lang">' + (lang || 'code') + '</span>' +
          '<button class="md-code-copy" onclick="navigator.clipboard.writeText(this.parentElement.nextElementSibling.innerText); const t=this.innerText; this.innerText=\\'Copied!\\'; setTimeout(()=>this.innerText=t,2000)">Copy</button>' +
        '</div>' +
        '<pre class="md-codeblock"><code class="language-' + (lang || 'none') + '">' + safeCode + '</code></pre>' +
      '</div>'
    ) - 1;
    return '\\u0000CB' + idx + '\\u0000';
  });

  // 2. Inline Code
  const inlineCodes = [];
  s = s.replace(/\`([^\`\\n]+)\`/g, (_m, code) => {
    const idx = inlineCodes.push('<code class="md-code">' + code + '</code>') - 1;
    return '\\u0000IC' + idx + '\\u0000';
  });

  // 3. Spoilers ||text||
  s = s.replace(/\\|\\|([\\s\\S]*?)\\|\\|/g, '<span class="md-spoiler" onclick="this.classList.toggle(\\'revealed\\')">$1</span>');

  // 4. Standard Links [text](url)
  s = s.replace(/\\[([^\\]\\n]+)\\]\\((https?:\\/\\/[^\\s)]+|mailto:[^\\s)]+?)(?:\\s+"[^"]*")?\\)/g,
    '<a href="$2" class="md-link" target="_blank" rel="noopener noreferrer">$1</a>');

  // 5. Auto-Links https://... (skip if inside an HTML tag, but s is currently raw escaped text)
  // Since we already parsed standard links, they are now <a href="...">...</a>.
  // We need to auto-link remaining URLs without touching existing <a> tags.
  // A safe way is to split by HTML tags, but since we are doing simple regex:
  // Instead of a complex regex, we can replace raw URLs that are not preceded by '="' or '>'
  // Let's use a trick: temporarily stash HTML tags.
  const htmlTags = [];
  s = s.replace(/<[^>]+>/g, m => {
    const idx = htmlTags.push(m) - 1;
    return '\\u0000TG' + idx + '\\u0000';
  });

  s = s.replace(/(https?:\\/\\/[^\\s]+)/g, '<a href="$1" class="md-link" target="_blank" rel="noopener noreferrer">$1</a>');

  // Restore HTML tags
  s = s.replace(/\\u0000TG(\\d+)\\u0000/g, (_m, idx) => htmlTags[parseInt(idx, 10)]);

  // 6. Mentions @username
  // Stash tags again just to be safe so we don't mention inside hrefs.
  const htmlTags2 = [];
  s = s.replace(/<[^>]+>/g, m => {
    const idx = htmlTags2.push(m) - 1;
    return '\\u0000TH' + idx + '\\u0000';
  });

  s = s.replace(/(^|\\s)@([a-zA-Z0-9_.]+)(?=\\s|[.,!?]|$)/g, '$1<span class="md-mention" onclick="window.dispatchEvent(new CustomEvent(\\'open-mention\\', {detail: \\'$2\\'}))">@$2</span>');

  s = s.replace(/\\u0000TH(\\d+)\\u0000/g, (_m, idx) => htmlTags2[parseInt(idx, 10)]);

  // 7. Headings
  s = s.replace(/^[ \\t]*###\\s+(.+)$/gm, '<div class="md-h3">$1</div>');
  s = s.replace(/^[ \\t]*##\\s+(.+)$/gm,  '<div class="md-h2">$1</div>');
  s = s.replace(/^[ \\t]*#\\s+(.+)$/gm,   '<div class="md-h1">$1</div>');

  // 8. Blockquotes
  s = s.replace(/^[ \\t]*&gt;\\s?(.+)$/gm, '<div class="md-quote">$1</div>');

  // 9. Checklists and Lists
  // Numbered list
  s = s.replace(/^([ \\t]*)(\\d+)\\.\\s+(.+)$/gm, (_m, indent, num, txt) => {
    const depth = Math.floor(indent.replace(/\\t/g, '  ').length / 2);
    return '<div class="md-li md-li-ol" style="padding-left:' + (2 + depth * 16) + 'px">' + num + '. ' + txt + '</div>';
  });
  // Checklists (must precede bullet list)
  s = s.replace(/^([ \\t]*)[-*]\\s+\\[([ xX])\\]\\s+(.+)$/gm, (_m, indent, checked, txt) => {
    const depth = Math.floor(indent.replace(/\\t/g, '  ').length / 2);
    const isChecked = checked.toLowerCase() === 'x';
    return '<div class="md-li md-task-list" style="padding-left:' + (2 + depth * 16) + 'px">' +
      '<input type="checkbox" disabled ' + (isChecked ? 'checked' : '') + ' class="md-task-checkbox"> ' + txt + '</div>';
  });
  // Bullet lists
  s = s.replace(/^([ \\t]*)[-*]\\s+(.+)$/gm, (_m, indent, txt) => {
    const depth = Math.floor(indent.replace(/\\t/g, '  ').length / 2);
    return '<div class="md-li" style="padding-left:' + (2 + depth * 16) + 'px">• ' + txt + '</div>';
  });

  // 10. Tables
  // A simple table parser: lines containing '|'
  // But doing this with regex is hard. Let's do a basic multiline regex for contiguous table rows.
  // For now, if we match `^\\|.*?\\|$` multiline.
  const tables = [];
  s = s.replace(/(?:^[ \t]*\|.*\|[ \t]*\n)+^[ \t]*\|.*\|[ \t]*/gm, (match) => {
    let rows = match.trim().split('\\n');
    let html = '<div class="md-table-wrap"><table class="md-table">';
    let hasHeader = false;
    rows.forEach((row, i) => {
      // Ignore separator line like |---|---|
      if (row.match(/^\\|?[ \\t:-]+\\|[ \\t:-|]+$/)) {
        hasHeader = true;
        return;
      }
      const tag = (i === 0 && rows.length > 1 && rows[1].match(/^\\|?[ \\t:-]+\\|[ \\t:-|]+$/)) ? 'th' : 'td';
      let cols = row.trim().replace(/^\\||\\|$/g, '').split('|');
      html += '<tr>' + cols.map(c => '<' + tag + '>' + c.trim() + '</' + tag + '>').join('') + '</tr>';
    });
    html += '</table></div>';
    const idx = tables.push(html) - 1;
    return '\\u0000TB' + idx + '\\u0000';
  });


  // 11. Strikethrough, Bold, Italic
  s = s.replace(/~~([^~\\n]+)~~/g, '<del class="md-del">$1</del>');
  s = s.replace(/\\*\\*([^*\\n]+)\\*\\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_\\n]+)__/g, '<strong>$1</strong>');
  s = s.replace(/\\*([^*\\n]+)\\*/g, '<em>$1</em>');
  s = s.replace(/(^|[^\\w])_([^_\\n]+)_(?!\\w)/g, '$1<em>$2</em>');

  // 12. Line breaks
  s = s.replace(/\\n/g, '<br>');

  // 13. Restore Placeholders
  s = s.replace(/\\u0000TB(\\d+)\\u0000/g, (_m, idx) => tables[parseInt(idx, 10)]);
  s = s.replace(/\\u0000IC(\\d+)\\u0000/g, (_m, idx) => inlineCodes[parseInt(idx, 10)]);
  s = s.replace(/\\u0000CB(\\d+)\\u0000/g, (_m, idx) => codeBlocks[parseInt(idx, 10)]);

  return s;
}`;

utils = utils.substring(0, start) + newFn + utils.substring(end);
fs.writeFileSync('modules/core/utils.js', utils);
