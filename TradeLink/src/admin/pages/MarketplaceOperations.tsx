import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { PageHeading } from "../../components/ui";
import { errorText, requireSupabase } from "../../lib/supabase";
import { useAdmin } from "../AdminData";

const MODULES: Record<string, { title: string; description: string; table: string; status?: string[] }> = {
  payments: { title: "Payments & Payouts", description: "Review payment records and manage the supplier payout queue. Transfers are not sent from this page.", table: "marketplace_payment_records", status: ["pending","submitted","verified","failed","refunded","cancelled"] },
  commissions: { title: "Category Commissions", description: "Review category-based commission rules. Configure rates only after confirming the commercial terms.", table: "marketplace_category_commissions" },
  returns: { title: "Returns & Disputes", description: "Track return requests and customer disputes.", table: "marketplace_returns", status: ["requested","under_review","approved","rejected","received","refunded","closed"] },
  disputes: { title: "Disputes", description: "Investigate and resolve marketplace disputes.", table: "marketplace_disputes", status: ["open","investigating","awaiting_customer","awaiting_supplier","resolved","closed"] },
  verification: { title: "Supplier Verification", description: "Supplier applications and approval decisions remain managed in Supplier Operations.", table: "suppliers" },
  promotions: { title: "Marketing & Promotions", description: "Review promotion campaigns and their activation status.", table: "marketplace_promotions" },
  reviews: { title: "Reviews & Ratings", description: "Moderate customer product and supplier reviews.", table: "marketplace_reviews", status: ["pending","published","hidden","rejected"] },
  website: { title: "Website Management", description: "Website content and contact settings are available in the existing Settings and Communication pages.", table: "contact_settings" },
  support: { title: "Customer Support", description: "Customer enquiries and replies are available in the existing Communication page.", table: "quotations" },
};

function label(v: string) { return v.replaceAll("_", " ").replace(/\b\w/g, x => x.toUpperCase()); }
function display(v: unknown) {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export default function MarketplaceOperations() {
  const { pathname } = useLocation();
  const { notify } = useAdmin();
  const key = pathname.split("/").filter(Boolean).at(-1) ?? "payments";
  const module = MODULES[key] ?? MODULES.payments;
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");

  const load = useCallback(async () => {
    setBusy(true); setFailure("");
    try {
      const { data, error } = await requireSupabase().from(module.table).select("*").order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      setRows((data ?? []) as Record<string, unknown>[]);
    } catch (e) { setFailure(errorText(e, "Could not load this section. Apply the marketplace migrations in Supabase first.")); setRows([]); }
    finally { setBusy(false); }
  }, [module.table]);

  useEffect(() => { void load(); }, [load]);

  const updateStatus = async (id: unknown, status: string) => {
    if (!id) return;
    setBusy(true);
    try {
      const { error } = await requireSupabase().from(module.table).update({ status }).eq("id", id);
      if (error) throw error;
      notify(module.title + " status updated.");
      await load();
    } catch (e) { notify(errorText(e, "Could not update status")); setBusy(false); }
  };

  const columns = rows?.length ? Object.keys(rows[0]).filter(k => !["metadata","public_configuration","documents","image_paths"].includes(k)).slice(0, 7) : [];

  return <>
    <PageHeading title={module.title} sub={module.description} />
    <div className="table-panel">
      <div className="table-toolbar" style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:16}}>
        <b>{rows?.length ?? 0} records</b>
        <button className="btn outline" onClick={() => void load()} disabled={busy}>{busy ? "Loading…" : "Refresh"}</button>
      </div>
      {failure && <p className="inline-note" role="alert" style={{padding:16}}>{failure}</p>}
      {!failure && rows?.length === 0 && <p className="empty-state" style={{padding:28}}>No records found yet.</p>}
      {!!rows?.length && <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse"}}>
        <thead><tr>{columns.map(c => <th key={c}>{label(c)}</th>)}{module.status && <th>Update status</th>}</tr></thead>
        <tbody>{rows.map((row,i) => <tr key={String(row.id ?? i)}>
          {columns.map(c => <td key={c} style={{maxWidth:240,overflowWrap:"anywhere"}}>{display(row[c])}</td>)}
          {module.status && <td><select aria-label="Update record status" disabled={busy || !row.id} value={String(row.status ?? "")} onChange={e => void updateStatus(row.id,e.target.value)}>
            {module.status.map(s => <option key={s} value={s}>{label(s)}</option>)}
          </select></td>}
        </tr>)}</tbody>
      </table></div>}
    </div>
    {key === "payments" && <p className="inline-note" style={{marginTop:14}}>Provider rails: Telebirr · Bank transfer · CBE · eBirr. No live collection, receipt verification, or payout transfer is enabled yet.</p>}
  </>;
}
