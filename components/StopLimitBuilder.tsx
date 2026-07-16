'use client';

import type { StopLimit, StopMethod } from '@/types/trade';

export default function StopLimitBuilder({ instruments, limits, onChange }: { instruments: string[]; limits: StopLimit[]; onChange: (limits: StopLimit[]) => void }) {
  function current(symbol: string): StopLimit {
    return limits.find((limit) => limit.instrument === symbol) ?? { instrument: symbol, method: 'PIPS', minimumValue: 10, preferredValue: 18, maximumValue: 25 };
  }

  function update(symbol: string, patch: Partial<StopLimit>) {
    const exists = limits.some((limit) => limit.instrument === symbol);
    onChange(exists
      ? limits.map((limit) => limit.instrument === symbol ? { ...limit, ...patch } : limit)
      : [...limits, { ...current(symbol), ...patch }]);
  }

  if (instruments.length === 0) return <p className="muted">Select instruments before configuring stop limits.</p>;

  return (
    <div className="stop-grid">
      {instruments.map((symbol) => {
        const limit = current(symbol);
        return (
          <div className="stop-row" key={symbol}>
            <strong>{symbol}</strong>
            <select value={limit.method} onChange={(event) => update(symbol, { method: event.target.value as StopMethod })}>
              {!['PIPS','POINTS','TICKS','PERCENT'].includes(limit.method)&&<option value={limit.method} disabled>{limit.method} — unsupported in beta</option>}
              {['PIPS','POINTS','TICKS','PERCENT'].map((method) => <option key={method}>{method}</option>)}
            </select>
            <label><small>Minimum</small><input type="number" step="any" min="0" value={limit.minimumValue ?? 0} onChange={(event) => update(symbol, { minimumValue: Number(event.target.value) })} /></label>
            <label><small>Preferred</small><input type="number" step="any" min="0" value={limit.preferredValue ?? limit.maximumValue} onChange={(event) => update(symbol, { preferredValue: Number(event.target.value) })} /></label>
            <label><small>Maximum</small><input type="number" step="any" min="0" value={limit.maximumValue} onChange={(event) => update(symbol, { maximumValue: Number(event.target.value) })} /></label>
          </div>
        );
      })}
    </div>
  );
}
