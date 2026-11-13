export type BalanceStatus = 'ok' | 'warn' | 'low' | 'owes';

/**
 * Snap an hours value to whole minutes. Ledger rows store `-(billed / 60)` as
 * floats, so a sum that should be 0 can come back as −2.2e-16 ("OWES 0m").
 * Apply at every read boundary that surfaces a balance. Never returns −0.
 */
export function normaliseHours(hours: number): number {
  if (!Number.isFinite(hours)) return 0;
  const r = Math.round(hours * 60) / 60;
  return r === 0 ? 0 : r;
}

export function balanceStatus(rawHours: number): BalanceStatus {
  const hours = normaliseHours(rawHours);
  if (hours < 0) return 'owes';
  if (hours >= 3) return 'ok';
  if (hours >= 1) return 'warn';
  return 'low';
}

export function balanceColour(status: BalanceStatus): string {
  const map: Record<BalanceStatus, string> = {
    ok:   '#3F5641',
    warn: '#96592A', // amberText: balances are text, so use the AA shade
    low:  '#9A2A2A',
    owes: '#7A2530',
  };
  return map[status];
}

export function balanceTailwindText(status: BalanceStatus): string {
  const map: Record<BalanceStatus, string> = {
    ok:   'text-moss',
    warn: 'text-amberText',
    low:  'text-crimson',
    owes: 'text-oxblood',
  };
  return map[status];
}

export function balanceTailwindFill(status: BalanceStatus): string {
  const map: Record<BalanceStatus, string> = {
    ok:   'bg-okFill',
    warn: 'bg-warnFill',
    low:  'bg-badFill',
    owes: 'bg-badFill',
  };
  return map[status];
}
