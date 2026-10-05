export type CompanionSelection = {
  strategyId?: string;
  analysisId?: string;
  decisionSourceId?: string;
  tradeId?: string;
  backtestId?: string;
};
export type CompanionContextEvent = {
  context: CompanionSelection;
  reason:
    "ANALYSIS" | "DECISION" | "POSITION" | "BACKTEST" | "CHANGE" | "CLOSED";
  instrument?: string;
  timeframe?: string;
};
export function publishCompanionContext(detail: CompanionContextEvent) {
  if (typeof window !== "undefined")
    window.dispatchEvent(new CustomEvent("trade-police:context", { detail }));
}
