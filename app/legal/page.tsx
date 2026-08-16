import Link from 'next/link';

const legalSections = [
  ['Trading Risk', 'Trading involves substantial risk, including the possibility of losing all capital committed to a trade. Decisions may still fail even when the system reports READY or FINAL RISK CHECK passed.'],
  ['Not Financial Advice', 'Trade Police is not a broker, advisor, or financial institution. It does not recommend or arrange trades, and it does not assess suitability or compliance for any person or jurisdiction.'],
  ['No Profit Guarantee', 'READY is not a profit guarantee. It means that configured strategy conditions and available evidence were satisfied at the time the decision was produced. Market conditions can change immediately after the check.'],
  ['User Responsibility', 'Users are responsible for their own trading decisions, risk limits, execution, account management, and compliance with local law. Trade Police does not replace a user’s own judgment, diligence, or responsibility.'],
  ['Strategy Responsibility', 'Users define the strategy, their rules, risk model, and the meaning of evidence. Trade Police evaluates based on the user’s configured rules and the available market data; it does not automatically know the user’s intentions beyond that configuration.'],
  ['Market Data', 'Market data may be delayed, incomplete, stale, unavailable, or corrected after posting. A result should be treated as a decision aid, not as a definitive market forecast.'],
  ['Data Integrity', 'Trade Police relies on the quality of source data, user configuration, and the integrity of its evidence model. Incomplete or failed data sources may prevent a decision from being fully authorized.'],
  ['Automated Detection Limitations', 'Not every rule or trading concept can be verified automatically. Some concepts are manual, external, or descriptive only. Unsupported concepts may require manual confirmation or remain ineligible for deterministic authorization.'],
  ['Manual Confirmations', 'Manual confirmations are a legitimate part of the process when a rule cannot be validated automatically. Manual confirmation does not convert the system into a market predictor or a broker.'],
  ['External Evidence', 'External evidence such as news, macro catalysts, or market correlation may be out of scope for automatic detection or may be unavailable at the time of evaluation. External dependencies should be reviewed by the user before acting.'],
  ['AI Usage', 'AI may assist with summarization, interpretation, structured drafting, and explanation. It does not become the final trading authority and cannot silently override deterministic strategy logic or mandatory risk controls.'],
  ['Strategy Conflicts', 'Trade Police may flag conflicting requirements or impossible logic. The user remains responsible for reviewing and approving the strategy configuration, including any conflict that is intentionally retained.'],
  ['Execution & Brokerage', 'Trade Police does not execute trades on behalf of the user unless a separate, explicit integration is implemented by the user or their institution. Trade Police is not a brokerage, execution venue, or custodian.'],
  ['Availability & Technical Risk', 'The service may be unavailable, delayed, rate-limited, or impacted by outages or maintenance. Users should not assume that a failed check or outage means a trade is implicitly safe or unsafe.'],
  ['Beta / Experimental Features', 'Some functionality may be beta, experimental, or limited as the product evolves. Feature availability and limits can change, and users should rely on the current system state and authoritative plan/usage data.'],
  ['Historical Performance', 'Historical records and analytics are for review and learning. They are not proof of future performance and should not be interpreted as a guarantee that the same process will succeed in the future.'],
  ['Jurisdiction & Eligibility', 'Access to the service and any associated financial or trading activity may be restricted by law or by the service provider’s operational requirements. Users are responsible for ensuring eligibility in their jurisdiction.'],
];

export default function Legal() {
  return <main className="marketing-page">
    <nav className="marketing-nav">
      <Link className="marketing-brand" href="/"><span>TP</span> Trade Police</Link>
      <div>
        <Link href="/about">About</Link>
        <Link href="/faq">FAQ</Link>
        <Link href="/pricing">Pricing</Link>
        <Link className="button-link secondary marketing-cta" href="/client/login">Sign in</Link>
      </div>
    </nav>

    <article className="legal-copy legal-doc">
      <p className="eyebrow">LEGAL & RISK DISCLOSURES</p>
      <h1>Decision support, not financial advice.</h1>
      <p className="lead">Trade Police is a trading decision-support and discipline system built around the user’s own strategy and risk rules. It does not provide financial, investment, tax, or legal advice and does not guarantee trading results.</p>

      <nav className="legal-nav" aria-label="Legal section navigation">
        {legalSections.map(([title]) => (
          <a key={title} href={`#${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>
            {title}
          </a>
        ))}
      </nav>

      <div className="legal-section-stack">
        {legalSections.map(([title, copy]) => (
          <section key={title} id={title.toLowerCase().replace(/[^a-z0-9]+/g, '-')} className="info-section legal-section">
            <h2>{title}</h2>
            <p>{copy}</p>
          </section>
        ))}
      </div>

      <p className="muted legal-updated">Last updated: August 16, 2026.</p>
    </article>
  </main>;
}
