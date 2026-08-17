const TELEGRAM_API = 'https://api.telegram.org';

export interface SendTelegramResult {
  ok: boolean;
  detail?: string;
}

export async function sendTelegramMessage(
  botToken: string,
  chatId: number,
  text: string,
): Promise<SendTelegramResult> {
  const url = `${TELEGRAM_API}/bot${botToken}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json() as { ok: boolean; description?: string };
    if (data.ok) return { ok: true };
    return { ok: false, detail: data.description ?? 'Unknown error' };
  } catch (err) {
    return { ok: false, detail: String(err) };
  }
}

export async function setTelegramWebhook(
  botToken: string,
  webhookUrl: string,
): Promise<SendTelegramResult> {
  const url = `${TELEGRAM_API}/bot${botToken}/setWebhook`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: webhookUrl }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json() as { ok: boolean; description?: string };
    if (data.ok) return { ok: true };
    return { ok: false, detail: data.description ?? 'Unknown error' };
  } catch (err) {
    return { ok: false, detail: String(err) };
  }
}
