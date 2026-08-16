import Link from 'next/link';

const faqs = [
  ['What is Trade Police?', 'Trade Police is a decision-support and discipline system built around a trader’s own strategy. It checks whether current market evidence matches the rules you configured before you risk money.'],
  ['Is Trade Police a signal service?', 'No. It does not publish buy or sell signals or simulate a prediction engine. It evaluates evidence against your strategy and explains what is confirmed, missing, or blocked.'],
  ['Does Trade Police tell me what to buy or sell?', 'No. The product is designed to assess whether a setup fits your strategy and risk plan. It does not replace your own judgment or your responsibility to execute correctly.'],
  ['Can I use my own strategy?', 'Yes. Trade Police is built for the trader’s own rules, methodology, and risk model. You can combine methodologies and only keep the concepts you actually use.'],
  ['Can I combine SMC, ICT, Support & Resistance, and other approaches?', 'Yes. The system supports combining methodologies in a structured builder, but the user still reviews the final rule mix and any conflict warnings before activation.'],
  ['What if Trade Police cannot detect one of my rules?', 'The rule is shown honestly as manual, external, or descriptive. Some concepts require confirmation outside the automated engine or are not currently eligible for deterministic authorization.'],
  ['What are automatic, manual, and external rules?', 'Automatic means the system can evaluate it reliably. Manual means the trader must confirm it. External means it depends on an outside source like news or macro context. Descriptive means it is part of the playbook but not eligible for deterministic authorization.'],
  ['What do READY FOR FINAL CHECK, READY, WAIT, and BLOCKED mean?', 'These are the status states for the current decision. READY means the strategy conditions are satisfied at the time of evaluation. WAIT means more evidence is required. BLOCKED means the setup is not authorized under current rules.'],
  ['Can I override WAIT or BLOCKED?', 'Only where the configured rules and authorization path allow it. Trade Police keeps a clear boundary between your discretion and the deterministic decision logic.'],
  ['What is the Final Risk Check?', 'It is the final review before execution. It confirms that the setup still aligns with the strategy, the account and risk controls are okay, and the trade remains within the configured risk posture.'],
  ['What is Describe Your Strategy — Beta?', 'It turns a plain-language description of how you trade into a structured draft that the trader reviews before saving or activating it. It is a deterministic drafting assistant, not a live AI strategy engine or conversational trading copilot.'],
  ['Does AI make the final trading decision?', 'No. AI can structure and explain, but the final decision logic remains deterministic and based on the rules and evidence the user has approved.'],
  ['What happens when strategy rules conflict?', 'Trade Police surfaces the conflict. It explains the issue, why it matters, and what the engine expects. The user can fix it, review it, or keep it intentionally while the decision is recorded as retained.'],
  ['Can Trade Police track active trades?', 'Yes. The product preserves the decision context and connects the trade to the strategy, evidence, and review timeline while it is live.'],
  ['Does Trade Police connect to a broker?', 'Not by default. Trade Police is not a broker, and it does not automatically execute trades unless a separate integration is explicitly present.'],
  ['What markets are supported?', 'The system supports the markets and instruments configured by the active strategy and data sources available in the environment. Coverage depends on the actual market data and the user’s strategy set.'],
  ['How many strategies can I create?', 'The number depends on the active plan. The current limits are Free: 1 active strategy, Pro: 5, Elite: 10, Team: unlimited, with billing enforced server-side.'],
  ['How are market checks counted?', 'Market checks are counted against the current anchored monthly usage period for the authenticated user. The exact limit depends on the plan and billing state.'],
  ['When does my cycle reset?', 'It resets according to the anchored monthly billing period used by the account, not a guess or a local browser clock.'],
  ['What does each plan include?', 'The public commercial plans are Free, Pro, Elite, and Team. The exact limits and entitlement checks are enforced server-side and the listed public prices match the current public launch pricing.'],
  ['What is the public pricing?', 'Free is $0. Pro is $29/month or $279/year. Elite is $59/month or $569/year. Team is $149/month or $1,429/year. Annual pricing shows a ~20% savings when available.'],
  ['Is my information private?', 'Trade Police keeps account and billing data protected through authenticated, server-authoritative systems. Public pages remain public; protected account and strategy data are not exposed broadly.'],
  ['Can Trade Police guarantee profitability?', 'No. The product is a discipline and review layer, not a profit engine or financial advice service.'],
  ['Is this financial advice?', 'No. Trade Police is a decision-support system and not a substitute for financial advice, suitability assessment, or legal/compliance review.'],
  ['What is Strategy DNA?', 'Strategy DNA is the structured representation of your trading approach and the rules that govern it. It helps preserve the decision model across market checks and decision records.'],
  ['Is Trade Police still in beta?', 'The current public messaging is that it is a beta or early-release product, with limits and capabilities evolving as the platform matures.'],
  ['Can teams use Trade Police?', 'Yes. Team deployments and shared permissions are supported through team or workspace accounts, with role-based access and management controls.'],
];

export default function FAQPage() {
  return <main className="marketing-page">
    <nav className="marketing-nav">
      <Link className="marketing-brand" href="/"><span>TP</span> Trade Police</Link>
      <Link href="/client/login">Sign in</Link>
    </nav>
    <article className="legal-copy">
      <p className="eyebrow">FAQ</p>
      <h1>Frequently asked questions</h1>
      <div className="faq-list">{faqs.map(([question, answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</div>
      <p><Link href="/pricing">See pricing</Link> · <Link href="/legal">Review the legal disclosures</Link></p>
    </article>
  </main>;
}
