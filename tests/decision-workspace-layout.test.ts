import test from 'node:test';
import assert from 'node:assert/strict';
import { getDecisionWorkspaceLayoutState } from '../lib/decision-workspace-layout.ts';

test('collapses the workspace to a single full-width flow before any analysis exists', () => {
  const state = getDecisionWorkspaceLayoutState({ analysis: null, explanation: null, narrative: null });

  assert.equal(state.mode, 'full-width');
  assert.equal(state.showDecisionColumn, false);
  assert.equal(state.showDecisionReportButton, false);
});

test('keeps the workspace in a single full-width flow for unavailable analysis', () => {
  const state = getDecisionWorkspaceLayoutState({
    analysis: { status: 'DATA_UNAVAILABLE' } as any,
    explanation: { verdict: 'DATA_UNAVAILABLE' } as any,
    narrative: null,
  });

  assert.equal(state.mode, 'full-width');
  assert.equal(state.showDecisionColumn, false);
  assert.equal(state.showDecisionReportButton, false);
});

test('uses a split layout once a completed decision is available', () => {
  const state = getDecisionWorkspaceLayoutState({
    analysis: { status: 'VALID_ANALYSIS' } as any,
    explanation: { verdict: 'READY' } as any,
    narrative: { reasons: [], missingEvidence: [], nextActions: [] } as any,
  });

  assert.equal(state.mode, 'split');
  assert.equal(state.showDecisionColumn, true);
  assert.equal(state.showDecisionReportButton, true);
});

test('keeps the decision column visible for wait and blocked authorization states', () => {
  for (const verdict of ['WAIT', 'BLOCKED'] as const) {
    const state = getDecisionWorkspaceLayoutState({
      analysis: { status: 'VALID_ANALYSIS' } as any,
      explanation: { verdict } as any,
      narrative: { reasons: [], missingEvidence: [], nextActions: [] } as any,
    });

    assert.equal(state.showDecisionColumn, true, verdict);
  }
});
