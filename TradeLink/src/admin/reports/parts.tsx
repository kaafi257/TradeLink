import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Download, FileSpreadsheet, FileText, Search, TrendingDown, TrendingUp, Loader2, Info } from "lucide-react";
import { blank, fmtN, pct, rpc, type Preset } from "./api";
import { exportCSV, exportPDF, exportXLSX, type Col } from "./exporters";

export const PRESETS: { key: Preset; label: string }[] = [
  { key: "today", label: "Today" }, { key: "week", label: "7 days" }, { key: "month", label: "Month" }, { key: "year", label: "Year" }, { key: "custom", label: "Custom" },
];

export function DateBar({ preset, setPreset, cf, ct, setCf, setCt, label }: { preset: Preset; setPreset: (p: Preset) => void; cf: string; ct: string; setCf: (v: string) => void; setCt: (v: string) => void; label: string }) {
  return (
    <div className="rp-datebar">
      <div className="range-tabs" role="tablist" aria-label="Period">{PRESETS.map(p => <button key={p.key} className={preset === p.key ? "on" : ""} onClick={() => setPreset(p.key)}>{p.label}</button>)}</div>
      {preset === "custom" && <div className="rp-custom"><input type="date" value={cf} max={ct || undefined} onChange={e => setCf(e.target.value)} aria-label="From" /><span>→</span><input type="date" value={ct} min={cf || undefined} onChange={e => setCt(e.target.value)} aria-label="To" /></div>}
      <span className="rp-range-label">{label}</span>
    </div>
  );
}

export type Card = { key: string; icon: ReactNode; label: string; value: string; cur?: number; prev?: number; note?: string; onClick?: () => void; muted?: boolean };
export function Cards({ cards }: { cards: Card[] }) {
  return (
    <div className="rp-cards">
      {cards.map(c => {
        const d = c.prev != null && c.cur != null ? pct(c.cur, c.prev) : null;
        const Tag = c.onClick ? "button" : "div";
        return (
          <Tag key={c.key} className={`rp-card${c.onClick ? " click" : ""}${c.muted ? " muted" : ""}`} onClick={c.onClick}>
            <span className="rp-card-ic">{c.icon}</span>
            <span className="rp-card-l">{c.label}</span>
            <b>{c.value}</b>
            {d != null && <em className={d >= 0 ? "up" : "down"}>{d >= 0 ? <TrendingUp /> : <TrendingDown />}{Math.abs(d)}%</em>}
            {c.note && <small>{c.note}</small>}
          </Tag>
        );
      })}
    </div>
  );
}

export function Box({ title, icon, children, wide }: { title: string; icon?: ReactNode; children: ReactNode; wide?: boolean }) {
  return <section className={`panel rp-box${wide ? " wide" : ""}`}><div className="panel-head"><div>{icon}<b>{title}</b></div></div><div className="rp-box-body">{children}</div></section>;
}

export function Note({ children }: { children: ReactNode }) { return <p className="rp-note"><Info />{children}</p>; }
export function Err({ msg }: { msg: string }) { return msg ? <p className="rp-err" role="alert">{msg}</p> : null; }
export function Spin() { return <div className="rp-spin"><Loader2 /></div>; }

export function Select({ value, onChange, options, label }: { value: string; onChange: (v: string) => void; options: [string, string][]; label: string }) {
  return <select className="rp-sel" value={value} onChange={e => onChange(e.target.value)} aria-label={label}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>;
}

type TableProps = {
  title: string; fn: string; args: Record<string, unknown>; cols: Col[]; render?: Record<string, (r: Record<string, unknown>) => ReactNode>;
  filters?: ReactNode; subtitle: string; searchKey?: string; searchHint?: string; anchor?: React.Ref<HTMLDivElement>;
};

