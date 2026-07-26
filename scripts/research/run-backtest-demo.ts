import { createBacktestDataset, runBacktest, type ExecutableStrategy } from '../../lib/backtesting/index.ts';

const candles = Array.from({ length: 600 }, (_, index) => {
  const trend = Math.floor(index / 75) % 2 === 0 ? index % 75 : 75 - index % 75;
  const close = 2_000 + trend * .8 + Math.sin(index / 4) * 3;
  return { timestamp: new Date(Date.UTC(2024, 0, 1, 0, index * 15)).toISOString(), open: close - .3, high: close + 1.5, low: close - 1.5, close, volume: 1_000 + index % 40 };
});
const dataset = createBacktestDataset({ symbol: 'XAUUSD', timeframe: 'M15', timezone: 'UTC', source: 'deterministic-development-fixture', candles });
const strategy = Object.freeze({
  id: 'demo-ema-breakout', name: 'EMA Breakout Demonstration', version: '1.0.0', direction: 'BOTH',
  entryRules: Object.freeze([
    { id: 'ema-trend', type: 'EMA_RELATION', fastPeriod: 10, slowPeriod: 24, relation: 'ABOVE' },
    { id: 'body', type: 'MIN_BODY_TO_RANGE', minimumRatio: .05 },
  ] as const),
  forbiddenRules: Object.freeze([]), stopLossRule: { type: 'ATR_MULTIPLE', period: 14, multiple: 1 },
  takeProfitRule: { type: 'ATR_MULTIPLE', period: 14, multiple: 2 }, maximumHoldingPeriod: 20, minimumRequiredConfirmations: 2,
} satisfies ExecutableStrategy);
const result = runBacktest(dataset, strategy, { configuration: { maximumHoldingBars: 20, costs: { commissionR: .02, spreadPrice: .2, slippagePrice: .05 } } });
console.log(JSON.stringify({
  dataset: result.datasetMetadata, candlesProcessed: result.datasetMetadata.candleCount, signalsFound: result.metrics.totalSignals,
  tradesExecuted: result.metrics.totalExecutedTrades, inSampleMetrics: result.inSample.metrics, outOfSampleMetrics: result.outOfSample.metrics,
  totalMetrics: result.total.metrics, warnings: result.warnings, classification: result.classification, sampleSizeQuality: result.metrics.sampleSizeQuality,
  reproducibility: result.reproducibility,
}, null, 2));
