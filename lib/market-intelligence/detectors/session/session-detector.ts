import type { DetectorResult, MarketDataSnapshot, SessionObservation } from '../../contracts.ts';
import { BaseDetector } from '../base-detector.ts';
import type { SessionDetectorOptions, TradingSessionConfig } from './session-types.ts';
import { DEFAULT_MARKET_SESSIONS, localParts, resolveSessionWindows } from './session-utils.ts';

const minutes = (milliseconds: number): number => Math.max(0, Math.ceil(milliseconds / 60_000));

export class SessionDetector extends BaseDetector<SessionObservation> {
  readonly #sessions: readonly TradingSessionConfig[];
  readonly #openingSoonMinutes: number;
  readonly #closingSoonMinutes: number;

  constructor(options: SessionDetectorOptions = {}) {
    super({ id: 'session', version: '1.0.0', displayName: 'Session Detector', deterministic: true, supportedTimeframes: ['GLOBAL'], supportsReplay: true, experimental: true, enabledByDefault: true, description: 'Determines configured market-session state from an immutable market-data timestamp.' });
    this.#sessions = options.sessions ?? DEFAULT_MARKET_SESSIONS;
    this.#openingSoonMinutes = options.openingSoonMinutes ?? 60;
    this.#closingSoonMinutes = options.closingSoonMinutes ?? 60;
  }

  async execute(snapshot: MarketDataSnapshot): Promise<DetectorResult<SessionObservation>> {
    const atMs = Date.parse(snapshot.dataAsOf);
    if (!Number.isFinite(atMs)) return this.error(snapshot, 'INVALID_SESSION_TIMESTAMP', 'Snapshot dataAsOf is not a valid ISO-8601 timestamp.');
    try {
      const windows = this.#sessions.flatMap((session) => resolveSessionWindows(session, atMs));
      const active = windows.filter((window) => window.startMs <= atMs && atMs < window.endMs).sort((a, b) => a.startMs - b.startMs);
      const upcoming = windows.filter((window) => window.startMs > atMs).sort((a, b) => a.startMs - b.startMs);
      const selected = active[0] ?? upcoming[0];
      if (!selected) return this.error(snapshot, 'NO_SESSION_SCHEDULE', 'No configured session window could be resolved.');
      const isOpen = active.length > 0;
      const untilOpen = isOpen ? null : minutes(selected.startMs - atMs);
      const untilClose = isOpen ? minutes(selected.endMs - atMs) : null;
      const status = isOpen
        ? (untilClose! <= this.#closingSoonMinutes ? 'CLOSING_SOON' : 'OPEN')
        : (untilOpen! <= this.#openingSoonMinutes ? 'OPENING_SOON' : 'CLOSED');
      const payload: SessionObservation = {
        sessionId: selected.sessionId, sessionName: selected.sessionName, market: selected.market, timezone: selected.timezone, status,
        startTime: selected.startTime, endTime: selected.endTime, minutesUntilOpen: untilOpen, minutesUntilClose: untilClose,
        isWeekend: localParts(atMs, selected.timezone).weekday >= 6, isHoliday: null,
        overlappingSessions: active.slice(1).map(({ startMs: _start, endMs: _end, localWeekday: _weekday, ...window }) => window),
      };
      return { detectorId: this.id, detectorVersion: this.version, runId: 'unassigned', instrument: snapshot.instrument, timeframe: 'GLOBAL', observedAt: snapshot.dataAsOf, dataAsOf: snapshot.dataAsOf, status: 'DETECTED', confidence: 100, payload, evidence: [{ id: `session:${selected.sessionId}:${selected.startTime}`, type: 'SESSION_SCHEDULE', description: `${selected.sessionName} session schedule evaluated at ${snapshot.dataAsOf}.`, source: 'configured-market-sessions', sourceReference: selected.timezone }], freshness: snapshot.freshness, warnings: [] };
    } catch (error) {
      return this.error(snapshot, 'SESSION_CONFIGURATION_ERROR', error instanceof Error ? error.message : 'Session configuration could not be evaluated.');
    }
  }

  private error(snapshot: MarketDataSnapshot, errorCode: string, warning: string): DetectorResult<SessionObservation> {
    return { detectorId: this.id, detectorVersion: this.version, runId: 'unassigned', instrument: snapshot.instrument, timeframe: 'GLOBAL', observedAt: snapshot.dataAsOf, dataAsOf: snapshot.dataAsOf, status: 'ERROR', confidence: null, payload: null, evidence: [], freshness: snapshot.freshness, warnings: [warning], errorCode };
  }
}
