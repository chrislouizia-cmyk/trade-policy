type BacktestTradePoint = {
  sequence?: unknown;
  exit_timestamp?: unknown;
  balance_after?: unknown;
  net_r?: unknown;
};

export type EquityDrawdownPoint = {
  sequence: number;
  timestampUtc: string;
  balance: number;
  peakBalance: number;
  drawdownPercent: number;
  cumulativeR: number;
};

function finite(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function xml(value: unknown): string {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character]!);
}

function money(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function shortDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value || '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  }).format(parsed);
}

function niceStep(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const rounded = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return rounded * magnitude;
}

export function buildEquityDrawdownSeries(
  startingBalance: number,
  periodStartUtc: unknown,
  trades: BacktestTradePoint[],
): EquityDrawdownPoint[] {
  const start = finite(startingBalance);
  let peak = start;
  let cumulativeR = 0;
  const points: EquityDrawdownPoint[] = [{
    sequence: 0,
    timestampUtc: String(periodStartUtc ?? ''),
    balance: start,
    peakBalance: start,
    drawdownPercent: 0,
    cumulativeR: 0,
  }];

  trades.forEach((trade, index) => {
    const balance = finite(trade.balance_after, points.at(-1)?.balance ?? start);
    peak = Math.max(peak, balance);
    cumulativeR += finite(trade.net_r);
    points.push({
      sequence: finite(trade.sequence, index + 1),
      timestampUtc: String(trade.exit_timestamp ?? ''),
      balance,
      peakBalance: peak,
      drawdownPercent: peak > 0 ? ((peak - balance) / peak) * 100 : 0,
      cumulativeR,
    });
  });

  return points;
}

