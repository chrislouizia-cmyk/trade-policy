'use client';

import { useState } from 'react';
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
  evaluationMode: ['sessionRequirement','newsFilter','correlationFilter','spreadFilter'].includes(ruleKey)?'EXTERNAL':ruleKey==='orderBlock'?'MANUAL':'AUTOMATIC',
}));

const MODE_HELP = {
  AUTOMATIC: 'Trade Police reads this from market data.',
  MANUAL: 'You confirm this before the decision.',
  EXTERNAL: 'A broker, calendar, indicator, or other source supplies this.',
} as const;

export default function RuleBuilder({ rules, onChange }: { rules: StrategyRule[]; onChange: (rules: StrategyRule[]) => void }) {
  const [newRuleLabel,setNewRuleLabel]=useState('');
  const [newRuleMode,setNewRuleMode]=useState<NonNullable<StrategyRule['evaluationMode']>>('MANUAL');
  function update(index: number, patch: Partial<StrategyRule>) {
    onChange(rules.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...patch } : rule));
  }

  function addConfirmation(){
    const label=newRuleLabel.trim();
    if(!label)return;
    const base=label.toLowerCase().replace(/[^a-z0-9]+(.)/g,(_,letter:string)=>letter.toUpperCase()).replace(/[^a-z0-9]/g,'')||'confirmation';
    let ruleKey=base,index=2;
    while(rules.some(rule=>rule.ruleKey===ruleKey))ruleKey=`${base}${index++}`;
    onChange([...rules,{ruleKey,label,enabled:true,mandatory:true,weight:10,minimumConfidence:60,timeframeRole:'ENTRY',evaluationMode:newRuleMode}]);
    setNewRuleLabel('');
  }

  return (
    <div className="rule-table sprint-rule-table">
      <div className="rule-mode-legend" aria-label="Rule classification guide"><span><strong>Automatic</strong> · Trade Police detects it</span><span><strong>Manual</strong> · you confirm it</span><span><strong>External</strong> · another source supplies it</span></div>
      <div className="rule-table-head"><span>Use</span><span>What must be true?</span><span>Mandatory</span><span>Weight</span><span>Confidence</span><span>Layer / source</span></div>
      {rules.map((rule, index) => (
        <div className="rule-table-row" key={rule.ruleKey}>
          <input aria-label={`${rule.label} enabled`} type="checkbox" checked={rule.enabled} onChange={(event) => update(index, { enabled: event.target.checked })} />
          <strong>{rule.label}<small className="rule-mode-copy">{MODE_HELP[rule.evaluationMode??'AUTOMATIC']}</small></strong>
          <input aria-label={`${rule.label} mandatory`} type="checkbox" checked={rule.mandatory} disabled={!rule.enabled} onChange={(event) => update(index, { mandatory: event.target.checked })} />
          <input aria-label={`${rule.label} weight`} type="number" min="0" max="100" value={rule.weight} disabled={!rule.enabled} onChange={(event) => update(index, { weight: Number(event.target.value) })} />
          <input aria-label={`${rule.label} confidence`} type="number" min="0" max="100" value={rule.minimumConfidence} disabled={!rule.enabled} onChange={(event) => update(index, { minimumConfidence: Number(event.target.value) })} />
          <span><select aria-label={`${rule.label} timeframe`} value={rule.timeframeRole} disabled={!rule.enabled} onChange={(event) => update(index, { timeframeRole: event.target.value as StrategyRule['timeframeRole'] })}>
            {['MACRO','TREND','CONFIRMATION','ENTRY','TRIGGER'].map((role) => <option key={role}>{role}</option>)}
          </select><select aria-label={`${rule.label} evaluation mode`} value={rule.evaluationMode??'AUTOMATIC'} disabled={!rule.enabled} onChange={event=>update(index,{evaluationMode:event.target.value as StrategyRule['evaluationMode']})}><option value="AUTOMATIC">Automatic</option><option value="MANUAL">Manual</option><option value="EXTERNAL">External</option></select></span>
        </div>
      ))}
      <div className="add-confirmation"><div><strong>Add a missing confirmation</strong><small>Teach Trade Police a rule that is not listed above.</small></div><input aria-label="New confirmation name" placeholder="e.g. Psychology check" value={newRuleLabel} onChange={event=>setNewRuleLabel(event.target.value)}/><select aria-label="New confirmation source" value={newRuleMode} onChange={event=>setNewRuleMode(event.target.value as NonNullable<StrategyRule['evaluationMode']>)}><option value="AUTOMATIC">Automatic</option><option value="MANUAL">Manual</option><option value="EXTERNAL">External</option></select><button type="button" onClick={addConfirmation} disabled={!newRuleLabel.trim()}>Add confirmation</button></div>
    </div>
  );
}
