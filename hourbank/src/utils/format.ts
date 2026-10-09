export function formatHours(h: number): string {
  // 1.5 → "1h 30m", 0.5 → "30m", 7 → "7h", 0.083 → "5m"
  if (h < 0) return `-${formatHours(-h)}`;
  const totalMinutes = Math.round(h * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

export function formatRand(amount: number): string {
  // 5500 → "R 5,500.00"
  return `R ${amount.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatDuration(totalSeconds: number): string {
  // 4523 → "01:15:23"
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map(n => String(n).padStart(2, '0')).join(':');
}

export function formatLedgerDate(isoDate: string): { day: string; month: string } {
  const d = new Date(isoDate);
  const day = String(d.getDate()).padStart(2, '0');
  const month = d.toLocaleString('en-ZA', { month: 'short' }).toUpperCase();
  return { day, month };
}

export function formatScheduledTime(isoDate: string): string {
  // "Thu 8 May · 15:00"
  const d = new Date(isoDate);
  const dow = d.toLocaleString('en-ZA', { weekday: 'short' });
  const day = d.getDate();
  const mon = d.toLocaleString('en-ZA', { month: 'short' });
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${dow} ${day} ${mon} · ${hh}:${mm}`;
}

export function formatHoursDisplay(h: number): { integer: string; decimal: string } {
  // For the balance hero display: 7.5 → { integer: '7', decimal: '.5' }
  const fixed = h.toFixed(1);
  const [int, dec] = fixed.split('.');
  return { integer: int, decimal: `.${dec}` };
}

export function formatBilledDuration(seconds: number): string {
  return formatHours(seconds / 3600);
}

export function pluralize(count: number, singular: string, plural?: string): string {
  // 1 → "lesson", 2 → "lessons"
  return count === 1 ? singular : (plural ?? `${singular}s`);
}
