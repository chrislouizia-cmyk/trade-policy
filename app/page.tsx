import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { isPortalHostname } from '@/lib/hostname-routing';
import { getRequestLocale } from '@/lib/i18n/server';
import { getLandingCopy } from '@/lib/i18n/landing-copy';
import styles from './trade-police-landing.module.css';

function FlowIcon({type}:{type:'rules'|'test'|'decision'|'review'}) {
  const paths={rules:<><path d="M8 7h8M8 12h5M8 17h7"/><path d="M5 4h14v16H5z"/></>,test:<><path d="M4 18l5-6 4 3 7-9"/><path d="M4 5v14h16"/></>,decision:<><path d="M12 3l8 3v5c0 5-3.4 8.4-8 10-4.6-1.6-8-5-8-10V6z"/><path d="M8.5 12l2.2 2.2 4.8-5"/></>,review:<><path d="M4 18V9m5 9V5m5 13v-7m5 7V3"/><path d="M3 21h18"/></>};
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[type]}</svg>;
}

export default async function LandingPage() {
  const [headerStore,locale]=await Promise.all([headers(),getRequestLocale()]);
  if(isPortalHostname(headerStore.get('host'))) redirect('/dashboard');
  const c=getLandingCopy(locale);
  const icons=['rules','test','decision','review'] as const;

  return <main className={styles.page}>
    <nav className={styles.nav} aria-label={c.navigation}>
      <Link className={styles.brand} href="/" aria-label="Trade Police"><Image src="/brand/trade-police-logo.png" alt="Trade Police" width={232} height={48} priority /></Link>
      <div className={styles.navLinks}><a href="#system">{c.system}</a><a href="#workflow">{c.workflow}</a><a href="#trust">{c.trust}</a><Link href="/faq">FAQ</Link><Link href="/pricing">{c.pricing}</Link></div>
      <div className={styles.navActions}><Link href="/client/login">{c.signIn}</Link><Link className={styles.navCta} href="/client/login?mode=signup&next=/onboarding">{c.startFree}</Link></div>
    </nav>

    <section className={styles.hero}>
      <div className={styles.heroCopy}><p className={styles.kicker}><span/>{c.kicker}</p><h1>{c.heroTitle}<em>{c.heroAccent}</em></h1><p className={styles.heroLead}>{c.heroLead}</p><div className={styles.actions}><Link className={styles.primaryCta} href="/client/login?mode=signup&next=/onboarding">{c.checkSetup}<span>→</span></Link><a className={styles.secondaryCta} href="#system">{c.seeSystem}</a></div><p className={styles.micro}>{c.disclaimer}</p></div>
      <div className={styles.heroVisual} aria-label={c.illustrationLabel}>
        <div className={styles.ambientOrb}/><div className={styles.terminal}><header><span><i/>TRADE POLICE</span><small>{c.liveDecision}</small></header><div className={styles.terminalBody}><aside><small>{c.yourRules}</small><strong>XAUUSD · M15</strong><div><i className={styles.good}/>{c.trend}</div><div><i className={styles.good}/>{c.structure}</div><div><i className={styles.wait}/>{c.liquidity}</div></aside><article><span className={styles.waitBadge}>WAIT</span><small>{c.currentVerdict}</small><strong>68%</strong><div className={styles.score}><i/></div><p>{c.missingEvidence}</p></article><aside><small>{c.riskCheck}</small><dl><div><dt>{c.risk}</dt><dd>0.50%</dd></div><div><dt>{c.minimumRR}</dt><dd>1:2.0</dd></div><div><dt>{c.status}</dt><dd>{c.held}</dd></div></dl></aside></div><footer><span>{c.aiExplains}</span><strong>{c.rulesDecide}</strong></footer></div>
        <div className={`${styles.floatCard} ${styles.floatTop}`}><span>✓</span><div><small>{c.evidence}</small><strong>{c.attached}</strong></div></div><div className={`${styles.floatCard} ${styles.floatBottom}`}><span>↗</span><div><small>{c.lifecycle}</small><strong>{c.preserved}</strong></div></div>
      </div>
    </section>

    <section id="trust" className={styles.trustBar}>{c.trustPoints.map(([title,copy])=><article key={title}><span>✓</span><div><strong>{title}</strong><small>{copy}</small></div></article>)}</section>
    <section id="system" className={styles.statement}><p className={styles.kicker}>{c.notAnother}</p><h2>{c.pauseTitle}</h2><p>{c.pauseCopy}</p><div className={styles.verdictRail}><span className={styles.ready}>READY</span><i/><span className={styles.waitState}>WAIT</span><i/><span className={styles.blocked}>BLOCKED</span><small>{c.oneSystem}</small></div></section>
    <section id="workflow" className={styles.workflowSection}><header><p className={styles.kicker}>{c.workflowKicker}</p><h2>{c.workflowTitle}</h2></header><div className={styles.workflowGrid}>{c.steps.map((step,index)=><article key={step.title}><div className={styles.stepTop}><span>0{index+1}</span><FlowIcon type={icons[index]}/></div><h3>{step.title}</h3><p>{step.copy}</p><small>{step.meta}</small></article>)}</div></section>
    <section className={styles.featureSplit}><div className={styles.journalVisual} aria-hidden="true"><div className={styles.timeline}/><article><span>09:42</span><strong>{c.decisionSaved}</strong><small>WAIT · 68%</small></article><article><span>10:06</span><strong>{c.tradeOpened}</strong><small>XAUUSD · SELL</small></article><article><span>12:18</span><strong>{c.tradeClosed}</strong><small>+1.84R</small></article><div className={styles.curve}><i/><i/><i/><i/><i/></div></div><div><p className={styles.kicker}>{c.memoryKicker}</p><h2>{c.memoryTitle}</h2><p>{c.memoryCopy}</p><ul><li>{c.memoryOne}</li><li>{c.memoryTwo}</li><li>{c.memoryThree}</li></ul></div></section>
    <section className={styles.boundary}><div><p className={styles.kicker}>{c.clearBoundary}</p><h2>{c.controlTitle}</h2></div><div className={styles.boundaryGrid}>{c.boundaries.map(([title,copy])=><article key={title}><strong>{title}</strong><p>{copy}</p></article>)}</div></section>
    <section className={styles.faq}><div><p className={styles.kicker}>FAQ</p><h2>{c.faqTitle}</h2></div><div>{c.faqs.map(([question,answer])=><details key={question}><summary>{question}<span>+</span></summary><p>{answer}</p></details>)}</div></section>
    <section className={styles.finalCta}><div className={styles.finalMark}><Image src="/brand/trade-police-mark.png" alt="" width={96} height={96}/></div><p className={styles.kicker}>{c.finalKicker}</p><h2>{c.finalTitle}</h2><p>{c.finalCopy}</p><Link className={styles.primaryCta} href="/client/login?mode=signup&next=/onboarding">{c.startFree}<span>→</span></Link></section>
    <footer className={styles.footer}><Image src="/brand/trade-police-logo.png" alt="Trade Police" width={190} height={40}/><span>© 2026 Trade Police</span><nav><Link href="/about">{c.about}</Link><Link href="/faq">FAQ</Link><Link href="/legal">{c.legal}</Link><Link href="/pricing">{c.pricing}</Link></nav></footer>
  </main>;
}
