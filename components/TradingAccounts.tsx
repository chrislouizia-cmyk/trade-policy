'use client';

import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useLocale } from '@/components/i18n/LocaleProvider';
import { workspaceText } from '@/lib/i18n/workspace-copy';

type Account = { id:string; name:string; broker:string|null; account_type:string; currency:string; initial_balance:number; current_balance:number; peak_balance:number|null; is_active:boolean };
type Ledger = { id:string; entry_type:string; amount:number; balance_after:number; description:string|null; created_at:string };

export default function TradingAccounts({ userId }: { userId:string }) {
  const { locale } = useLocale();
  const w = (text:string) => workspaceText(locale, text);
  const [accounts,setAccounts]=useState<Account[]>([]);
  const [ledger,setLedger]=useState<Ledger[]>([]);
  const [selectedId,setSelectedId]=useState('');
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const [editing,setEditing]=useState(false);

  useEffect(()=>{ void loadAccounts(); },[userId]);
  useEffect(()=>{ if(selectedId) void loadLedger(selectedId); },[selectedId]);

  async function loadAccounts(){
    const {data,error}=await createClient().from('trading_accounts').select('*').eq('user_id',userId).eq('is_archived',false).order('created_at');
    if(error) return setMessage(w('Trading accounts could not be loaded. Please try again.'));
    const rows=(data??[]).map((row:any)=>({...row,initial_balance:Number(row.initial_balance),current_balance:Number(row.current_balance),peak_balance:row.peak_balance==null?null:Number(row.peak_balance)}));
    setAccounts(rows);
    setSelectedId(current=>rows.some((row:any)=>row.id===current)?current:rows.find((row:any)=>row.is_active)?.id??rows[0]?.id??'');
  }

  async function loadLedger(id:string){
    const {data}=await createClient().from('account_ledger').select('id,entry_type,amount,balance_after,description,created_at').eq('user_id',userId).eq('account_id',id).order('created_at',{ascending:false}).limit(100);
    setLedger((data??[]).map((row:any)=>({...row,amount:Number(row.amount),balance_after:Number(row.balance_after)})));
  }

  async function createAccount(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    const element=event.currentTarget;
    const form=new FormData(element);
    const initial=Number(form.get('initialBalance'));
    if(!Number.isFinite(initial)||initial<0) return setMessage(w('Enter a valid initial balance.'));
    setBusy(true);
    const supabase=createClient();
    const {data,error}=await supabase.from('trading_accounts').insert({user_id:userId,name:String(form.get('name')||'').trim(),broker:String(form.get('broker')||'').trim()||null,account_type:form.get('accountType'),currency:String(form.get('currency')||'USD').toUpperCase(),initial_balance:initial,current_balance:initial,peak_balance:initial,is_active:accounts.length===0}).select().single();
    if(error){ setBusy(false); return setMessage(error.message); }
    const {error:ledgerError}=await supabase.from('account_ledger').insert({user_id:userId,account_id:data.id,entry_type:'INITIAL_BALANCE',amount:initial,balance_before:0,balance_after:initial,description:'Opening balance'});
    setBusy(false);
    if(ledgerError) return setMessage(ledgerError.message);
    element.reset();
    setMessage(w('Trading account created.'));
    await loadAccounts();
    setSelectedId(data.id);
  }

  async function activate(id:string){
    const {error}=await createClient().rpc('set_active_trading_account',{target_account_id:id});
    if(error) return setMessage(error.message);
    await loadAccounts();
    setSelectedId(id);
    setMessage(w('Active trading account changed.'));
    window.dispatchEvent(new CustomEvent('trade-police:account-changed',{detail:{accountId:id}}));
  }

  async function adjust(type:string){
    if(!selected) return;
    const raw=prompt(`${w(type.replaceAll('_',' '))} · ${w('Amount')}`,'0');
    if(raw===null) return;
    const amount=Number(raw);
    if(!Number.isFinite(amount)||amount<0) return setMessage(w('Enter a valid amount.'));
    const description=prompt(w('Description (optional)'))||null;
    setBusy(true);
    const {error}=await createClient().rpc('adjust_trading_account',{p_account_id:selected.id,p_entry_type:type,p_amount:amount,p_description:description});
    setBusy(false);
    if(error) return setMessage(error.message);
    setMessage(w('Account balance updated.'));
    await loadAccounts();
    await loadLedger(selected.id);
  }

  async function saveEdit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!selected) return;
    const form=new FormData(event.currentTarget);
    const {error}=await createClient().from('trading_accounts').update({name:String(form.get('name')),broker:String(form.get('broker')||'')||null,account_type:form.get('accountType'),updated_at:new Date().toISOString()}).eq('id',selected.id).eq('user_id',userId);
    if(error) return setMessage(error.message);
    setEditing(false);
    setMessage(w('Account updated.'));
    await loadAccounts();
  }

  async function archive(){
    if(!selected||!confirm(`${w('Archive')} ${selected.name}?`)) return;
    const {error}=await createClient().rpc('archive_trading_account',{p_account_id:selected.id});
    if(error) return setMessage(error.message);
    setMessage(w('Account archived.'));
    await loadAccounts();
  }

  const selected=useMemo(()=>accounts.find(account=>account.id===selectedId)||null,[accounts,selectedId]);
  const totalReturn=selected&&selected.initial_balance>0?(selected.current_balance-selected.initial_balance)/selected.initial_balance*100:0;
  const peak=selected?.peak_balance??selected?.initial_balance??0;
  const drawdown=selected&&peak>0?(selected.current_balance-peak)/peak*100:0;
  const today=ledger.filter(item=>new Date(item.created_at).toDateString()===new Date().toDateString()).reduce((sum,item)=>sum+item.amount,0);

  return <div className="account-layout">
    <aside className="card account-sidebar">
      <p className="muted">{w('TRADING ACCOUNTS')}</p>
      <h2>{w('Your accounts')}</h2>
      <p className="muted">{w('Add another account whenever you need one. Trade Police stores only the account details and balance you enter here.')}</p>
      <div className="strategy-list">{accounts.map(account=><button type="button" key={account.id} className={`strategy-list-item ${selectedId===account.id?'selected':''}`} onClick={()=>setSelectedId(account.id)}><span>{account.is_active?'●':'○'}</span><div><strong>{account.name}</strong><small>{account.account_type} · {account.currency} {account.current_balance.toLocaleString(locale)}</small></div></button>)}</div>
      {selected&&!selected.is_active&&<button onClick={()=>void activate(selected.id)}>{w('Set as active account')}</button>}
    </aside>
    <section className="stack">
      <form className="card" onSubmit={createAccount}>
        <div className="section-title"><div><p className="eyebrow">{w('NEW RISK ACCOUNT')}</p><h2>{w('Add trading account')}</h2></div></div>
        <p className="muted">{w('No broker login or password is required. This account is used for risk, history, and analytics inside Trade Police.')}</p>
        <div className="grid grid-3">
          <label>{w('Account name')}<input name="name" required/></label>
          <label>{w('Broker or firm')}<input name="broker"/></label>
          <label>{w('Type')}<select name="accountType"><option value="PAPER">{w('Paper')}</option><option value="DEMO">{w('Demo')}</option><option value="FUNDED">{w('Funded')}</option><option value="LIVE">{w('Live')}</option></select></label>
          <label>{w('Currency')}<input name="currency" defaultValue="USD" maxLength={3}/></label>
          <label>{w('Initial balance')}<input name="initialBalance" type="number" min="0" step="0.01" required/></label>
        </div>
        <button className="primary" disabled={busy}>{busy?w('Creating…'):w('Create account')}</button>
      </form>
      {selected&&<>
        <div className="grid grid-3 metric-grid"><Metric label={w('Initial balance')} value={`${selected.currency} ${selected.initial_balance.toLocaleString(locale)}`}/><Metric label={w('Current balance')} value={`${selected.currency} ${selected.current_balance.toLocaleString(locale)}`}/><Metric label={w('Today')} value={`${today>=0?'+':''}${today.toFixed(2)}`}/><Metric label={w('Total return')} value={`${totalReturn.toFixed(2)}%`}/><Metric label={w('Drawdown')} value={`${drawdown.toFixed(2)}%`}/><Metric label={w('Type')} value={w(selected.account_type)}/></div>
        <div className="card"><div className="section-title"><h2>{w('Account actions')}</h2><button onClick={()=>setEditing(!editing)}>{editing?w('Cancel edit'):w('Edit account')}</button></div>{editing&&<form onSubmit={saveEdit} className="grid grid-3"><label>{w('Name')}<input name="name" defaultValue={selected.name}/></label><label>{w('Broker')}<input name="broker" defaultValue={selected.broker??''}/></label><label>{w('Type')}<select name="accountType" defaultValue={selected.account_type}><option value="PAPER">{w('Paper')}</option><option value="DEMO">{w('Demo')}</option><option value="FUNDED">{w('Funded')}</option><option value="LIVE">{w('Live')}</option></select></label><button className="primary">{w('Save changes')}</button></form>}<div className="button-row"><button onClick={()=>void adjust('DEPOSIT')}>{w('Deposit')}</button><button onClick={()=>void adjust('WITHDRAWAL')}>{w('Withdraw')}</button><button onClick={()=>void adjust('FEE')}>{w('Add fee')}</button><button onClick={()=>void adjust('MANUAL_ADJUSTMENT')}>{w('Manual adjustment')}</button><button onClick={()=>void archive()}>{w('Archive')}</button></div></div>
        <div className="card"><h2>{w('Account ledger')}</h2>{ledger.map(item=><div className="event-row" key={item.id}><div><strong>{w(item.entry_type.replaceAll('_',' '))}</strong><small>{item.description||new Date(item.created_at).toLocaleString(locale)}</small></div><div><span className={item.amount>=0?'positive':'negative'}>{item.amount>=0?'+':''}{item.amount.toFixed(2)}</span><small>{w('Balance')} {item.balance_after.toFixed(2)}</small></div></div>)}</div>
      </>}
      {!selected&&<div className="card empty-state"><h2>{w('Create your first account')}</h2><p>{w('Add a balance so Trade Police can calculate risk and keep an auditable trading history.')}</p></div>}
      {message&&<p className="warning" role="status">{message}</p>}
    </section>
  </div>;
}

function Metric({label,value}:{label:string;value:string}){return <div className="card metric"><span className="muted">{label}</span><strong>{value}</strong></div>}
