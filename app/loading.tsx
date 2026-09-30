import Image from 'next/image';

export default function AppLoading(){
  return <main className="route-loading-shell" aria-live="polite" aria-busy="true">
    <section className="route-loading-card">
      <Image src="/brand/trade-police-logo.png" alt="Trade Police" width={220} height={46} priority/>
      <div className="route-loading-indicator" aria-hidden="true"><span/><span/><span/></div>
      <p>Opening your workspace…</p>
    </section>
  </main>;
}
