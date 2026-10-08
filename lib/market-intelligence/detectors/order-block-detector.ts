import { createHash } from 'node:crypto';
import { filterCompletedCandles, SUPPORTED_TIMEFRAMES, validateCandles } from '../analysis-utils/index.ts';
import type { DetectorResult, MarketDataSnapshot, NormalizedCandle } from '../contracts.ts';
import { createLifecycleReplay } from './lifecycle-replay.ts';
import { BaseDetector } from './base-detector.ts';

export const ORDER_BLOCK_SOURCE_MAX_LOOKBACK = 20;
export type OrderBlockDirection = 'BULLISH' | 'BEARISH';
export type OrderBlockStatus = 'ACTIVE' | 'PARTIALLY_MITIGATED' | 'MITIGATED' | 'INVALIDATED';
export type OrderBlock = { id: string; direction: OrderBlockDirection; timeframe: string; sourceCandleTime: string; confirmationTime: string; zoneLow: number; zoneHigh: number; status: OrderBlockStatus; eligible: boolean; mitigatedAt?: string; invalidatedAt?: string };
export type OrderBlockObservation = { orderBlocks: OrderBlock[]; selected: OrderBlock | null };
export type OrderBlockResult = OrderBlockObservation;
export type OrderBlockDelta = { created: OrderBlock[]; transitioned: OrderBlock[] };
export type OrderBlockConfig = { instrument: string; timeframe: string; sourceMaxLookback?: number };

const hash = (parts: unknown[]) => `order-block:${createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24)}`;
const freezeBlock = (block: OrderBlock): OrderBlock => Object.freeze({ ...block });
const color = (candle: NormalizedCandle): 'BULLISH' | 'BEARISH' | 'NEUTRAL' => candle.close > candle.open ? 'BULLISH' : candle.close < candle.open ? 'BEARISH' : 'NEUTRAL';
const chronological = (a: OrderBlock, b: OrderBlock) => b.confirmationTime.localeCompare(a.confirmationTime) || a.id.localeCompare(b.id);

/** Searches newest-to-oldest; the first opposite candle displaced through is canonical. */
export function findOrderBlockSource(candles: readonly NormalizedCandle[], confirmationIndex: number, direction: OrderBlockDirection, maxLookback = ORDER_BLOCK_SOURCE_MAX_LOOKBACK): NormalizedCandle | null {
  const confirmation = candles[confirmationIndex]; const opposite = direction === 'BULLISH' ? 'BEARISH' : 'BULLISH';
  for (let distance = 1; distance <= maxLookback && confirmationIndex - distance >= 0; distance += 1) {
    const candidate = candles[confirmationIndex - distance];
    if (!candidate.complete || color(candidate) !== opposite) continue;
    if (direction === 'BULLISH' ? confirmation.close > candidate.high : confirmation.close < candidate.low) return candidate;
  }
  return null;
}

function evolve(block: OrderBlock, candles: readonly NormalizedCandle[], start: number): OrderBlock {
  let next = block;
  for (let index = start; index < candles.length; index += 1) {
    const candle = candles[index];
    const invalidated = next.direction === 'BULLISH' ? candle.close < next.zoneLow : candle.close > next.zoneHigh;
    if (invalidated) return freezeBlock({ ...next, status: 'INVALIDATED', eligible: false, invalidatedAt: candle.closedAt });
    const touches = candle.low <= next.zoneHigh && candle.high >= next.zoneLow;
    if (candle.low <= next.zoneLow && candle.high >= next.zoneHigh) return freezeBlock({ ...next, status: 'MITIGATED', eligible: false, mitigatedAt: candle.closedAt });
    if (touches && next.status === 'ACTIVE') next = freezeBlock({ ...next, status: 'PARTIALLY_MITIGATED', eligible: true, mitigatedAt: candle.closedAt });
  }
  return next;
}

/** The only Order Block lifecycle implementation; input is completed normalized candles. */
export function evaluateOrderBlocks(candles: readonly NormalizedCandle[], config: OrderBlockConfig): OrderBlockResult {
  const completed = candles.filter(candle => candle.complete).map(candle => ({ ...candle }));
  const blocks: OrderBlock[] = []; const maxLookback = config.sourceMaxLookback ?? ORDER_BLOCK_SOURCE_MAX_LOOKBACK;
  for (let index = 1; index < completed.length; index += 1) for (const direction of ['BULLISH', 'BEARISH'] as const) {
    const confirmation = completed[index]; const source = findOrderBlockSource(completed, index, direction, maxLookback);
    if (!source) continue;
    const base = freezeBlock({ id: hash([config.instrument, config.timeframe, direction, source.openedAt, source.open, source.high, source.low, source.close, confirmation.closedAt]), direction, timeframe: config.timeframe, sourceCandleTime: source.openedAt, confirmationTime: confirmation.closedAt, zoneLow: source.low, zoneHigh: source.high, status: 'ACTIVE', eligible: true });
    blocks.push(evolve(base, completed, index + 1));
  }
  const orderBlocks = blocks.sort(chronological).map(freezeBlock);
  return Object.freeze({ orderBlocks: Object.freeze(orderBlocks) as unknown as OrderBlock[], selected: orderBlocks.find(block => block.eligible) ?? null });
}

