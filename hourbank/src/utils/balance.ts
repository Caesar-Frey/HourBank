export type BalanceStatus = 'ok' | 'warn' | 'low' | 'owes';

export function balanceStatus(hours: number): BalanceStatus {
  if (hours < 0) return 'owes';
  if (hours >= 3) return 'ok';
  if (hours >= 1) return 'warn';
  return 'low';
}

export function balanceColour(status: BalanceStatus): string {
  const map: Record<BalanceStatus, string> = {
    ok:   '#3F5641',
    warn: '#B8743F',
    low:  '#9A2A2A',
    owes: '#7A2530',
  };
  return map[status];
}

export function balanceTailwindText(status: BalanceStatus): string {
  const map: Record<BalanceStatus, string> = {
    ok:   'text-moss',
    warn: 'text-amber',
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
