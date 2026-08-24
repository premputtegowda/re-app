import { Svg, Rect, Line, Text as PdfText, G } from '@react-pdf/renderer';
import type { CoCYearlyProjection } from '@/types';

interface CashFlowChartProps {
  projections: CoCYearlyProjection[];
  width: number;
  height: number;
}

/**
 * Bar chart of annual cash flow with a line overlay for cumulative cash flow.
 * Rendered with @react-pdf/renderer SVG primitives (no browser DOM).
 */
export function CashFlowChart({ projections, width, height }: CashFlowChartProps) {
  if (projections.length === 0) return null;

  const padding = { top: 20, right: 40, bottom: 30, left: 55 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const annualValues = projections.map((p) => p.cashFlow);
  const cumulativeValues = projections.map((p) => p.cumulativeCashFlow);
  const allValues = [...annualValues, ...cumulativeValues, 0];
  const minVal = Math.min(...allValues);
  const maxVal = Math.max(...allValues);
  const valueRange = maxVal - minVal || 1;

  const barCount = projections.length;
  const barSlotWidth = plotWidth / barCount;
  const barWidth = barSlotWidth * 0.6;

  const yFromValue = (v: number) =>
    padding.top + plotHeight - ((v - minVal) / valueRange) * plotHeight;
  const zeroY = yFromValue(0);

  const formatK = (n: number): string => {
    if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1_000)}K`;
    return `$${Math.round(n)}`;
  };

  const yTicks = 4;
  const tickValues = Array.from({ length: yTicks + 1 }, (_, i) =>
    minVal + (valueRange * i) / yTicks
  );

  return (
    <Svg width={width} height={height}>
      {tickValues.map((val, i) => {
        const y = yFromValue(val);
        return (
          <G key={`grid-${i}`}>
            <Line
              x1={padding.left}
              x2={width - padding.right}
              y1={y}
              y2={y}
              stroke="#E2E8F0"
              strokeWidth={0.5}
            />
            <PdfText
              x={padding.left - 6}
              y={y + 3}
              style={{ fontSize: 7, textAnchor: 'end', fill: '#64748B' }}
            >
              {formatK(val)}
            </PdfText>
          </G>
        );
      })}

      <Line
        x1={padding.left}
        x2={width - padding.right}
        y1={zeroY}
        y2={zeroY}
        stroke="#94A3B8"
        strokeWidth={1}
      />

      {projections.map((p, i) => {
        const barX = padding.left + i * barSlotWidth + (barSlotWidth - barWidth) / 2;
        const cashFlow = p.cashFlow;
        const barTop = cashFlow >= 0 ? yFromValue(cashFlow) : zeroY;
        const barHeight = Math.abs(yFromValue(cashFlow) - zeroY);
        const fill = cashFlow >= 0 ? '#3B82F6' : '#EF4444';
        return (
          <Rect
            key={`bar-${i}`}
            x={barX}
            y={barTop}
            width={barWidth}
            height={barHeight}
            fill={fill}
          />
        );
      })}

      {projections.slice(0, -1).map((p, i) => {
        const x1 = padding.left + i * barSlotWidth + barSlotWidth / 2;
        const x2 = padding.left + (i + 1) * barSlotWidth + barSlotWidth / 2;
        const y1 = yFromValue(p.cumulativeCashFlow);
        const y2 = yFromValue(projections[i + 1].cumulativeCashFlow);
        return (
          <Line
            key={`cum-line-${i}`}
            x1={x1}
            x2={x2}
            y1={y1}
            y2={y2}
            stroke="#10B981"
            strokeWidth={1.5}
          />
        );
      })}

      {projections.map((p, i) => {
        const cx = padding.left + i * barSlotWidth + barSlotWidth / 2;
        const cy = yFromValue(p.cumulativeCashFlow);
        return (
          <Rect
            key={`cum-dot-${i}`}
            x={cx - 1.5}
            y={cy - 1.5}
            width={3}
            height={3}
            fill="#10B981"
          />
        );
      })}

      {projections.map((p, i) => {
        const x = padding.left + i * barSlotWidth + barSlotWidth / 2;
        return (
          <PdfText
            key={`x-${i}`}
            x={x}
            y={height - padding.bottom + 12}
            style={{ fontSize: 7, textAnchor: 'middle', fill: '#64748B' }}
          >
            {`Yr ${p.year}`}
          </PdfText>
        );
      })}

      <G>
        <Rect x={padding.left} y={height - 10} width={8} height={6} fill="#3B82F6" />
        <PdfText x={padding.left + 12} y={height - 5} style={{ fontSize: 7, fill: '#334155' }}>
          Annual Cash Flow
        </PdfText>
        <Line
          x1={padding.left + 90}
          x2={padding.left + 102}
          y1={height - 7}
          y2={height - 7}
          stroke="#10B981"
          strokeWidth={1.5}
        />
        <PdfText x={padding.left + 106} y={height - 5} style={{ fontSize: 7, fill: '#334155' }}>
          Cumulative
        </PdfText>
      </G>
    </Svg>
  );
}
