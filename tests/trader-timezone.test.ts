import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalTraderTimezone,shouldCaptureTraderTimezone} from '../lib/trader-timezone.ts';

test('validates and canonicalizes IANA zones independently for every user',()=>{
  assert.equal(canonicalTraderTimezone(' America/Monterrey '),'America/Monterrey');
  assert.equal(canonicalTraderTimezone('Asia/Tokyo'),'Asia/Tokyo');
  assert.equal(canonicalTraderTimezone('UTC'),'UTC');
  for(const value of ['',null,{},'Invalid/Zone','x'.repeat(81)])assert.equal(canonicalTraderTimezone(value),null);
});
test('device capture is only permitted before the first detection',()=>{
  assert.equal(shouldCaptureTraderTimezone('UNSET'),true);
  assert.equal(shouldCaptureTraderTimezone('DEVICE'),false);
  assert.equal(shouldCaptureTraderTimezone('USER'),false);
});
test('local weekdays and hours use each profile zone rather than server time',()=>{
  const at=new Date('2026-10-29T01:00:00Z');
  const local=(zone:string)=>new Intl.DateTimeFormat('en-US',{timeZone:zone,weekday:'long',hour:'2-digit',hourCycle:'h23'}).format(at);
  assert.match(local('America/Monterrey'),/Wednesday.*19/);
  assert.match(local('Asia/Tokyo'),/Thursday.*10/);
});
test('IANA daylight saving rules apply without changing the saved zone',()=>{
  const hour=(at:string,zone:string)=>new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'2-digit',hourCycle:'h23'}).format(new Date(at));
  assert.equal(hour('2026-01-15T12:00:00Z','America/New_York'),'07');
  assert.equal(hour('2026-07-15T12:00:00Z','America/New_York'),'08');
  assert.equal(hour('2026-01-15T12:00:00Z','America/Monterrey'),'06');
  assert.equal(hour('2026-07-15T12:00:00Z','America/Monterrey'),'06');
});
