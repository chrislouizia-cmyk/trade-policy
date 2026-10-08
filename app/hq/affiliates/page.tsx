import AffiliateQueue from '@/components/hq/AffiliateQueue';
import { getHQContext, HQShell } from '@/lib/hq-page';

export default async function AffiliatesPage() {
  const { role, displayName, permissions } =
    await getHQContext('affiliate.manage');

  return (
    <HQShell
      displayName={displayName}
      role={role}
      permissions={permissions}
    >
      <div className="stack">
        <header>
          <span className="eyebrow">HQ GROWTH</span>
          <h1>Affiliates</h1>
          <p className="muted">
            Review applications, manage affiliate access, and monitor
            referral activity.
          </p>
        </header>

        <AffiliateQueue />
      </div>
    </HQShell>
  );
}
