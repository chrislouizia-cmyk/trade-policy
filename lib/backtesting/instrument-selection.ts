export function normalizeStrategyInstruments(instruments: readonly string[] | null | undefined): string[] {
  return Array.from(new Set(
    (instruments ?? [])
      .map((instrument) => String(instrument).trim().toUpperCase())
      .filter(Boolean),
  ));
}

export function resolveBacktestInstrument(
  currentInstrument: string | null | undefined,
  enabledInstruments: readonly string[] | null | undefined,
): string {
  const normalizedInstruments = normalizeStrategyInstruments(enabledInstruments);
  const normalizedCurrent = String(currentInstrument ?? '').trim().toUpperCase();

  if (normalizedCurrent && normalizedInstruments.includes(normalizedCurrent)) {
    return normalizedCurrent;
  }

  return normalizedInstruments[0] ?? '';
}
