import { eq } from 'drizzle-orm';
import type { NotifyKind } from '@pma/core';
import { maintenanceRequests, workerDb } from '@pma/db';
import { ENV } from '../env.js';

export interface OutboundOptions {
  /** resident phone (E.164) — used when the source channel is sms */
  phone?: string;
  /** resident email — used when the source channel is email */
  email?: string;
  /** enqueue a notify job (handled by handler/notify.ts → notify providers) */
  enqueueNotify: (kind: NotifyKind, payload: Record<string, unknown>) => Promise<void>;
}

/**
 * Delivers an AI/system reply back to the resident over the channel the
 * request arrived on. SMS and email go through the notify queue (so the
 * configured NOTIFY_PROVIDER applies, with retry semantics); Telegram is sent
 * directly via the bot API so bots respond in real time.
 */
export async function sendResidentMessage(
  requestId: string,
  body: string,
  opts: OutboundOptions,
): Promise<void> {
  const db = workerDb();
  const [req] = await db
    .select({ source: maintenanceRequests.source, channelThreadId: maintenanceRequests.channelThreadId })
    .from(maintenanceRequests)
    .where(eq(maintenanceRequests.id, requestId));
  if (!req) return;

  switch (req.source) {
    case 'telegram': {
      const chatIdStr = req.channelThreadId?.replace(/^tg:/, '') ?? '';
      const chatId = parseInt(chatIdStr, 10);
      if (isNaN(chatId)) break;
      const botToken = ENV.TELEGRAM_BOT_TOKEN;
      if (!botToken) break;
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
      break;
    }
    case 'sms':
      if (opts.phone) {
        await opts.enqueueNotify('resident_sms', { to: opts.phone, body });
      }
      break;
    case 'email':
      if (opts.email) {
        await opts.enqueueNotify('resident_email', {
          to: opts.email,
          subject: 'Update on your maintenance request',
          body,
        });
      }
      break;
    case 'portal':
    case 'voice':
    default:
      break;
  }
}