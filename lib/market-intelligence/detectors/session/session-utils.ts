import type { SessionObservation } from '../../contracts.ts';
import type { ManualSessionComparison, TradingSessionConfig, TradingSessionWindow } from './session-types.ts';

export const DEFAULT_MARKET_SESSIONS: readonly TradingSessionConfig[] = Object.freeze([
  { id: 'sydney', name: 'Sydney', market: 'FOREX', timezone: 'Australia/Sydney', startTime: '08:00', endTime: '17:00', weekdays: [1, 2, 3, 4, 5] },
  { id: 'tokyo', name: 'Tokyo', market: 'FOREX', timezone: 'Asia/Tokyo', startTime: '09:00', endTime: '18:00', weekdays: [1, 2, 3, 4, 5] },
  { id: 'london', name: 'London', market: 'FOREX', timezone: 'Europe/London', startTime: '08:00', endTime: '17:00', weekdays: [1, 2, 3, 4, 5] },
  { id: 'new-york', name: 'New York', market: 'FOREX', timezone: 'America/New_York', startTime: '08:00', endTime: '17:00', weekdays: [1, 2, 3, 4, 5] },
]);

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number };
type ResolvedWindow = TradingSessionWindow & { startMs: number; endMs: number; localWeekday: number };

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timezone: string): Intl.DateTimeFormat {
  let value = formatters.get(timezone);
  if (!value) {
    value = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' });
    formatters.set(timezone, value);
  }
  return value;
}

const weekdayNumbers: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function localParts(atMs: number, timezone: string): LocalParts {
  const values = Object.fromEntries(formatter(timezone).formatToParts(atMs).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day), hour: Number(values.hour), minute: Number(values.minute), second: Number(values.second), weekday: weekdayNumbers[values.weekday] };
}

function utcForLocal(year: number, month: number, day: number, hour: number, minute: number, timezone: string): number {
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  let guess = desired;
  for (let attempt = 0; attempt < 4; attempt++) {
    const actual = localParts(guess, timezone);
    const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    const adjustment = desired - represented;
    guess += adjustment;
    if (adjustment === 0) break;
  }
  return guess;
}

function shiftedDate(parts: LocalParts, days: number): { year: number; month: number; day: number } {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function nextDate(date: { year: number; month: number; day: number }): { year: number; month: number; day: number } {
  const value = new Date(Date.UTC(date.year, date.month - 1, date.day + 1));
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() };
}

function clock(value: string): [number, number] {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) throw new Error(`Invalid session time: ${value}`);
  return [Number(match[1]), Number(match[2])];
}

export function resolveSessionWindows(config: TradingSessionConfig, atMs: number): ResolvedWindow[] {
  const local = localParts(atMs, config.timezone);
  const [startHour, startMinute] = clock(config.startTime);
  const [endHour, endMinute] = clock(config.endTime);
  const crossesMidnight = endHour * 60 + endMinute <= startHour * 60 + startMinute;
  const windows: ResolvedWindow[] = [];
  for (const offset of [-1, 0, 1, 2]) {
    const date = shiftedDate(local, offset);
    const weekday = ((local.weekday - 1 + offset + 7) % 7) + 1;
    if (!config.weekdays.includes(weekday)) continue;
    const endDate = crossesMidnight ? nextDate(date) : date;
    const startMs = utcForLocal(date.year, date.month, date.day, startHour, startMinute, config.timezone);
    const endMs = utcForLocal(endDate.year, endDate.month, endDate.day, endHour, endMinute, config.timezone);
    windows.push({ sessionId: config.id, sessionName: config.name, market: config.market, timezone: config.timezone, startTime: new Date(startMs).toISOString(), endTime: new Date(endMs).toISOString(), startMs, endMs, localWeekday: weekday });
  }
  return windows;
}

export function compareManualSession(detected: SessionObservation | null | undefined, manualSession: string | null | undefined): ManualSessionComparison {
  if (!detected || !manualSession) return 'UNKNOWN';
  const normalized = manualSession.trim().toLowerCase();
  if (!normalized || detected.status === 'CLOSED') return 'UNKNOWN';
  const ids = [detected.sessionId, detected.sessionName, ...detected.overlappingSessions.flatMap((session) => [session.sessionId, session.sessionName])].map((value) => value.toLowerCase());
  return ids.includes(normalized) ? 'MATCH' : 'MISMATCH';
}
