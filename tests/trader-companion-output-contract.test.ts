import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildCompanionOutputSchema,generateTraderCompanionWithProvider} from '../lib/trader-companion-engine.ts';

const facts=[{id:'integral:state',text:'Historical records with nested evidenceIds [trade-uuid]. Small sample.',source:'Records',evidenceIds:['trade-uuid']}];
const input={facts,profile:{},message:'Review the recorded process.',history:[],locale:'en',memorySaved:false};
const valid={message:'Review the recorded sample; it is too small to prove an edge.',question:'',evidenceIds:['integral:state']};
const run=(body:unknown)=>generateTraderCompanionWithProvider(input,{apiKey:'test-only',model:'test-model'},async()=>Response.json(body));

test('provider schema restricts citations to supplied fact IDs and mirrors local bounds',()=>{
  const schema=buildCompanionOutputSchema(facts);
  assert.deepEqual(schema.properties.evidenceIds.items,{type:'string',enum:['integral:state']});
  assert.equal(schema.properties.message.maxLength,2400);
  assert.equal(schema.properties.question.maxLength,400);
  assert.equal(schema.properties.evidenceIds.maxItems,1);
  const empty=buildCompanionOutputSchema([]);
  assert.equal(empty.properties.evidenceIds.maxItems,0);
  assert.equal('enum' in empty.properties.evidenceIds.items,false);
});
test('a completed Responses result concatenates text chunks, skipping reasoning',async()=>{
  const text=JSON.stringify(valid),split=25;
  const result=await run({status:'completed',output:[{type:'reasoning'},{type:'message',content:[{type:'output_text',text:text.slice(0,split)},{type:'output_text',text:text.slice(split)}]}]});
  assert.equal(result.source,'OPENAI');
  assert.deepEqual(result.reply,valid);
});
test('schema/evidence/safety failures remain rejected with non-sensitive distinct diagnostics',async()=>{
  const cases=[
    {value:{...valid,message:'a'.repeat(2401)},code:'OUTPUT_REJECTED_SCHEMA'},
    {value:{...valid,evidenceIds:['trade-uuid']},code:'OUTPUT_REJECTED_EVIDENCE'},
    {value:{...valid,message:'Buy now'},code:'OUTPUT_REJECTED_SAFETY'},
    {value:{...valid,message:'<script>unsafe</script>'},code:'OUTPUT_REJECTED_SAFETY'},
  ];
  for(const item of cases){
    const result=await run({status:'completed',output_text:JSON.stringify(item.value)});
    assert.equal(result.source,'DETERMINISTIC');
    assert.equal(result.failureCode,item.code);
    assert.deepEqual(result.reply.evidenceIds,[]);
  }
});
test('incomplete output and refusal cannot masquerade as a valid generated brief',async()=>{
  const incomplete=await run({status:'incomplete',output_text:JSON.stringify(valid)});
  assert.equal(incomplete.failureCode,'OUTPUT_INCOMPLETE');
  const refused=await run({status:'completed',output:[{content:[{type:'refusal',refusal:'No.'}]}]});
  assert.equal(refused.failureCode,'OUTPUT_REFUSED');
  assert.equal(refused.source,'DETERMINISTIC');
  const malformed=await run({status:'completed',output_text:'not-json'});
  assert.equal(malformed.failureCode,'OUTPUT_REJECTED_SCHEMA');
});
test('the intelligence footnote uses the profile zone, not the device default',()=>{
  const component=fs.readFileSync('components/PoliceIntelligence.tsx','utf8');
  assert.match(component,/new Date\(summary\.generatedAt\)\.toLocaleString\(locale,\{timeZone:summary\.timezone\}\)/);
});
