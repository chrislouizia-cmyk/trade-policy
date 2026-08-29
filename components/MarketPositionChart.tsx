'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { BaselineSeries, CandlestickSeries, ColorType, createChart, LineStyle, type IChartApi, type ISeriesApi, type Time, type UTCTimestamp } from 'lightweight-charts';

import type { Candle } from '@/lib/market-analysis';
import { getSupportedInstrument } from '@/lib/instrument-registry';
import { assessPositionGeometry, type PositionOverlayModel } from '@/lib/position-geometry';
import { deriveMarketSummary, formatPrice, useMarketCandles } from './useMarketCandles';

type Props = { instrument: string; timeframe: string; overlay: PositionOverlayModel | null; onOverlayClick?: () => void };

type PriceLine = ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']>;
type TooltipState = { x: number; y: number; candle: Candle; candleIndex: number };

const chartTime = (datetime: string) => Math.floor(Date.parse(datetime) / 1000) as UTCTimestamp;

export default function MarketPositionChart({ instrument, timeframe, overlay, onOverlayClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const overlaySeriesRef = useRef<ISeriesApi<'Baseline'>[]>([]);
  const candlesRef = useRef<Candle[]>([]);
  const entryPriceLineRef = useRef<PriceLine | null>(null);
  const stopLossPriceLineRef = useRef<PriceLine | null>(null);
  const takeProfitPriceLineRef = useRef<PriceLine | null>(null);
  const currentPriceLineRef = useRef<PriceLine | null>(null);
  const overlayRef = useRef(overlay);
  const clickRef = useRef(onOverlayClick);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const { candles, loading, error, provider } = useMarketCandles(instrument, timeframe);
  const instrumentMeta = getSupportedInstrument(instrument);

  const header = useMemo(() => deriveMarketSummary(candles, instrument, provider), [candles, instrument, provider]);

  useEffect(() => { overlayRef.current = overlay; clickRef.current = onOverlayClick; }, [overlay, onOverlayClick]);
  useEffect(() => { candlesRef.current = candles; }, [candles]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = createChart(container, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: '#0b0e14' }, textColor: '#aeb7c7', attributionLogo: false },
      grid: { vertLines: { color: '#181e29' }, horzLines: { color: '#181e29' } },
      rightPriceScale: { borderColor: '#2a3342', scaleMargins: { top: 0.12, bottom: 0.16 } },
      timeScale: { borderColor: '#2a3342', timeVisible: true, secondsVisible: false, rightOffset: 8, barSpacing: 10 },
      crosshair: { vertLine: { color: '#6b7280', width: 1, style: 2 }, horzLine: { color: '#6b7280', width: 1, style: 1 } },
      localization: { priceFormatter: (value: number) => formatPrice(value, instrument) },
    });
    const series = chart.addSeries(CandlestickSeries, { upColor: '#20b486', downColor: '#ef5b5b', borderUpColor: '#20b486', borderDownColor: '#ef5b5b', wickUpColor: '#20b486', wickDownColor: '#ef5b5b' });
    chart.subscribeClick((param) => {
      const current = overlayRef.current;
      if (!current || !param.point) return;
      const geometry = current.acceptedGeometry ?? current.currentGeometry;
      const coordinates = [geometry.stopLoss, geometry.entry, geometry.takeProfit].map((price) => series.priceToCoordinate(price)).filter((value): value is NonNullable<typeof value> => value !== null);
      if (coordinates.length === 3 && param.point.y >= Math.min(...coordinates) - 8 && param.point.y <= Math.max(...coordinates) + 8) clickRef.current?.();
    });
    chart.subscribeCrosshairMove((param) => {
      const logical = typeof param.logical === 'number' ? Math.floor(param.logical) : null;
      const list = candlesRef.current;
      if (logical == null || !list.length) { setTooltip(null); return; }
      const index = Math.min(Math.max(logical, 0), list.length - 1);
      const candle = list[index];
      if (!param.point) { setTooltip(null); return; }
      setTooltip({ x: param.point.x + 18, y: param.point.y + 18, candle, candleIndex: index });
    });
    chartRef.current = chart; candleSeriesRef.current = series;
    return () => { chart.remove(); chartRef.current = null; candleSeriesRef.current = null; overlaySeriesRef.current = []; setTooltip(null); };
  }, [instrument]);

  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series || !candles.length) return;
    const data = candles.map((candle) => ({ time: chartTime(candle.datetime), open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume }));
    series.setData(data as Array<{ time: Time; open: number; high: number; low: number; close: number }>);
    chartRef.current?.timeScale().fitContent();
    setTooltip(null);
  }, [candles]);

  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    if (!chart || !candleSeries) return;
    for (const series of overlaySeriesRef.current) chart.removeSeries(series);
    overlaySeriesRef.current = [];

    const clearOwnedPriceLines = () => {
      [entryPriceLineRef.current, stopLossPriceLineRef.current, takeProfitPriceLineRef.current].forEach((line) => {
        if (line) {
          candleSeries.removePriceLine(line);
        }
      });
      entryPriceLineRef.current = null;
      stopLossPriceLineRef.current = null;
      takeProfitPriceLineRef.current = null;
    };
    clearOwnedPriceLines();

    if (!overlay || !candles.length) return;
    const geometry = overlay.acceptedGeometry ?? overlay.currentGeometry;
    const assessment = assessPositionGeometry(geometry);
    const active = overlay.status === 'ACTIVE';
    const first = chartTime(candles[0]!.datetime), last = chartTime(candles.at(-1)!.datetime);
    const region = (value: number, color: string) => {
      const series = chart.addSeries(BaselineSeries, { baseValue: { type: 'price', price: geometry.entry }, lineVisible: false, priceLineVisible: false, lastValueVisible: false, topFillColor1: color, topFillColor2: color, bottomFillColor1: color, bottomFillColor2: color });
      series.setData([{ time: first, value }, { time: last, value }]);
      overlaySeriesRef.current.push(series);
    };
    region(geometry.stopLoss, 'rgba(239,91,91,0.20)');
    region(geometry.takeProfit, 'rgba(32,180,134,0.18)');
    const status = active ? 'ACTIVE' : 'PROPOSED';
    entryPriceLineRef.current = candleSeries.createPriceLine({ price: geometry.entry, color: active ? '#f5f7fb' : '#f2c94c', lineWidth: 2, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: `${status} ${geometry.direction} · Entry` });
    stopLossPriceLineRef.current = candleSeries.createPriceLine({ price: geometry.stopLoss, color: '#ef5b5b', lineWidth: 2, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'Stop Loss' });
    takeProfitPriceLineRef.current = candleSeries.createPriceLine({ price: geometry.takeProfit, color: '#20b486', lineWidth: 2, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `Take Profit${assessment.rr == null ? '' : ` · ${assessment.rr.toFixed(2)}R`}` });
    return () => {
      if (entryPriceLineRef.current) candleSeries.removePriceLine(entryPriceLineRef.current);
      if (stopLossPriceLineRef.current) candleSeries.removePriceLine(stopLossPriceLineRef.current);
      if (takeProfitPriceLineRef.current) candleSeries.removePriceLine(takeProfitPriceLineRef.current);
      entryPriceLineRef.current = null;
      stopLossPriceLineRef.current = null;
      takeProfitPriceLineRef.current = null;
    };
  }, [candles, overlay]);

  const latest = header.latest;
  const change = header.change ?? null;
  const changePercent = header.changePercent ?? null;
  const currentPrice = latest?.close ?? null;
  const changeTone = change == null ? 'neutral' : change >= 0 ? 'positive' : 'negative';

  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series || !latest) return;
    if (currentPriceLineRef.current) {
      series.removePriceLine(currentPriceLineRef.current);
      currentPriceLineRef.current = null;
    }
    currentPriceLineRef.current = series.createPriceLine({ price: latest.close, color: '#cfd8ee', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: 'Current' });
    return () => {
      if (currentPriceLineRef.current) {
        series.removePriceLine(currentPriceLineRef.current);
        currentPriceLineRef.current = null;
      }
    };
  }, [latest, instrument]);

  const hoveredPreviousClose = tooltip && tooltip.candleIndex > 0 && candlesRef.current[tooltip.candleIndex - 1]
    ? candlesRef.current[tooltip.candleIndex - 1].close
    : null;
  const hoveredChange = tooltip && hoveredPreviousClose != null && Number.isFinite(tooltip.candle.close)
    ? tooltip.candle.close - hoveredPreviousClose
    : null;
  const hoveredChangePercent = hoveredChange != null && hoveredPreviousClose != null && Math.abs(hoveredPreviousClose) > Number.EPSILON
    ? (hoveredChange / hoveredPreviousClose) * 100
    : null;

  return <div className="market-position-chart-shell">
    <div className="market-position-header">
      <div className="market-position-symbol-block">
        <strong>{instrument}</strong>
        <span>{instrumentMeta?.displayName ?? 'Instrument'}</span>
      </div>
      <div className="market-position-meta-block">
        <span className="market-position-timeframe">{timeframe}</span>
        {provider ? <span className="market-position-provider">{provider}</span> : null}
      </div>
      {latest ? <div className="market-position-summary">
        <span>O {formatPrice(latest.open, instrument)}</span>
        <span>H {formatPrice(latest.high, instrument)}</span>
        <span>L {formatPrice(latest.low, instrument)}</span>
        <span>C {formatPrice(latest.close, instrument)}</span>
        <span className={`market-position-change ${changeTone}`}>{change == null ? '—' : `${change >= 0 ? '+' : ''}${formatPrice(change, instrument)}`} {changePercent == null ? '' : `(${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%)`}</span>
      </div> : null}
    </div>
    <div ref={containerRef} className="market-position-chart" role="img" aria-label={`${instrument} ${timeframe} candlestick chart`} />
    {tooltip && latest ? <div className="market-chart-tooltip" style={{ left: `${Math.min(Math.max(tooltip.x, 12), 500)}px`, top: `${Math.min(Math.max(tooltip.y, 12), 220)}px` }}>
      <strong>{new Date(tooltip.candle.datetime).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</strong>
      <span>O {formatPrice(tooltip.candle.open, instrument)}</span>
      <span>H {formatPrice(tooltip.candle.high, instrument)}</span>
      <span>L {formatPrice(tooltip.candle.low, instrument)}</span>
      <span>C {formatPrice(tooltip.candle.close, instrument)}</span>
      <span>{hoveredChange == null || hoveredPreviousClose == null ? 'Change —' : `${hoveredChange >= 0 ? '+' : ''}${formatPrice(hoveredChange, instrument)} (${hoveredChangePercent != null && hoveredChangePercent >= 0 ? '+' : ''}${hoveredChangePercent == null ? '—' : hoveredChangePercent.toFixed(2)}%)`}</span>
      {Number.isFinite(tooltip.candle.volume) ? <span>Vol {tooltip.candle.volume}</span> : null}
    </div> : null}
    {loading ? <div className="market-chart-status">Loading Twelve Data candles…</div> : null}
    {error ? <div className="market-chart-status market-chart-error">{error}</div> : null}
  </div>;
}
