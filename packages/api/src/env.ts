import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  API_PORT: z.coerce.number().default(8080),
  API_HOST: z.string().default('0.0.0.0'),
  PUBLIC_BASE_URL: z.string().default('http://localhost:8080'),
  JWT_SECRET: z.string().min(16),
  JWT_TTL: z.string().default('8h'),
  API_DATABASE_URL: z.string(),
  WORKER_DATABASE_URL: z.string(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  LLM_PROVIDER: z.enum(['anthropic', 'openai', 'mock']).default('mock'),
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
