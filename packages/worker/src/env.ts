import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  WORKER_DATABASE_URL: z.string(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  LLM_PROVIDER: z.enum(['anthropic', 'openai', 'mock']).default('mock'),
  LLM_MODEL: z.string().default('claude-sonnet-4-20250514'),
  LLM_TENANT_MONTHLY_BUDGET_USD: z.coerce.number().default(100),
  NOTIFY_PROVIDER: z.enum(['console', 'twilio', 'smtp', 'http', 'msg91', 'telegram']).default('console'),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),
  NOTIFY_HTTP_URL: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  AGENT_CONCURRENCY: z.coerce.number().int().min(1).default(8),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues
      .filter((i) => i.code === 'invalid_type')
      .map((i) => i.path.join('.'));
    throw new Error(`Invalid environment: missing ${missing.join(', ')}`);
  }
  return parsed.data;
}

export let ENV: Env;

export function initEnv(): Env {
  ENV = loadEnv();
  return ENV;
}
