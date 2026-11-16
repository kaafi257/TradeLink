import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { money } from "../lib/format";

type TipProps = { active?: boolean; payload?: { value?: number }[]; label?: string };
function GlassTip({ active, payload, label }: TipProps) {
  if (!active || !payload?.length) return null;
  return <div className="chart-tip"><small>{label}</small><b>{money(Number(payload[0].value ?? 0))}</b></div>;
}

export default function SalesChart({ data }: { data: { day: string; sales: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 20, right: 12, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1479c2" stopOpacity={0.4} /><stop offset="100%" stopColor="#1479c2" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="salesStroke" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#3aa0e6" /><stop offset="100%" stopColor="#0b4f86" />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#0b4f8618" strokeDasharray="4 6" vertical={false} />
        <XAxis dataKey="day" tick={{ fontSize: 12, fill: "#4a6479" }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={14} tickMargin={6} />
        <YAxis width={40} tick={{ fontSize: 12, fill: "#4a6479" }} axisLine={false} tickLine={false} tickFormatter={v => (v >= 1000 ? `${v / 1000}k` : String(v))} />
        <Tooltip content={<GlassTip />} cursor={{ stroke: "#1479c2", strokeOpacity: 0.35, strokeDasharray: "4 4" }} />
        <Area type="monotone" dataKey="sales" stroke="url(#salesStroke)" strokeWidth={3} fill="url(#salesFill)" activeDot={{ r: 6, fill: "#fff", stroke: "#1479c2", strokeWidth: 3 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
