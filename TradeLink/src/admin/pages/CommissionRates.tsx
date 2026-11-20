import { useState } from "react";
import { Building2, Info, Layers } from "lucide-react";
import { DataTable, PageHeading, SummaryStrip } from "../../components/ui";
import { money } from "../../lib/format";
import { requireSupabase } from "../../lib/supabase";
import { useAdmin } from "../AdminData";
import { ErrorNote, Tabs, callRpc, useAction, useLoad } from "../suite";

type CatRow = { category_id: string; category_name: string; industry_name: string; rate: number | null; sales_count: number; commission: number };
type SupRow = { id: string; name: string; status: string | null; fee_rate: number };

/** One rate box with Save (and Clear for category rates, which fall back to the supplier's own rate). */
function RateCell({ value, canEdit, onSave, onClear, placeholder }: { value: number | null; canEdit: boolean; onSave: (n: number) => Promise<unknown>; onClear?: () => Promise<unknown>; placeholder?: string }) {
  const [v, setV] = useState(value == null ? "" : String(Number(value)));
  const { busy, run } = useAction();
  const changed = v !== (value == null ? "" : String(Number(value)));
  if (!canEdit) return <>{value == null ? "—" : `${Number(value)}%`}</>;
  return (
    <span className="su-row" style={{ flexWrap: "nowrap" }}>
      <input type="number" min="0" max="100" step="0.5" aria-label="Commission rate in percent" value={v} placeholder={placeholder} style={{ width: 84, minHeight: 36, border: "1px solid var(--line)", borderRadius: 8, padding: "0 8px" }} onChange={e => setV(e.target.value)} />%
      <button className="su-ico-btn good" disabled={busy || !changed || v === ""} onClick={() => void run(() => onSave(Number(v)), "Rate saved.")}>Save</button>
      {onClear && value != null && <button className="su-ico-btn" disabled={busy} onClick={() => void run(async () => { await onClear(); setV(""); }, "Rate removed.")}>Clear</button>}
    </span>
  );
}

export default function CommissionRates() {
  const { can, search } = useAdmin();
  const [tab, setTab] = useState<"categories" | "suppliers">("categories");
  const cats = useLoad(() => callRpc<CatRow[]>("commission_categories"), []);
  const sups = useLoad(async () => {
    const { data, error } = await requireSupabase().from("suppliers").select("id, name, status, fee_rate").order("name");
    if (error) throw error;
    return (data ?? []) as SupRow[];
  }, []);
  const edit = can("commissions.manage");
  const s = search.toLowerCase();
  const rows = cats.data ?? [];
  const withRate = rows.filter(r => r.rate != null).length;
  const earned = rows.reduce((a, r) => a + Number(r.commission), 0);

  return (
    <>
      <PageHeading title="Commissions" sub="TradeLink's commission on supplier products, by category or by supplier." />
      <div className="info-banner"><Info /> Commission = rate × the supplier's price. A category rate wins; if a category has none, the supplier's own rate is used. The rate is saved on each sale when it happens, so changes never alter past sales.</div>
      <SummaryStrip items={[
        { icon: <Layers />, tone: "blue", value: withRate, label: "Categories with a rate" },
        { icon: <Building2 />, tone: "mint", value: (sups.data ?? []).filter(x => Number(x.fee_rate) > 0).length, label: "Suppliers with a rate" },
        { icon: <Info />, tone: "gold", value: money(earned), label: "Earned (category view)" },
      ]} />
      <Tabs label="Commission views" value={tab} onChange={setTab} tabs={[{ id: "categories", label: "By category", icon: <Layers /> }, { id: "suppliers", label: "By supplier", icon: <Building2 /> }]} />
      {tab === "categories" && <>
        <ErrorNote text={cats.error} />
        <DataTable headers={["Industry", "Category", "Rate", "Sales", "Commission earned"]} isEmpty={!rows.length} empty={cats.loading ? "Loading…" : "No categories yet. Add them in Categories."}>
          {rows.filter(r => `${r.industry_name} ${r.category_name}`.toLowerCase().includes(s)).map(r => (
            <tr key={r.category_id}><td>{r.industry_name}</td><td><b>{r.category_name}</b></td>
              <td><RateCell key={String(r.rate)} value={r.rate} canEdit={edit} placeholder="supplier" onSave={async n => { await callRpc("set_category_commission", { p_category: r.category_id, p_rate: n }); cats.reload(); }} onClear={async () => { await callRpc("set_category_commission", { p_category: r.category_id, p_rate: null }); cats.reload(); }} /></td>
              <td>{Number(r.sales_count)}</td><td>{money(Number(r.commission))}</td></tr>
          ))}
        </DataTable>
      </>}
      {tab === "suppliers" && <>
        <ErrorNote text={sups.error} />
        <DataTable headers={["Supplier", "Status", "Default rate"]} isEmpty={!(sups.data ?? []).length} empty={sups.loading ? "Loading…" : "No suppliers yet."}>
          {(sups.data ?? []).filter(x => x.name.toLowerCase().includes(s)).map(x => (
            <tr key={x.id}><td><b>{x.name}</b></td><td><span className={`status ${x.status === "approved" ? "good" : x.status === "pending" ? "warn" : "muted"}`}>{x.status ?? "approved"}</span></td>
              <td><RateCell key={String(x.fee_rate)} value={Number(x.fee_rate)} canEdit={edit} onSave={async n => { await callRpc("set_supplier_fee_rate", { p_supplier: x.id, p_rate: n }); sups.reload(); }} /></td></tr>
          ))}
        </DataTable>
      </>}
    </>
  );
}
