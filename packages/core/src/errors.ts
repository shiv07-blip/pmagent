/**
 * Error hierarchy. Every error carries an `httpStatus` so API boundaries and
 * queue retry logic can react consistently without coupling to transport.
 */

export type ErrorCode =
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'TENANT_BUDGET_EXCEEDED'
  | 'UPSTREAM_TIMEOUT'
  | 'INTERNAL';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details?: unknown;
  /** transient errors are safe to retry (queue backoff); permanent are not */
  readonly retryable: boolean;

  constructor(opts: {
    code: ErrorCode;
    message: string;
    httpStatus?: number;
    details?: unknown;
    retryable?: boolean;
    cause?: unknown;
  }) {
    super(opts.message, opts.cause ? { cause: opts.cause } : undefined);
    this.name = 'AppError';
    this.code = opts.code;
    this.httpStatus = opts.httpStatus ?? 500;
    this.details = opts.details;
    this.retryable = opts.retryable ?? false;
  }
}

export const notFound = (msg: string, details?: unknown) =>
  new AppError({ code: 'NOT_FOUND', message: msg, httpStatus: 404, details });

export const unauthorized = (msg = 'Unauthorized') =>
  new AppError({ code: 'UNAUTHORIZED', message: msg, httpStatus: 401 });

export const forbidden = (msg = 'Forbidden') =>
  new AppError({ code: 'FORBIDDEN', message: msg, httpStatus: 403 });

export const validation = (msg: string, details?: unknown) =>
  new AppError({ code: 'VALIDATION', message: msg, httpStatus: 400, details });

export const conflict = (msg: string, details?: unknown) =>
  new AppError({ code: 'CONFLICT', message: msg, httpStatus: 409, details });

export const rateLimited = (msg = 'Rate limited') =>
  new AppError({ code: 'RATE_LIMITED', message: msg, httpStatus: 429 });

export const tenantBudgetExceeded = (msg = 'Tenant LLM budget exceeded') =>
  new AppError({ code: 'TENANT_BUDGET_EXCEEDED', message: msg, httpStatus: 429 });

/** Wraps an upstream transient failure (LLM timeout, provider 5xx) for retry logic. */
export const upstreamTimeout = (msg: string, cause?: unknown) =>
  new AppError({
    code: 'UPSTREAM_TIMEOUT',
    message: msg,
    httpStatus: 502,
    retryable: true,
    cause,
  });

export const internal = (msg = 'Internal error', cause?: unknown) =>
  new AppError({ code: 'INTERNAL', message: msg, httpStatus: 500, cause });

/** Returns a stable retry decision for queue jobs. */
export function isRetryable(err: unknown): boolean {
  if (err instanceof AppError) return err.retryable;
  return true; // unknown errors are treated as transient
}
