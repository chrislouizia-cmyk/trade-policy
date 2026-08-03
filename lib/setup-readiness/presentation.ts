import type {ChartAnalysis, LayerAnalysis} from '@/types/trade';

type ReadinessSummary = NonNullable<ChartAnalysis['setupReadiness']>;

type LayerCardPresentation = {
  category: string;
  timeframe: string;
  state: string;
  confidencePercentage: number | null;
  mode: string;
  pendingConfirmations: string[];
  supportingDetails: string[];
};

type MetadataItem = {
  label: string;
  value: string;
};

export function getSetupReadinessLayoutColumns(width: number) {
  if (width >= 1280) {
    return 3;
  }

  if (width >= 768) {
    return 2;
  }

  return 1;
}

export function formatHumanLabel(label: string) {
  const normalized = label
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();

  if (!normalized) {
    return label;
  }

  const acronymOverrides: Record<string, string> = {
    bos: 'BOS',
    choch: 'ChoCH',
    fvg: 'FVG',
    h1: 'H1',
    h4: 'H4',
    d1: 'D1',
    m30: 'M30',
  };

  return normalized
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const cleaned = word.replace(/[^a-zA-Z0-9]/g, '');
      if (!cleaned) {
        return '';
      }

      const lookupKey = cleaned.toLowerCase();
      if (acronymOverrides[lookupKey]) {
        return acronymOverrides[lookupKey];
      }

      if (/[0-9]/.test(cleaned)) {
        return cleaned.toUpperCase();
      }

      if (/^[A-Z]+$/.test(cleaned)) {
        return cleaned;
      }

      if (word === normalized.split(/\s+/)[0]) {
        return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
      }

      return cleaned.toLowerCase();
    })
    .join(' ');
}

function formatReadinessState(state: ReadinessSummary['state'] | undefined) {
  switch (state) {
    case 'READY':
      return 'Ready';
    case 'NOT_READY':
      return 'Not ready';
    case 'WAITING_FOR_CONFIRMATION':
      return 'Waiting for confirmation';
    case 'CONFIGURATION_REQUIRED':
      return 'Configuration required';
    default:
      return 'Unclear';
  }
}

function formatClock(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function buildLayerCardPresentation(layer: LayerAnalysis): LayerCardPresentation {
  const pendingConfirmations = (layer.missingEvidence ?? []).map((item) => formatHumanLabel(item));
  const supportingDetails = (layer.confirmedEvidence ?? []).map((item) => formatHumanLabel(item));

  return {
    category: layer.role,
    timeframe: layer.timeframe,
    state: layer.bias,
    confidencePercentage: layer.confidence ?? null,
    mode: layer.confidence == null ? 'Context only' : 'Automatic confirmations',
    pendingConfirmations,
    supportingDetails,
  };
}

export function buildSetupReadinessMetadata(params: {
  instrument: string;
  timeframe: string;
  calculatedAt: string;
  liveAnalysisConfidence: number | null;
  strategyConfidenceThreshold: number;
  setupReadiness?: Pick<ReadinessSummary, 'percentage' | 'state'>;
}): MetadataItem[] {
  const readinessPercentage = params.setupReadiness?.percentage == null ? 'Pending' : `${params.setupReadiness.percentage}%`;
  const requiredPercentage = `${params.strategyConfidenceThreshold}%`;
  const result = params.liveAnalysisConfidence == null
    ? 'Pending'
    : params.liveAnalysisConfidence >= params.strategyConfidenceThreshold
      ? 'Meets required readiness'
      : 'Below required readiness';

  return [
    { label: 'Status', value: formatReadinessState(params.setupReadiness?.state) },
    { label: 'Setup readiness', value: readinessPercentage },
    { label: 'Required', value: requiredPercentage },
    { label: 'Result', value: result },
    { label: 'Checked', value: formatClock(params.calculatedAt) },
    { label: 'Instrument', value: params.instrument },
    { label: 'Timeframe', value: params.timeframe },
  ];
}
