const fs = require('fs');
let code = fs.readFileSync('modules/core/config.js', 'utf8');
const anon = code.match(/SUPABASE_ANON_KEY = '([^']+)'/)[1];
const url = code.match(/SUPABASE_URL = '([^']+)'/)[1];
console.log(anon.substring(0,10), url);
