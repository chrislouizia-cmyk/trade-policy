'use client';

import { useEffect, useMemo, useState } from 'react';
import { MARKET_TYPES, canSelectVisibleInstrument, type CatalogInstrument as UniversalCatalogInstrument } from '@/lib/instrument-catalog';

export type CatalogInstrument = UniversalCatalogInstrument;

export default function InstrumentSelector({
  catalog,
  selected,
  onChange,
  onInstrumentResolved,
}: {
  catalog: CatalogInstrument[];
  selected: string[];
  onChange: (symbols: string[]) => void;
  onInstrumentResolved?: (instrument: CatalogInstrument) => void;
}) {
  const [search, setSearch] = useState('');
  const [market, setMarket] = useState('ALL');
  const [category, setCategory] = useState('ALL');
  const [open, setOpen] = useState(false);
  const [remoteResults, setRemoteResults] = useState<CatalogInstrument[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');

  const markets = ['ALL', ...MARKET_TYPES];
  const categories = ['ALL', ...Array.from(new Set(catalog.filter((item) => market === 'ALL' || item.marketType === market).map((item) => item.category)))];

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return [];
    const byIdentity = new Map([...catalog, ...remoteResults].map((item) => [`${item.marketType}:${item.symbol}`, item]));
    return [...byIdentity.values()]
      .filter((item) => {
        const matchesMarket = market === 'ALL' || item.marketType === market;
        const matchesCategory = category === 'ALL' || item.category === category;
        const matchesQuery = item.symbol.toLowerCase().includes(query) || item.displayName.toLowerCase().includes(query);
        return matchesMarket && matchesCategory && matchesQuery && !selected.includes(item.symbol);
      })
      .slice(0, 12);
  }, [catalog, remoteResults, search, market, category, selected]);

  useEffect(() => {
    const query = search.trim();
    if (!query) {
      setRemoteResults([]);
      setSearchError('');
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setSearching(true);
      setSearchError('');
      try {
        const params = new URLSearchParams({ q: query });
        if (market !== 'ALL') params.set('marketType', market);
        const response = await fetch(`/api/instruments?${params}`, { signal: controller.signal, cache: 'no-store' });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error ?? 'Instrument search failed.');
        setRemoteResults(Array.isArray(payload.instruments) ? payload.instruments : []);
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
        setSearchError(error instanceof Error ? error.message : 'Instrument search failed.');
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 180);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [search, market]);

  function add(instrument: CatalogInstrument) {
    onInstrumentResolved?.(instrument);
    if (!selected.includes(instrument.symbol)) onChange([...selected, instrument.symbol]);
    setSearch('');
    setOpen(false);
  }

  function remove(symbol: string) {
    onChange(selected.filter((item) => item !== symbol));
  }

  function selectCategory(target: string) {
    const symbols = catalog.filter((item) => canSelectVisibleInstrument(item) && item.category === target && (market === 'ALL' || item.marketType === market)).map((item) => item.symbol);
    onChange(Array.from(new Set([...selected, ...symbols])));
  }

  function selectMarket(target: string) {
    setMarket(target);
    setCategory('ALL');
    setSearch('');
    setOpen(true);
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
                <button type="button" disabled={!canSelectVisibleInstrument(item)} key={`${item.marketType}-${item.symbol}`} onMouseDown={(event) => event.preventDefault()} onClick={() => add(item)}>
                  <span><strong>{item.symbol}</strong><small>{item.displayName}</small></span>
                  <em>{item.marketType} · {item.availability === 'AVAILABLE' ? item.category : item.availability === 'INTERNAL_TEST_ONLY' ? `Internal test · ${item.category}` : item.availability.replaceAll('_', ' ')}</em>
                </button>
              )) : <p className="muted">{searching ? 'Searching verified instruments…' : searchError || 'No verified instrument matches this search.'}</p>}
            </div>
          )}
        </label>
      </div>

      <div>
        <div className="button-row compact-row instrument-shortcuts">
          <button type="button" onClick={() => selectCategory('MAJOR')}>Forex majors</button>
          <button type="button" onClick={() => selectCategory('CROSS')}>Crosses</button>
          <button type="button" onClick={() => selectCategory('METAL')}>Metals</button>
          <button type="button" onClick={() => selectMarket('CRYPTO')}>Crypto</button>
          <button type="button" onClick={() => selectMarket('STOCKS')}>US stocks</button>
          <button type="button" onClick={() => selectMarket('ETFS')}>ETFs</button>
          <button type="button" onClick={() => selectMarket('INDEX')}>Indices</button>
          <button type="button" onClick={() => selectMarket('FUTURES')}>Futures</button>
          <button type="button" onClick={() => selectMarket('COMMODITIES')}>Commodities</button>
          <button type="button" onClick={() => onChange([])}>Clear</button>
        </div>
        <p className="muted">Only provider-verified catalog instruments can be added. Internal-test markets are limited to authorized Trade Police staff.</p>
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
