import Image from 'next/image';
import Link from 'next/link';
import type { Locale } from '@/lib/i18n/config';
import { getLandingCopy } from '@/lib/i18n/landing-copy';

export default function PublicSiteHeader({locale}:{locale:Locale}) {
  const c=getLandingCopy(locale);
  return <nav className="public-site-nav" aria-label={c.navigation}>
    <Link className="public-site-brand" href="/" aria-label="Trade Police"><Image src="/brand/trade-police-logo.png" alt="Trade Police" width={232} height={48} priority/></Link>
    <div className="public-site-links"><Link href="/about">{c.about}</Link><Link href="/faq">FAQ</Link><Link href="/legal">{c.legal}</Link><Link href="/pricing">{c.pricing}</Link></div>
    <Link className="public-site-signin" href="/client/login">{c.signIn}</Link>
  </nav>;
}
