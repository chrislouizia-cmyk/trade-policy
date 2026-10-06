import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserDisplayName } from "@/lib/user-display-name";
import AuthenticatedAppShell from "@/components/AuthenticatedAppShell";
import Dashboard from "@/components/Dashboard";
import { getRequestLocale } from "@/lib/i18n/server";
import { workspaceText } from "@/lib/i18n/workspace-copy";
import { loadTraderContext } from "@/lib/server/trader-context";

export default async function DashboardPage() {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/client/login?next=/dashboard");
  const { data: profile } = await client.from("profiles").select("profile_completed").eq("id", user.id).maybeSingle();
  if (!profile?.profile_completed) redirect("/onboarding");

  const [displayName, locale] = await Promise.all([getUserDisplayName(client, user), getRequestLocale()]);
  const [{ data: account }, { data: strategy }, { data: open }, { data: closed }, { count: analysisCount }, intelligence] = await Promise.all([
    client.from("trading_accounts").select("*").eq("is_active", true).eq("is_archived", false).maybeSingle(),
    client.from("strategy_profiles").select("*").eq("is_default", true).eq("is_archived", false).maybeSingle(),
    client.from("active_trades").select("id", { count: "exact" }).eq("status", "OPEN"),
    client.from("active_trades").select("realized_pnl,outcome,taken_against_verdict,closed_at").eq("status", "CLOSED").gte("closed_at", new Date(new Date().setHours(0, 0, 0, 0)).toISOString()),
    client.from('market_scans').select('id',{count:'exact',head:true}),
    loadTraderContext(client, user.id).then((value) => value.summary).catch(() => null),
  ]);
  const rows = closed ?? [];
  const todayPnl = rows.reduce((sum, trade) => sum + Number(trade.realized_pnl ?? 0), 0);
  const wins = rows.filter((trade) => trade.outcome === "WIN").length;
  const losses = rows.filter((trade) => trade.outcome === "LOSS").length;
  const disciplined = rows.filter((trade) => !trade.taken_against_verdict).length;

  return <AuthenticatedAppShell eyebrow={workspaceText(locale, "TRADE POLICE / DASHBOARD")} displayName={displayName} description={workspaceText(locale, "Your account, strategy and discipline in one place.")} userId={user.id} showContext>
    <Dashboard locale={locale} displayName={displayName} account={account} strategy={strategy} openTrades={open?.length ?? 0} todayPnl={todayPnl} wins={wins} losses={losses} discipline={rows.length ? Math.round((disciplined / rows.length) * 100) : null} closedTradesToday={rows.length} hasTrade={(analysisCount??0)>0} intelligence={intelligence}/>
  </AuthenticatedAppShell>;
}

