export type SupportedInstrument = {
  symbol: string;
  displayName: string;
  category: 'MAJOR' | 'CROSS' | 'METAL';
  marketType: 'FOREX' | 'METALS';
  base: string;
  quote: string;
  twelveDataSymbol: string;
  tradingViewSymbol: string;
  backtestEnabled: true;
};

export const SUPPORTED_INSTRUMENTS = [
  { symbol:'EURUSD', displayName:'Euro / US Dollar', category:'MAJOR', marketType:'FOREX', base:'EUR', quote:'USD', twelveDataSymbol:'EUR/USD', tradingViewSymbol:'OANDA:EURUSD', backtestEnabled:true },
  { symbol:'GBPUSD', displayName:'British Pound / US Dollar', category:'MAJOR', marketType:'FOREX', base:'GBP', quote:'USD', twelveDataSymbol:'GBP/USD', tradingViewSymbol:'OANDA:GBPUSD', backtestEnabled:true },
  { symbol:'USDJPY', displayName:'US Dollar / Japanese Yen', category:'MAJOR', marketType:'FOREX', base:'USD', quote:'JPY', twelveDataSymbol:'USD/JPY', tradingViewSymbol:'OANDA:USDJPY', backtestEnabled:true },
  { symbol:'USDCHF', displayName:'US Dollar / Swiss Franc', category:'MAJOR', marketType:'FOREX', base:'USD', quote:'CHF', twelveDataSymbol:'USD/CHF', tradingViewSymbol:'OANDA:USDCHF', backtestEnabled:true },
  { symbol:'USDCAD', displayName:'US Dollar / Canadian Dollar', category:'MAJOR', marketType:'FOREX', base:'USD', quote:'CAD', twelveDataSymbol:'USD/CAD', tradingViewSymbol:'OANDA:USDCAD', backtestEnabled:true },
  { symbol:'AUDUSD', displayName:'Australian Dollar / US Dollar', category:'MAJOR', marketType:'FOREX', base:'AUD', quote:'USD', twelveDataSymbol:'AUD/USD', tradingViewSymbol:'OANDA:AUDUSD', backtestEnabled:true },
  { symbol:'NZDUSD', displayName:'New Zealand Dollar / US Dollar', category:'MAJOR', marketType:'FOREX', base:'NZD', quote:'USD', twelveDataSymbol:'NZD/USD', tradingViewSymbol:'OANDA:NZDUSD', backtestEnabled:true },
  { symbol:'EURGBP', displayName:'Euro / British Pound', category:'CROSS', marketType:'FOREX', base:'EUR', quote:'GBP', twelveDataSymbol:'EUR/GBP', tradingViewSymbol:'OANDA:EURGBP', backtestEnabled:true },
  { symbol:'EURJPY', displayName:'Euro / Japanese Yen', category:'CROSS', marketType:'FOREX', base:'EUR', quote:'JPY', twelveDataSymbol:'EUR/JPY', tradingViewSymbol:'OANDA:EURJPY', backtestEnabled:true },
  { symbol:'GBPJPY', displayName:'British Pound / Japanese Yen', category:'CROSS', marketType:'FOREX', base:'GBP', quote:'JPY', twelveDataSymbol:'GBP/JPY', tradingViewSymbol:'OANDA:GBPJPY', backtestEnabled:true },
  { symbol:'EURAUD', displayName:'Euro / Australian Dollar', category:'CROSS', marketType:'FOREX', base:'EUR', quote:'AUD', twelveDataSymbol:'EUR/AUD', tradingViewSymbol:'OANDA:EURAUD', backtestEnabled:true },
  { symbol:'GBPAUD', displayName:'British Pound / Australian Dollar', category:'CROSS', marketType:'FOREX', base:'GBP', quote:'AUD', twelveDataSymbol:'GBP/AUD', tradingViewSymbol:'OANDA:GBPAUD', backtestEnabled:true },
  { symbol:'AUDJPY', displayName:'Australian Dollar / Japanese Yen', category:'CROSS', marketType:'FOREX', base:'AUD', quote:'JPY', twelveDataSymbol:'AUD/JPY', tradingViewSymbol:'OANDA:AUDJPY', backtestEnabled:true },
  { symbol:'CADJPY', displayName:'Canadian Dollar / Japanese Yen', category:'CROSS', marketType:'FOREX', base:'CAD', quote:'JPY', twelveDataSymbol:'CAD/JPY', tradingViewSymbol:'OANDA:CADJPY', backtestEnabled:true },
  { symbol:'CHFJPY', displayName:'Swiss Franc / Japanese Yen', category:'CROSS', marketType:'FOREX', base:'CHF', quote:'JPY', twelveDataSymbol:'CHF/JPY', tradingViewSymbol:'OANDA:CHFJPY', backtestEnabled:true },
  { symbol:'XAUUSD', displayName:'Gold / US Dollar', category:'METAL', marketType:'METALS', base:'XAU', quote:'USD', twelveDataSymbol:'XAU/USD', tradingViewSymbol:'OANDA:XAUUSD', backtestEnabled:true },
  { symbol:'XAGUSD', displayName:'Silver / US Dollar', category:'METAL', marketType:'METALS', base:'XAG', quote:'USD', twelveDataSymbol:'XAG/USD', tradingViewSymbol:'OANDA:XAGUSD', backtestEnabled:true },
] as const satisfies readonly SupportedInstrument[];

export const SUPPORTED_INSTRUMENT_SYMBOLS = SUPPORTED_INSTRUMENTS.map((item) => item.symbol);
const bySymbol = new Map(SUPPORTED_INSTRUMENTS.map((item) => [item.symbol, item] as const));

export function getSupportedInstrument(symbol: string) {
  return bySymbol.get(symbol.toUpperCase() as (typeof SUPPORTED_INSTRUMENTS)[number]['symbol']) ?? null;
}

export function isSupportedInstrument(symbol: string): boolean {
  return Boolean(getSupportedInstrument(symbol));
}

export function twelveDataSymbolFor(symbol: string): string {
  const instrument = getSupportedInstrument(symbol);
  if (!instrument) throw new Error(`Unsupported instrument: ${symbol}.`);
  return instrument.twelveDataSymbol;
}

export function strategyCatalogInstruments() {
  return SUPPORTED_INSTRUMENTS.map(({symbol,displayName,category,marketType}) => ({symbol,displayName,category,marketType}));
}
