import { defaultStopMethod, type CatalogInstrument, type MarketType } from './instrument-catalog.ts';
import { getSupportedInstrument } from './instrument-registry.ts';

export type StrategyDraftState = {
  profile: {
    id?: string;
    name: string;
    description?: string;
    isDefault?: boolean;
    instruments: string[];
  };
  stopLimits: Array<{
    instrument: string;
    method: 'PIPS' | 'POINTS' | 'TICKS' | 'PERCENT' | 'ATR' | 'STRUCTURAL';
    minimumValue?: number;
    preferredValue?: number;
    maximumValue: number;
    atrMultiplier?: number;
  }>;
};

export function createBlankStrategyDraft(): StrategyDraftState {
  return {
    profile: {
      id: undefined,
      name: 'New Strategy',
      description: '',
      isDefault: false,
      instruments: [],
    },
    stopLimits: [],
  };
}

export function createNewStrategyDraft(previous?: { instruments?: string[] }): StrategyDraftState {
  const blank = createBlankStrategyDraft();
  return previous?.instruments?.length ? { ...blank, profile: { ...blank.profile, instruments: [] } } : blank;
}

export function createStarterTemplateSelection() {
  return {
    instruments: ['XAUUSD'],
    confirmed: false,
  };
}

export function createStarterStrategyDraft() {
  const selection = createStarterTemplateSelection();
  return {
    profile: {
      id: undefined,
      name: 'My Starter Strategy',
      description: 'A transparent starting point. Review every rule before using it with real risk.',
      isDefault: true,
      instruments: selection.confirmed ? selection.instruments : [],
    },
    stopLimits: selection.confirmed ? selection.instruments.map((instrument) => ({ instrument, method: 'POINTS' as const, minimumValue: 80, preferredValue: 180, maximumValue: 300 })) : [],
  };
}

export function hydrateDraftFromSavedProfile(profile: StrategyDraftState['profile'], stopLimits: StrategyDraftState['stopLimits']): StrategyDraftState {
  const selectedInstruments = Array.isArray(profile.instruments) ? profile.instruments.filter(Boolean) : [];
  return {
    profile: { ...profile, instruments: selectedInstruments },
    stopLimits: deriveStopLimitsForInstruments(selectedInstruments, stopLimits),
  };
}

function marketTypeFor(symbol: string, catalog: readonly CatalogInstrument[]): MarketType {
  const resolved = catalog.find((item) => item.symbol === symbol)?.marketType;
  if (resolved) return resolved;
  return getSupportedInstrument(symbol)?.marketType ?? 'FOREX';
}

function defaultStopLimit(instrument: string, marketType: MarketType): StrategyDraftState['stopLimits'][number] {
  if (marketType === 'FOREX') return { instrument, method: 'PIPS', minimumValue: 10, preferredValue: 18, maximumValue: 25 };
  if (marketType === 'METALS') return { instrument, method: 'POINTS', minimumValue: 80, preferredValue: 180, maximumValue: 300 };
  if (marketType === 'STOCKS' || marketType === 'ETFS' || marketType === 'CRYPTO') {
    return { instrument, method: 'PERCENT', minimumValue: 0.25, preferredValue: 0.75, maximumValue: 2 };
  }
  return { instrument, method: defaultStopMethod(marketType), minimumValue: 4, preferredValue: 12, maximumValue: 40 };
}

export function deriveStopLimitsForInstruments(instruments: string[], limits: StrategyDraftState['stopLimits'], catalog: readonly CatalogInstrument[] = []): StrategyDraftState['stopLimits'] {
  const byInstrument = new Map(limits.map((limit) => [limit.instrument, limit]));
  return instruments.map((instrument) => {
    const existing = byInstrument.get(instrument);
    return existing
      ? { ...existing, instrument }
      : defaultStopLimit(instrument, marketTypeFor(instrument, catalog));
  });
}

export function buildPayloadInstruments(instruments: string[], catalog: readonly CatalogInstrument[] = []) {
  return instruments.map((symbol, index) => ({
    symbol,
    market_type: marketTypeFor(symbol, catalog),
    provider_symbol: catalog.find((item) => item.symbol === symbol)?.providerSymbol ?? getSupportedInstrument(symbol)?.twelveDataSymbol ?? null,
    sort_order: index,
    enabled: true,
  }));
}

export function buildPayloadStopLimits(instruments: string[], stopLimits: StrategyDraftState['stopLimits'], catalog: readonly CatalogInstrument[] = []) {
  return instruments.map((instrument) => {
    const current = stopLimits.find((limit) => limit.instrument === instrument)
      ?? defaultStopLimit(instrument, marketTypeFor(instrument, catalog));

    return {
      instrument,
      method: current.method,
      minimum_value: current.minimumValue ?? 0,
      preferred_value: current.preferredValue ?? current.maximumValue,
      maximum_value: current.maximumValue,
      atr_multiplier: current.atrMultiplier ?? null,
    };
  });
}
