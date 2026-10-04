import fs from 'fs';

let authCode = fs.readFileSync('modules/auth/auth.js', 'utf8');

authCode = authCode.replace(
  "await Promise.race([Promise.allSettled(tasks), new Promise(r => setTimeout(r, 600))]);",
  "Promise.allSettled(tasks); // Fire and forget! Don't block splash screen."
);

fs.writeFileSync('modules/auth/auth.js', authCode);
