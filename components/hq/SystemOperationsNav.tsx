import Link from 'next/link';

export default function SystemOperationsNav({active}:{active:'health'|'compatibility'|'diagnostics'|'beta-intelligence'|'queue'|'incidents'}){
  return <nav className="sales-subnav" aria-label="System Operations">
    <Link className={active==='health'?'active':undefined} href="/hq/system">Health</Link>
    <Link className={active==='queue'?'active':undefined} href="/hq/system/queue">Action Queue</Link>
    <Link className={active==='incidents'?'active':undefined} href="/hq/system/queue?status=OPEN">Incidents</Link>
    <Link className={active==='compatibility'?'active':undefined} href="/hq/system/strategy-compatibility">Strategy Compatibility Inspector</Link>
    <Link className={active==='diagnostics'?'active':undefined} href="/hq/system/queue">Diagnostics</Link>
    <Link className={active==='beta-intelligence'?'active':undefined} href="/hq/system/beta-intelligence">Beta Intelligence</Link>
  </nav>;
}
