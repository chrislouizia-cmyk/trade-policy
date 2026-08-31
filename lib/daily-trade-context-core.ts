export function isCountableDailyTradeExecution(
  row: { id?: string | null; source?: string | null; status?: string | null; created_at?: string | null; strategy_snapshot?: Record<string, unknown> | null; simulation_mode?: string | null },
  successfulActivatedTradeRecordIds: Set<string>,
): boolean {
  const simulationMode = row.simulation_mode ?? row.strategy_snapshot?.simulationMode ?? row.strategy_snapshot?.testSource ?? row.strategy_snapshot?.internalTestMode;
  const isSimulationRow = row.source === 'SIMULATION' || simulationMode === 'INTERNAL_LIFECYCLE_SMOKE_TEST' || String(simulationMode ?? '').toLowerCase() === 'internal_lifecycle_smoke_test';

  if (isSimulationRow) return false;
  if (row.source !== 'EXECUTED') return false;
  if (!row.id) return false;
  if (!successfulActivatedTradeRecordIds.has(row.id)) return false;
  return true;
}
