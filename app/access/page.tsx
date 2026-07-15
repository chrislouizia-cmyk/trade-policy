import Link from 'next/link';

export default function AccessPage() {
  return (
    <main className="auth-page access-choice-page">
      <section className="access-choice-shell">
        <div className="access-choice-heading">
          <span className="brand-mark">TP</span>
          <span className="eyebrow">TRADE POLICE</span>
          <h1>Choose your portal</h1>
          <p>Customers and employees use separate operational environments.</p>
        </div>
        <div className="portal-choice-grid">
          <Link className="card portal-choice-card" href="/client/login">
            <span className="eyebrow">CLIENT PORTAL</span>
            <h2>I am a trader</h2>
            <p>Open strategies, accounts, validation, analytics and subscription tools.</p>
            <strong>Continue as customer →</strong>
          </Link>
          <Link className="card portal-choice-card" href="/hq/login">
            <span className="eyebrow">HEADQUARTERS</span>
            <h2>I work at Trade Police</h2>
            <p>Open the workspace assigned to your employee identity and permissions.</p>
            <strong>Continue as employee →</strong>
          </Link>
        </div>
      </section>
    </main>
  );
}
