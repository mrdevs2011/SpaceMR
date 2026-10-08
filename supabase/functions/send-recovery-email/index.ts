// SpaceMR — send-recovery-email Edge Function (Multi-provider resilient email pipeline)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import nodemailer from 'npm:nodemailer@6.9.9';

const CORS = {
  'Access-Control-Allow-Origin': 'https://spacemr.vercel.app',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  let body: { username?: string; temp_password?: string } = {};
  try { body = await req.json(); } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { username, temp_password } = body;
  if (!username || !temp_password) {
    return json({ error: 'username and temp_password required' }, 400);
  }

  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // 1. request_password_reset RPC (kod yozadi; uid/email qaytarmaydi — 081)
  const { data: resData, error: resErr } = await admin.rpc('request_password_reset', {
    p_username: username,
    p_temp_password: temp_password,
  });

  if (resErr) {
    return json({ error: resErr.message }, 400);
  }
  if (resData?.error === 'rate_limited') {
    return json({ error: "Juda ko'p urinish. 15 daqiqa kuting." }, 429);
  }
  if (!resData?.ok || resData?.sent === false) {
    // uniform: foydalanuvchi/email yo'q — maxfiy
    return json({ ok: true, masked_email: null, email_sent: false });
  }

  // 2) Email faqat service_role orqali (RPC endi recovery_email qaytarmaydi)
  const uname = String(username).trim().toLowerCase();
  const { data: prof, error: pErr } = await admin
    .from('profiles')
    .select('recovery_email')
    .eq('username', uname)
    .maybeSingle();
  if (pErr || !prof?.recovery_email) {
    return json({ ok: true, masked_email: resData?.masked_email || null, email_sent: false });
  }
  const recoveryEmail = prof.recovery_email as string;
  const maskedEmail = (resData?.masked_email as string) || null;

  const emailSubject = `SpaceMR | Tasdiqlash kodi: ${temp_password}`;
  const logoUrl = 'https://spacemr.vercel.app/svg/SpaceMR-email.png';
  const emailHtml = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:auto;padding:28px 24px;border:1px solid #222222;border-radius:14px;background:#000000;color:#f0f0f0;">
      <table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;">
        <tr>
          <td style="vertical-align:middle;padding-right:12px;">
            <img src="${logoUrl}" alt="MR" width="36" height="36" style="display:block;border-radius:8px;border:1px solid #222;" />
          </td>
          <td style="vertical-align:middle;">
            <span style="font-size:20px;font-weight:700;letter-spacing:-0.4px;color:#ffffff;">SpaceMR</span>
          </td>
        </tr>
      </table>
      <h2 style="color:#ffffff;font-size:17px;font-weight:600;margin:0 0 12px 0;">Hisobingizni tiklash kodi</h2>
      <p style="color:#a8a8a8;font-size:14px;line-height:1.55;margin:0 0 16px 0;">
        Salom, <strong>@${username}</strong>.<br>
        SpaceMR profilingizga kirish uchun bir martalik tasdiqlash kodi:
      </p>
      <div style="margin:18px 0;padding:16px;background:#0d0d0d;border:1px solid #1d9bf0;border-radius:10px;text-align:center;font-size:26px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-weight:700;letter-spacing:5px;color:#1d9bf0;">
        ${temp_password}
      </div>
      <p style="color:#888888;font-size:13px;line-height:1.5;margin:0 0 16px 0;">
        Ushbu kod orqali hisobingizga kiring va yangi shaxsiy parol o'rnating.
      </p>
      <p style="color:#555555;font-size:11.5px;margin:20px 0 0 0;border-top:1px solid #161616;padding-top:12px;line-height:1.4;">
        © SpaceMR • Agar siz buni so'ramagan bo'lsangiz, xatni e'tiborsiz qoldiring.
      </p>
    </div>
  `;

  const emailText = [
    'SpaceMR: Hisobingizni tiklash kodi',
    '',
    `Salom, @${username}.`,
    `SpaceMR profilingizga kirish uchun tasdiqlash kodi: ${temp_password}`,
    '',
    'Ushbu kod orqali hisobingizga kiring va yangi shaxsiy parol o\'rnating.',
    '',
    'Agar siz buni so\'ramagan bo\'lsangiz, xatni e\'tiborsiz qoldiring.',
    '',
    '© SpaceMR — https://spacemr.vercel.app',
  ].join('\n');

  let emailSent = false;
  let sendError: string | null = null;
  let providerUsed: string | null = null;

  // ═══════════════════════════════════════════════════════════════════════
  // 2. KENG VA CHEKLOVSIZ EMAIL QUVURI (Multi-Provider Waterfall)
  // ═══════════════════════════════════════════════════════════════════════

  // 1-Yo'l: Gmail SMTP / Standart SMTP (Kuniga 500-2000 ta email, 100% tekin, provayder blokirovkasisiz)
  const smtpUser = Deno.env.get('SMTP_USER');
  const smtpPass = Deno.env.get('SMTP_PASS');
  const smtpHost = Deno.env.get('SMTP_HOST') || (smtpUser?.includes('@gmail.com') ? 'smtp.gmail.com' : '');

  if (!emailSent && smtpHost && smtpUser && smtpPass) {
    const isGmail = smtpHost.includes('gmail.com');
    const customPort = Deno.env.get('SMTP_PORT');
    const portsToTry = customPort ? [Number(customPort)] : (isGmail ? [465, 587] : [587, 465]);

    for (const port of portsToTry) {
      if (emailSent) break;
      try {
        const isSecure = port === 465;
        const transporter = nodemailer.createTransport({
          host: smtpHost,
          port,
          secure: isSecure,
          auth: {
            user: smtpUser.trim(),
            pass: smtpPass.replace(/\s+/g, ''), // Google 16 xonali app password bo'shliqlarini olib tashlash
          },
          connectionTimeout: 10000,
          greetingTimeout: 10000,
          socketTimeout: 15000,
        });

        const senderFrom = Deno.env.get('SMTP_FROM') || `"SpaceMR" <${smtpUser.trim()}>`;
        await transporter.sendMail({
          from: senderFrom,
          replyTo: senderFrom,
          to: recoveryEmail,
          subject: emailSubject,
          text: emailText,
          html: emailHtml,
        });
        emailSent = true;
        providerUsed = `SMTP (${smtpHost}:${port})`;
        console.log(`[send-recovery-email] SMTP (${smtpHost}:${port}) orqali muvaffaqiyatli jo'natildi`);
      } catch (e: any) {
        console.error(`[send-recovery-email] SMTP (${smtpHost}:${port}) xatosi:`, e);
        sendError = `SMTP (${port}): ${e?.message}`;
      }
    }
  }

  // 2-Yo'l: Brevo (Sendinblue) API (Oyiga 9,000 ta, kuniga 300 ta xat bepul)
  const brevoApiKey = Deno.env.get('BREVO_API_KEY');
  if (!emailSent && brevoApiKey) {
    try {
      const senderEmail = Deno.env.get('BREVO_SENDER_EMAIL') || smtpUser || 'mrbir460@gmail.com';
      const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': brevoApiKey.trim(),
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          sender: { name: 'SpaceMR', email: senderEmail },
          replyTo: { name: 'SpaceMR', email: senderEmail },
          to: [{ email: recoveryEmail }],
          subject: emailSubject,
          textContent: emailText,
          htmlContent: emailHtml,
        }),
      });
      if (brevoRes.ok) {
        emailSent = true;
        providerUsed = 'Brevo API';
        console.log('[send-recovery-email] Brevo orqali muvaffaqiyatli jo\'natildi');
      } else {
        const bErr = await brevoRes.json().catch(() => null);
        console.error('[send-recovery-email] Brevo xatosi:', brevoRes.status, bErr);
        sendError = `Brevo: ${bErr?.message || brevoRes.statusText}`;
      }
    } catch (e: any) {
      console.error('[send-recovery-email] Brevo exception:', e);
      sendError = `Brevo: ${e?.message}`;
    }
  }

  // 3-Yo'l: Resend API (Oyiga 3,000 ta xat bepul)
  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  if (!emailSent && resendApiKey) {
    try {
      const fromAddr = Deno.env.get('RESEND_FROM') || 'SpaceMR <onboarding@resend.dev>';
      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey.trim()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromAddr,
          to: recoveryEmail,
          subject: emailSubject,
          text: emailText,
          html: emailHtml,
        }),
      });
      if (emailRes.ok) {
        emailSent = true;
        providerUsed = 'Resend API';
        console.log('[send-recovery-email] Resend orqali muvaffaqiyatli jo\'natildi');
      } else {
        const errJson = await emailRes.json().catch(() => null);
        console.error('[send-recovery-email] Resend xatosi:', emailRes.status, errJson);
        sendError = `Resend: ${errJson?.message || emailRes.statusText}`;
      }
    } catch (e: any) {
      console.error('[send-recovery-email] Resend exception:', e);
      sendError = `Resend: ${e?.message}`;
    }
  }

  // 3. Javob qaytarish
  return json({
    ok: true,
    masked_email: maskedEmail,
    email_sent: emailSent,
    provider: providerUsed,
    error_detail: emailSent ? null : (sendError || 'Email provayder kaliti sozlanmagan'),
  });
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
