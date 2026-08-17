import type { NotifyJobData } from '@pma/core';
import { notify } from '../notify/index.js';

export async function processNotify(data: NotifyJobData): Promise<void> {
  const p = data.payload;
  switch (data.kind) {
    case 'oncall_escalation':
      await notify({
        kind: data.kind,
        to: String(p.to ?? ''),
        subject: String(p.subject ?? 'URGENT maintenance escalation'),
        body: String(p.reason ?? p.body ?? ''),
      });
      break;
    case 'resident_sms':
      await notify({ kind: data.kind, to: String(p.to), body: String(p.body) });
      break;
    case 'resident_email':
      await notify({ kind: data.kind, to: String(p.to), subject: String(p.subject ?? ''), body: String(p.body) });
      break;
    case 'pm_alert':
      await notify({ kind: data.kind, to: String(p.to ?? ''), subject: String(p.subject ?? ''), body: String(p.body ?? '') });
      break;
  }
}
