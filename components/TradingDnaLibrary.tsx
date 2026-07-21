'use client';

import { useMemo, useState } from 'react';
import { TRADING_DNA_CATEGORIES, searchTradingDnaRules } from '@/lib/trading-dna/registry';
import type { TradingDnaCategoryId, TradingDnaRuleDefinition } from '@/lib/trading-dna/types';

export default function TradingDnaLibrary({selectedIds,onSelect}:{selectedIds:string[];onSelect:(rule:TradingDnaRuleDefinition)=>void}) {
  const [query,setQuery]=useState('');
  const [category,setCategory]=useState<TradingDnaCategoryId|undefined>();
  const rules=useMemo(()=>searchTradingDnaRules(query,category),[query,category]);
  const selected=new Set(selectedIds);
  return <section className="trading-dna-library" aria-labelledby="trading-dna-library-title">
    <header><div><p className="muted">TRADING DNA LIBRARY</p><h2 id="trading-dna-library-title">Browse confirmations</h2><p>Choose the evidence you must see before taking a trade. Logical combinations will be available in Rule Composer later.</p></div><label>Search rules<input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search EMA, structure, risk…" /></label></header>
    <nav className="trading-dna-categories" aria-label="Trading DNA categories"><button type="button" className={!category?'selected':''} onClick={()=>setCategory(undefined)}>All <span>{searchTradingDnaRules('').length}</span></button>{TRADING_DNA_CATEGORIES.map(item=><button type="button" className={category===item.id?'selected':''} key={item.id} onClick={()=>setCategory(item.id)}>{item.displayName} <span>{searchTradingDnaRules('',item.id).length}</span></button>)}</nav>
    <p className="muted trading-dna-results">{rules.length} {rules.length===1?'rule':'rules'} found</p>
    <div className="trading-dna-rule-grid">{rules.map(rule=>{
      const added=selected.has(rule.id);
      return <article className="trading-dna-rule-card" key={rule.id}><div><span className={`evidence-mode ${rule.evaluationType.toLowerCase()}`}>{rule.evaluationType}</span><small>{TRADING_DNA_CATEGORIES.find(item=>item.id===rule.category)?.displayName} · {rule.subcategory}</small></div><h3>{rule.displayName}</h3><p>{rule.description}</p><details><summary>Learn about this rule</summary><dl><dt>What it means</dt><dd>{rule.whatItMeans}</dd><dt>Why traders use it</dt><dd>{rule.whyTradersUseIt}</dd><dt>Typical confirmations</dt><dd>{rule.typicalConfirmations.join('; ')}.</dd><dt>Example</dt><dd>{rule.exampleScenario}</dd></dl></details><button type="button" disabled={added} onClick={()=>onSelect(rule)}>{added?'Added to Trading DNA':'Add rule'}</button></article>;
    })}</div>
    {!rules.length&&<p className="empty-state">No rules match that search. Try a name, description, tag, or category.</p>}
  </section>;
}
