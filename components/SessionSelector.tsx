'use client';

import { useMemo } from 'react';
import type { StrategySession } from '@/types/trade';

export const PRESET_SESSIONS: StrategySession[] = [
  { sessionCode: 'SYDNEY', name: 'Sydney', timezone: 'Australia/Sydney', startTime: '08:00', endTime: '17:00', days: [1,2,3,4,5], allowOpenOutside: false, allowHoldOutside: true },
  { sessionCode: 'TOKYO', name: 'Tokyo', timezone: 'Asia/Tokyo', startTime: '09:00', endTime: '18:00', days: [1,2,3,4,5], allowOpenOutside: false, allowHoldOutside: true },
  { sessionCode: 'ASIA', name: 'Asia', timezone: 'Asia/Tokyo', startTime: '08:00', endTime: '17:00', days: [1,2,3,4,5], allowOpenOutside: false, allowHoldOutside: true },
  { sessionCode: 'LONDON', name: 'London', timezone: 'Europe/London', startTime: '08:00', endTime: '17:00', days: [1,2,3,4,5], allowOpenOutside: false, allowHoldOutside: true },
  { sessionCode: 'LONDON_OPEN', name: 'London Open', timezone: 'Europe/London', startTime: '07:00', endTime: '10:00', days: [1,2,3,4,5], allowOpenOutside: false, allowHoldOutside: true },
  { sessionCode: 'LONDON_KILL_ZONE', name: 'London Kill Zone', timezone: 'Europe/London', startTime: '07:00', endTime: '10:00', days: [1,2,3,4,5], allowOpenOutside: false, allowHoldOutside: true },
  { sessionCode: 'NEW_YORK', name: 'New York', timezone: 'America/New_York', startTime: '08:00', endTime: '17:00', days: [1,2,3,4,5], allowOpenOutside: false, allowHoldOutside: true },
  { sessionCode: 'NEW_YORK_AM', name: 'New York AM', timezone: 'America/New_York', startTime: '08:00', endTime: '12:00', days: [1,2,3,4,5], allowOpenOutside: false, allowHoldOutside: true },
  { sessionCode: 'NEW_YORK_KILL_ZONE', name: 'New York Kill Zone', timezone: 'America/New_York', startTime: '07:00', endTime: '10:00', days: [1,2,3,4,5], allowOpenOutside: false, allowHoldOutside: true },
  { sessionCode: 'NEW_YORK_PM', name: 'New York PM', timezone: 'America/New_York', startTime: '13:00', endTime: '16:00', days: [1,2,3,4,5], allowOpenOutside: false, allowHoldOutside: true },
  { sessionCode: 'LONDON_NY_OVERLAP', name: 'London–New York Overlap', timezone: 'UTC', startTime: '12:00', endTime: '16:00', days: [1,2,3,4,5], allowOpenOutside: false, allowHoldOutside: true },
  { sessionCode: 'ASIA_LONDON_TRANSITION', name: 'Asia–London Transition', timezone: 'UTC', startTime: '06:00', endTime: '09:00', days: [1,2,3,4,5], allowOpenOutside: false, allowHoldOutside: true },
  { sessionCode: 'US_FUTURES_PREMARKET', name: 'US Futures Premarket', timezone: 'America/New_York', startTime: '04:00', endTime: '09:30', days: [1,2,3,4,5], allowOpenOutside: false, allowHoldOutside: true },
  { sessionCode: 'US_STOCK_PREMARKET', name: 'US Stock Premarket', timezone: 'America/New_York', startTime: '04:00', endTime: '09:30', days: [1,2,3,4,5], allowOpenOutside: false, allowHoldOutside: true },
  { sessionCode: 'US_REGULAR', name: 'US Regular Session', timezone: 'America/New_York', startTime: '09:30', endTime: '16:00', days: [1,2,3,4,5], allowOpenOutside: false, allowHoldOutside: true },
  { sessionCode: 'US_POWER_HOUR', name: 'US Power Hour', timezone: 'America/New_York', startTime: '15:00', endTime: '16:00', days: [1,2,3,4,5], allowOpenOutside: false, allowHoldOutside: true },
  { sessionCode: 'AFTER_HOURS', name: 'After Hours', timezone: 'America/New_York', startTime: '16:00', endTime: '20:00', days: [1,2,3,4,5], allowOpenOutside: false, allowHoldOutside: true },
  { sessionCode: 'CRYPTO_24_7', name: 'Crypto 24/7', timezone: 'UTC', startTime: '00:00', endTime: '23:59', days: [0,1,2,3,4,5,6], allowOpenOutside: true, allowHoldOutside: true },
];

const COMMON_TIMEZONES = ['America/Monterrey','America/Mexico_City','America/New_York','America/Chicago','America/Los_Angeles','Europe/London','Europe/Paris','Asia/Tokyo','Australia/Sydney','UTC'];

