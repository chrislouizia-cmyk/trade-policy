import assert from 'node:assert/strict';
import test from 'node:test';

import { extractSupportedInstrumentSymbols, extractUnsupportedInstrumentSymbols, normalizeInstrumentSymbol } from '../lib/instrument-registry.ts';
import { mapCopilotReplyToCanonicalCreation } from '../lib/strategy-copilot-creation.ts';
import { extractStructuredDraftFromText } from '../lib/strategy-copilot.ts';

test('single new FX symbols normalize to canonical Trade Police symbols',()=>{
  assert.equal(normalizeInstrumentSymbol('GBPJPY'),'GBPJPY');
  assert.equal(normalizeInstrumentSymbol('EURUSD'),'EURUSD');
  assert.equal(normalizeInstrumentSymbol('USDJPY'),'USDJPY');
  assert.equal(extractStructuredDraftFromText('Trade GBPJPY only.').instrument,'GBPJPY');
});

test('comma and newline instrument lists preserve every supported symbol in order',()=>{
  const expected=['GBPUSD','EURUSD','GBPJPY','USDJPY'];
  assert.deepEqual(extractSupportedInstrumentSymbols('GBPUSD, EURUSD, GBPJPY, USDJPY'),expected);
  assert.deepEqual(extractSupportedInstrumentSymbols('GBPUSD\nEURUSD\nGBPJPY\nUSDJPY'),expected);
  assert.deepEqual(extractStructuredDraftFromText('Markets: GBPUSD, EURUSD, GBPJPY, USDJPY').instruments,expected);
});

test('slash-format lists normalize without collapsing instruments',()=>{
  assert.deepEqual(extractSupportedInstrumentSymbols('GBP/USD\nEUR/USD\nGBP/JPY\nUSD/JPY'),['GBPUSD','EURUSD','GBPJPY','USDJPY']);
  assert.equal(normalizeInstrumentSymbol('GBP/JPY'),'GBPJPY');
});

test('unknown currency pairs are surfaced rather than accepted silently',()=>{
  assert.deepEqual(extractSupportedInstrumentSymbols('GBPUSD, GBPCHF'),['GBPUSD']);
  assert.deepEqual(extractUnsupportedInstrumentSymbols('GBPUSD, GBPCHF'),['GBPCHF']);
  assert.equal(normalizeInstrumentSymbol('GBPCHF'),null);
});

test('HTF role language keeps M15 as confirmation and M5 as refinement only',()=>{
  const message='D1 + H4 are macro context. H1 is directional setup context. M15 is the primary confirmation. M5 is optional entry refinement.';
  const mapped=mapCopilotReplyToCanonicalCreation({
    userMessage:message,
    reply:{
      message:'Ready for review.',intent:'CREATE',changes:[],unresolvedQuestions:[],
      strategyDraft:{
        name:'GBPUSD HTF Liquidity & Structure v1',instrument:'GBPUSD',sessions:['London','New York'],
        timeframes:['D1','H4','H1','M15','M5'],rules:[{key:'displacement',label:'Displacement',capability:'AUTOMATIC',requirement:'REQUIRED',timeframe:'M15',group:'ALL'}],
        logicTree:{logic:'ALL',children:['displacement']},riskPercent:0.5,minimumRR:2,notes:[],
      },
    },
  });
  assert.equal(mapped.draft.values.contextTimeframe,'D1');
  assert.equal(mapped.draft.values.executionTimeframe,'M15');
  assert.notEqual(mapped.draft.values.executionTimeframe,'M5');
});
