const MS_PER_DAY = 24 * 60 * 60 * 1000;

function utcDate(year: number, month: number, day: number): Date {
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDay)));
}

function asUtcDateOnly(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

export function toPeriodKey(date: Date): string {
  return asUtcDateOnly(date).toISOString().slice(0, 10);
}

/**
 * Returns the beginning of the user's current monthly usage cycle.
 *
 * The cycle is anchored to the UTC calendar day of the user's first analysis.
 * Example: first analysis on August 5 -> cycles renew on the 5th of each month.
 * For anchors on days that do not exist in a month (29–31), the cycle renews on
 * that month's final day.
 */
export function getAnchoredMonthlyPeriod(
  anchor: Date,
  now: Date = new Date(),
): { start: Date; end: Date; startKey: string; endKey: string } {
  const anchorDate = asUtcDateOnly(anchor);
  const currentDate = asUtcDateOnly(now);
  const anchorDay = anchorDate.getUTCDate();

  let start = utcDate(
    currentDate.getUTCFullYear(),
    currentDate.getUTCMonth(),
    anchorDay,
  );

  if (start.getTime() > currentDate.getTime()) {
    start = utcDate(
      currentDate.getUTCFullYear(),
      currentDate.getUTCMonth() - 1,
      anchorDay,
    );
  }

  const end = utcDate(
    start.getUTCFullYear(),
    start.getUTCMonth() + 1,
    anchorDay,
  );

  return {
    start,
    end,
    startKey: toPeriodKey(start),
    endKey: toPeriodKey(end),
  };
}

/**
 * Backward-compatible calendar-month helper retained for any callers that still
 * need it. Billing usage should use getAnchoredMonthlyPeriod instead.
 */
export function getMonthlyPeriodStartKey(date: Date = new Date()): string {
  const start = new Date(date);
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  return start.toISOString().slice(0, 10);
}

export function daysUntilPeriodEnd(end: Date, now: Date = new Date()): number {
  return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / MS_PER_DAY));
}
