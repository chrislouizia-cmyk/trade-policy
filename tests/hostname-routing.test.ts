import test from 'node:test';
import assert from 'node:assert/strict';
import { getHostnameRoutingDecision, isHQHostname, isPortalHostname } from '../lib/hostname-routing.ts';

test('treats portal host as portal traffic', () => {
  const decision = getHostnameRoutingDecision('portal.tradepolice.app', '/dashboard');
  assert.equal(decision.mode, 'portal');
  assert.equal(decision.redirectTarget, undefined);
});

test('redirects portal-only paths from marketing host to the portal host', () => {
  const decision = getHostnameRoutingDecision('tradepolice.app', '/dashboard');
  assert.equal(decision.mode, 'marketing');
  assert.equal(decision.redirectTarget, 'portal');
});

test('keeps marketing pages on the marketing host', () => {
  const decision = getHostnameRoutingDecision('tradepolice.app', '/pricing');
  assert.equal(decision.mode, 'marketing');
  assert.equal(decision.redirectTarget, undefined);
});

test('routes HQ paths and recognizes the canonical HQ host', () => {
  assert.equal(isHQHostname('hq.tradepolice.app'), true);
  assert.equal(getHostnameRoutingDecision('hq.tradepolice.app', '/').mode, 'hq');
  assert.equal(getHostnameRoutingDecision('tradepolice.app', '/hq').redirectTarget, 'hq');
  assert.equal(getHostnameRoutingDecision('portal.tradepolice.app', '/hq/team').redirectTarget, 'hq');
  assert.equal(getHostnameRoutingDecision('hq.tradepolice.app', '/hq/system').redirectTarget, undefined);
  assert.equal(getHostnameRoutingDecision('hq.tradepolice.app', '/hq/login').redirectTarget, undefined);
  assert.equal(getHostnameRoutingDecision('hq.tradepolice.app', '/hq/onboarding').redirectTarget, undefined);
  assert.equal(getHostnameRoutingDecision('hq.tradepolice.app', '/api/hq/staff/onboarding').redirectTarget, undefined);
});

test('shared authentication stays on HQ while portal screens leave HQ', () => {
  assert.equal(getHostnameRoutingDecision('hq.tradepolice.app', '/auth/callback').redirectTarget, undefined);
  assert.equal(getHostnameRoutingDecision('hq.tradepolice.app', '/reset-password').redirectTarget, undefined);
  assert.equal(getHostnameRoutingDecision('hq.tradepolice.app', '/forgot-password').redirectTarget, undefined);
  assert.equal(getHostnameRoutingDecision('hq.tradepolice.app', '/client/login').redirectTarget, 'portal');
});

test('recognizes portal subdomains', () => {
  assert.equal(isPortalHostname('portal.tradepolice.app'), true);
  assert.equal(isPortalHostname('www.tradepolice.app'), false);
});
