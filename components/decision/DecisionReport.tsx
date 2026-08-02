import type {DecisionExplanationItem,DecisionExplanationState,DecisionExplanationSummary,DecisionNarrative} from '@/types/intelligence';
import type {ChartAnalysis,StrategyProfile,TradeResult} from '@/types/trade';

const stateLabel:Record<DecisionExplanationState,string>={CONFIRMED:'Confirmed',MISSING:'Still needed',BLOCKED:'Rule violated',NOT_AVAILABLE:'Could not verify',NOT_REQUIRED:'Not required'};
const stateIcon:Record<DecisionExplanationState,string>={CONFIRMED:'✓',MISSING:'○',BLOCKED:'!',NOT_AVAILABLE:'?',NOT_REQUIRED:'–'};

function EvidenceRows({title,items}:{title:string;items:DecisionExplanationItem[]}){
  if(!items.length)return null;
  return <section className="decision-report-section"><h3>{title}</h3><div className="decision-report-evidence">{items.map(item=><details className={`decision-evidence-row state-${item.state.toLowerCase()}`} key={item.id}><summary><span aria-hidden="true">{stateIcon[item.state]}</span><strong>{item.title}</strong><em>{item.required?'Required rule':'Helpful confirmation'}</em><b>{stateLabel[item.state]}</b></summary><div><p>{item.plainLanguageDescription}</p>{item.expectedValue&&<p><strong>Expected:</strong> {item.expectedValue}</p>}{item.observedValue&&<p><strong>Observed:</strong> {item.observedValue}</p>}{item.nextAction&&<p><strong>Next:</strong> {item.nextAction}</p>}<small>{item.source??'Checked by Trade Police'}{item.detectedAt?` · ${new Date(item.detectedAt).toLocaleString()}`:''}</small></div></details>)}</div></section>;
}

export default function DecisionReport({explanation,analysis,result,narrative,strategy}:{explanation:DecisionExplanationSummary;analysis:ChartAnalysis;result:TradeResult|null;narrative?:DecisionNarrative;strategy:StrategyProfile}){
  const required=explanation.items.filter(item=>item.required&&!['BLOCKED','NOT_AVAILABLE'].includes(item.state));
  const helpful=explanation.items.filter(item=>!item.required&&!['BLOCKED','NOT_AVAILABLE'].includes(item.state));
  const blocking=explanation.items.filter(item=>item.state==='BLOCKED');
  const unavailable=explanation.items.filter(item=>item.state==='NOT_AVAILABLE');
  return <div className="decision-report-content">
    <section className="decision-report-summary"><p className="eyebrow">EXECUTIVE SUMMARY</p><h2>{explanation.verdict.replaceAll('_',' ')}</h2><h3>{explanation.headline}</h3><p>{explanation.explanation}</p><p className="decision-primary-reason">{explanation.primaryReason}</p></section>
    <dl className="decision-report-metadata"><div><dt>Report ID</dt><dd>{analysis.analysisId??'Not assigned'}</dd></div><div><dt>Instrument</dt><dd>{analysis.instrument}</dd></div><div><dt>Timeframe</dt><dd>{analysis.timeframe}</dd></div><div><dt>Trading rules</dt><dd>{strategy.name}</dd></div><div><dt>Saved revision</dt><dd>{strategy.engineVersion??'Not available'}</dd></div><div><dt>Verdict</dt><dd>{explanation.verdict.replaceAll('_',' ')}</dd></div><div><dt>Generated</dt><dd>{new Date(analysis.calculatedAt).toLocaleString()}</dd></div><div><dt>Provider</dt><dd>{explanation.dataStatus.provider}</dd></div><div><dt>Required rules</dt><dd>{explanation.confirmedRequiredCount} of {explanation.totalRequiredCount} confirmed</dd></div></dl>
    <section className="decision-report-section"><h3>Current market and data status</h3><p><strong>{explanation.dataStatus.freshness.replaceAll('_',' ')}</strong> · {explanation.dataStatus.provider}</p><p>{explanation.dataStatus.lastVerifiedCandleAt?`Last verified completed candle: ${new Date(explanation.dataStatus.lastVerifiedCandleAt).toLocaleString()}`:'A verified completed-candle time is unavailable.'}</p><details><summary>How Trade Police reads the chart</summary><p>Trade Police evaluates completed market data against your saved trading rules. It does not use the chart image as the source of the verdict.</p></details></section>
    <EvidenceRows title="Required rules" items={required}/><EvidenceRows title="Helpful confirmations" items={helpful}/><EvidenceRows title="Blocking conditions" items={blocking}/><EvidenceRows title="Unavailable evidence" items={unavailable}/>
    <section className="decision-report-section"><h3>Readiness</h3><p><strong>{explanation.confirmedRequiredCount} of {explanation.totalRequiredCount} required rules confirmed.</strong></p><p>Readiness is not a probability of profit. Required rules control the decision; helpful confirmations cannot compensate for a missing required rule.</p></section>
    <section className="decision-report-section"><h3>Next trigger</h3><p>{explanation.nextAction}</p></section>
    <section className="decision-report-section"><h3>Final risk check</h3><p>{result?`Completed · ${result.verdict}`:'Not completed. Run the final risk check before deciding whether to act.'}</p></section>
    <section className="decision-report-section"><h3>Trading-rule identity</h3><p>{strategy.name} · revision {strategy.engineVersion??'not available'} · {strategy.instruments.includes(analysis.instrument)?analysis.instrument:'instrument unavailable'}</p></section>
    {narrative?.educationalExplanation&&<section className="decision-report-section"><h3>Plain-language explanation</h3><p>{narrative.educationalExplanation}</p><small>AI-authored educational prose. It cannot change the decision or evidence.</small></section>}
    <section className="decision-report-section decision-integrity"><h3>Decision integrity</h3><p>{explanation.integrityStatement}</p></section>
    <section className="decision-report-section"><h3>Limitations</h3><p>Trade Police supports disciplined decision-making. It does not predict profits, execute trades, provide financial advice, or guarantee outcomes.</p></section>
  </div>;
}
