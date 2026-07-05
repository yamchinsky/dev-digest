/* LineChart — multi-series line chart on Recharts. */
import React from "react";
import {
  LineChart as RLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

export interface ChartSeries {
  name: string;
  color: string;
  data: number[];
}

export function LineChart({
  series,
  w = 620,
  h = 200,
  yMin = 0.6,
  yMax = 1.0,
  tooltipLabels,
}: {
  series: ChartSeries[];
  w?: number;
  h?: number;
  yMin?: number;
  yMax?: number;
  /** One label per data-point index. When provided, a Recharts Tooltip renders
      the label for the hovered point. Absent → no tooltip (default, preserves
      all existing LineChart consumers). */
  tooltipLabels?: string[];
}) {
  const n = series[0]?.data.length ?? 0;
  const rows = Array.from({ length: n }, (_, i) => {
    const row: Record<string, number> = { i };
    series.forEach((s) => {
      row[s.name] = s.data[i] ?? 0;
    });
    return row;
  });
  return (
    <div style={{ width: "100%", maxWidth: w, height: h }}>
      <ResponsiveContainer width="100%" height="100%">
        <RLineChart data={rows} margin={{ top: 14, right: 14, bottom: 8, left: -10 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="i" hide />
          <YAxis
            domain={[yMin, yMax]}
            tick={{ fontSize: 12, fill: "var(--text-muted)" }}
            tickFormatter={(v: number) => v.toFixed(1)}
            axisLine={false}
            tickLine={false}
            width={38}
          />
          {tooltipLabels && (
            <Tooltip
              content={({ active, label }: { active?: boolean; label?: unknown }) => {
                if (!active || label === undefined || label === null) return null;
                const text = tooltipLabels[Number(label)];
                if (!text) return null;
                return (
                  <div
                    style={{
                      background: "var(--bg-elevated, #1a1a2e)",
                      border: "1px solid var(--border, #333)",
                      borderRadius: 6,
                      padding: "6px 10px",
                      fontSize: 12,
                      color: "var(--text-primary, #e2e8f0)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {text}
                  </div>
                );
              }}
            />
          )}
          {series.map((s) => (
            <Line
              key={s.name}
              type="monotone"
              dataKey={s.name}
              stroke={s.color}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </RLineChart>
      </ResponsiveContainer>
    </div>
  );
}