/** Server-side paginated, searchable table. Exports fetch every matching row (up to the 10,000 cap) with the same filters. */
export function DataTable({ title, fn, args, cols, render = {}, filters, subtitle, searchHint = "Search", anchor }: TableProps) {
  const SIZE = 15;
  const [q, setQ] = useState(""), [sq, setSq] = useState(""), [page, setPage] = useState(0);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0), [loading, setLoading] = useState(true), [err, setErr] = useState(""), [busy, setBusy] = useState("");
  const [open, setOpen] = useState(false);
  const key = JSON.stringify(args);
  const seq = useRef(0);
  useEffect(() => { const t = setTimeout(() => { setSq(q.trim()); setPage(0); }, 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => { setPage(0); }, [key]);
  useEffect(() => {
    const n = ++seq.current;
    setLoading(true);
    rpc<Record<string, unknown>[]>(fn, { ...args, p_search: blank(sq), p_limit: SIZE, p_offset: page * SIZE })
      .then(d => { if (n !== seq.current) return; setRows(d || []); setTotal(Number(d?.[0]?.total_count ?? 0)); setErr(""); })
      .catch(e => { if (n === seq.current) setErr(e instanceof Error ? e.message : "Could not load."); })
      .finally(() => { if (n === seq.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, sq, page, fn]);

  async function run(kind: "csv" | "xlsx" | "pdf") {
    setOpen(false); setBusy(kind); setErr("");
    try {
      const all = await rpc<Record<string, unknown>[]>(fn, { ...args, p_search: blank(sq), p_limit: 10000, p_offset: 0 });
      if (!all.length) { setErr("Nothing to export for these filters."); return; }
      if (kind === "csv") exportCSV(title, cols, all); else if (kind === "xlsx") exportXLSX(title, cols, all); else await exportPDF(title, subtitle, cols, all);
    } catch (e) { setErr(e instanceof Error ? e.message : "Export failed."); } finally { setBusy(""); }
  }
  const pages = Math.max(1, Math.ceil(total / SIZE));
  return (
    <section className="panel rp-table" ref={anchor}>
      <div className="panel-head"><div><b>{title}</b><span className="rp-count">{fmtN(total)}</span></div>
        <div className="rp-tools">
          <label className="rp-search"><Search /><input value={q} onChange={e => setQ(e.target.value)} placeholder={searchHint} aria-label={searchHint} /></label>
          {filters}
          <div className="rp-export">
            <button className="rp-btn" onClick={() => setOpen(o => !o)} disabled={!!busy} aria-haspopup="menu" aria-expanded={open}>{busy ? <Loader2 className="spin" /> : <Download />}<span>Export</span></button>
            {open && <div className="rp-menu" role="menu"><button role="menuitem" onClick={() => run("xlsx")}><FileSpreadsheet />Excel</button><button role="menuitem" onClick={() => run("csv")}><FileText />CSV</button><button role="menuitem" onClick={() => run("pdf")}><FileText />PDF</button></div>}
          </div>
        </div>
      </div>
      <Err msg={err} />
      <div className="rp-scroll">
        <table className="rp-tbl">
          <thead><tr>{cols.map(c => <th key={c.key}>{c.label}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => <tr key={String(r.id ?? r.customer_key ?? i)}>{cols.map(c => <td key={c.key} data-label={c.label}>{render[c.key] ? render[c.key](r) : String(c.get ? c.get(r) : r[c.key] ?? "—")}</td>)}</tr>)}
            {!loading && !rows.length && !err && <tr><td colSpan={cols.length} className="rp-empty">No records for these filters.</td></tr>}
          </tbody>
        </table>
        {loading && <div className="rp-veil"><Loader2 className="spin" /></div>}
      </div>
      <div className="rp-pager">
        <span>{total ? `${page * SIZE + 1}–${Math.min(total, (page + 1) * SIZE)} of ${fmtN(total)}` : "0 records"}</span>
        <div><button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} aria-label="Previous"><ChevronLeft /></button><b>{page + 1}/{pages}</b><button onClick={() => setPage(p => Math.min(pages - 1, p + 1))} disabled={page + 1 >= pages} aria-label="Next"><ChevronRight /></button></div>
      </div>
    </section>
  );
}

export const Badge = ({ v }: { v: string }) => <span className={`rp-badge s-${String(v).replace(/[^a-z_]/gi, "")}`}>{String(v).replace(/_/g, " ")}</span>;
