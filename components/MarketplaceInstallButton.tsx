'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function MarketplaceInstallButton({ listingId, installed }: { listingId: string; installed: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function install() {
    setBusy(true); setMessage('');
    try {
      const response = await fetch(`/api/marketplace/${listingId}`, { method: 'POST' });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.message ?? 'Installation failed.');
      setMessage(body.install?.alreadyInstalled ? 'Already in your Strategies.' : 'Installed in Strategies. It stays inactive until you choose it.');
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Installation failed.');
    } finally { setBusy(false); }
  }
  return <div className="marketplace-install-action"><button className="button primary" type="button" disabled={busy || installed} onClick={() => void install()}>{installed ? 'Installed' : busy ? 'Installing…' : 'Add to my strategies'}</button>{message ? <p role="status">{message}</p> : null}</div>;
}
