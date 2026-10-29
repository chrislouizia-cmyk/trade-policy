export type TradeActivityRow = {
  createdAt: string;
  source: 'SUGGESTED' | 'EXECUTED';
};

export function latestTradeActivity<T extends TradeActivityRow>(
  rows: T[],
  source: TradeActivityRow['source'],
  limit = 3,
): T[] {
  return [...rows]
    .filter((row) => row.source === source)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, limit);
}

export function formatTradeActivityDateTime(
  value: string,
  options: { locale?: string; timeZone?: string } = {},
): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Unknown date';

  return new Intl.DateTimeFormat(options.locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...(options.timeZone ? { timeZone: options.timeZone } : {}),
  }).format(date);
}
