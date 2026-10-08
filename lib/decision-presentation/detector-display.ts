export type DetectorPresentationItem = {
  title: string;
  status: 'pending' | 'warning' | 'info';
  humanLabel: string;
  timeframe?: string;
  explanation?: string;
};

const SAFE_LABEL_OVERRIDES: Record<string, string> = {
  h1TrendAligned: 'H1 trend aligned',
  h4TrendAligned: 'H4 trend aligned',
  structurePattern: 'Structure pattern',
  liquiditySweep: 'Liquidity sweep',
  chochConfirmed: 'ChoCH confirmed',
  bosConfirmed: 'BOS confirmed',
  orderBlock: 'Order block',
  fairValueGap: 'Fair value gap',
  retestConfirmed: 'Retest confirmed',
  premiumDiscount: 'Premium discount',
  rejectionCandle: 'Rejection candle',
  volumeConfirmation: 'Volume confirmation',
  volatilityRequirement: 'Volatility requirement',
  displacement: 'Displacement',
  smartMoneyOrderBlock: 'Smart-money order block',
  'smart-money-order-block': 'Smart-money order block',
  'smart-money-orderblock': 'Smart-money order block',
};

const SAFE_OPERATOR_LABELS: Record<string, string> = {
  IS_TRUE: 'Must be present',
  IS_FALSE: 'Must be absent',
  EXISTS: 'Must exist',
  REQUIRED: 'Required',
};

const SAFE_LABEL_OVERRIDE_INDEX = Object.fromEntries(
  Object.entries(SAFE_LABEL_OVERRIDES).map(([key, value]) => [key.toLowerCase().replace(/[^a-z0-9]+/g, ''), value]),
);

function normalizeIdentifier(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function toSafeDetectorDisplayModel(rawValue: unknown, fallback = 'Additional automatic confirmation is pending.'): DetectorPresentationItem | null {
  if (typeof rawValue !== 'string' || !rawValue.trim()) {
    return null;
  }

  const trimmed = rawValue.trim();
  if (trimmed.includes('{') || trimmed.includes('[') || trimmed.includes('%7B') || trimmed.includes('%22')) {
    return {
      title: 'Automatic detector review required',
      status: 'pending',
      humanLabel: fallback,
      explanation: undefined,
    };
  }

  const lower = trimmed.toLowerCase();
  const override = SAFE_LABEL_OVERRIDE_INDEX[normalizeIdentifier(trimmed)] ?? SAFE_LABEL_OVERRIDE_INDEX[normalizeIdentifier(lower)] ?? null;
  const operatorLabel = SAFE_OPERATOR_LABELS[trimmed.toUpperCase()] ?? null;
  const humanLabel = override ?? (operatorLabel ? operatorLabel : trimmed);

  return {
    title: 'Automatic detector review required',
    status: 'pending',
    humanLabel: humanLabel.length > 64 ? `${humanLabel.slice(0, 61)}...` : humanLabel,
    explanation: undefined,
  };
}

export function buildDetectorDisplayItems(values: readonly unknown[]): DetectorPresentationItem[] {
  return values
    .map((value) => toSafeDetectorDisplayModel(value))
    .filter((value): value is DetectorPresentationItem => value !== null);
}
