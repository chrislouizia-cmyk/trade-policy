'use client';

import { useState } from 'react';

export default function InstallCommunityStrategy({shareCode}:{shareCode:string}) {
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  const [installed,setInstalled] = useState(false);
  async function install() {
    if (busy || installed) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/community/install',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({shareCode})
      });
      const data = await response.json();
      if (response.status===401) {
        setMessage('Sign in to Trade Police before installing.');
      } else if (data.installed) {
        setInstalled(true);
        setMessage('Installed as a private, inactive copy. Review your strategy before activating.');
      } else {
        setMessage(data.error || 'Installation failed.');
      }
    } catch {
      setMessage('Connection error. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return <div>
    <button type="button" disabled={busy || installed} onClick={install}
      style={{padding:'10px 18px',borderRadius:10,cursor:busy?'wait':'pointer'}}>
      {busy?'Installing…':installed?'Installed':'Install free strategy'}
    </button>
    {message && <p role="status" aria-live="polite">{message}</p>}
  </div>;
}
