import Link from 'next/link';
import PublicSiteHeader from '@/components/PublicSiteHeader';
import { getRequestLocale } from '@/lib/i18n/server';

export default async function About() {
  const locale=await getRequestLocale();
  return <main className="public-trust-page">
    <PublicSiteHeader locale={locale}/>

    <article className="trust-page-content about-copy">
      <header className="trust-page-hero">
      <p className="eyebrow">ABOUT TRADE POLICE</p>
      <h1>Why Trade Police Exists</h1>
      <p className="lead">Most traders do not fail because they cannot spot opportunities. They fail because they break their own plan under pressure, and the process around the decision becomes fuzzy just when clarity matters most.</p>
      <p>Trade Police exists to create structure around that moment: visible rules, disciplined checks, and a reviewable record that helps traders separate process from impulse.</p>
      </header>

      <div className="trust-principle-grid">
      <section className="info-section">
        <span>01</span>
        <h2>Our Mission</h2>
        <p>Help traders build a repeatable decision process around strategy, risk, and review so the method is visible before money is committed.</p>
      </section>

      <section className="info-section">
        <span>02</span>
        <h2>Our Principles</h2>
        <ul>
          <li>Your strategy comes first.</li>
          <li>Evidence over impulse.</li>
          <li>History should not be rewritten.</li>
          <li>AI assists; rules govern.</li>
          <li>Discipline is measurable.</li>
          <li>Transparency over false certainty.</li>
        </ul>
      </section>

      <section className="info-section">
        <span>03</span>
        <h2>How We Build</h2>
        <p>Trade Police combines user-defined rules, structured methodology, and deterministic evaluation. The system explains what is confirmed, what is missing, and what remains blocked—without pretending to know the future or overriding the user’s chosen logic.</p>
      </section>

      <section className="info-section founder-section">
        <span>04</span>
        <h2>Founder</h2>
        <p>Trade Police is built for traders who want a clearer process around rule-based execution, review, and learning. The product is intentionally transparent about what it does and what it does not do, and the public surface is kept consistent with that real capability.</p>
      </section>
      </div>

      <div className="inline-links">
        <Link href="/pricing">See pricing</Link>
        <Link href="/faq">Read the FAQ</Link>
        <Link href="/legal">Review legal disclosures</Link>
      </div>
    </article>
  </main>;
}
