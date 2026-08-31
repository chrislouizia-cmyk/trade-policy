import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { getPollingIntervalMs, mergeIncomingCandles, resolveCandlesFetchOutcome as resolveCandlesFetchOutcomeFromHook } from '../components/useMarketCandles.ts';
import type { Candle } from '../lib/market-analysis.ts';
import { parseMarketCandleRequest } from '../lib/market-candle-request.ts';
import { normalizeTwelveDataCandles } from '../lib/market-data.ts';
import { activatePositionOverlay, assessPositionGeometry, positionOverlayProvenance, proposedPositionFromCandidate, updateProposedGeometry } from '../lib/position-geometry.ts';

const normalizeMarketCandlesError = (value: unknown, fallback: string): string => {
  const payload = value && typeof value === 'object' && 'error' in value ? value.error ?? value : value;
  const message = (() => {
    if (!payload || typeof payload !== 'object') return fallback;
    if (typeof payload === 'string') return payload;
    const candidate = payload as { error?: unknown; message?: unknown };
    const error = ('error' in payload ? (payload as { error?: unknown }).error ?? payload : payload) as unknown;
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') return (error as { message: string }).message;
    if (typeof candidate.message === 'string') return candidate.message;
    return fallback;
  })();
  return typeof message === 'string' && message.trim() ? message : fallback;
};

const resolveCandlesFetchOutcomeLocal = (previousCandles: Candle[], payload: unknown, manualRefresh: boolean) => {
  const fallback = manualRefresh ? 'Unable to refresh market data.' : 'Unable to load market data.';
  if (payload && typeof payload === 'object' && Array.isArray((payload as { candles?: Candle[] }).candles)) {
    return {
      candles: [...((payload as { candles: Candle[] }).candles)],
      provider: (payload as { provider?: string | null }).provider ?? null,
      error: '',
    };
  }
  return {
    candles: manualRefresh ? [...previousCandles] : [],
    provider: null,
    error: normalizeMarketCandlesError(payload, fallback),
  };
};

const candidate = { id: 'candidate-1', direction: 'BUY' as const, entryLow: 100, entryHigh: 100, stopLoss: 98, takeProfit: 104, rr: 2, status: 'READY' as const, rationale: 'fixture' };

test('candle request validates and normalizes instrument, timeframe, and range', () => {
  const result = parseMarketCandleRequest({ instrument: 'gbpusd', timeframe: 'h1', from: '2025-01-01T00:00:00.000Z', to: '2025-01-02T00:00:00.000Z' });
  assert.deepEqual(result, { ok: true, value: { instrument: 'GBPUSD', timeframe: 'H1', from: '2025-01-01T00:00:00.000Z', to: '2025-01-02T00:00:00.000Z' } });
  assert.equal(parseMarketCandleRequest({ instrument: 'UNKNOWN', timeframe: 'H1', from: '2025-01-01T00:00:00.000Z', to: '2025-01-02T00:00:00.000Z' }).ok, false);
  assert.equal(parseMarketCandleRequest({ instrument: 'GBPUSD', timeframe: 'H7', from: '2025-01-01T00:00:00.000Z', to: '2025-01-02T00:00:00.000Z' }).ok, false);
  assert.equal(parseMarketCandleRequest({ instrument: 'GBPUSD', timeframe: 'H1', from: '2025-01-02T00:00:00.000Z', to: '2025-01-01T00:00:00.000Z' }).ok, false);
});

test('Twelve Data candles normalize deterministically to UTC numeric OHLC', () => {
  assert.deepEqual(normalizeTwelveDataCandles([{ datetime: '2025-01-01 12:00:00', open: '1', high: '3', low: '0.5', close: '2', volume: '9' }], 'GBPUSD', 'H1'), [{ datetime: '2025-01-01T12:00:00.000Z', open: 1, high: 3, low: 0.5, close: 2, volume: 9 }]);
  assert.throws(() => normalizeTwelveDataCandles([{ datetime: 'bad', open: 1, high: 3, low: 0.5, close: 2 }]), /malformed/);
});