export function renderEquityDrawdownSvg(points: EquityDrawdownPoint[], options?: {
  width?: number;
  height?: number;
  title?: string;
}): string {
  const width = options?.width ?? 960;
  const height = options?.height ?? 520;
  const title = options?.title ?? 'Equity balance and drawdown';
  const left = 84;
  const right = 28;
  const plotWidth = width - left - right;
  const equityTop = 82;
  const equityBottom = Math.round(height * 0.56);
  const drawdownTop = equityBottom + 74;
  const drawdownBottom = height - 54;
  const balances = points.map(point => point.balance);
  const low = Math.min(...balances);
  const high = Math.max(...balances);
  const rawBalanceSpread = Math.max(high - low, Math.abs(points[0]?.balance ?? 0) * 0.004, 1);
  const balanceStep = niceStep(rawBalanceSpread / 4);
  const balanceMin = Math.floor((low - balanceStep * 0.25) / balanceStep) * balanceStep;
  const balanceMax = Math.ceil((high + balanceStep * 0.25) / balanceStep) * balanceStep;
  const balanceSpread = Math.max(balanceMax - balanceMin, 1);
  const actualMaxDrawdown = Math.max(...points.map(point => point.drawdownPercent), 0);
  const drawdownStep = niceStep(Math.max(actualMaxDrawdown, 0.01) / 2);
  const maxDrawdown = Math.max(drawdownStep * 2, Math.ceil(actualMaxDrawdown / drawdownStep) * drawdownStep);
  const x = (index: number) => left + (index / Math.max(points.length - 1, 1)) * plotWidth;
  const equityY = (value: number) => equityTop + ((balanceMax - value) / balanceSpread) * (equityBottom - equityTop);
  const drawdownY = (value: number) => drawdownTop + (value / maxDrawdown) * (drawdownBottom - drawdownTop);
  const equityPath = points.map((point, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)} ${equityY(point.balance).toFixed(1)}`).join(' ');
  const drawdownPath = points.map((point, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)} ${drawdownY(point.drawdownPercent).toFixed(1)}`).join(' ');
  const drawdownArea = `${drawdownPath} L${x(points.length - 1).toFixed(1)} ${drawdownTop} L${left} ${drawdownTop} Z`;
  const startY = equityY(points[0]?.balance ?? 0);
  const last = points.at(-1)!;
  const tradeCount = Math.max(points.length - 1, 0);

  const equityTicks = Array.from({ length: 5 }, (_, index) => {
    const ratio = index / 4;
    const value = balanceMax - ratio * balanceSpread;
    const y = equityTop + ratio * (equityBottom - equityTop);
    return `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" class="grid"/><text x="${left - 12}" y="${y + 4}" text-anchor="end" class="axis">${xml(money(value))}</text>`;
  }).join('');
  const drawdownTicks = Array.from({ length: 3 }, (_, index) => {
    const ratio = index / 2;
    const value = ratio * maxDrawdown;
    const y = drawdownTop + ratio * (drawdownBottom - drawdownTop);
    return `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" class="grid"/><text x="${left - 12}" y="${y + 4}" text-anchor="end" class="axis">${value === 0 ? '' : '-'}${value.toFixed(2)}%</text>`;
  }).join('');
  const markerIndexes = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
  const xLabels = markerIndexes.map(index => `<line x1="${x(index)}" y1="${equityTop}" x2="${x(index)}" y2="${drawdownBottom}" class="vertical"/><text x="${x(index)}" y="${height - 24}" text-anchor="${index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}" class="axis">${xml(shortDate(points[index].timestampUtc))}</text>`).join('');
  const dots = points.map((point, index) => `<circle cx="${x(index)}" cy="${equityY(point.balance)}" r="${index === points.length - 1 ? 4.5 : 2.6}" class="point"><title>Trade ${point.sequence}: ${money(point.balance)} · ${point.drawdownPercent.toFixed(2)}% drawdown</title></circle>`).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${xml(title)}">
  <style>.bg{fill:#fff}.plot{fill:#f8fafc;stroke:#d8dee8}.grid{stroke:#dfe5ec;stroke-width:1}.vertical{stroke:#e7ebf0;stroke-width:1;stroke-dasharray:4 5}.baseline{stroke:#8190a5;stroke-width:1.5;stroke-dasharray:7 5}.equity-line{fill:none;stroke:#1677ff;stroke-width:4;stroke-linecap:round;stroke-linejoin:round}.drawdown-area{fill:#ff6b6b;opacity:.16}.drawdown-line{fill:none;stroke:#d6455d;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}.point{fill:#fff;stroke:#1677ff;stroke-width:2}.title{font:700 22px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;fill:#172033}.subtitle{font:12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;fill:#667085}.label{font:700 11px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;fill:#445066;letter-spacing:.08em}.axis{font:11px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;fill:#667085}.legend{font:11px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;fill:#445066}</style>
  <rect width="${width}" height="${height}" rx="18" class="bg"/>
  <text x="${left}" y="32" class="title">${xml(title)}</text>
  <text x="${left}" y="54" class="subtitle">${tradeCount} trades · UTC · start ${xml(money(points[0]?.balance ?? 0))} · end ${xml(money(last.balance))} · max drawdown ${actualMaxDrawdown.toFixed(2)}%</text>
  <rect x="${left}" y="${equityTop}" width="${plotWidth}" height="${equityBottom - equityTop}" rx="10" class="plot"/>
  <text x="${left}" y="${equityTop - 14}" class="label">ACCOUNT BALANCE</text>
  ${equityTicks}${xLabels}
  <line x1="${left}" y1="${startY}" x2="${width - right}" y2="${startY}" class="baseline"/>
  <path d="${equityPath}" class="equity-line"/>${dots}
  <line x1="${width - 238}" y1="${equityTop - 18}" x2="${width - 210}" y2="${equityTop - 18}" class="equity-line"/><text x="${width - 201}" y="${equityTop - 14}" class="legend">Equity</text>
  <line x1="${width - 132}" y1="${equityTop - 18}" x2="${width - 104}" y2="${equityTop - 18}" class="baseline"/><text x="${width - 95}" y="${equityTop - 14}" class="legend">Start</text>
  <rect x="${left}" y="${drawdownTop}" width="${plotWidth}" height="${drawdownBottom - drawdownTop}" rx="10" class="plot"/>
  <text x="${left}" y="${drawdownTop - 14}" class="label">DRAWDOWN FROM PRIOR PEAK</text>
  ${drawdownTicks}<path d="${drawdownArea}" class="drawdown-area"/><path d="${drawdownPath}" class="drawdown-line"/>
  <text x="${width / 2}" y="${height - 6}" text-anchor="middle" class="label">TEST PERIOD (UTC)</text>
  </svg>`;
}
