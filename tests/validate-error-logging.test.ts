import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(new URL('../app/api/validate/route.ts', import.meta.url), 'utf8');

test('validate logs allowlisted PostgREST fields with request and operation context', () => {
  assert.match(route, /function safeValidationError\(error: unknown\)/);
  for (const field of ['message', 'code', 'details', 'hint']) assert.match(route, new RegExp(`value\\?\\.${field}`));
  assert.match(route, /requestId,operation:'decision_report_sources\.insert'/);
  assert.match(route, /requestId,operation:'validate\.POST'/);
});

test('validate keeps database details server-side and preserves the public 503 contract', () => {
  assert.match(route, /return apiError\('VALIDATION_FAILED','Trade authorization could not be completed\. Your trade data was not changed\.',503\)/);
  assert.doesNotMatch(route, /apiError\([^\n]+safeValidationError/);
  assert.doesNotMatch(route, /NextResponse\.json\([^\n]+sourceError/);
});

test('decision source insert failures retain plain-object errors for structured logging', () => {
  assert.match(route, /const failure=sourceError\?\?new Error\('Decision report source was not created\.'\)/);
  assert.match(route, /\.\.\.safeValidationError\(failure\)/);
  assert.match(route, /throw failure/);
});
