export type PatternEvidence = {
  status: "OBSERVED" | "REPEATED" | "CONFLICTING" | "STALE";
  activeDays: number;
  latestClosedAt: string;
  discoveryTrades: number;
  validationTrades: number;
  discoveryAverageR: number;
  validationAverageR: number;
  explanation: string;
};

// Policy thresholds, not a statistical confidence score or proof of causality.
// Later records are held apart from discovery to expose direction changes.
export function assessPatternEvidence(
  records: Array<{ result_r?: number | string | null; closed_at?: string | null }>,
  now: Date,
  timezone: string,
): PatternEvidence {
  const rows = records.filter(row => row.closed_at && Number.isFinite(Date.parse(row.closed_at)) &&
    Date.parse(row.closed_at) <= now.getTime() && row.result_r != null &&
    String(row.result_r).trim() !== "" && Number.isFinite(Number(row.result_r)))
    .sort((a, b) => Date.parse(a.closed_at!) - Date.parse(b.closed_at!));
  const split = Math.floor(rows.length * 2 / 3);
  const discovery = rows.slice(0, split);
  const validation = rows.slice(split);
  const mean = (items: typeof rows) => items.length
    ? Math.round(items.reduce((sum, row) => sum + Number(row.result_r), 0) / items.length * 1000) / 1000 : 0;
  const discoveryAverageR = mean(discovery);
  const validationAverageR = mean(validation);
  const latestClosedAt = rows.at(-1)?.closed_at ?? "";
  const activeDays = new Set(rows.map(row => new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(row.closed_at!)))).size;
  let status: PatternEvidence["status"] = "OBSERVED";
  let explanation = "Early observation; insufficient independent days or later evidence to adapt.";
  if (!latestClosedAt || now.getTime() - Date.parse(latestClosedAt) > 90 * 86400000) {
    status = "STALE";
    explanation = "No recorded outcome in this context within 90 days; review before reuse.";
  } else if (discovery.length >= 10 && validation.length >= 5 &&
    Math.sign(discoveryAverageR) !== Math.sign(validationAverageR)) {
    status = "CONFLICTING";
    explanation = "Later outcomes disagree with discovery; the prior direction should not drive coaching.";
  } else if (rows.length >= 30 && validation.length >= 10 && activeDays >= 5 &&
    discoveryAverageR !== 0 && Math.sign(discoveryAverageR) === Math.sign(validationAverageR) &&
    Date.parse(validation[0].closed_at!) > Date.parse(discovery.at(-1)!.closed_at!)) {
    status = "REPEATED";
    explanation = "Direction repeats in later records across multiple days; recorded association, not a verified edge.";
  }
  return { status, activeDays, latestClosedAt, discoveryTrades: discovery.length,
    validationTrades: validation.length, discoveryAverageR, validationAverageR, explanation };
}
