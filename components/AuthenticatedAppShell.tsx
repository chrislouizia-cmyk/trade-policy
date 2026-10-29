import type { ReactNode } from 'react';
import AppHeader from '@/components/AppHeader';
import FeedbackWidget from '@/components/FeedbackWidget';
import MobileBottomNav from '@/components/MobileBottomNav';
import { createClient } from '@/lib/supabase/server';

type AuthenticatedAppShellProps = {
  children: ReactNode;
  eyebrow: string;
  displayName: string;
  description: string;
  userId: string;
  decisionFocused?: boolean;
  showContext?: boolean;
  className?: string;
};

export default async function AuthenticatedAppShell({
  children,
  eyebrow,
  displayName,
  description,
  userId,
  decisionFocused = false,
  showContext = false,
  className = '',
}: AuthenticatedAppShellProps) {
  const supabase = await createClient();
  const { count } = await supabase
    .from('active_trades')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'OPEN');
  const activeTradeCount = count ?? 0;

  return (
    <main className={`container authenticated-app-shell ${className}`.trim()}>
      <AppHeader
        eyebrow={eyebrow}
        displayName={displayName}
        description={description}
        activeTradeCount={activeTradeCount}
        decisionFocused={decisionFocused}
        showContext={showContext}
      />
      <div className="authenticated-shell-content">{children}</div>
      <MobileBottomNav activeTradeCount={activeTradeCount} />
      <FeedbackWidget userId={userId} />
    </main>
  );
}
