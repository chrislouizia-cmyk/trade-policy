import test from 'node:test';
import assert from 'node:assert/strict';
import { getHostnameRoutingDecision, isPortalHostname } from '@/lib/hostname-routing';

test('treats portal host as portal traffic', () => {
  const decision = getHostnameRoutingDecision('portal.tradepolice.app', '/dashboard');
  assert.equal(decision.mode, 'portal');
  assert.equal(decision.redirectToPortal, undefined);
});

test('redirects portal-only paths from marketing host to the portal host', () => {
  const decision = getHostnameRoutingDecision('tradepolice.app', '/dashboard');
  assert.equal(decision.mode, 'marketing');
  assert.equal(decision.redirectToPortal, true);
});

test('keeps marketing pages on the marketing host', () => {
  const decision = getHostnameRoutingDecision('tradepolice.app', '/pricing');
  assert.equal(decision.mode, 'marketing');
  assert.equal(decision.redirectToPortal, false);
});

test('recognizes portal subdomains', () => {
  assert.equal(isPortalHostname('portal.tradepolice.app'), true);
  assert.equal(isPortalHostname('www.tradepolice.app'), false);
});
