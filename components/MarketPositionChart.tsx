'use client';

import { useEffect, useRef } from 'react';
import { BaselineSeries, CandlestickSeries, ColorType, createChart, LineStyle, type IChartApi, type ISeriesApi, type Time, type UTCTimestamp } from 'lightweight-charts';

import type { Candle } from '@/lib/market-analysis';
import { assessPositionGeometry, type PositionOverlayModel } from '@/lib/position-geometry';
import { useMarketCandles } from './useMarketCandles';

type Props = { instrument: string; timeframe: string; overlay: PositionOverlayModel | null; onOverlayClick?: () => void };

const chartTime = (datetime: string) => Math.floor(Date.parse(datetime) / 1000) as UTCTimestamp;

export default function MarketPositionChart({ instrument, timeframe, overlay, onOverlayClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const overlaySeriesRef = useRef<ISeriesApi<'Baseline'>[]>([]);
  const overlayRef = useRef(overlay);
  const clickRef = useRef(onOverlayClick);
  const { candles, loading, error } = useMarketCandles(instrument, timeframe);

  useEffect(() => { overlayRef.current = overlay; clickRef.current = onOverlayClick; }, [overlay, onOverlayClick]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = createChart(container, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: '#0b0e14' }, textColor: '#aeb7c7', attributionLogo: false },
      grid: { vertLines: { color: '#181e29' }, horzLines: { color: '#181e29' } },
      rightPriceScale: { borderColor: '#2a3342' }, timeScale: { borderColor: '#2a3342', timeVisible: true, secondsVisible: false },
      crosshair: { vertLine: { color: '#6b7280' }, horzLine: { color: '#6b7280' } },
    });
    const series = chart.addSeries(CandlestickSeries, { upColor: '#20b486', downColor: '#ef5b5b', borderUpColor: '#20b486', borderDownColor: '#ef5b5b', wickUpColor: '#20b486', wickDownColor: '#ef5b5b' });
    chart.subscribeClick((param) => {
      const current = overlayRef.current;
      if (!current || !param.point) return;
      const geometry = current.acceptedGeometry ?? current.currentGeometry;
      const coordinates = [geometry.stopLoss, geometry.entry, geometry.takeProfit].map((price) => series.priceToCoordinate(price)).filter((value): value is NonNullable<typeof value> => value !== null);
      if (coordinates.length === 3 && param.point.y >= Math.min(...coordinates) - 8 && param.point.y <= Math.max(...coordinates) + 8) clickRef.current?.();
    });
    chartRef.current = chart; candleSeriesRef.current = series;
    return () => { chart.remove(); chartRef.current = null; candleSeriesRef.current = null; overlaySeriesRef.current = []; };
  }, []);

  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series || !candles.length) return;
    series.setData(candles.map((candle) => ({ time: chartTime(candle.datetime), open: candle.open, high: candle.high, low: candle.low, close: candle.close })));
    chartRef.current?.timeScale().fitContent();
  }, [candles]);

  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    if (!chart || !candleSeries) return;
    for (const series of overlaySeriesRef.current) chart.removeSeries(series);
    overlaySeriesRef.current = [];
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
    candleSeries.createPriceLine({ price: geometry.entry, color: active ? '#f5f7fb' : '#f2c94c', lineWidth: 2, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: `${status} ${geometry.direction} · Entry` });
    candleSeries.createPriceLine({ price: geometry.stopLoss, color: '#ef5b5b', lineWidth: 2, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'Stop Loss' });
    candleSeries.createPriceLine({ price: geometry.takeProfit, color: '#20b486', lineWidth: 2, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `Take Profit${assessment.rr == null ? '' : ` · ${assessment.rr.toFixed(2)}R`}` });
    return () => {
      // Price lines belong to the candle series; rebuilding that series is unnecessary,
      // so remove only lines created for this overlay instance.
      const lines = candleSeries.priceLines();
      for (const line of lines) candleSeries.removePriceLine(line);
    };
  }, [candles, overlay]);

  return <div className="market-position-chart-shell">
    <div ref={containerRef} className="market-position-chart" role="img" aria-label={`${instrument} ${timeframe} candlestick chart`} />
    {loading ? <div className="market-chart-status">Loading Twelve Data candles…</div> : null}
    {error ? <div className="market-chart-status market-chart-error">{error}</div> : null}
  </div>;
}
