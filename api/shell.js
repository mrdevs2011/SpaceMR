// Vercel Serverless Function: ilova qobig'i (index.html) — FAQAT tizimga kirgan foydalanuvchiga.
// vercel.json: "/" , "/index.html" va barcha noma'lum yo'llar shu funksiyaga keladi (faqat /login ochiq).
// Brauzer `sp_at` cookie'sida Supabase access_token yuboradi (modules/core/config.js yozadi);
// token Supabase Auth bilan tekshiriladi. Yaroqsiz bo'lsa — server darajasida 302 -> /login
// (HTML umuman berilmaydi, UI ga bog'liq emas).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const COOKIE = 'sp_at';
const OK_MS = 60e3;            // yaroqli token 60 soniya xotirada
const okCache = new Map();     // token -> amal qilish muddati (ms)
let html = null;

function loadHtml() {
  if (html) return html;
  const tries = [join(process.cwd(), 'index.html'), new URL('../index.html', import.meta.url)];
  for (const p of tries) { try { html = readFileSync(p, 'utf8'); return html; } catch (_) {} }
  return null;
}

function readCookie(header, name) {
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

async function isValid(token) {
  if (!token || token.length > 4096) return false;
  const hit = okCache.get(token);
  if (hit && hit > Date.now()) return true;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return false;                       // sozlanmagan = yopiq
  try {
    const r = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: key, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return false;
    if (okCache.size > 500) okCache.clear();
    okCache.set(token, Date.now() + OK_MS);
    return true;
  } catch (_) { return false; }                         // xato = yopiq
}

function safeNext(raw) {
  let p = String(raw || '');
  try { p = decodeURIComponent(p); } catch (_) {}
  if (!/^\/(?!\/)/.test(p) || /^\/(login|api)(\/|$)/i.test(p) || p === '/') return '';
  return p.slice(0, 300);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Cookie');
  const token = readCookie(req.headers.cookie, COOKIE);
  if (await isValid(token)) {
    const page = loadHtml();
    if (!page) return res.status(500).send('shell-missing');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(page);
  }
  const q = new URL(req.url, 'http://x').searchParams.get('p');
  const next = safeNext(q);
  res.setHeader('Location', '/login' + (next ? '?next=' + encodeURIComponent(next) : ''));
  return res.status(302).send('');
}
