'use client';

import { useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type Ticket = {
  id:string; customer_name:string; customer_email:string; title:string; type:string; message:string;
  page_path:string|null; browser:string|null; ease_score:number|null; priority:'LOW'|'NORMAL'|'HIGH'|'URGENT';
  status:'OPEN'|'REVIEWING'|'RESOLVED'|'CLOSED'; resolution_note:string|null; created_at:string;
};

export default function FeedbackTicketQueue({initialTickets}:{initialTickets:Ticket[]}){
  const [tickets,setTickets]=useState(initialTickets);
  const [filter,setFilter]=useState<'ALL'|'OPEN'|'REVIEWING'|'RESOLVED'>('ALL');
  const [busy,setBusy]=useState('');
  const visible=useMemo(()=>filter==='ALL'?tickets:tickets.filter(t=>t.status===filter),[tickets,filter]);

  async function update(id:string, patch:{status?:Ticket['status'];priority?:Ticket['priority'];resolution_note?:string;assign?:boolean}){
    setBusy(id);
    const {error}=await createClient().rpc('update_feedback_ticket',{
      p_ticket_id:id,p_status:patch.status??null,p_priority:patch.priority??null,
      p_resolution_note:patch.resolution_note??null,p_assign_to_me:patch.assign??false,
    });
    setBusy('');
    if(error){window.alert(error.message);return;}
    setTickets(current=>current.map(t=>t.id===id?{...t,...patch}:t).filter(t=>t.status!=='CLOSED'));
  }

  return <div className="stack">
    <section className="card hq-hero-card"><div><span className="eyebrow">BETA OPERATIONS</span><h1>Tester feedback tickets</h1><p>Every report becomes owned work: triage it, prioritize it, resolve it and preserve the learning.</p></div><div className="hq-mission"><small>OPEN WORK</small><strong>{tickets.filter(t=>!['RESOLVED','CLOSED'].includes(t.status)).length} tickets need a decision</strong></div></section>
    <div className="button-row">{(['ALL','OPEN','REVIEWING','RESOLVED'] as const).map(x=><button key={x} className={filter===x?'primary':''} onClick={()=>setFilter(x)}>{x}</button>)}</div>
    {visible.length===0?<section className="card"><h2>Queue clear</h2><p className="muted">No feedback tickets match this view.</p></section>:visible.map(ticket=><article className="card" key={ticket.id}>
      <div className="ticket-head"><div><span className="eyebrow">{ticket.type} · {ticket.priority}</span><h2>{ticket.title}</h2><p className="muted">{ticket.customer_name}{ticket.customer_email?` · ${ticket.customer_email}`:''} · {new Date(ticket.created_at).toLocaleString()}</p></div><span className={`badge ${ticket.status.toLowerCase()}`}>{ticket.status}</span></div>
      <p>{ticket.message}</p>
      <div className="analysis-strip"><span>Page {ticket.page_path||'Unknown'}</span><span>Ease {ticket.ease_score??'—'}/10</span></div>
      <div className="grid grid-2">
        <label>Priority<select value={ticket.priority} disabled={busy===ticket.id} onChange={e=>void update(ticket.id,{priority:e.target.value as Ticket['priority']})}><option>LOW</option><option>NORMAL</option><option>HIGH</option><option>URGENT</option></select></label>
        <label>Status<select value={ticket.status} disabled={busy===ticket.id} onChange={e=>void update(ticket.id,{status:e.target.value as Ticket['status']})}><option>OPEN</option><option>REVIEWING</option><option>RESOLVED</option><option>CLOSED</option></select></label>
      </div>
      <label>Resolution / product note<textarea defaultValue={ticket.resolution_note??''} id={`note-${ticket.id}`} placeholder="What will we change, why, and how will we verify it?"/></label>
      <div className="button-row"><button onClick={()=>void update(ticket.id,{assign:true,status:'REVIEWING'})}>Assign to me</button><button className="primary" onClick={()=>{const el=document.getElementById(`note-${ticket.id}`) as HTMLTextAreaElement;void update(ticket.id,{resolution_note:el.value,status:'RESOLVED'});}}>Resolve ticket</button></div>
    </article>)}
  </div>;
}
