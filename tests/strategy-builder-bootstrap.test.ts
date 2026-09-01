import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveStrategyBuilderBootstrapRenderState,
  runStrategyBuilderBootstrap,
  summarizeStrategyBuilderBootstrapFailure,
} from '../lib/strategy-builder-bootstrap.ts';

test('successful bootstrap clears loading after finalization', async () => {
  let loading = true;
  const outcome = await runStrategyBuilderBootstrap(
    async () => ({ ok: true }),
    async () => {
      assert.equal(loading, true);
    },
    () => {
      throw new Error('failure callback should not run on success');
    },
    (value) => {
      loading = value;
    },
  );

  assert.deepEqual(outcome, { ok: true });
  assert.equal(loading, false);
});

test('failed strategy_profiles fetch clears loading and surfaces an error', async () => {
  let loading = true;
  let message: string | null = null;

  const outcome = await runStrategyBuilderBootstrap(
    async () => {
      throw new Error('strategy_profiles fetch failed');
    },
    async () => undefined,
    (error) => {
      message = summarizeStrategyBuilderBootstrapFailure(error);
    },
    (value) => {
      loading = value;
    },
  );

  assert.equal(outcome, undefined);
  assert.equal(loading, false);
  assert.match(message ?? '', /strategy_profiles fetch failed/i);
});

test('failed instrument_catalog fetch clears loading and surfaces an error', async () => {
  let loading = true;
  let message: string | null = null;

  const outcome = await runStrategyBuilderBootstrap(
    async () => {
      throw new Error('instrument_catalog fetch failed');
    },
    async () => undefined,
    (error) => {
      message = summarizeStrategyBuilderBootstrapFailure(error);
    },
    (value) => {
      loading = value;
    },
  );

  assert.equal(outcome, undefined);
  assert.equal(loading, false);
  assert.match(message ?? '', /instrument_catalog fetch failed/i);
});

test('error state renders instead of leaving the loading skeleton forever', () => {
  assert.equal(resolveStrategyBuilderBootstrapRenderState({ loading: true, bootstrapError: null }), 'loading');
  assert.equal(resolveStrategyBuilderBootstrapRenderState({ loading: false, bootstrapError: 'Supabase failed to load profile data.' }), 'error');
  assert.equal(resolveStrategyBuilderBootstrapRenderState({ loading: false, bootstrapError: null }), 'ready');
});

test('retry can invoke bootstrap again after a failed attempt', async () => {
  let attempts = 0;
  let loading = true;

  const retryBootstrap = async () => {
    attempts += 1;
    if (attempts === 1) {
      throw new Error('temporary bootstrap failure');
    }
    return { attempt: attempts };
  };

  const first = await runStrategyBuilderBootstrap(
    retryBootstrap,
    async () => undefined,
    (error) => {
      assert.match(summarizeStrategyBuilderBootstrapFailure(error), /temporary bootstrap failure/i);
    },
    (value) => {
      loading = value;
    },
  );

  assert.equal(first, undefined);
  assert.equal(loading, false);

  const second = await runStrategyBuilderBootstrap(
    retryBootstrap,
    async (result) => {
      assert.deepEqual(result, { attempt: 2 });
    },
    () => {
      throw new Error('retry callback should not run on success');
    },
    (value) => {
      loading = value;
    },
  );

  assert.deepEqual(second, { attempt: 2 });
  assert.equal(loading, false);
  assert.equal(attempts, 2);
});
