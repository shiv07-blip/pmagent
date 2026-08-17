import { eq } from 'drizzle-orm';
import { maintenanceRequests, workerDb } from '@pma/db';
import { ENV } from '../env.js';

export async function sendResidentMessage(
  requestId: string,
  body: string,
): Promise<void> {
  const db = workerDb();
  const [req] = await db
    .select({ source: maintenanceRequests.source, channelThreadId: maintenanceRequests.channelThreadId })
    .from(maintenanceRequests)
    .where(eq(maintenanceRequests.id, requestId));
  if (!req) return;

  if (req.source === 'telegram' && req.channelThreadId) {
    const chatIdStr = req.channelThreadId.startsWith('tg:')
      ? req.channelThreadId.slice(3)
      : req.channelThreadId;
    const chatId = parseInt(chatIdStr, 10);
    if (isNaN(chatId)) return;

    const botToken = ENV.TELEGRAM_BOT_TOKEN;
    if (!botToken) return;

    try {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: body }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      console.error('[sendResidentMessage] Telegram send failed:', err);
    }
  }
}
