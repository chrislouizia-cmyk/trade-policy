'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

type Ticket = {
  id: string;
  customer_user_id: string;
  customer_name: string;
  customer_email: string;
  subject: string;
  description: string;
  status: 'OPEN' | 'WAITING_CUSTOMER' | 'RESOLVED' | 'CLOSED';
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  resolution_note: string | null;
  created_at: string;
};

export default function SupportTicketQueue({ initialTickets, canManage }: { initialTickets: Ticket[]; canManage: boolean }) {
  const [tickets, setTickets] = useState(initialTickets);
  const [filter, setFilter] = useState<'ACTIVE' | 'RESOLVED' | 'ALL'>('ACTIVE');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const visible = useMemo(() => tickets.filter((ticket) => {
    if (filter === 'ACTIVE') return ['OPEN', 'WAITING_CUSTOMER'].includes(ticket.status);
    if (filter === 'RESOLVED') return ticket.status === 'RESOLVED';
    return true;
  }), [filter, tickets]);

  async function update(id: string, patch: Partial<Pick<Ticket, 'status' | 'priority' | 'resolution_note'>> & { assign?: boolean }) {
    if (!canManage || busy) return;
    setBusy(id);
    setMessage('');
    const { data, error } = await createClient().rpc('staff_support_ticket_action', {
      p_ticket_id: id,
      p_status: patch.status ?? null,
      p_priority: patch.priority ?? null,
      p_resolution_note: patch.resolution_note ?? null,
      p_assign_to_me: patch.assign ?? false,
    });
    setBusy('');
    if (error) {
      setMessage(error.message);
      return;
    }
    setTickets((current) => current.map((ticket) => ticket.id === id ? { ...ticket, ...data } : ticket));
    setMessage('Ticket updated.');
  }

  return (
    <section className="stack">
      <div className="section-title">
        <div><span className="eyebrow">CUSTOMER SUPPORT</span><h2>Support tickets</h2></div>
        <span>{tickets.filter((ticket) => ['OPEN', 'WAITING_CUSTOMER'].includes(ticket.status)).length} active</span>
      </div>
      <div className="button-row">
        {(['ACTIVE', 'RESOLVED', 'ALL'] as const).map((value) => <button key={value} className={filter === value ? 'primary' : ''} onClick={() => setFilter(value)}>{value}</button>)}
      </div>
      {message ? <p role="status">{message}</p> : null}
      {visible.length ? visible.map((ticket) => (
        <article className="card" key={ticket.id}>
          <div className="ticket-head">
            <div><span className="eyebrow">{ticket.priority}</span><h3>{ticket.subject}</h3><p className="muted">{ticket.customer_name} · {ticket.customer_email} · {new Date(ticket.created_at).toLocaleString()}</p></div>
            <span className={`badge ${ticket.status.toLowerCase()}`}>{ticket.status.replaceAll('_', ' ')}</span>
          </div>
          <p>{ticket.description || 'No description provided.'}</p>
          <Link href={`/hq/customers/${ticket.customer_user_id}`}>Open customer</Link>
          {canManage ? <>
            <div className="grid grid-2">
              <label>Priority<select value={ticket.priority} disabled={busy === ticket.id} onChange={(event) => void update(ticket.id, { priority: event.target.value as Ticket['priority'] })}><option>LOW</option><option>NORMAL</option><option>HIGH</option><option>URGENT</option></select></label>
              <label>Status<select value={ticket.status} disabled={busy === ticket.id} onChange={(event) => void update(ticket.id, { status: event.target.value as Ticket['status'] })}><option>OPEN</option><option>WAITING_CUSTOMER</option><option>RESOLVED</option><option>CLOSED</option></select></label>
            </div>
            <label>Resolution note<textarea defaultValue={ticket.resolution_note ?? ''} id={`support-note-${ticket.id}`} placeholder="Required to resolve or close" /></label>
            <div className="button-row"><button onClick={() => void update(ticket.id, { assign: true })}>Assign to me</button><button className="primary" onClick={() => { const element = document.getElementById(`support-note-${ticket.id}`) as HTMLTextAreaElement; void update(ticket.id, { status: 'RESOLVED', resolution_note: element.value }); }}>Resolve ticket</button></div>
          </> : ticket.resolution_note ? <p className="muted">Resolution: {ticket.resolution_note}</p> : <p className="muted">Read-only access</p>}
        </article>
      )) : <section className="card"><h3>No matching support tickets</h3><p className="muted">This is a verified empty state.</p></section>}
    </section>
  );
}
