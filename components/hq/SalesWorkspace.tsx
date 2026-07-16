'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

type SalesItem = {
  item_type: 'CUSTOMER' | 'LEAD';
  id: string;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  discord_handle: string | null;
  plan: string | null;
  status: string | null;
  reason: string;
  priority: number;
  due_at: string | null;
  last_activity_at: string | null;
  created_at: string | null;
  assigned_to: string | null;
};

type Filter = 'ATTENTION' | 'ACTIVE' | 'TRIAL' | 'LEADS' | 'ALL';

function matchesFilter(item: SalesItem, filter: Filter) {
  if (filter === 'ALL') return true;
  if (filter === 'LEADS') return item.item_type === 'LEAD';
  if (filter === 'ACTIVE') return item.item_type === 'CUSTOMER' && item.status === 'ACTIVE';
  if (filter === 'TRIAL') return item.item_type === 'CUSTOMER' && item.status === 'TRIAL';
  return item.priority >= 60;
}

function formatDate(value: string | null) {
  if (!value) return 'Not scheduled';
  return new Date(value).toLocaleString();
}

export default function SalesWorkspace({ items }: { items: SalesItem[] }) {
  const [filter, setFilter] = useState<Filter>('ATTENTION');
  const counts = useMemo(() => ({
    ATTENTION: items.filter(i => i.priority >= 60).length,
    ACTIVE: items.filter(i => i.item_type === 'CUSTOMER' && i.status === 'ACTIVE').length,
    TRIAL: items.filter(i => i.item_type === 'CUSTOMER' && i.status === 'TRIAL').length,
    LEADS: items.filter(i => i.item_type === 'LEAD').length,
    ALL: items.length,
  }), [items]);
  const visible = useMemo(() => items.filter(i => matchesFilter(i, filter)), [items, filter]);

  const cards: { key: Filter; label: string; help: string }[] = [
    { key: 'ATTENTION', label: 'Needs attention', help: 'Renewals, inactivity and overdue follow-ups' },
    { key: 'ACTIVE', label: 'Active subscriptions', help: 'Retention, relationship and expansion' },
    { key: 'TRIAL', label: 'Trial customers', help: 'Help engaged trials become subscribers' },
    { key: 'LEADS', label: 'Open leads', help: 'Qualified interest awaiting follow-up' },
  ];

  return <div className="stack hq-workspace">
    <section className="card hq-hero-card">
      <div><span className="eyebrow">SALES OPERATIONS</span><h1>Who should Sales help today?</h1><p>Every number opens the people behind it. Contact, follow up and understand the commercial context without exposing private trading activity.</p></div>
      <div className="hq-mission"><small>MISSION</small><strong>Turn qualified interest into long-term Trade Police customers.</strong></div>
    </section>

    <div className="grid grid-4 sales-filter-grid">
      {cards.map(card => <button type="button" key={card.key} className={`card metric sales-filter-card ${filter === card.key ? 'selected' : ''}`} onClick={() => setFilter(card.key)}>
        <span className="muted">{card.label}</span><strong>{counts[card.key]}</strong><small>{card.help}</small>
      </button>)}
    </div>

    <section className="card sales-queue-card">
      <div className="section-title">
        <div><span className="eyebrow">LIVE QUEUE</span><h2>{cards.find(c => c.key === filter)?.label ?? 'All sales records'}</h2><p className="muted">{visible.length} record{visible.length === 1 ? '' : 's'} ready for action.</p></div>
        <button className="button-link secondary" type="button" onClick={() => setFilter('ALL')}>Show all</button>
      </div>

      {visible.length === 0 ? <div className="empty-state"><strong>Nothing needs action in this view.</strong><span>When customers, trials or leads match this queue, they will appear here automatically.</span></div> :
      <div className="sales-record-list">{visible.map(item => <article className="sales-record" key={`${item.item_type}-${item.id}`}>
        <div className="sales-record-main">
          <div className="sales-record-title"><span className={`status-pill ${item.item_type === 'LEAD' ? 'warning' : ''}`}>{item.item_type}</span><strong>{item.display_name || 'Unnamed person'}</strong></div>
          <span>{item.email || 'No email available'}</span>
          <small>{item.reason}</small>
        </div>
        <div className="sales-record-context"><strong>{item.plan || 'No plan'}</strong><span>{item.status || 'UNKNOWN'}</span><small>{item.due_at ? `Due ${formatDate(item.due_at)}` : `Last activity: ${formatDate(item.last_activity_at)}`}</small></div>
        <div className="staff-actions sales-record-actions">
          {item.item_type === 'CUSTOMER' && <Link className="button-link primary" href={`/hq/customers/${item.id}`}>Open profile</Link>}
          {item.email && <a className="button-link secondary" href={`mailto:${item.email}`}>Email</a>}
          {item.phone && <a className="button-link secondary" href={`https://wa.me/${String(item.phone).replace(/\D/g, '')}`} target="_blank" rel="noreferrer">WhatsApp</a>}
        </div>
      </article>)}</div>}
    </section>
  </div>;
}
