'use client';

import type { StrategyRule } from '@/types/trade';

export const DEFAULT_RULES: StrategyRule[] = [
  ['h4TrendAligned','Trend alignment','TREND'],
  ['h1TrendAligned','Multi-timeframe alignment','CONFIRMATION'],
  ['structurePattern','HH/HL or LH/LL structure','CONFIRMATION'],
  ['liquiditySweep','Liquidity sweep','ENTRY'],
  ['chochConfirmed','ChoCH','ENTRY'],
  ['bosConfirmed','BoS','CONFIRMATION'],
  ['displacement','Displacement','ENTRY'],
  ['orderBlock','Order block','CONFIRMATION'],
  ['fairValueGap','Fair value gap','CONFIRMATION'],
  ['premiumDiscount','Premium / discount','TREND'],
  ['retestConfirmed','Retest','ENTRY'],
  ['rejectionCandle','Rejection candle','TRIGGER'],
  ['volumeConfirmation','Volume confirmation','TRIGGER'],
  ['volatilityRequirement','Volatility requirement','ENTRY'],
  ['sessionRequirement','Session requirement','ENTRY'],
  ['newsFilter','News filter','ENTRY'],
  ['correlationFilter','Correlation filter','ENTRY'],
  ['spreadFilter','Spread filter','TRIGGER'],
].map(([ruleKey, label, timeframeRole], index) => ({
  ruleKey,
  label,
  enabled: index < 10 && ruleKey !== 'orderBlock',
  mandatory: ['h4TrendAligned','h1TrendAligned','structurePattern','bosConfirmed'].includes(ruleKey),
  weight: index < 10 ? 10 : 5,
  minimumConfidence: 60,
  timeframeRole: timeframeRole as StrategyRule['timeframeRole'],
  evaluationMode: ['orderBlock','sessionRequirement','newsFilter','correlationFilter','spreadFilter'].includes(ruleKey)?'MANUAL':'AUTOMATIC',
}));

const NOT_LIVE_DETECTABLE = new Set(['orderBlock','sessionRequirement','newsFilter','correlationFilter','spreadFilter']);

export default function RuleBuilder({ rules, onChange }: { rules: StrategyRule[]; onChange: (rules: StrategyRule[]) => void }) {
  function update(index: number, patch: Partial<StrategyRule>) {
    onChange(rules.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...patch } : rule));
  }

  return (
    <div className="rule-table">
      <div className="rule-table-head"><span>Enabled</span><span>Rule</span><span>Mandatory</span><span>Weight</span><span>Confidence</span><span>Timeframe / mode</span></div>
      {rules.map((rule, index) => (
        <div className="rule-table-row" key={rule.ruleKey}>
          <input type="checkbox" checked={rule.enabled} onChange={(event) => update(index, { enabled: event.target.checked })} />
          <strong>{rule.label}{NOT_LIVE_DETECTABLE.has(rule.ruleKey)?' · not available in live analysis':''}</strong>
          <input type="checkbox" checked={rule.mandatory} disabled={!rule.enabled} onChange={(event) => update(index, { mandatory: event.target.checked })} />
          <input type="number" min="0" max="100" value={rule.weight} disabled={!rule.enabled} onChange={(event) => update(index, { weight: Number(event.target.value) })} />
          <input type="number" min="0" max="100" value={rule.minimumConfidence} disabled={!rule.enabled} onChange={(event) => update(index, { minimumConfidence: Number(event.target.value) })} />
          <span><select value={rule.timeframeRole} disabled={!rule.enabled} onChange={(event) => update(index, { timeframeRole: event.target.value as StrategyRule['timeframeRole'] })}>
            {['MACRO','TREND','CONFIRMATION','ENTRY','TRIGGER'].map((role) => <option key={role}>{role}</option>)}
          </select><select value={rule.evaluationMode??'AUTOMATIC'} disabled={!rule.enabled} onChange={event=>update(index,{evaluationMode:event.target.value as StrategyRule['evaluationMode']})}><option value="AUTOMATIC">Automatic</option><option value="MANUAL">Manual</option></select></span>
        </div>
      ))}
    </div>
  );
}
