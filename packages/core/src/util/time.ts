export function nowIso(): string {
  return new Date().toISOString();
}

/** Age in minutes between two ISO strings. */
export function minutesBetween(fromIso: string, toIso = new Date().toISOString()): number {
  return (new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60_000;
}

export function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}
