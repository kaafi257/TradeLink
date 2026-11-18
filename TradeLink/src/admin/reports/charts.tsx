import { useState } from "react";

export const PALETTE = ["#2f6df6", "#0b1f3a", "#6fa0ff", "#14a37f", "#e0a030", "#d9534f", "#8b9ab5"];
type Pt = { label: string; value: number };

function nice(max: number) { if (max <= 0) return 1; const p = 10 ** Math.floor(Math.log10(max)); const f = max / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; }
const compact = (n: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);

/** Smooth-edged area/line chart with hover read-out. Pure SVG, so it stays light and responsive. */
export function LineChart({ data, fmt = compact, bars = false }: { data: Pt[]; fmt?: (n: number) => string; bars?: boolean }) {
  const [hi, setHi] = useState<number | null>(null);
  const W = 640, H = 220, L = 44, R = 12, T = 14, B = 26;
  const max = nice(Math.max(0, ...data.map(d => d.value)));
  const n = data.length;
  const x = (i: number) => L + (n <= 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (n - 1));
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const bw = Math.max(2, Math.min(28, ((W - L - R) / Math.max(n, 1)) * 0.62));
  const pts = data.map((d, i) => `${x(i)},${y(d.value)}`).join(" ");
  const step = Math.max(1, Math.ceil(n / 7));
  const ticks = [0, 0.5, 1].map(f => max * f);
  return (
    <div className="rp-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" preserveAspectRatio="none" onMouseLeave={() => setHi(null)}>
        {ticks.map(t => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="rp-grid" /><text x={L - 6} y={y(t) + 3} className="rp-tick" textAnchor="end">{compact(t)}</text></g>)}
        {bars
          ? data.map((d, i) => <rect key={i} x={x(i) - bw / 2} y={y(d.value)} width={bw} height={Math.max(0, H - B - y(d.value))} rx="3" className={hi === i ? "rp-bar on" : "rp-bar"} />)
          : <>
              {n > 1 && <polygon points={`${x(0)},${H - B} ${pts} ${x(n - 1)},${H - B}`} className="rp-area" />}
              {n > 1 && <polyline points={pts} className="rp-line" />}
              {data.map((d, i) => (n <= 40 || i === hi) && <circle key={i} cx={x(i)} cy={y(d.value)} r={hi === i ? 4.5 : 2.5} className="rp-dot" />)}
            </>}
        {data.map((d, i) => i % step === 0 && <text key={i} x={x(i)} y={H - 8} className="rp-tick" textAnchor="middle">{d.label}</text>)}
        {data.map((_, i) => <rect key={i} x={x(i) - (W - L - R) / Math.max(n, 1) / 2} y={0} width={(W - L - R) / Math.max(n, 1)} height={H} fill="transparent" onMouseEnter={() => setHi(i)} onTouchStart={() => setHi(i)} />)}
      </svg>
      {hi != null && data[hi] && <div className="rp-tip"><span>{data[hi].label}</span><b>{fmt(data[hi].value)}</b></div>}
    </div>
  );
}

export type Slice = { label: string; value: number; color?: string };
export function Donut({ data, total, fmt = (n: number) => String(n) }: { data: Slice[]; total?: string; fmt?: (n: number) => string }) {
  const sum = data.reduce((s, d) => s + d.value, 0);
  const R = 52, C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className="rp-donut">
      <svg viewBox="0 0 140 140" role="img">
        <circle cx="70" cy="70" r={R} className="rp-donut-bg" />
        {sum > 0 && data.map((d, i) => { const len = (d.value / sum) * C; const el = <circle key={d.label} cx="70" cy="70" r={R} fill="none" stroke={d.color || PALETTE[i % PALETTE.length]} strokeWidth="16" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-acc} transform="rotate(-90 70 70)" />; acc += len; return el; })}
        <text x="70" y="68" textAnchor="middle" className="rp-donut-n">{total ?? fmt(sum)}</text>
        <text x="70" y="84" textAnchor="middle" className="rp-tick">total</text>
      </svg>
      <ul>{data.map((d, i) => <li key={d.label}><i style={{ background: d.color || PALETTE[i % PALETTE.length] }} /><span>{d.label}</span><b>{fmt(d.value)}</b></li>)}</ul>
    </div>
  );
}

export function HBars({ data, fmt = (n: number) => String(n) }: { data: Slice[]; fmt?: (n: number) => string }) {
  const max = Math.max(1, ...data.map(d => d.value));
  return <div className="rp-hbars">{data.map((d, i) => <div key={d.label}><span>{d.label}</span><div><i style={{ width: `${(d.value / max) * 100}%`, background: d.color || PALETTE[i % PALETTE.length] }} /></div><b>{fmt(d.value)}</b></div>)}</div>;
}
