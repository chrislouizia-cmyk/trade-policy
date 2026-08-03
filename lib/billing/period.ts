export function getMonthlyPeriodStartKey(date: Date = new Date()): string {
  const start = new Date(date);
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  return start.toISOString().slice(0, 10);
}