function localTimeFor(referenceTime: string, sourceTimezone: string, userTimezone: string): string {
  try {
    const [hour, minute] = referenceTime.split(':').map(Number);
    const now = new Date();
    const dateParts = new Intl.DateTimeFormat('en-CA', { timeZone: sourceTimezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const part = (type: string) => dateParts.find((item) => item.type === type)?.value ?? '';
    const targetWall = `${part('year')}-${part('month')}-${part('day')}T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:00`;
    let guess = new Date(`${targetWall}Z`);
    for (let i = 0; i < 3; i += 1) {
      const sourceRendered = new Intl.DateTimeFormat('en-CA', { timeZone: sourceTimezone, hour12: false, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }).formatToParts(guess);
      const rendered = Object.fromEntries(sourceRendered.map((item) => [item.type, item.value]));
      const renderedAsUtc = Date.UTC(Number(rendered.year), Number(rendered.month)-1, Number(rendered.day), Number(rendered.hour), Number(rendered.minute));
      const desiredAsUtc = Date.UTC(Number(part('year')), Number(part('month'))-1, Number(part('day')), hour, minute);
      guess = new Date(guess.getTime() + (desiredAsUtc - renderedAsUtc));
    }
    return new Intl.DateTimeFormat(undefined, { timeZone: userTimezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(guess);
  } catch {
    return referenceTime;
  }
}

export default function SessionSelector({ sessions, onChange, userTimezone, onUserTimezoneChange }: { sessions: StrategySession[]; onChange: (sessions: StrategySession[]) => void; userTimezone: string; onUserTimezoneChange: (timezone: string) => void; }) {
  const detectedTimezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);

  function togglePreset(preset: StrategySession) {
    const exists = sessions.some((item) => item.sessionCode === preset.sessionCode);
    onChange(exists ? sessions.filter((item) => item.sessionCode !== preset.sessionCode) : [...sessions, { ...preset }]);
  }

  function update(index: number, patch: Partial<StrategySession>) {
    onChange(sessions.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }

  function addCustom() {
    onChange([...sessions, { sessionCode: `CUSTOM_${Date.now()}`, name: 'Custom session', timezone: userTimezone, startTime: '08:00', endTime: '12:00', days: [1,2,3,4,5], allowOpenOutside: false, allowHoldOutside: true, isCustom: true }]);
  }

  return (
    <div className="stack">
      <div className="grid grid-2 timezone-picker">
        <label>Your timezone<select value={userTimezone} onChange={(event) => onUserTimezoneChange(event.target.value)}>{Array.from(new Set([userTimezone, detectedTimezone, ...COMMON_TIMEZONES])).map((zone) => <option key={zone}>{zone}</option>)}</select></label>
        <div><p className="muted">Detected timezone: <strong>{detectedTimezone}</strong></p><button type="button" onClick={() => onUserTimezoneChange(detectedTimezone)}>Use detected timezone</button></div>
      </div>

      <div className="session-presets">
        {PRESET_SESSIONS.map((preset) => {
          const active = sessions.some((item) => item.sessionCode === preset.sessionCode);
          return <button type="button" className={`chip ${active ? 'selected' : ''}`} key={preset.sessionCode} onClick={() => togglePreset(preset)}>{preset.name}</button>;
        })}
        <button type="button" className="chip" disabled title="Coming later">+ Custom — Coming later</button>
      </div>
      <p className="muted">Beta enforcement uses the selected session codes. Detailed hours, weekdays, and outside-session controls are coming later.</p>

      {sessions.map((session, index) => {
        const localStart = localTimeFor(session.startTime, session.timezone, userTimezone);
        const localEnd = localTimeFor(session.endTime, session.timezone, userTimezone);
        return (
          <div className="session-card" key={session.sessionCode}>
            <div className="session-card-head"><div><strong>{session.name}</strong><small>{session.timezone}</small></div><button type="button" onClick={() => onChange(sessions.filter((_, itemIndex) => itemIndex !== index))}>Remove</button></div>
            <div className="session-time-summary"><span>Market time <strong>{session.startTime}–{session.endTime}</strong></span><span>Your time <strong>{localStart}–{localEnd}</strong></span></div>
            <div className="session-row compact-session-row">
              <label>Name<input disabled value={session.name} /></label>
              <label>Market timezone<select disabled value={session.timezone}>{Array.from(new Set([session.timezone, ...COMMON_TIMEZONES])).map((zone) => <option key={zone}>{zone}</option>)}</select></label>
              <label>Start<input disabled type="time" value={session.startTime} /></label>
              <label>End<input disabled type="time" value={session.endTime} /></label>
            </div>
            <div className="button-row compact-row"><label className="check-row"><input disabled type="checkbox" checked={session.allowOpenOutside} /><span>Allow entries outside — Coming later</span></label><label className="check-row"><input disabled type="checkbox" checked={session.allowHoldOutside} /><span>Allow holding outside — Coming later</span></label></div>
          </div>
        );
      })}
    </div>
  );
}
