'use client';
import {useMemo,useState} from 'react';
import Link from 'next/link';
export default function CustomerDirectory({rows}:{rows:any[]}){
 const [query,setQuery]=useState(''); const [open,setOpen]=useState(false); const [page,setPage]=useState(1); const size=20;
 const filtered=useMemo(()=>rows.filter(r=>`${r.display_name} ${r.email} ${r.plan} ${r.subscription_status}`.toLowerCase().includes(query.toLowerCase())),[rows,query]);
 const pages=Math.max(1,Math.ceil(filtered.length/size)); const visible=filtered.slice((page-1)*size,page*size);
 return <div className="customer-directory-widget">
  <div className="directory-toolbar"><button className="secondary" onClick={()=>setOpen(!open)}>{open?'Hide customer list':`Browse customers (${rows.length})`}</button>{open&&<input aria-label="Search customers" placeholder="Search name, email, plan or status" value={query} onChange={e=>{setQuery(e.target.value);setPage(1)}}/>}</div>
  {open&&<><div className="customer-card-list">{visible.map(c=><article className="customer-card-row" key={c.customer_id}><div><strong>{c.display_name||'Unnamed customer'}</strong><small>{c.email||'No email'}</small></div><div><span className="status-pill">{c.plan}</span><small>{c.subscription_status}</small></div><div><strong>{c.analysis_count} analyses</strong><small>{c.strategy_count} strategies · {c.account_count} accounts</small></div><div><small>{c.last_activity_at?new Date(c.last_activity_at).toLocaleString():'No activity'}</small></div><Link className="button-link secondary" href={`/hq/customers/${c.customer_id}`}>Open profile</Link></article>)}</div><div className="pagination"><button disabled={page===1} onClick={()=>setPage(p=>p-1)}>Previous</button><span>Page {page} of {pages}</span><button disabled={page===pages} onClick={()=>setPage(p=>p+1)}>Next</button></div></>}
 </div>
}
