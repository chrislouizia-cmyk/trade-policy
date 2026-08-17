import assert from 'node:assert/strict';
import test from 'node:test';
import type { TradeResult } from '../types/trade.ts';
import { applyTradingDnaRuntime, type ConditionEvidence, type TradingDnaEvidenceReport } from '../lib/trading-dna/runtime.ts';
import { evaluateTradeAuthorizationEligibility } from '../lib/trade-authorization.ts';

const base:TradeResult={score:90,grade:'A',verdict:'AUTHORIZED',rr:3,riskAmount:10,stopDistance:1,vetoes:[],observations:[],scoreItems:[]};
const required=(id:string):ConditionEvidence=>({id,ruleId:id,label:id,status:'PASS',required:true,evaluationType:'AUTOMATIC',operator:'IS_TRUE',actual:true,expected:[],reason:'Confirmed.',groupPath:['root']});
const displacement=(status:'PENDING'|'FAIL',requiredRule=false):ConditionEvidence=>({id:'displacement',ruleId:'displacement',label:'Displacement',status,required:requiredRule,evaluationType:'AUTOMATIC',operator:'CONFIRMED',actual:status==='FAIL'?false:null,expected:[],reason:'Displacement has not supplied evidence yet.',groupPath:['root']});
const report=(condition:ConditionEvidence):TradingDnaEvidenceReport=>({status:condition.status==='FAIL'?'FAIL':'PENDING',summary:'',generatedAt:'',counts:{passed:3,failed:condition.status==='FAIL'?1:0,pending:condition.status==='PENDING'?1:0},groups:[],conditions:[required('required-1'),required('required-2'),required('required-3'),condition]});

test('final risk preserves READY when 3/3 required rules pass and optional displacement is pending or failed',()=>{
  for(const optional of [displacement('PENDING'),displacement('FAIL')]){
    const result=applyTradingDnaRuntime(base,report(optional));
    const finalBlocks=result.vetoes.length;
    const authorization=evaluateTradeAuthorizationEligibility({verdict:result.verdict,analysisStatus:'VALID_ANALYSIS',strategyActive:true,readinessPercentage:100,missingMandatoryConfirmations:[]});
    assert.equal(result.verdict,'AUTHORIZED');
    assert.equal(finalBlocks,0);
    assert.equal(authorization.state,'READY');
  }
});

test('required displacement remains a final WAIT or BLOCKED condition',()=>{
  const pending=applyTradingDnaRuntime(base,report(displacement('PENDING',true)));
  const failed=applyTradingDnaRuntime(base,report(displacement('FAIL',true)));
  assert.equal(pending.verdict,'WAIT');
  assert.equal(failed.verdict,'REJECTED');
  assert.equal(failed.vetoes.length,1);
});
