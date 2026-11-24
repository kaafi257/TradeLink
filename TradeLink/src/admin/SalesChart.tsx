import { useMemo } from "react";
import { Bar, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { money } from "../lib/format";

type Pt = { day: string; sales: number };
type Row = Pt & { avg: number | null };
type TipProps = { active?: boolean; payload?: { payload?: Row }[]; label?: string };

function Tip({ active, payload, label }: TipProps) {
  const r = payload?.[0]?.payload;
  if (!active || !r) return null;
  const avg = r.avg;
  return (
    <div className="chart-tip sc-tip">
      <small>{label}</small>
      <b>{money(r.sales)}</b>
      {avg !== null && <span><i className="a" />7-day average <em>{money(Math.round(avg))}</em></span>}
    </div>
  );
}

const compact = (v: number) => (v >= 1_000_000 ? `${+(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${+(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : String(v));

/** Daily sales as bars, with a 7-day average line, the period average as a dashed guide and the best day highlighted. Real values only. */
export default function SalesChart({ data }: { data: Pt[] }) {
  const { rows, mean, bestI } = useMemo(() => {
    // Days after the last sale (the rest of the month) have no average, so the line does not fall to zero.
    const last = data.reduce((l, d, i) => (d.sales > 0 ? i : l), -1);
    const rows: Row[] = data.map((d, i) => {
      if (i > last) return { ...d, avg: null };
      const from = Math.max(0, i - 6), win = data.slice(from, i + 1);
      return { ...d, avg: win.reduce((a, x) => a + x.sales, 0) / win.length };
    });
    const total = data.reduce((a, d) => a + d.sales, 0);
    return { rows, mean: last >= 0 ? total / (last + 1) : 0, bestI: data.reduce((b, d, i) => (d.sales > data[b].sales ? i : b), 0) };
  }, [data]);
  const dense = rows.length > 45;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={rows} margin={{ top: 14, right: 10, left: 0, bottom: 0 }} barCategoryGap={dense ? "12%" : "28%"}>
        <defs>
          <linearGradient id="scBar" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#4aa8ec" /><stop offset="100%" stopColor="#9fd0f6" /></linearGradient>
          <linearGradient id="scBest" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0b4f86" /><stop offset="100%" stopColor="#1479c2" /></linearGradient>
        </defs>
        <CartesianGrid stroke="#0b4f8614" vertical={false} />
        <XAxis dataKey="day" tick={{ fontSize: 11.5, fill: "#5b7890" }} axisLine={{ stroke: "#d3e1ef" }} tickLine={false} interval="preserveStartEnd" minTickGap={dense ? 24 : 14} tickMargin={8} />
        <YAxis width={42} tick={{ fontSize: 11.5, fill: "#5b7890" }} axisLine={false} tickLine={false} tickFormatter={compact} />
        <Tooltip content={<Tip />} cursor={{ fill: "#1479c214" }} />
        {mean > 0 && <ReferenceLine y={mean} stroke="#0b4f86" strokeOpacity={0.45} strokeDasharray="5 5" />}
        <Bar dataKey="sales" radius={[4, 4, 0, 0]} maxBarSize={22}>
          {rows.map((r, i) => <Cell key={r.day + i} fill={i === bestI && r.sales > 0 ? "url(#scBest)" : "url(#scBar)"} />)}
        </Bar>
        <Line type="monotone" dataKey="avg" stroke="#0b2a4a" strokeWidth={2.2} dot={false} activeDot={{ r: 5, fill: "#fff", stroke: "#0b2a4a", strokeWidth: 2.5 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
