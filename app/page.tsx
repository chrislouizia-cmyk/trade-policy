import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import LandingProductDemo from '@/components/LandingProductDemo';
import { isPortalHostname } from '@/lib/hostname-routing';

const flow = [
  ['Build Strategy', 'Design your methodology, choose the rules you actually use, and explain your process in plain language.'],
  ['Backtest', 'Test those rules against historical market data to measure how the strategy would have behaved before risking real money.'],
  ['Market Check', 'Trade Police validates the current market against the strategy you selected.'],
  ['Decision', 'The workspace says READY, WAIT, BLOCKED, or NO SETUP based on your configured rules and evidence.'],
  ['Final Risk Check', 'Before execution, confirm risk, sizing, and whether the setup still matches your rules.'],
  ['Active Trade', 'Track the live trade with the decision context preserved and visible throughout execution.'],
  ['History & Analytics', 'Review completed trades, saved decisions, and historical context without rewriting the record.'],
];

const featureCards = [
  {
    eyebrow: 'STRATEGY BUILDER',
    title: 'Translate how you trade into rules',
    copy: 'Choose methodologies, combine them intentionally, and keep only the concepts you actually use. Trade Police turns the structure into a deterministic draft for review before activation.',
  },
  {
    eyebrow: 'DECISION ENGINE',
    title: 'Answer the question clearly',
    copy: 'READY, WAIT, BLOCKED, and NO SETUP are based on your strategy, evidence quality, risk controls, and account context—not a market prediction.',
  },
  {
    eyebrow: 'RISK & HISTORY',
    title: 'Preserve the process',
    copy: 'Active trades and completed trades remain linked to the evidence that made the decision, so the review is honest and useful.',
  },
];

const faqs = [
  ['What is Trade Police?', 'Trade Police is a decision-support and discipline system built around your own trading rules. It helps you check whether a market setup matches your strategy before risking money.'],
  ['Is this a signal service?', 'No. Trade Police does not tell you what to buy or sell based on a prediction model. It evaluates current evidence against the strategy you configure.'],
  ['Can I use my own strategy?', 'Yes. The product is built around your rules, your methodologies, and your review process. AI can help structure and explain, but the final decision logic remains deterministic.'],
  ['How does backtesting work?', 'Trade Police applies your configured strategy rules to historical market data and measures how the strategy would have behaved. You can review trades, win rate, profit and loss, drawdown, and the evidence behind the results. A backtest is historical evidence, not a prediction of future performance.'],
  ['What if a backtest fails?', 'A backtest credit is only consumed when the run completes successfully. If a technical or provider error causes the run to fail, the reserved credit is released so you can retry.'],
  ['What if I use unsupported concepts?', 'Unsupported or external rules are shown honestly. Some concepts may require manual confirmation, external evidence, or remain descriptive rather than automatically verifiable.'],
  ['What does READY mean?', 'READY means the configured conditions and required evidence were satisfied for the current setup. It is not a profit guarantee or a prediction.'],
  ['Can I override a WAIT or BLOCKED decision?', 'Only when the configuration or authorized override path explicitly allows it. Trade Police is designed to preserve the boundary between your judgment and the deterministic authorization logic.'],
  ['Does Trade Police execute trades?', 'No. It is not a broker and does not automatically place trades unless a separate integration is explicitly added.'],
  ['What are the plan limits?', 'FREE includes one lifetime backtest. Approved Private Beta members receive 10 backtests per month. Other plan capabilities and billing limits are enforced server-side.'],
];

