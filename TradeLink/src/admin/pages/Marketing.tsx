import { useEffect, useState } from "react";
import { CalendarClock, Megaphone, Percent, Play, Plus, Power, Square, Tag, Ticket } from "lucide-react";
import { DataTable, PageHeading, SummaryStrip } from "../../components/ui";
import { StatusChip, type Tone } from "../Records";
import { money } from "../../lib/format";
import { requireSupabase } from "../../lib/supabase";
import { useAdmin } from "../AdminData";
import CampaignScenes from "./CampaignScenes";
import { ErrorNote, Form, Modal, Tabs, callRpc, label, useAction, useLoad } from "../suite";

type Promo = { id: string; name: string; scope: string; category_id: string | null; product_id: string | null; percent: number; starts_at: string | null; ends_at: string | null; status: string; note: string | null; promotion_items: { product_id: string }[] };
type PromoResult = { promotion_id: string; units: number; revenue: number; orders: number };
type Coupon = { id: string; code: string; name: string | null; percent: number; max_uses: number | null; starts_at: string | null; ends_at: string | null; active: boolean };
type CouponResult = { coupon_id: string; uses: number; orders: number; discount: number; revenue: number };
const TONE: Record<string, Tone> = { draft: "muted", scheduled: "info", active: "good", ended: "muted" };
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }) : null);
const asLocal = (v: string) => (v ? new Date(v).toISOString() : null);

