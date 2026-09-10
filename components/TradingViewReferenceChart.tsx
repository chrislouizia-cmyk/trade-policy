'use client';

import {useMemo,useState} from 'react';
import {getTradingViewInterval,getTradingViewSymbol} from '@/lib/tradingview-reference';

function TradingViewFrame({src,title}:{src:string;title:string}){
  const [loaded,setLoaded]=useState(false);
  return <div className="tv-wrap tradingview-reference-frame" aria-busy={!loaded}>
    {!loaded?<div className="tradingview-reference-loading">Loading market chart…</div>:null}
    <iframe src={src} title={title} loading="eager" referrerPolicy="no-referrer-when-downgrade" onLoad={()=>setLoaded(true)} />
  </div>;
}

export default function TradingViewReferenceChart({instrument,timeframe}:{instrument:string;timeframe:string}){
  const src=useMemo(()=>{
    const params=new URLSearchParams({symbol:getTradingViewSymbol(instrument),interval:getTradingViewInterval(timeframe),theme:'dark',style:'1',timezone:'Etc/UTC',hideideas:'1',withdateranges:'1',saveimage:'0',studies:'[]',locale:'en'});
    return `https://s.tradingview.com/widgetembed/?${params.toString()}`;
  },[instrument,timeframe]);

  return <div className="tradingview-reference">
    <TradingViewFrame key={src} src={src} title={`${instrument} ${timeframe} live reference chart`}/>
  </div>;
}