export default async function LandingPage() {
  const headerStore = await headers();
  const host = headerStore.get('host');
  if (isPortalHostname(host)) {
    redirect('/dashboard');
  }

  return <main className="marketing-page">
    <nav className="marketing-nav" aria-label="Public navigation"><Link className="marketing-brand" href="/" aria-label="Trade Police"><Image src="/brand/trade-police-logo.png" alt="Trade Police" width={232} height={48} className="brand-logo-wordmark" /></Link><div><a href="#how">How it works</a><a href="#backtesting">Backtesting</a><Link href="/about">About</Link><Link href="/faq">FAQ</Link><Link href="/pricing">Pricing</Link><Link href="/legal">Legal</Link><Link className="button-link secondary marketing-cta" href="/client/login">Sign in</Link></div></nav>
    <section className="marketing-hero"><p className="eyebrow">RULE-BASED DECISION SUPPORT</p><h1>Trade with a system, not an impulse.</h1><p><strong>No signals. No copy trading. Your strategy. Your rules. Your decisions.</strong></p><p>Build your strategy, test it against historical market data, check every live setup against your rules, validate risk before execution, and learn from every trade without sacrificing the record.</p><div className="marketing-actions hero-actions"><Link className="button-link primary marketing-cta hero-cta" href="/client/login?mode=signup&next=/onboarding">Check your first setup free</Link><a className="button-link secondary marketing-cta hero-cta" href="#how">See the workflow</a></div><small>Decision support, not financial advice. No result guarantees an outcome.</small></section>
    <LandingProductDemo />
    <section className="marketing-section problem"><p className="eyebrow">THE CORE PROBLEM</p><h2>Most traders break their own plan at the exact moment they need structure most.</h2><p>Trade Police creates a deliberate pause between opportunity and risk. It compares the market with your rules, shows what is confirmed, and makes the decision legible before money is on the line.</p></section>
    <section id="how" className="marketing-section"><p className="eyebrow">HOW TRADE POLICE WORKS</p><h2>Build Strategy → Backtest → Market Check → Decision → Final Risk Check → Active Trade → History & Analytics</h2><div className="marketing-grid">{flow.map(([title,copy])=><article className="marketing-card" key={title}><span>•</span><h3>{title}</h3><p>{copy}</p></article>)}</div></section>
    <section className="marketing-section split"><article><p className="eyebrow">STRATEGY BUILDER</p><h2>Build visually. Or describe how you trade.</h2><p>Choose methodologies, combine them intentionally, and select only the concepts you actually use. Trade Police helps structure the setup into a reviewable draft before you activate it.</p><p>It does not silently invent a hidden strategy. Every rule remains visible and any contradiction is flagged before activation.</p></article><article className="marketing-card"><p className="eyebrow">DECISION ENGINE</p><h3>READY FOR FINAL CHECK · READY · WAIT · BLOCKED</h3><p>Trade Police evaluates the strategy, evidence, confirmations, risk controls, and account context. READY means the rules were satisfied; it is not a promise of profit.</p></article></section>
    <section id="backtesting" className="marketing-section split"><article><p className="eyebrow">BACKTESTING</p><h2>Stop guessing whether your strategy works. Test it.</h2><p>Run your configured rules against historical market data before you risk real money. Trade Police reconstructs the opportunities your strategy would have taken and turns the result into measurable evidence.</p><p>Review the number of trades, winners and losers, win rate, profit and loss, drawdown, and the trade history behind the result. The goal is not to predict the future—it is to understand how your rules have behaved.</p><div className="marketing-actions"><Link className="button-link primary marketing-cta" href="/client/login?mode=signup&next=/onboarding">Run your first backtest</Link></div></article><article className="marketing-card"><p className="eyebrow">BACKTEST ACCESS</p><h3>Your credit is used only when the backtest completes.</h3><p>If a technical or data-provider error causes a run to fail, the reserved credit is released automatically so you can retry.</p><p><strong>FREE</strong><br />1 completed backtest for life.</p><p><strong>PRIVATE BETA</strong><br />10 completed backtests per month while your beta access is active.</p><small>Historical performance does not guarantee future results.</small></article></section>
    <section id="example" className="marketing-section decision-example"><div><p className="eyebrow">EXAMPLE DECISION</p><h2>The answer comes first. The evidence stays attached.</h2><p>This example shows the shape of a real Trade Police result. It is a transparent explanation of configured rules, not a market prediction.</p></div><article className="marketing-card example-report"><span className="badge wait">WAIT</span><h3>Two required confirmations are still missing.</h3><div><strong>Readiness</strong><span>68% · required 75%</span></div><div><strong>Confirmed</strong><span>Trend alignment · structure</span></div><div><strong>Missing</strong><span>Liquidity sweep · retest</span></div><div><strong>Next</strong><span>Wait for the required evidence or skip the setup.</span></div><small>Illustrative result · not live market data</small></article></section>
    <section className="marketing-section marketing-grid">{featureCards.map((card)=><article className="marketing-card" key={card.eyebrow}><p className="eyebrow">{card.eyebrow}</p><h3>{card.title}</h3><p>{card.copy}</p></article>)}</section>
    <section className="marketing-section pricing-preview"><p className="eyebrow">PRICING</p><h2>Start free. Upgrade for more capacity, not different rules.</h2><p>FREE includes one lifetime backtest. Approved Private Beta members receive 10 backtests per month.</p><div className="marketing-actions"><Link className="button-link primary marketing-cta" href="/pricing">See plan limits</Link></div></section>
    <section className="marketing-section"><p className="eyebrow">FAQ</p><div className="faq-list">{faqs.map(([question,answer])=><details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</div></section>
    <section className="marketing-section risk-callout"><p className="eyebrow">RISK DISCLAIMER</p><h2>Every trade can lose money.</h2><p>Trade Police is a decision-support and discipline system. It is not financial advice, it does not guarantee profits, and it does not execute trades on your behalf. Backtests use historical data and do not guarantee future performance. Market data can be delayed, incomplete, or unavailable.</p></section>
    <section className="marketing-final"><h2>Put your rules between the idea and the risk.</h2><Link className="button-link primary marketing-cta" href="/client/login?mode=signup&next=/onboarding">Start free</Link></section>
    <footer className="marketing-footer"><span>© 2026 Trade Police</span><Link href="/about">About</Link><Link href="/faq">FAQ</Link><Link href="/legal">Legal & risk</Link><Link href="/pricing">Pricing</Link></footer>
  </main>;
}
