import test from 'node:test';
import assert from 'node:assert/strict';
import { getSafeClientNextPath } from '../lib/auth/safe-next.ts';

const blocked = [
  '/login',
  '/client/login',
  '/hq/login',
  '//evil.com',
  'https://evil.com',
  'javascript:alert(1)',
  '/dashboard',
];

test('safe-next rejects self-referential and external destinations', () => {
  for (const value of blocked) {
    const next = getSafeClientNextPath(value, '/login', '/dashboard');
    assert.equal(next, '/dashboard');
  }
});

test('safe-next accepts a valid relative path', () => {
  assert.equal(getSafeClientNextPath('/history', '/client/login', '/dashboard'), '/history');
  assert.equal(getSafeClientNextPath('/account?tab=profile', '/client/login', '/dashboard'), '/account?tab=profile');
});

test('stale-session redirect guard prevents login loop paths', () => {
  const cycle = ['/','/login','/client/login','/dashboard'];
  const sanitized = cycle.map((value) => getSafeClientNextPath(value, '/login', '/dashboard'));
  assert.deepEqual(sanitized, ['/dashboard', '/dashboard', '/dashboard', '/dashboard']);
});

test('no auth loop under stale state can include login pages in the redirect chain', () => {
  const chain = ['/login', '/client/login', '/dashboard'];
  const sanitized = chain.map((path) => getSafeClientNextPath(path, path, '/dashboard'));
  assert.deepEqual(sanitized, ['/dashboard', '/dashboard', '/dashboard']);
  assert.ok(sanitized.every((path) => path !== '/login' && path !== '/client/login'));
});
