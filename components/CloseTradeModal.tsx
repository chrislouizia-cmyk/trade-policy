'use client';
import { useMemo, useState } from 'react';

type Trade = { id:string; instrument:string; direction:'BUY'|'SELL'; entry:number; stop_loss:number; current_price?:number; risk_amount?:number|null; balance_at_entry?:number|null; account_name?:string|null };

export default function CloseTradeModal({trade,onClose,onClosed}:{trade:Trade;onClose:()=>void;onClosed:(result:any)=>void}){
  const [price,setPrice]=useState(String(trade.current_price ?? trade.entry));
  const [fees,setFees]=useState('0');
  const [notes,setNotes]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const preview=useMemo(()=>{
    const close=Number(price), riskDistance=Math.abs(trade.entry-trade.stop_loss), risk=Number(trade.risk_amount??0), fee=Number(fees||0);
    if(!Number.isFinite(close)||!riskDistance)return null;
    const resultR=trade.direction==='BUY'?(close-trade.entry)/riskDistance:(trade.entry-close)/riskDistance;
    const pnl=resultR*risk-fee;
    return {resultR,pnl,balanceAfter:trade.balance_at_entry==null?null:Number(trade.balance_at_entry)+pnl};
  },[price,fees,trade]);
  async function submit(){setBusy(true);setError('');try{const res=await fetch('/api/trades/close',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tradeId:trade.id,closePrice:Number(price),fees:Number(fees||0),notes})});const data=await res.json();if(!res.ok)throw new Error(data.error||'Could not close trade.');onClosed(data.result);}catch(e){setError(e instanceof Error?e.message:'Could not close trade.');}finally{setBusy(false)}}
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><div className="card modal-card"><div className="modal-head"><div><p className="muted">CLOSE TRADE</p><h2>{trade.instrument} {trade.direction}</h2></div><button onClick={onClose}>×</button></div><div className="grid grid-2"><label>Exit price<input type="number" step="any" value={price} onChange={e=>setPrice(e.target.value)}/></label><label>Fees / commission<input type="number" min="0" step="0.01" value={fees} onChange={e=>setFees(e.target.value)}/></label><label className="full-span">Notes<textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="What happened?"/></label></div>{preview&&<div className="close-preview"><Metric label="Result" value={`${preview.resultR.toFixed(2)}R`}/><Metric label="Realized P&L" value={`$${preview.pnl.toFixed(2)}`}/><Metric label="Balance after" value={preview.balanceAfter==null?'Legacy trade':`$${preview.balanceAfter.toFixed(2)}`}/></div>}{error&&<p className="error">{error}</p>}<div className="button-row"><button onClick={onClose}>Cancel</button><button className="primary" onClick={submit} disabled={busy}>{busy?'Updating balance…':'Confirm close'}</button></div></div></div>
}
function Metric({label,value}:{label:string;value:string}){return <div><span className="muted">{label}</span><strong>{value}</strong></div>}
