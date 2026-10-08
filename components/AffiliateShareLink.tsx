'use client';

import { useState } from 'react';

export default function AffiliateShareLink({
  referralCode,
}: {
  referralCode: string;
}) {
  const [copied, setCopied] = useState(false);
  const path = `/r/${encodeURIComponent(referralCode)}`;

  async function copy() {
    const url = `${window.location.origin}${path}`;

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div>
      <p className="muted">
        Share your personal referral link. First valid attribution is preserved.
      </p>

      <div className="button-row">
        <button className="button-link primary" type="button" onClick={copy}>
          {copied ? 'Copied' : 'Copy referral link'}
        </button>

        <a className="button-link secondary" href={path} target="_blank" rel="noreferrer">
          Open link
        </a>
      </div>

      <p className="muted">
        <code>{path}</code>
      </p>
    </div>
  );
}
