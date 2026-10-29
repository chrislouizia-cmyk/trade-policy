import assert from 'node:assert/strict';
import test from 'node:test';
import { createLifecycleReplay, LifecycleReplayError } from '../lib/market-intelligence/detectors/lifecycle-replay.ts';

const candle=(n:number)=>({openedAt:`2026-01-01T00:0${n}:00.000Z`,closedAt:`2026-01-01T00:0${n+1}:00.000Z`,open:n,high:n+1,low:n-1,close:n,volume:1,complete:true});
const evaluate=(candles:readonly any[])=>({ids:candles.map(value=>value.openedAt),count:candles.length});
const delta=(previous:{ids:string[]},next:{ids:string[]})=>next.ids.filter(id=>!previous.ids.includes(id));

test('generic replay has consumptive deltas, replay-safe queries, and strict ingestion',()=>{
 const replay=createLifecycleReplay(evaluate,delta,()=>[] as string[]), first=candle(1), second=candle(2);
 replay.pushCandle(first);assert.deepEqual(replay.getNewResult(),[first.openedAt]);assert.deepEqual(replay.getNewResult(),[]);
 replay.pushCandle(second);const before=replay.getResult();assert.deepEqual(replay.query(first.closedAt),{ids:[first.openedAt],count:1});assert.deepEqual(replay.getResult(),before);assert.deepEqual(replay.getNewResult(),[second.openedAt]);
 assert.throws(()=>replay.pushCandle(first),(error:unknown)=>error instanceof LifecycleReplayError&&error.code==='DUPLICATE_CANDLE');assert.deepEqual(replay.getResult(),before);
 assert.throws(()=>replay.pushCandle(candle(0)),(error:unknown)=>error instanceof LifecycleReplayError&&error.code==='OUT_OF_ORDER_INCREMENTAL_INPUT');
 replay.reset();assert.deepEqual(replay.getResult(),{ids:[],count:0});assert.deepEqual(replay.getNewResult(),[]);
});
