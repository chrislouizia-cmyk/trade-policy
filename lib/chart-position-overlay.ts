export type ChartPositionOverlayLayout = {
  left: number;
  width: number;
  entryY: number;
  riskTop: number;
  riskHeight: number;
  rewardTop: number;
  rewardHeight: number;
};

type LayoutInput = {
  viewportWidth: number;
  leftX: number;
  rightX?: number | null;
  entryY: number;
  stopY: number;
  targetY: number;
  priceAxisGutter?: number;
  minWidth?: number;
};

const finite = (value: number): boolean => Number.isFinite(value);

export function buildChartPositionOverlayLayout({
  viewportWidth,
  leftX,
  rightX,
  entryY,
  stopY,
  targetY,
  priceAxisGutter = 74,
  minWidth = 42,
}: LayoutInput): ChartPositionOverlayLayout | null {
  if (![viewportWidth, leftX, entryY, stopY, targetY, priceAxisGutter, minWidth].every(finite) || viewportWidth <= 0) return null;

  const usableRight = Math.max(0, viewportWidth - Math.max(0, priceAxisGutter));
  const left = Math.min(Math.max(0, leftX), usableRight);
  const requestedRight = rightX == null || !finite(rightX) ? usableRight : rightX;
  const right = Math.min(usableRight, Math.max(left, requestedRight));
  const width = Math.max(0, right - left);
  if (width < Math.max(1, minWidth)) return null;

  return {
    left,
    width,
    entryY,
    riskTop: Math.min(entryY, stopY),
    riskHeight: Math.max(1, Math.abs(stopY - entryY)),
    rewardTop: Math.min(entryY, targetY),
    rewardHeight: Math.max(1, Math.abs(targetY - entryY)),
  };
}
