import type { ChartAnalysis } from '@/types/trade';

const orderedTimeframes = ['D1', 'H4', 'H1', 'M30', 'M5'] as const;

export default function MarketContextStrip({ analysis }: { analysis: ChartAnalysis }) {
  return <section className="market-context-strip" aria-labelledby="market-context-title">
    <div className="market-context-heading">
      <p className="brand">MARKET CONTEXT</p>
      <h2 id="market-context-title">Timeframe map</h2>
    </div>
    <div className="market-context-timeframes" role="list">
      {orderedTimeframes.map(timeframe => {
        const layer = analysis.layerAnalysis?.find(item => item.timeframe === timeframe);
        const bias = layer?.bias ?? analysis.timeframeBiases?.[timeframe] ?? null;
        return <div className="market-context-cell" role="listitem" key={timeframe}>
          <strong>{timeframe}</strong>
          <span>{bias ? bias.replaceAll('_', ' ') : 'Unavailable'}</span>
          <small>{layer?.role ? layer.role.replaceAll('_', ' ') : 'No strategy layer'}</small>
        </div>;
      })}
    </div>
  </section>;
}
