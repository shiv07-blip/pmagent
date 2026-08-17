import { ENV } from '../env.js';

export interface NotifyRequest {
  kind: 'oncall_escalation' | 'pm_alert' | 'resident_sms' | 'resident_email';
  to: string; // phone (E.164) or email
  body: string;
  subject?: string;
}

export interface NotifyResult {
  ok: boolean;
  provider: string;
  detail?: string;
}

export async function notify(req: NotifyRequest): Promise<NotifyResult> {
  const provider = ENV.NOTIFY_PROVIDER;
  switch (provider) {
    case 'twilio':
      return notifyTwilio(req);
    case 'msg91':
      return notifyMsg91(req);
    case 'telegram':
      return notifyTelegram(req);
    case 'smtp':
    case 'http':
      return notifyHttp(req);
    case 'console':
    default:
      return notifyConsole(req);
  }
}

function notifyConsole(req: NotifyRequest): NotifyResult {
  console.log(`[notify:console] ${req.kind} → ${req.to}: ${req.subject ? `${req.subject} | ` : ''}${req.body.slice(0, 200)}`);
  return { ok: true, provider: 'console' };
}

async function notifyTwilio(req: NotifyRequest): Promise<NotifyResult> {
  const sid = ENV.TWILIO_ACCOUNT_SID;
  const token = ENV.TWILIO_AUTH_TOKEN;
  const from = ENV.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) {
    return notifyConsole(req);
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const body = new URLSearchParams({ From: from, To: req.to, Body: req.body });
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { ok: false, provider: 'twilio', detail: `HTTP ${res.status}` };
    return { ok: true, provider: 'twilio' };
  } catch (err) {
    return { ok: false, provider: 'twilio', detail: String(err) };
  }
}

async function notifyHttp(req: NotifyRequest): Promise<NotifyResult> {
  const url = ENV.NOTIFY_HTTP_URL;
  if (!url) return notifyConsole(req);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: req.to, subject: req.subject, body: req.body, kind: req.kind }),
      signal: AbortSignal.timeout(15_000),
    });
    return { ok: res.ok, provider: 'http', detail: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, provider: 'http', detail: String(err) };
  }
}

async function notifyMsg91(req: NotifyRequest): Promise<NotifyResult> {
  const authkey = process.env.MSG91_AUTHKEY;
  const sender = process.env.MSG91_SENDER_ID ?? 'PMAENT';
  if (!authkey) return notifyConsole(req);

  const toNumber = req.to.replace(/^\+/, '');
  const url = `https://api.msg91.com/api/sendsms.php?authkey=${authkey}&mobiles=${toNumber}&message=${encodeURIComponent(req.body)}&sender=${sender}&route=4&response=json`;

  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json() as { type?: string; message?: string };
    if (data.type === 'success') return { ok: true, provider: 'msg91' };
    return { ok: false, provider: 'msg91', detail: data.message ?? JSON.stringify(data) };
  } catch (err) {
    return { ok: false, provider: 'msg91', detail: String(err) };
  }
}

async function notifyTelegram(req: NotifyRequest): Promise<NotifyResult> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return notifyConsole(req);

  // req.to contains "tg:CHAT_ID" — extract the numeric chat ID
  const chatIdStr = req.to.startsWith('tg:') ? req.to.slice(3) : req.to;
  const chatId = parseInt(chatIdStr, 10);
  if (isNaN(chatId)) return { ok: false, provider: 'telegram', detail: `Invalid chat ID: ${req.to}` };

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: req.body,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json() as { ok: boolean; description?: string };
    if (data.ok) return { ok: true, provider: 'telegram' };
    return { ok: false, provider: 'telegram', detail: data.description ?? 'Unknown error' };
  } catch (err) {
    return { ok: false, provider: 'telegram', detail: String(err) };
  }
}
