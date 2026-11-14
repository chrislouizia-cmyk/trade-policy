'use client';

import { useState } from 'react';
import TradingViewChart from '@/components/TradingViewChart';

const instruments=['XAUUSD','GBPUSD','EURUSD','GBPJPY','USDJPY'] as const;

export default function ReadOnlyMarketCharts(){
  const [instrument,setInstrument]=useState<string>('XAUUSD');
  return <section className="card" aria-label="Read-only market chart" style={{marginTop:16}}>
    <div className="section-title"><div><span className="eyebrow">MARKET VIEW</span><h2>Market chart</h2></div></div>
    <p className="muted">Chart viewing only. Trade validation and authorization remain unavailable until the active strategy is fully configured.</p>
    <label htmlFor="readonly-market-instrument">Instrument</label>
    <select id="readonly-market-instrument" value={instrument} onChange={event=>setInstrument(event.target.value)}>
      {instruments.map(symbol=><option key={symbol} value={symbol}>{symbol}</option>)}
    </select>
    <TradingViewChart key={instrument} instrument={instrument}/>
  </section>;
}
