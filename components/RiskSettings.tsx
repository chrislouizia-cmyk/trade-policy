'use client';

import type { StrategyProfile } from '@/types/trade';

export default function RiskSettings({
  profile,
  onChange,
}: {
  profile: StrategyProfile;
  onChange: (profile: StrategyProfile) => void;
}) {
  const field = (
    key: keyof StrategyProfile,
    label: string,
    step = 0.1,
    min = 0,
  ) => (
    <label>
      {label}
      <input
        type="number"
        step={step}
        min={min}
        value={Number(profile[key] ?? 0)}
        onChange={(event) =>
          onChange({ ...profile, [key]: Number(event.target.value) })
        }
      />
    </label>
  );

  const instrumentLimits = profile.instrumentTradeLimits ?? {};

  function updateInstrumentLimit(symbol: string, value: number) {
    onChange({
      ...profile,
      instrumentTradeLimits: {
        ...instrumentLimits,
        [symbol]: Math.max(1, Math.floor(value || 1)),
      },
    });
  }

  return (
    <div className="stack">
      <div className="grid grid-3">
        {field('maximumRiskPercent', 'Risk per trade %', 0.05, 0.05)}
        {field('maximumTradesPerDay', 'Maximum total trades per day', 1, 1)}
        {field('maximumConsecutiveLosses', 'Maximum consecutive losses', 1, 1)}
        {field('minimumRR', 'Minimum RR', 0.1, 0.1)}
        {field('authorizationScore', 'AUTHORIZED score', 1, 1)}
        {field('waitScore', 'WAIT score', 1, 1)}
      </div>
      <p className="muted">Exposure percentages, weekly limits, and preferred RR are coming later and are not editable in the beta.</p>

      <div className="card nested-card">
        <h3>Daily trades by instrument</h3>
        <p className="muted">
          Each selected instrument can have its own daily limit. The total
          strategy limit above still applies.
        </p>
        <div className="grid grid-3">
          {profile.instruments.map((symbol) => (
            <label key={symbol}>
              {symbol} trades per day
              <input
                type="number"
                min="1"
                step="1"
                value={instrumentLimits[symbol] ?? profile.maximumTradesPerDay}
                onChange={(event) =>
                  updateInstrumentLimit(symbol, Number(event.target.value))
                }
              />
            </label>
          ))}
        </div>
      </div>

      <div className="card nested-card">
        <label className="check-row">
          <input
            type="checkbox"
            checked={Boolean(profile.greenDayProtectionEnabled)}
            onChange={(event) =>
              onChange({
                ...profile,
                greenDayProtectionEnabled: event.target.checked,
              })
            }
          />
          <span>
            <strong>Green Day Protection</strong>
            <small>
              After the normal daily limit, permit an extra authorized trade
              only when its full loss cannot turn the day red.
            </small>
          </span>
        </label>

        {profile.greenDayProtectionEnabled && (
          <div className="grid grid-3">
            <label>
              Protected floor
              <select
                value={profile.greenDayProtectedFloorMode ?? 'ZERO'}
                onChange={(event) =>
                  onChange({
                    ...profile,
                    greenDayProtectedFloorMode: event.target.value as
                      | 'ZERO'
                      | 'FIXED'
                      | 'PERCENT_OF_PROFIT',
                  })
                }
              >
                <option value="ZERO">Keep the day above $0</option>
                <option value="FIXED">Keep a fixed profit amount</option>
                <option value="PERCENT_OF_PROFIT">Protect % of daily profit</option>
              </select>
            </label>

            {(profile.greenDayProtectedFloorMode ?? 'ZERO') !== 'ZERO' && (
              <label>
                {(profile.greenDayProtectedFloorMode ?? 'ZERO') === 'FIXED'
                  ? 'Protected amount'
                  : 'Profit protected %'}
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={profile.greenDayProtectedFloorValue ?? 0}
                  onChange={(event) =>
                    onChange({
                      ...profile,
                      greenDayProtectedFloorValue: Number(event.target.value),
                    })
                  }
                />
              </label>
            )}

            <label>
              Maximum extra trades
              <input
                type="number"
                min="0"
                max="10"
                step="1"
                value={profile.greenDayMaxExtraTrades ?? 1}
                onChange={(event) =>
                  onChange({
                    ...profile,
                    greenDayMaxExtraTrades: Number(event.target.value),
                  })
                }
              />
            </label>

            <label>
              Extra-trade risk (% of normal risk)
              <input
                type="number"
                min="10"
                max="100"
                step="5"
                value={(profile.greenDayExtraRiskMultiplier ?? 0.5) * 100}
                onChange={(event) =>
                  onChange({
                    ...profile,
                    greenDayExtraRiskMultiplier: Number(event.target.value) / 100,
                  })
                }
              />
            </label>

            <label className="check-row">
              <input
                type="checkbox"
                checked={profile.greenDayRequireAuthorized !== false}
                onChange={(event) =>
                  onChange({
                    ...profile,
                    greenDayRequireAuthorized: event.target.checked,
                  })
                }
              />
              <span>
                Extra trade must be AUTHORIZED
                <small>Take Anyway is blocked after the regular daily limit.</small>
              </span>
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
