export function roundToBilledMinutes(seconds: number): number {
  return Math.round(seconds / 60 / 30) * 30;
}
