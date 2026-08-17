/** Money is integer minor units (cents) everywhere; no floats in storage. */

export function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}

export function fromCents(cents: number | null | undefined): number | null {
  return cents == null ? null : cents / 100;
}

export function formatCents(cents: number | null | undefined): string {
  if (cents == null) return '—';
  return `$${(cents / 100).toFixed(2)}`;
}
