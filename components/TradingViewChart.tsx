'use client';

import { useMemo, useState } from 'react';

function getTradingViewSymbol(instrument: string) {
  const symbol = instrument.toUpperCase().trim();

  const specialSymbols: Record<string, string> = {
    XAUUSD: 'OANDA:XAUUSD',
    XAGUSD: 'OANDA:XAGUSD',
    SPX500: 'OANDA:SPX500USD',
    NAS100: 'OANDA:NAS100USD',
    US30: 'OANDA:US30USD',
    GER40: 'OANDA:DE30EUR',
    UK100: 'OANDA:UK100GBP',
    BTCUSD: 'BITSTAMP:BTCUSD',
    ETHUSD: 'BITSTAMP:ETHUSD',
    ES: 'CME_MINI:ES1!',
    MES: 'CME_MINI:MES1!',
    NQ: 'CME_MINI:NQ1!',
    MNQ: 'CME_MINI:MNQ1!',
    YM: 'CBOT_MINI:YM1!',
    RTY: 'CME_MINI:RTY1!',
    GC: 'COMEX:GC1!',
    MGC: 'COMEX:MGC1!',
    CL: 'NYMEX:CL1!',
  };

  if (specialSymbols[symbol]) return specialSymbols[symbol];
  if (/^[A-Z]{6}$/.test(symbol)) return `OANDA:${symbol}`;
  if (/^[A-Z]{1,5}$/.test(symbol)) return `NASDAQ:${symbol}`;
  return symbol;
}

export default function TradingViewChart({ instrument }: { instrument: string }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  const tradingViewSymbol = useMemo(
    () => getTradingViewSymbol(instrument),
    [instrument],
  );

  const src = useMemo(() => {
    const params = new URLSearchParams({
      symbol: tradingViewSymbol,
      interval: '60',
      theme: 'dark',
      style: '1',
      timezone: 'Etc/UTC',
      locale: 'en',
      hide_side_toolbar: '0',
      allow_symbol_change: '0',
      save_image: '0',
      calendar: '0',
      details: '1',
      hotlist: '0',
      withdateranges: '1',
    });

    return `https://s.tradingview.com/widgetembed/?${params.toString()}`;
  }, [tradingViewSymbol]);

  return (
    <div className="tv-wrap">
      {!loaded && !failed && (
        <div className="tv-status">Loading TradingView chart…</div>
      )}

      {failed ? (
        <div className="tv-status tv-error">
          <strong>TradingView chart could not load.</strong>
          <span>
            Turn off content blockers for localhost, then reload the page.
          </span>
          <a
            href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tradingViewSymbol)}`}
            target="_blank"
            rel="noreferrer"
          >
            Open {instrument} in TradingView
          </a>
        </div>
      ) : (
        <iframe
          key={tradingViewSymbol}
          title={`${instrument} TradingView chart`}
          src={src}
          allowFullScreen
          loading="eager"
          referrerPolicy="origin"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}