test('candidate creates a proposed controlled overlay model', () => {
  const model = proposedPositionFromCandidate('GBPUSD', candidate)!;
  assert.equal(model.status, 'PROPOSED');
  assert.deepEqual(model.currentGeometry, { instrument: 'GBPUSD', direction: 'BUY', entry: 100, stopLoss: 98, takeProfit: 104 });
  assert.equal(model.selectedCandidateId, 'candidate-1');
});

test('controlled geometry edits update the overlay and record edited fields', () => {
  const model = updateProposedGeometry(proposedPositionFromCandidate('GBPUSD', candidate)!, { entry: 101, takeProfit: 105 });
  assert.equal(model.currentGeometry.entry, 101);
  assert.deepEqual(model.editedFields, ['entry', 'takeProfit']);
  assert.equal(model.geometryEdited, true);
});

test('R:R calculation supports valid long and short geometry', () => {
  assert.equal(assessPositionGeometry({ instrument: 'GBPUSD', direction: 'BUY', entry: 100, stopLoss: 98, takeProfit: 106 }).rr, 3);
  assert.equal(assessPositionGeometry({ instrument: 'GBPUSD', direction: 'SELL', entry: 100, stopLoss: 102, takeProfit: 94 }).rr, 3);
});

test('invalid long and short geometry never fabricates R:R', () => {
  assert.deepEqual(assessPositionGeometry({ instrument: 'GBPUSD', direction: 'BUY', entry: 100, stopLoss: 101, takeProfit: 104 }), { valid: false, rr: null, reason: 'Long setup requires Stop Loss < Entry < Take Profit.' });
  assert.deepEqual(assessPositionGeometry({ instrument: 'GBPUSD', direction: 'SELL', entry: 100, stopLoss: 99, takeProfit: 95 }), { valid: false, rr: null, reason: 'Short setup requires Take Profit < Entry < Stop Loss.' });
});

test('activation freezes accepted geometry and authoritative identities', () => {
  const proposed = updateProposedGeometry(proposedPositionFromCandidate('GBPUSD', candidate)!, { entry: 101 });
  const active = activatePositionOverlay(proposed, { activeTradeId: 'trade-1', tradeRecordId: 'record-1', acceptedAt: '2025-01-01T00:00:00.000Z' });
  assert.equal(active.status, 'ACTIVE');
  assert.deepEqual(active.acceptedGeometry, proposed.currentGeometry);
  assert.equal(active.activeTradeId, 'trade-1');
});

test('proposal provenance preserves original and accepted geometry', () => {
  const proposed = updateProposedGeometry(proposedPositionFromCandidate('GBPUSD', candidate)!, { entry: 101, takeProfit: 107 });
  const provenance = positionOverlayProvenance(proposed, '2025-01-01T00:00:00.000Z');
  assert.equal(provenance.originalProposedGeometry.entry, 100);
  assert.equal(provenance.acceptedGeometry.entry, 101);
  assert.equal(provenance.geometryEdited, true);
  assert.deepEqual(provenance.editedFields, ['entry', 'takeProfit']);
});

test('instrument precision and initial visible range obey the chart contract', () => {
  const chart = fs.readFileSync('components/MarketPositionChart.tsx', 'utf8');
  assert.match(chart, /getInstrumentPriceScaleConfig\(instrument: string\)/);
  assert.match(chart, /if \(\/\(JPY\)\/\.test\(value\)\) return \{ precision: 3, minMove: 0\.001 \};/);
  assert.match(chart, /if \(\/\(EUR\|GBP\|USD\|AUD\|NZD\|CAD\|CHF\)\/\.test\(value\)\) return \{ precision: 5, minMove: 0\.00001 \};/);
  assert.match(chart, /getPreferredVisibleBarCount\(timeframe: string\)/);
  assert.match(chart, /getInitialVisibleLogicalRange\(candleCount: number, timeframe: string\)/);
  assert.match(chart, /Math\.max\(0, candleCount - Math\.min\(candleCount, preferred\)\)/);
  assert.match(chart, /setVisibleLogicalRange\(\{ from: range\.from, to: range\.to \}\)/);
  assert.match(chart, /scaleMargins: \{ top: 0\.12, bottom: 0\.18 \}/);
});

