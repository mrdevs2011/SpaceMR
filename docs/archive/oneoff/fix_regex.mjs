import fs from 'fs';

let utils = fs.readFileSync('modules/core/utils.js', 'utf8');
const newFn = fs.readFileSync('renderMarkdown.txt', 'utf8');

const start = utils.indexOf('export function renderMarkdown(rawText) {');
const nextExport = utils.indexOf('\nexport', start + 10);
const end = utils.lastIndexOf('}', nextExport > -1 ? nextExport : utils.length) + 1;

utils = utils.substring(0, start) + newFn + utils.substring(end);
fs.writeFileSync('modules/core/utils.js', utils);
