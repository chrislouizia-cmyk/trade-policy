const providerSymbols:Record<string,string>={
  XAUUSD:'OANDA:XAUUSD',XAGUSD:'OANDA:XAGUSD',SPX500:'OANDA:SPX500USD',NAS100:'OANDA:NAS100USD',
  US30:'OANDA:US30USD',GER40:'OANDA:DE30EUR',UK100:'OANDA:UK100GBP',BTCUSD:'BITSTAMP:BTCUSD',
  ETHUSD:'BITSTAMP:ETHUSD',ES:'CME_MINI:ES1!',NQ:'CME_MINI:NQ1!',YM:'CBOT_MINI:YM1!',CL:'NYMEX:CL1!',GC:'COMEX:GC1!',
};

export function getTradingViewSymbol(instrument:string):string{
  const normalized=instrument.trim().toUpperCase().replaceAll('/','');
  if(providerSymbols[normalized])return providerSymbols[normalized];
  if(/^[A-Z]{6}$/.test(normalized))return `OANDA:${normalized}`;
  return normalized;
}

export function getTradingViewInterval(timeframe:string):string{
  return ({M1:'1',M3:'3',M5:'5',M15:'15',M30:'30',H1:'60',H2:'120',H4:'240',D1:'D',W1:'W',MN:'M'} as Record<string,string>)[timeframe]??'60';
}
