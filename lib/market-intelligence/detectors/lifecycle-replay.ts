import type { NormalizedCandle } from '../contracts.ts';

export class LifecycleReplayError extends Error { readonly code:'DUPLICATE_CANDLE'|'OUT_OF_ORDER_INCREMENTAL_INPUT'; constructor(code:'DUPLICATE_CANDLE'|'OUT_OF_ORDER_INCREMENTAL_INPUT',message:string){super(message);this.code=code;} }
export type LifecycleEvaluator<T> = (candles:readonly NormalizedCandle[])=>T;
export type LifecycleDelta<T,D> = (previous:T,current:T)=>D;
const clone=<T>(value:T):T=>structuredClone(value);
export function createLifecycleReplay<T,D>(evaluate:LifecycleEvaluator<T>,deriveDelta:LifecycleDelta<T,D>,emptyDelta:()=>D){
 const candles:NormalizedCandle[]=[];let result=evaluate(candles),newResult=emptyDelta();
 const replay=(source:readonly NormalizedCandle[])=>evaluate(source.filter(candle=>Number.isFinite(Date.parse(candle.closedAt))));
 return Object.freeze({
  pushCandle(candle:NormalizedCandle){if(candles.some(value=>value.openedAt===candle.openedAt))throw new LifecycleReplayError('DUPLICATE_CANDLE',`Duplicate candle openedAt: ${candle.openedAt}.`);if(candles.at(-1)&&Date.parse(candle.openedAt)<=Date.parse(candles.at(-1)!.openedAt))throw new LifecycleReplayError('OUT_OF_ORDER_INCREMENTAL_INPUT','Incremental candles must have unique ascending openedAt.');const previous=result;candles.push(Object.freeze(clone(candle)));result=replay(candles);newResult=deriveDelta(previous,result);return result;},
  getNewResult(){const value=newResult;newResult=emptyDelta();return value;},getAll(){return result;},getResult(){return result;},getWarnings(){return Object.freeze([] as string[])},
  query(decisionTimestamp:string){const at=Date.parse(decisionTimestamp);return replay(candles.filter(candle=>Date.parse(candle.closedAt)<=at));},
  reset(){candles.length=0;result=evaluate(candles);newResult=emptyDelta();},
 });
}
