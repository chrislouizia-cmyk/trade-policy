'use client';

import { useMemo, useState } from 'react';

export type CatalogInstrument = {
  symbol: string;
  displayName: string;
  marketType: string;
  category: string;
};

export default function InstrumentSelector({
  catalog,
  selected,
  onChange,
}: {
  catalog: CatalogInstrument[];
  selected: string[];
  onChange: (symbols: string[]) => void;
}) {
  const [search, setSearch] = useState('');
  const [market, setMarket] = useState('ALL');
  const [category, setCategory] = useState('ALL');
  const [customSymbol, setCustomSymbol] = useState('');
  const [open, setOpen] = useState(false);

  const markets = ['ALL', ...Array.from(new Set(catalog.map((item) => item.marketType)))];
  const categories = ['ALL', ...Array.from(new Set(catalog.filter((item) => market === 'ALL' || item.marketType === market).map((item) => item.category)))];

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return [];
    return catalog
      .filter((item) => {
        const matchesMarket = market === 'ALL' || item.marketType === market;
        const matchesCategory = category === 'ALL' || item.category === category;
        const matchesQuery = item.symbol.toLowerCase().includes(query) || item.displayName.toLowerCase().includes(query);
        return matchesMarket && matchesCategory && matchesQuery && !selected.includes(item.symbol);
      })
      .slice(0, 12);
  }, [catalog, search, market, category, selected]);

  function add(symbol: string) {
    if (!selected.includes(symbol)) onChange([...selected, symbol]);
    setSearch('');
    setOpen(false);
  }

  function remove(symbol: string) {
    onChange(selected.filter((item) => item !== symbol));
  }

  function addCustom() {
    const symbol = customSymbol.trim().toUpperCase().replace(/[^A-Z0-9._-]/g, '');
    if (!symbol) return;
    add(symbol);
    setCustomSymbol('');
  }

  function selectCategory(target: string) {
    const symbols = catalog.filter((item) => item.category === target && (market === 'ALL' || item.marketType === market)).map((item) => item.symbol);
    onChange(Array.from(new Set([...selected, ...symbols])));
  }

  function selectMarket(target: string) {
    const symbols = catalog.filter((item) => item.marketType === target).map((item) => item.symbol);
    onChange(Array.from(new Set([...selected, ...symbols])));
    setMarket(target);
    setCategory('ALL');
  }

  return (
    <div className="stack compact-instrument-selector">
      <div className="grid grid-3">
        <label>
          Market
          <select value={market} onChange={(event) => { setMarket(event.target.value); setCategory('ALL'); }}>
            {markets.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label>
          Category
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            {categories.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label className="instrument-search-wrap">
          Search instrument
          <input
            value={search}
            onFocus={() => setOpen(true)}
            onChange={(event) => { setSearch(event.target.value); setOpen(true); }}
            placeholder="EURUSD, gold, NVIDIA…"
          />
          {open && search.trim() && (
            <div className="instrument-search-results">
              {filtered.length ? filtered.map((item) => (
                <button type="button" key={`${item.marketType}-${item.symbol}`} onMouseDown={(event) => event.preventDefault()} onClick={() => add(item.symbol)}>
                  <span><strong>{item.symbol}</strong><small>{item.displayName}</small></span>
                  <em>{item.marketType} · {item.category}</em>
                </button>
              )) : <p className="muted">No matching catalog symbol. Add it as a custom symbol below.</p>}
            </div>
          )}
        </label>
      </div>

      <div className="grid grid-2">
        <label>
          Add custom symbol
          <div className="inline-field">
            <input value={customSymbol} onChange={(event) => setCustomSymbol(event.target.value)} placeholder="US30" onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addCustom(); } }} />
            <button type="button" onClick={addCustom}>Add</button>
          </div>
        </label>
        <div className="button-row compact-row instrument-shortcuts">
          <button type="button" onClick={() => selectCategory('MAJOR')}>Forex majors</button>
          <button type="button" onClick={() => selectCategory('CROSS')}>Crosses</button>
          <button type="button" onClick={() => selectCategory('METAL')}>Metals</button>
          <button type="button" onClick={() => selectMarket('CRYPTO')}>Crypto</button>
          <button type="button" onClick={() => selectMarket('STOCKS')}>Stocks &amp; ETFs</button>
          <button type="button" onClick={() => selectMarket('FUTURES')}>Futures</button>
          <button type="button" onClick={() => onChange([])}>Clear</button>
        </div>
      </div>

      <div>
        <p className="muted">Selected instruments ({selected.length})</p>
        <div className="chip-list selected-instrument-chips">
          {selected.length === 0 ? <span className="muted">No instruments selected.</span> : selected.map((symbol) => (
            <button className="chip selected" type="button" key={symbol} onClick={() => remove(symbol)}>{symbol} ×</button>
          ))}
        </div>
      </div>
    </div>
  );
}
