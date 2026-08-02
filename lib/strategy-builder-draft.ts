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

export function deriveStopLimitsForInstruments(instruments: string[], limits: StrategyDraftState['stopLimits']): StrategyDraftState['stopLimits'] {
  const byInstrument = new Map(limits.map((limit) => [limit.instrument, limit]));
  return instruments.map((instrument) => {
    const existing = byInstrument.get(instrument);
    return existing
      ? { ...existing, instrument }
      : {
          instrument,
          method: instrument.startsWith('XAU') || instrument.startsWith('XAG') ? 'POINTS' : 'PIPS',
          minimumValue: instrument.startsWith('XAU') ? 80 : 10,
          preferredValue: instrument.startsWith('XAU') ? 180 : 18,
          maximumValue: instrument.startsWith('XAU') ? 300 : 25,
        };
  });
}

export function buildPayloadInstruments(instruments: string[]) {
  return instruments.map((symbol, index) => ({
    symbol,
    market_type: symbol.startsWith('XAU') || symbol.startsWith('XAG') ? 'METALS' : 'FOREX',
    provider_symbol: null,
    sort_order: index,
    enabled: true,
  }));
}

export function buildPayloadStopLimits(instruments: string[], stopLimits: StrategyDraftState['stopLimits']) {
  return instruments.map((instrument) => {
    const current = stopLimits.find((limit) => limit.instrument === instrument) ?? {
      instrument,
      method: instrument.startsWith('XAU') || instrument.startsWith('XAG') ? 'POINTS' : 'PIPS',
      minimumValue: instrument.startsWith('XAU') ? 80 : 10,
      preferredValue: instrument.startsWith('XAU') ? 180 : 18,
      maximumValue: instrument.startsWith('XAU') ? 300 : 25,
    };

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
