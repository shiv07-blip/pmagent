const MSG91_API = 'https://api.msg91.com/api/v5/flow';
const MSG91_SEND = 'https://api.msg91.com/api/sendsms.php';

export interface Msg91Config {
  authkey: string;
  senderId?: string;
  flowId?: string;
  dltTeId?: string;
  peId?: string;
}

export interface SendSmsResult {
  success: boolean;
  requestId?: string;
  error?: string;
}

export async function sendSms(
  config: Msg91Config,
  to: string,
  message: string,
): Promise<SendSmsResult> {
  const toNumber = to.replace(/^\+/, '');

  if (config.flowId) {
    return sendViaFlow(config, toNumber, message);
  }

  return sendViaSimpleApi(config, toNumber, message);
}

async function sendViaFlow(
  config: Msg91Config,
  toNumber: string,
  message: string,
): Promise<SendSmsResult> {
  const res = await fetch(MSG91_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      authkey: config.authkey,
    },
    body: JSON.stringify({
      flow_id: config.flowId,
      sender: config.senderId ?? 'PMAENT',
      recipients: [{ mobiles: toNumber }],
      var: message,
    }),
  });

  const data = await res.json() as Record<string, unknown>;
  if (data.type === 'success') {
    return { success: true, requestId: data.request_id as string };
  }
  return { success: false, error: JSON.stringify(data) };
}

async function sendViaSimpleApi(
  config: Msg91Config,
  toNumber: string,
  message: string,
): Promise<SendSmsResult> {
  const params = new URLSearchParams({
    authkey: config.authkey,
    mobiles: toNumber,
    message,
    sender: config.senderId ?? 'PMAENT',
    route: '4',
    response: 'json',
  });
  if (config.dltTeId) params.set('DLT_TE_ID', config.dltTeId);
  if (config.peId) params.set('PE_ID', config.peId);

  const res = await fetch(`${MSG91_SEND}?${params.toString()}`, {
    method: 'GET',
  });

  const data = await res.json() as Record<string, unknown>;
  if (data.type === 'success') {
    return { success: true, requestId: data.request_id as string };
  }
  return { success: false, error: JSON.stringify(data) };
}
