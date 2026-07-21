import type { SessionObservation, SessionWindowObservation } from '../../contracts.ts';

export type SessionStatus = SessionObservation['status'];
export type TradingSessionWindow = SessionWindowObservation;

export type TradingSessionConfig = {
  id: string;
  name: string;
  market: string;
  timezone: string;
  startTime: string;
  endTime: string;
  /** ISO weekday numbers: Monday=1 through Sunday=7. */
  weekdays: readonly number[];
};

export type SessionDetectorOptions = {
  sessions?: readonly TradingSessionConfig[];
  openingSoonMinutes?: number;
  closingSoonMinutes?: number;
};

export type ManualSessionComparison = 'MATCH' | 'MISMATCH' | 'UNKNOWN';
