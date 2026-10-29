import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLayerCardPresentation, buildSetupReadinessMetadata, formatHumanLabel, getSetupReadinessLayoutColumns } from '../lib/setup-readiness/presentation.ts';

test('responsive layout helpers map the requested breakpoints', () => {
  assert.equal(getSetupReadinessLayoutColumns(1440), 3);
  assert.equal(getSetupReadinessLayoutColumns(1024), 2);
  assert.equal(getSetupReadinessLayoutColumns(768), 2);
  assert.equal(getSetupReadinessLayoutColumns(430), 1);
});

test('human-readable formatting converts camelCase evidence labels', () => {
  assert.equal(formatHumanLabel('premiumDiscount'), 'Premium discount');
  assert.equal(formatHumanLabel('h1TrendAligned'), 'H1 trend aligned');
  assert.equal(formatHumanLabel('structurePattern'), 'Structure pattern');
  assert.equal(formatHumanLabel('bosConfirmed'), 'BOS confirmed');
  assert.equal(formatHumanLabel('fairValueGap'), 'Fair value gap');
});

test('layer card presentation keeps semantic fields separate for rendering', () => {
  const presentation = buildLayerCardPresentation({
    role: 'TREND',
    timeframe: 'H4',
    bias: 'BULLISH',
    confidence: 50,
    confirmedEvidence: ['trend aligned'],
    missingEvidence: ['premiumDiscount', 'structurePattern'],
  });

  assert.equal(presentation.category, 'TREND');
  assert.equal(presentation.timeframe, 'H4');
  assert.equal(presentation.state, 'BULLISH');
  assert.equal(presentation.confidencePercentage, 50);
  assert.equal(presentation.mode, 'Automatic confirmations');
  assert.deepEqual(presentation.pendingConfirmations, ['Premium discount', 'Structure pattern']);
  assert.deepEqual(presentation.supportingDetails, ['Trend aligned']);
});

test('setup readiness metadata exposes labeled values instead of concatenated strings', () => {
  const metadata = buildSetupReadinessMetadata({
    instrument: 'GBPUSD',
    timeframe: 'H1',
    calculatedAt: '2026-08-02T19:06:25.000Z',
    liveAnalysisConfidence: 0,
    strategyConfidenceThreshold: 80,
    setupReadiness: {
      percentage: 0,
      state: 'WAITING_FOR_CONFIRMATION',
    },
  } as any);

  assert.deepEqual(metadata.map((item) => item.label), [
    'Status',
    'Setup readiness',
    'Required',
    'Result',
    'Checked',
    'Instrument',
    'Timeframe',
  ]);
  assert.equal(metadata[1].value, '0%');
  assert.equal(metadata[2].value, '80%');
  assert.equal(metadata[3].value, 'Below required readiness');
  assert.equal(metadata[5].value, 'GBPUSD');
  assert.equal(metadata[6].value, 'H1');
});
