import Link from 'next/link';

export default function AppFooter() {
  return (
    <footer className="app-footer">
      <div className="app-footer-inner">
        <span>© 2026 Trade Police. All rights reserved.</span>
        <Link href="/community">Community Strategies</Link>
      </div>
    </footer>
  );
}
