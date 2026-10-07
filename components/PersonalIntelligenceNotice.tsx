'use client';

import type { IntelligenceIntervention } from '@/lib/trader-intelligence';

export type PersonalIntelligencePayload = {
  authoritative: false;
  controlsVerdict: false;
  interventions: IntelligenceIntervention[];
};

export default function PersonalIntelligenceNotice({ intelligence }: { intelligence?: PersonalIntelligencePayload | null }) {
  const interventions = intelligence?.interventions ?? [];
  if (!interventions.length) return null;
  const [primary, ...more] = interventions;
  return <aside className={`personal-intelligence-notice severity-${primary.severity.toLowerCase()}`} aria-label="Personal intelligence">
    <div className="personal-intelligence-mark" aria-hidden="true">TP</div>
    <div>
      <p className="personal-intelligence-label">PERSONAL INTELLIGENCE · {primary.sampleSize} RECORDED TRADES</p>
      <strong>{primary.title}</strong>
      <p>{primary.detail}</p>
      {more.length ? <details><summary>{more.length} additional personal pattern{more.length === 1 ? '' : 's'}</summary>{more.map(item => <div className="personal-intelligence-more" key={item.key}><strong>{item.title}</strong><p>{item.detail}</p></div>)}</details> : null}
      <small>Context only · your strategy and deterministic rules still control the verdict.</small>
    </div>
  </aside>;
}