export default function Marketing() {
  const { can, categories, products, search } = useAdmin();
  const [tab, setTab] = useState<"promotions" | "coupons" | "banner">("promotions");
  const [modal, setModal] = useState(false);
  const { busy, run } = useAction();
  const promos = useLoad(async () => {
    await callRpc("expire_promotions");                       // starts or ends anything that is due
    const { data, error } = await requireSupabase().from("promotions").select("*, promotion_items(product_id)").order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as Promo[];
  }, []);
  const pres = useLoad(() => callRpc<PromoResult[]>("promotion_results"), []);
  const coupons = useLoad(async () => {
    const { data, error } = await requireSupabase().from("coupons").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as Coupon[];
  }, []);
  const cres = useLoad(() => callRpc<CouponResult[]>("coupon_results"), []);
  const edit = can("marketing.manage");
  const s = search.toLowerCase();
  const rows = promos.data ?? [];
  const crow = coupons.data ?? [];
  const pr = new Map((pres.data ?? []).map(r => [r.promotion_id, r]));
  const cr = new Map((cres.data ?? []).map(r => [r.coupon_id, r]));
  const scopeText = (p: Promo) => p.scope === "all" ? "All retail products" : p.scope === "category" ? `Category: ${categories.find(c => c.id === p.category_id)?.name ?? "removed"}` : `Product: ${products.find(x => x.id === p.product_id)?.name ?? "removed"}`;
  const reloadAll = () => { promos.reload(); pres.reload(); coupons.reload(); cres.reload(); };
  const couponLive = (c: Coupon) => c.active && (!c.starts_at || new Date(c.starts_at) <= new Date()) && (!c.ends_at || new Date(c.ends_at) > new Date());

  return (
    <>
      <PageHeading title="Marketing & Promotions" sub="Run timed sales and coupon codes, and see what they earn." action={edit && tab !== "banner" ? <button className="btn green" onClick={() => setModal(true)}><Plus size={16} /> {tab === "promotions" ? "New promotion" : "New coupon"}</button> : undefined} />
      <ErrorNote text={promos.error || coupons.error} />
      <SummaryStrip items={[
        { icon: <Play />, tone: "mint", value: rows.filter(r => r.status === "active").length, label: "Running" },
        { icon: <CalendarClock />, tone: "blue", value: rows.filter(r => r.status === "scheduled").length, label: "Scheduled" },
        { icon: <Percent />, tone: "gold", value: rows.filter(r => r.status === "active").reduce((a, r) => a + r.promotion_items.length, 0), label: "Products on sale" },
        { icon: <Ticket />, tone: "red", value: crow.filter(couponLive).length, label: "Live coupons" },
      ]} />
      <Tabs label="Marketing views" value={tab} onChange={setTab} tabs={[{ id: "promotions", label: "Sales", icon: <Tag /> }, { id: "coupons", label: "Coupon codes", icon: <Ticket /> }, { id: "banner", label: "Homepage banner", icon: <Megaphone /> }]} />

      {tab === "banner" && <CampaignScenes canEdit={edit} />}

      {tab === "promotions" && <>
        <div className="info-banner"><Megaphone /> A sale puts the discounted price on each product, and the storefront shows it and quotes it. It starts and ends on its own at the times you set, and the earlier price comes back. Wholesale prices are never touched.</div>
        <DataTable headers={["Promotion", "Covers", "Discount", "Runs", "Status", "Sold", "Revenue", "Actions"]} isEmpty={!rows.length} empty={promos.loading ? "Loading…" : "No promotions yet."}>
          {rows.filter(r => r.name.toLowerCase().includes(s)).map(r => { const res = pr.get(r.id); return (
            <tr key={r.id}><td><b>{r.name}</b>{r.note && <><br /><small className="su-muted">{r.note}</small></>}</td><td>{scopeText(r)}</td><td>{Number(r.percent)}% off</td>
              <td>{r.status === "active" || r.status === "ended" ? `${r.promotion_items.length} products` : ""}<br /><small className="su-muted">{r.starts_at ? `from ${when(r.starts_at)}` : "starts by hand"}{r.ends_at ? ` · until ${when(r.ends_at)}` : ""}</small></td>
              <td><StatusChip tone={TONE[r.status] ?? "muted"}>{label(r.status)}</StatusChip></td>
              <td>{res ? `${Number(res.units)} units · ${Number(res.orders)} orders` : "—"}</td><td>{res ? money(Number(res.revenue)) : "—"}</td>
              <td>{edit && r.status === "draft" && <button className="btn green" disabled={busy} onClick={() => void run(async () => { await callRpc<number>("start_promotion", { p_id: r.id }); reloadAll(); }, "Promotion started.")}><Play size={14} /> Start</button>}
                {edit && r.status === "active" && <button className="btn outline" disabled={busy} onClick={() => void run(async () => { await callRpc("end_promotion", { p_id: r.id }); reloadAll(); }, "Promotion ended and prices restored.")}><Square size={14} /> End</button>}
                {edit && r.status === "scheduled" && <button className="btn outline" disabled={busy} onClick={() => void run(async () => { await callRpc("end_promotion", { p_id: r.id }); reloadAll(); }, "Scheduled promotion cancelled.")}>Cancel</button>}</td></tr>
          ); })}
        </DataTable>
        <p className="su-muted" style={{ marginTop: 10 }}>Sold and revenue count paid sales of the promoted products while the sale was running.</p>
      </>}

      {tab === "coupons" && <>
        <div className="info-banner"><Ticket /> Customers type a code on the request form. The percentage comes off every line when you price their quote, and shows on the quote, order and sale. Each phone number can use a code once.</div>
        <DataTable headers={["Code", "Discount", "Valid", "Used", "Orders", "Discount given", "Revenue", "Status", "Actions"]} isEmpty={!crow.length} empty={coupons.loading ? "Loading…" : "No coupons yet."}>
          {crow.filter(c => `${c.code} ${c.name ?? ""}`.toLowerCase().includes(s)).map(c => { const res = cr.get(c.id); return (
            <tr key={c.id}><td><span className="docno">{c.code}</span>{c.name && <><br /><small className="su-muted">{c.name}</small></>}</td><td>{Number(c.percent)}% off</td>
              <td><small className="su-muted">{c.starts_at ? `from ${when(c.starts_at)}` : "now"}{c.ends_at ? ` · until ${when(c.ends_at)}` : " · no end"}</small></td>
              <td>{res ? Number(res.uses) : 0}{c.max_uses ? ` / ${c.max_uses}` : ""}</td><td>{res ? Number(res.orders) : 0}</td><td>{res ? money(Number(res.discount)) : "—"}</td><td>{res ? money(Number(res.revenue)) : "—"}</td>
              <td>{couponLive(c) ? <StatusChip tone="good">Live</StatusChip> : <StatusChip tone="muted">{c.active ? "Scheduled / ended" : "Off"}</StatusChip>}</td>
              <td>{edit && <button className="btn outline" disabled={busy} onClick={() => void run(async () => { await callRpc("set_coupon_active", { p_id: c.id, p_active: !c.active }); coupons.reload(); }, c.active ? "Coupon turned off." : "Coupon turned on.")}><Power size={14} /> {c.active ? "Turn off" : "Turn on"}</button>}</td></tr>
          ); })}
        </DataTable>
        <p className="su-muted" style={{ marginTop: 10 }}>Used counts requests that entered the code. Orders, discount and revenue count only paid sales.</p>
      </>}

      {modal && tab === "promotions" && <NewPromo onClose={() => setModal(false)} onDone={() => { setModal(false); reloadAll(); }} />}
      {modal && tab === "coupons" && <NewCoupon onClose={() => setModal(false)} onDone={() => { setModal(false); reloadAll(); }} />}
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
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  useEffect(() => { setCat(""); setProd(""); }, [scope]);
  const retail = products.filter(p => p.active && Number(p.retail_price) > 0 && p.audience !== "b2b");
  const submit = async () => {
    const ok = await run(() => callRpc("create_promotion", { p_name: name, p_scope: scope, p_category: scope === "category" ? cat : null, p_product: scope === "product" ? prod : null, p_percent: Number(pct), p_starts: asLocal(starts), p_ends: asLocal(ends) }),
      starts ? "Scheduled. It will start by itself." : "Saved as a draft. Press Start when you are ready.");
    if (ok) onDone();
  };
  return (
    <Modal title="New promotion" kicker="MARKETING" onClose={onClose}>
      <Form onSubmit={() => void submit()} busy={busy} submit={starts ? "Schedule" : "Save draft"}>
        <label>Name<input required minLength={2} maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Eid sale" /></label>
        <div className="two">
          <label>Covers<select value={scope} onChange={e => setScope(e.target.value)}><option value="category">One category</option><option value="product">One product</option><option value="all">All retail products</option></select></label>
          <label>Discount (%)<input type="number" min="1" max="90" step="0.5" required value={pct} onChange={e => setPct(e.target.value)} /></label>
        </div>
        {scope === "category" && <label>Category<select required value={cat} onChange={e => setCat(e.target.value)}><option value="">Choose…</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
        {scope === "product" && <label>Product<select required value={prod} onChange={e => setProd(e.target.value)}><option value="">Choose…</option>{retail.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
        <div className="two">
          <label>Starts (optional)<input type="datetime-local" value={starts} onChange={e => setStarts(e.target.value)} /></label>
          <label>Ends (optional)<input type="datetime-local" value={ends} onChange={e => setEnds(e.target.value)} /></label>
        </div>
        <p className="su-muted">Leave the start empty to start it yourself. With a start time it begins by itself. Only active products with a retail price are included.</p>
      </Form>
    </Modal>
  );
}

function NewCoupon({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { busy, run } = useAction();
  const [f, setF] = useState({ code: "", name: "", percent: "10", max: "", starts: "", ends: "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = async () => {
    const ok = await run(() => callRpc("create_coupon", { p_code: f.code, p_name: f.name, p_percent: Number(f.percent), p_max_uses: f.max ? Number(f.max) : null, p_starts: asLocal(f.starts), p_ends: asLocal(f.ends) }), "Coupon created.");
    if (ok) onDone();
  };
  return (
    <Modal title="New coupon" kicker="MARKETING" onClose={onClose}>
      <Form onSubmit={() => void submit()} busy={busy} submit="Create coupon">
        <div className="two">
          <label>Code<input required minLength={4} maxLength={20} pattern="[A-Za-z0-9_\-]{4,20}" title="4 to 20 letters, numbers, - or _" value={f.code} onChange={e => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder="WELCOME10" /></label>
          <label>Discount (%)<input type="number" min="1" max="90" step="0.5" required value={f.percent} onChange={set("percent")} /></label>
        </div>
        <label>Note (optional)<input maxLength={80} value={f.name} onChange={set("name")} placeholder="Who or what it is for" /></label>
        <label>Maximum uses (optional)<input type="number" min="1" step="1" value={f.max} onChange={set("max")} placeholder="Unlimited" /></label>
        <div className="two">
          <label>Valid from (optional)<input type="datetime-local" value={f.starts} onChange={set("starts")} /></label>
          <label>Valid until (optional)<input type="datetime-local" value={f.ends} onChange={set("ends")} /></label>
        </div>
      </Form>
    </Modal>
  );
}
