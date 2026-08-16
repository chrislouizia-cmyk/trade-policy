import Link from 'next/link';

export default function About() {
  return <main className="marketing-page">
    <nav className="marketing-nav">
      <Link className="marketing-brand" href="/"><span>TP</span> Trade Police</Link>
      <Link href="/client/login">Sign in</Link>
    </nav>
    <article className="legal-copy">
      <p className="eyebrow">ABOUT TRADE POLICE</p>
      <h1>Why Trade Police Exists</h1>
      <p>Most traders do not fail because they cannot spot opportunities. They fail because they break their own plan under pressure, after a promising setup starts to feel urgent, or when they need a clearer answer than their chart can provide.</p>
      <p>Trade Police exists to create structure around that moment: a deliberate decision process, visible rules, and a reviewable record.</p>

      <h2>Our Mission</h2>
      <p>Help traders build structure around decision-making, risk, and learning so they can separate process from impulse.</p>

      <h2>Our Principles</h2>
      <ul>
        <li>Your strategy comes first.</li>
        <li>Evidence over impulse.</li>
        <li>History should not be rewritten.</li>
        <li>AI assists; rules govern.</li>
        <li>Discipline is measurable.</li>
        <li>Transparency over false certainty.</li>
      </ul>

      <h2>Team</h2>
      <p>Trade Police is built for traders who want a clearer process around rule-based execution, review, and learning. The public site is structured so founder and team profiles can be added cleanly as the company grows.</p>

      <p><Link href="/pricing">See pricing</Link> · <Link href="/faq">Read the FAQ</Link></p>
    </article>
  </main>;
}
