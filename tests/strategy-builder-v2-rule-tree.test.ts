import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizePersistedV2RuleTree,
  type PersistedV2RuleTree,
} from '../lib/strategy-builder-v2.ts';

const condition = (ruleKey: string, requirement: 'REQUIRED' | 'OPTIONAL' = 'REQUIRED') => ({
  type: 'CONDITION' as const,
  ruleKey,
  requirement,
});

const group = (logic: 'ALL' | 'ANY', children: unknown[]) => ({
  type: 'GROUP' as const,
  logic,
  children,
});

test('normalizes a single CONDITION within a canonical root group', () => {
  assert.deepEqual(normalizePersistedV2RuleTree(group('ALL', [condition('A')])), {
    type: 'GROUP', logic: 'ALL', children: [condition('A')],
  });
});

test('normalizes flat ALL and ANY groups', () => {
  assert.deepEqual(normalizePersistedV2RuleTree(group('ALL', [condition('A'), condition('B')])), {
    type: 'GROUP', logic: 'ALL', children: [condition('A'), condition('B')],
  });
  assert.deepEqual(normalizePersistedV2RuleTree(group('ANY', [condition('A'), condition('B', 'OPTIONAL')])), {
    type: 'GROUP', logic: 'ANY', children: [condition('A'), condition('B', 'OPTIONAL')],
  });
});

test('preserves A AND (B OR C)', () => {
  const source = group('ALL', [condition('A'), group('ANY', [condition('B'), condition('C')])]);
  assert.deepEqual(normalizePersistedV2RuleTree(source), source);
});

test('preserves A AND (B OR (C AND D))', () => {
  const source = group('ALL', [
    condition('A'),
    group('ANY', [condition('B'), group('ALL', [condition('C'), condition('D')])]),
  ]);
  assert.deepEqual(normalizePersistedV2RuleTree(source), source);
});

test('preserves deeper recursive nesting without flattening', () => {
  const source = group('ANY', [
    group('ALL', [condition('A'), group('ANY', [condition('B'), group('ALL', [condition('C')])])]),
    condition('D', 'OPTIONAL'),
  ]);
  const normalized = normalizePersistedV2RuleTree(source);
  assert.deepEqual(normalized, source);
  assert.equal(normalized.children[0].type, 'GROUP');
  if (normalized.children[0].type === 'GROUP') {
    assert.equal(normalized.children[0].children[1].type, 'GROUP');
  }
});

test('normalizes legacy kind/ruleId input into the canonical recursive shape', () => {
  const legacy = {
    kind: 'GROUP', id: 'root', logic: 'ALL', children: [
      { kind: 'CONDITION', id: 'a', ruleId: 'A', group: 'ALL', requirement: 'REQUIRED' },
      { kind: 'GROUP', id: 'alternatives', logic: 'ANY', children: [
        { kind: 'CONDITION', id: 'b', ruleId: 'B', group: 'ANY', requirement: 'OPTIONAL' },
        { kind: 'CONDITION', id: 'c', ruleId: 'C', group: 'ANY', requirement: 'REQUIRED' },
      ] },
    ],
  };
  assert.deepEqual(normalizePersistedV2RuleTree(legacy), group('ALL', [
    condition('A'), group('ANY', [condition('B', 'OPTIONAL'), condition('C')]),
  ]));
});

test('rejects malformed nodes, missing rule keys, invalid logic, and empty groups', () => {
  assert.throws(() => normalizePersistedV2RuleTree(group('ALL', [{ type: 'UNKNOWN' }])));
  assert.throws(() => normalizePersistedV2RuleTree(group('ALL', [{ type: 'CONDITION', requirement: 'REQUIRED' }])));
  assert.throws(() => normalizePersistedV2RuleTree({ type: 'GROUP', logic: 'SOME', children: [condition('A')] }));
  assert.throws(() => normalizePersistedV2RuleTree(group('ALL', [])));
  assert.throws(() => normalizePersistedV2RuleTree(condition('A')));
});

test('normalization is deterministic and leaves inputs immutable', () => {
  const source = group('ALL', [condition('A'), group('ANY', [condition('B', 'OPTIONAL')])]);
  const before = structuredClone(source);
  const once: PersistedV2RuleTree = normalizePersistedV2RuleTree(source);
  const twice = normalizePersistedV2RuleTree(source);

  assert.deepEqual(source, before);
  assert.deepEqual(once, twice);
  assert.equal(JSON.stringify(once), JSON.stringify(twice));
  assert.notEqual(once, source);
  assert.notEqual(once.children, source.children);
});
