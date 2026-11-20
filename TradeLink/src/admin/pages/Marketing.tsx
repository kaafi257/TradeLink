import { useEffect, useState } from "react";
import { Megaphone, Percent, Play, Plus, Square, Tag } from "lucide-react";
import { DataTable, PageHeading, SummaryStrip } from "../../components/ui";
import { StatusChip, type Tone } from "../Records";
import { requireSupabase } from "../../lib/supabase";
import { useAdmin } from "../AdminData";
import { ErrorNote, Form, Modal, callRpc, dateOf, label, useAction, useLoad } from "../suite";

type Promo = { id: string; name: string; scope: string; category_id: string | null; product_id: string | null; percent: number; ends_at: string | null; status: string; started_at: string | null; promotion_items: { product_id: string }[] };
const TONE: Record<string, Tone> = { draft: "muted", active: "good", ended: "info" };

export default function Marketing() {
  const { can, categories, products, search } = useAdmin();
  const [modal, setModal] = useState(false);
  const { busy, run } = useAction();
  const list = useLoad(async () => {
    await callRpc("expire_promotions");                       // ends anything whose end date has passed
    const { data, error } = await requireSupabase().from("promotions").select("*, promotion_items(product_id)").order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as Promo[];
  }, []);
  const rows = list.data ?? [];
  const edit = can("marketing.manage");
  const scopeText = (p: Promo) => p.scope === "all" ? "All retail products" : p.scope === "category" ? `Category: ${categories.find(c => c.id === p.category_id)?.name ?? "removed"}` : `Product: ${products.find(x => x.id === p.product_id)?.name ?? "removed"}`;
  const s = search.toLowerCase();

  return (
    <>
      <PageHeading title="Marketing & Promotions" sub="Run percentage-off promotions on retail prices." action={edit ? <button className="btn green" onClick={() => setModal(true)}><Plus size={16} /> New promotion</button> : undefined} />
      <ErrorNote text={list.error} />
      <div className="info-banner"><Megaphone /> Starting a promotion puts the discounted price on each product as its sale price, and the storefront shows it. Ending it restores the earlier price. Wholesale prices are never touched.</div>
      <SummaryStrip items={[
        { icon: <Play />, tone: "mint", value: rows.filter(r => r.status === "active").length, label: "Running" },
        { icon: <Tag />, tone: "gold", value: rows.filter(r => r.status === "draft").length, label: "Drafts" },
        { icon: <Percent />, tone: "blue", value: rows.filter(r => r.status === "active").reduce((a, r) => a + r.promotion_items.length, 0), label: "Products on sale" },
      ]} />
      <DataTable headers={["Promotion", "Covers", "Discount", "Products", "Ends", "Status", "Actions"]} isEmpty={!rows.length} empty={list.loading ? "Loading…" : "No promotions yet."}>
        {rows.filter(r => r.name.toLowerCase().includes(s)).map(r => (
          <tr key={r.id}><td><b>{r.name}</b></td><td>{scopeText(r)}</td><td>{Number(r.percent)}% off</td><td>{r.status === "draft" ? "—" : r.promotion_items.length}</td><td>{r.ends_at ? dateOf(r.ends_at) : "No end date"}</td>
            <td><StatusChip tone={TONE[r.status] ?? "muted"}>{label(r.status)}</StatusChip></td>
            <td>{edit && r.status === "draft" && <button className="btn green" disabled={busy} onClick={() => void run(async () => { const n = await callRpc<number>("start_promotion", { p_id: r.id }); list.reload(); return n; }, "Promotion started.")}><Play size={14} /> Start</button>}
              {edit && r.status === "active" && <button className="btn outline" disabled={busy} onClick={() => void run(async () => { await callRpc("end_promotion", { p_id: r.id }); list.reload(); }, "Promotion ended and prices restored.")}><Square size={14} /> End</button>}</td></tr>
        ))}
      </DataTable>
      {modal && <NewPromo onClose={() => setModal(false)} onDone={() => { setModal(false); list.reload(); }} />}
    </>
  );
}

function NewPromo({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { categories, products } = useAdmin();
  const { busy, run } = useAction();
  const [name, setName] = useState("");
  const [scope, setScope] = useState("category");
  const [cat, setCat] = useState("");
  const [prod, setProd] = useState("");
  const [pct, setPct] = useState("10");
  const [ends, setEnds] = useState("");
  useEffect(() => { setCat(""); setProd(""); }, [scope]);
  const retail = products.filter(p => p.active && Number(p.retail_price) > 0 && p.audience !== "b2b");
  const submit = async () => {
    const ok = await run(() => callRpc("create_promotion", { p_name: name, p_scope: scope, p_category: scope === "category" ? cat : null, p_product: scope === "product" ? prod : null, p_percent: Number(pct), p_ends: ends ? new Date(ends).toISOString() : null }), "Saved as a draft. Press Start when you are ready.");
    if (ok) onDone();
  };
  return (
    <Modal title="New promotion" kicker="MARKETING" onClose={onClose}>
      <Form onSubmit={() => void submit()} busy={busy} submit="Save draft">
        <label>Name<input required minLength={2} maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Eid sale" /></label>
        <div className="two">
          <label>Covers<select value={scope} onChange={e => setScope(e.target.value)}><option value="category">One category</option><option value="product">One product</option><option value="all">All retail products</option></select></label>
          <label>Discount (%)<input type="number" min="1" max="90" step="0.5" required value={pct} onChange={e => setPct(e.target.value)} /></label>
        </div>
        {scope === "category" && <label>Category<select required value={cat} onChange={e => setCat(e.target.value)}><option value="">Choose…</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
        {scope === "product" && <label>Product<select required value={prod} onChange={e => setProd(e.target.value)}><option value="">Choose…</option>{retail.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
        <label>Ends (optional)<input type="datetime-local" value={ends} onChange={e => setEnds(e.target.value)} /></label>
        <p className="su-muted">Only active products with a retail price are included. An end date is applied the next time someone opens this page, or when the promotion is ended by hand.</p>
      </Form>
    </Modal>
  );
}
