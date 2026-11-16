import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { money } from "../lib/format";

export default function SalesChart({ data }: { data: { day: string; sales: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 20, right: 12, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#155d97" stopOpacity={0.28} /><stop offset="100%" stopColor="#155d97" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#e4ebed" vertical={false} />
        <XAxis dataKey="day" tick={{ fontSize: 12, fill: "#385a61" }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={14} tickMargin={6} />
        <YAxis width={40} tick={{ fontSize: 12, fill: "#385a61" }} axisLine={false} tickLine={false} tickFormatter={v => (v >= 1000 ? `${v / 1000}k` : String(v))} />
        <Tooltip formatter={v => money(Number(v))} />
        <Area type="monotone" dataKey="sales" stroke="#135c97" strokeWidth={3} fill="url(#salesFill)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