export function emptyOrderBlockDelta(): OrderBlockDelta { return { created: [], transitioned: [] }; }
export function deriveOrderBlockDelta(previous: OrderBlockResult, next: OrderBlockResult): OrderBlockDelta {
  const before = new Map(previous.orderBlocks.map(block => [block.id, block]));
  return { created: next.orderBlocks.filter(block => !before.has(block.id)).sort(chronological), transitioned: next.orderBlocks.filter(block => { const prior = before.get(block.id); return prior !== undefined && prior.status !== block.status; }).sort(chronological) };
}

export function createOrderBlockDetector(config: OrderBlockConfig) {
  const replay = createLifecycleReplay(candles => evaluateOrderBlocks(candles, config), deriveOrderBlockDelta, emptyOrderBlockDelta);
  return Object.freeze({ pushCandle: replay.pushCandle, getNewOrderBlocks: replay.getNewResult, getAll: () => replay.getResult().orderBlocks, getResult: replay.getResult, getWarnings: replay.getWarnings, query: replay.query, reset: replay.reset });
}

/** Batch adapter delegates to evaluateOrderBlocks; it has no separate lifecycle algorithm. */
export class OrderBlockDetector extends BaseDetector<OrderBlockObservation> {
  constructor() { super({ id: 'order-block', version: '1.0.0', displayName: 'Order Block Detector', deterministic: true, supportedTimeframes: [...SUPPORTED_TIMEFRAMES], supportsReplay: true, experimental: true, enabledByDefault: true, description: 'Detects confirmed opposite-candle order blocks with immutable lifecycle events.' }); }
  async execute(snapshot: MarketDataSnapshot): Promise<DetectorResult<OrderBlockObservation>> {
    if (!snapshot.timeframe.trim()) return this.result(snapshot, 'INSUFFICIENT_DATA', null, ['Snapshot timeframe is missing.']);
    const validation = validateCandles(snapshot.candles); if (!validation.valid) return this.result(snapshot, 'ERROR', null, validation.issues.map(issue => issue.message), validation.issues[0]?.code);
    const filtered = filterCompletedCandles(snapshot.candles, snapshot.requestedAt); if (filtered.invalidTimestamp.length) return this.result(snapshot, 'ERROR', null, ['One or more candle close timestamps are invalid.'], 'INVALID_TIMESTAMP');
    if (filtered.completed.length < 2) return this.result(snapshot, 'INSUFFICIENT_DATA', null, ['Order block requires two completed candles.']);
    return this.result(snapshot, 'DETECTED', evaluateOrderBlocks(filtered.completed, { instrument: snapshot.instrument, timeframe: snapshot.timeframe }), [], undefined, filtered.completed);
  }
  private result(snapshot: MarketDataSnapshot, status: DetectorResult<OrderBlockObservation>['status'], payload: OrderBlockObservation | null, warnings: string[], errorCode?: string, source: NormalizedCandle[] = []): DetectorResult<OrderBlockObservation> {
    return { detectorId: this.id, detectorVersion: this.version, runId: 'unassigned', instrument: snapshot.instrument, timeframe: snapshot.timeframe, observedAt: snapshot.dataAsOf, dataAsOf: snapshot.dataAsOf, status, confidence: payload?.selected ? 1 : 0, evidence: payload?.selected ? [{ id: payload.selected.id, type: 'CANDLE_PATTERN', description: `${payload.selected.direction} order block confirmed at displacement close.`, candleTimes: source.map(candle => candle.openedAt), priceLevels: [payload.selected.zoneLow, payload.selected.zoneHigh], source: snapshot.provider, sourceReference: snapshot.id, metadata: { status: payload.selected.status, timeframe: snapshot.timeframe, confirmationTime: payload.selected.confirmationTime } }] : [], payload, freshness: snapshot.freshness, warnings, ...(errorCode ? { errorCode } : {}) };
  }
}