test('initial logical-index viewport is based on actual candle counts without a wall-clock future gap', () => {
  const chart = fs.readFileSync('components/MarketPositionChart.tsx', 'utf8');
  assert.match(chart, /getInitialVisibleRange\(candleCount, preferred\)/);
  assert.match(chart, /Math\.max\(0, candleCount - Math\.min\(candleCount, preferred\)\)/);
  assert.doesNotMatch(chart, /Date\.now\(|new Date\(\)|Math\.max\(0, .*now|Date\.parse\(.*candle/);
  assert.match(chart, /getPreferredVisibleBarCount\(timeframe\)/);
  assert.match(chart, /case 'M5': return 220|case 'M30': return 180|case 'H1': return 120|case 'H4': return 90|case 'D1': return 60/);
});

test('timeframe selection resets viewport density and keeps bars readable', () => {
  const chart = fs.readFileSync('components/MarketPositionChart.tsx', 'utf8');
  assert.match(chart, /initialVisibleRangeRef\.current = false;\s*}, \[instrument, timeframe\]\)/);
  assert.match(chart, /getPreferredVisibleBarCount\(timeframe\)/);
  assert.match(chart, /case 'M5': return 220/);
  assert.match(chart, /case 'M30': return 180/);
  assert.match(chart, /case 'H1': return 120/);
  assert.match(chart, /case 'H4': return 90/);
  assert.match(chart, /case 'D1': return 60/);
  assert.match(chart, /scaleMargins: \{ top: 0\.12, bottom: 0\.18 \}/);
});

test('zoom controls and current line retain chart ownership and previous-candle deltas', () => {
  const chart = fs.readFileSync('components/MarketPositionChart.tsx', 'utf8');
  assert.match(chart, /setVisibleLogicalRange\(|fitContent\(|createPriceLine\(/);
  assert.match(chart, /currentPriceLineRef/);
  assert.match(chart, /entryPriceLineRef/); assert.match(chart, /stopLossPriceLineRef/); assert.match(chart, /takeProfitPriceLineRef/);
  assert.match(chart, /hoveredPreviousClose|hoveredChangePercent/);
  assert.doesNotMatch(chart, /priceLines\(\)\s*;\s*for \(const line of lines\)\s*series\.removePriceLine/);
});

test('manual refresh is limited to candles and preserves overlay state and retry behavior', () => {
  const chart = fs.readFileSync('components/MarketPositionChart.tsx', 'utf8');
  const hook = fs.readFileSync('components/useMarketCandles.ts', 'utf8');
  assert.match(chart, /refetch\(|refreshCandles/);
  assert.match(chart, /if \(refreshing \|\| loading\) return;/);
  assert.match(chart, /overlayRef\.current|entryPriceLineRef|currentPriceLineRef/);
  assert.match(chart, /market-chart-inline-message|chart-retry-btn|Retry/);
  assert.match(chart, /initialVisibleRangeRef/);
  assert.match(chart, /Number\.isFinite\(tooltip\.candle\.volume\)/);
  assert.match(hook, /\/api\/market\/candles\?/);
  assert.doesNotMatch(hook, /\/api\/market\/analyze/);
  assert.match(hook, /inFlightRef|manualRefresh/);
});

test('manual refresh failures keep prior candles, successful retries replace them, and structured payloads stay readable', () => {
  const previous = [{ datetime: '2025-01-01T00:00:00.000Z', open: 1, high: 2, low: 0.5, close: 1.5, volume: 42 }];
  const failed = resolveCandlesFetchOutcomeLocal(previous, { error: { message: 'Market feed timed out.' } }, true);
  assert.deepEqual(failed.candles, previous);
  assert.equal(failed.error, 'Market feed timed out.');
  assert.doesNotMatch(failed.error, /\[object Object\]/);

  const replacement = [{ datetime: '2025-01-02T00:00:00.000Z', open: 2, high: 3, low: 1.5, close: 2.5, volume: 90 }];
  const succeeded = resolveCandlesFetchOutcomeLocal(previous, { candles: replacement, provider: 'Twelve Data' }, true);
  assert.deepEqual(succeeded.candles, replacement);
  assert.equal(succeeded.error, '');
  assert.equal(succeeded.provider, 'Twelve Data');

  const structured = normalizeMarketCandlesError({ error: { message: 'Quote service unavailable.' } }, 'Unable to refresh market data.');
  assert.equal(structured, 'Quote service unavailable.');
  assert.doesNotMatch(structured, /\[object Object\]/);
  assert.doesNotMatch(structured, /error: \{ message:/);
  assert.equal(normalizeMarketCandlesError({ message: 'API failed.' }, 'fallback'), 'API failed.');
});

test('successful retry clears chart error state and remains candle-only', () => {
  const chart = fs.readFileSync('components/MarketPositionChart.tsx', 'utf8');
  const hook = fs.readFileSync('components/useMarketCandles.ts', 'utf8');
  assert.match(chart, /Unable to refresh market data\./);
  assert.match(chart, /Retry/);
  assert.match(hook, /setError\(''\)/);
  assert.match(hook, /readApiResponse\(response\)/);
  assert.match(hook, /apiErrorMessage\(payload, fallback\)/);
  assert.doesNotMatch(chart, /\[object Object\]/);
  assert.doesNotMatch(hook, /\/api\/market\/analyze/);
});

test('polling utilities auto-refresh on a timeframe-aware schedule and preserve last good candles on background failure', () => {
  const previous = [
    { datetime: '2025-01-01T00:00:00.000Z', open: 1, high: 2, low: 0.8, close: 1.7, volume: 10 },
    { datetime: '2025-01-01T01:00:00.000Z', open: 1.7, high: 1.9, low: 1.4, close: 1.5, volume: 8 },
  ];
  const incoming = [
    { datetime: '2025-01-01T02:00:00.000Z', open: 1.5, high: 1.8, low: 1.3, close: 1.6, volume: 12 },
    { datetime: '2025-01-01T03:00:00.000Z', open: 1.6, high: 1.9, low: 1.5, close: 1.8, volume: 15 },
  ];
  const merged = mergeIncomingCandles(previous, incoming);
  assert.deepEqual(merged.map((item) => item.datetime), ['2025-01-01T00:00:00.000Z', '2025-01-01T01:00:00.000Z', '2025-01-01T02:00:00.000Z', '2025-01-01T03:00:00.000Z']);
  assert.deepEqual(resolveCandlesFetchOutcomeFromHook(previous, { error: { message: 'Market feed timed out.' } }, false, true).candles, previous);
  assert.equal(getPollingIntervalMs('M5'), 15_000);
  assert.equal(getPollingIntervalMs('H1'), 60_000);
  assert.equal(getPollingIntervalMs('D1'), 300_000);

  const hook = fs.readFileSync('components/useMarketCandles.ts', 'utf8');
  const chart = fs.readFileSync('components/MarketPositionChart.tsx', 'utf8');
  assert.match(hook, /if \(inFlightRef\.current\) return;/);
  assert.match(hook, /backgroundRefresh \? mergeIncomingCandles\(previousCandles, completedCandles\) : completedCandles/);
  assert.match(hook, /window\.setInterval\(\(\) => \{\s*void fetchCandles\(false, true\);\s*\}, getPollingIntervalMs\(timeframe\)\)/s);
  assert.match(hook, /window\.clearInterval\(interval\)/);
  assert.match(chart, /initialVisibleRangeRef\.current = true;/);
  assert.match(chart, /if \(!initialVisibleRangeRef\.current\) \{\s*const range = getInitialVisibleLogicalRange\(candles\.length, timeframe\);\s*const timeScale = chartRef\.current\?\.timeScale\(\);\s*if \(timeScale\) \{\s*timeScale\.setVisibleLogicalRange\(\{ from: range\.from, to: range\.to \}\);\s*\}\s*initialVisibleRangeRef\.current = true;\s*\}/s);
});

test('controlled chart owns candles, coordinates, overlays, clicks, and switching inputs', () => {
  const chart = fs.readFileSync('components/MarketPositionChart.tsx', 'utf8');
  const panel = fs.readFileSync('components/LiveMarketPanel.tsx', 'utf8');
  const legacy = fs.readFileSync('components/TradingViewChart.tsx', 'utf8');
  assert.match(chart, /createChart/); assert.match(chart, /CandlestickSeries/); assert.match(chart, /BaselineSeries/);
  assert.match(chart, /priceToCoordinate/); assert.match(chart, /subscribeClick/); assert.match(chart, /time:/);
  assert.match(panel, /chartTimeframe/); assert.match(panel, /selectedInstrument/); assert.doesNotMatch(legacy, /iframe/);
});

test('right-edge anchoring, future-candle filtering, and chart controls stay in the validate chart layer', () => {
  const chart = fs.readFileSync('components/MarketPositionChart.tsx', 'utf8');
  const hook = fs.readFileSync('components/useMarketCandles.ts', 'utf8');
  assert.match(chart, /getInitialVisibleLogicalRange\(candleCount: number, timeframe: string\)/);
  assert.match(chart, /Math\.max\(0, candleCount - Math\.min\(candleCount, preferred\)\)/);
  assert.match(chart, /setVisibleLogicalRange\(\{ from: range\.from, to: range\.to \}\)/);
  assert.match(chart, /requestFullscreen|exitFullscreen|fullscreenchange/);
  assert.match(chart, /Zoom In|Zoom Out|Fit|Refresh|Full chart/);
  assert.match(chart, /BUY|SELL|Entry|Stop Loss|Take Profit/);
  assert.match(hook, /Date\.now\(\)|Date\.parse\(candle\.datetime\) <= nowMs|filter\(\(candle\) =>/);
  assert.doesNotMatch(hook, /setCandles\(payload\.candles\)/);
});

test('active trade markers remain visible in the overlay contract', () => {
  const chart = fs.readFileSync('components/MarketPositionChart.tsx', 'utf8');
  assert.match(chart, /currentPriceLineRef/);
  assert.match(chart, /entryPriceLineRef/); assert.match(chart, /stopLossPriceLineRef/); assert.match(chart, /takeProfitPriceLineRef/);
  assert.match(chart, /status === 'ACTIVE'|ACTIVE.*BUY|ACTIVE.*SELL/);
  assert.match(chart, /Current|Entry|Stop Loss|Take Profit/);
});

test('candle endpoint is authenticated and has no analysis or billing side effects', () => {
  const route = fs.readFileSync('app/api/market/candles/route.ts', 'utf8');
  assert.match(route, /auth\.getUser/); assert.match(route, /parseMarketCandleRequest/); assert.match(route, /fetchSeriesRange/);
  assert.doesNotMatch(route, /reserveAnalysis|finalizeAnalysis|buildLiveAnalysis|strategy_profiles/);
});

test('acceptance preserves authoritative take path and never inserts active trades client-side', () => {
  const validator = fs.readFileSync('components/TradeValidator.tsx', 'utf8');
  assert.match(validator, /fetch\('\/api\/trades\/take'/);
  assert.doesNotMatch(validator, /from\('active_trades'\)\.insert/);
  assert.match(validator, /activatePositionOverlay/);
  assert.match(validator, /strategyRevisionId:activeStrategyRevisionId/);
});

test('server persists explicit revision and immutable overlay provenance', () => {
  const route = fs.readFileSync('app/api/trades/take/route.ts', 'utf8');
  assert.match(route, /p_strategy_revision_id: body\.strategyRevisionId\.trim\(\)/);
  assert.match(route, /positionOverlay: positionOverlaySnapshot/);
  assert.match(route, /acceptedGeometry/); assert.match(route, /originalProposedGeometry/);
  assert.doesNotMatch(route, /strategySnapshot\?\.revisionId/);
});
