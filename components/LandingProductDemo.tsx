const states = [
  {verdict:'READY',tone:'authorized',className:'product-demo-ready',title:'All required confirmations are present.',copy:'The setup fits the trading rules currently configured.',evidence:[['Trend alignment','Confirmed','confirmed'],['Market structure','Confirmed','confirmed'],['Retest confirmation','Confirmed','confirmed']],next:'Review the risk details before deciding whether to proceed.'},
  {verdict:'WAIT',tone:'wait',className:'product-demo-wait',title:'Two required confirmations are still missing.',copy:'The setup is not ready under the current trading rules.',evidence:[['Trend alignment','Confirmed','confirmed'],['Liquidity sweep','Missing','missing'],['Retest confirmation','Missing','missing']],next:'Wait for the required evidence or skip the setup.'},
  {verdict:'BLOCKED',tone:'rejected',className:'product-demo-blocked',title:'A required trading rule failed.',copy:'Trade Police will not treat this setup as ready.',evidence:[['Trend alignment','Confirmed','confirmed'],['Market structure','Confirmed','confirmed'],['Required risk rule','Failed','failed']],next:'Respect the block and review the failed rule.'},
];

export default function LandingProductDemo() {
  return <section className="product-demo" aria-labelledby="product-demo-title">
    <div className="product-demo-copy">
      <p className="eyebrow">PRODUCT WALKTHROUGH</p>
      <h2 id="product-demo-title">The decision changes only when the evidence does.</h2>
      <p>See how Trade Police presents READY, WAIT, and BLOCKED using the trading rules you configured. Every state is illustrative—not live market data, a signal, or a performance claim.</p>
      <div className="product-demo-steps" aria-label="Decision states shown">
        <span><b>✓</b> READY · required evidence present</span>
        <span><b>…</b> WAIT · required evidence missing</span>
        <span><b>×</b> BLOCKED · required rule failed</span>
      </div>
    </div>
    <div className="product-demo-shell" aria-hidden="true">
      <div className="product-demo-bar"><span><i /> Trade Police</span><span>Decision workspace · illustrative states</span></div>
      <div className="product-demo-stage">
        {states.map(state=><article className={`product-demo-frame product-demo-decision ${state.className}`} key={state.verdict}>
          <div className="demo-decision-head"><div><p className="eyebrow">DECISION REPORT</p><span className={`badge ${state.tone}`}>{state.verdict}</span></div><small>Illustrative result</small></div>
          <h3>{state.title}</h3><p>{state.copy}</p>
          <div className="demo-rule-list">{state.evidence.map(([label,status,tone])=><div key={label}><span>{label}</span><strong className={tone}>{status}</strong></div>)}</div>
          <p className="demo-next-action"><strong>Next:</strong> {state.next}</p>
          <footer>AI may explain this result. It cannot change the decision.</footer>
        </article>)}
      </div>
    </div>
    <p className="sr-only">Illustrative product states: READY means required evidence is present, WAIT means required evidence is missing, and BLOCKED means a required rule failed. AI may explain these deterministic results but cannot change them.</p>
  </section>;
}
