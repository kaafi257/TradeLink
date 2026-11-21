import { useMemo, useState } from "react";
import { BarChart3, CalendarClock, CheckCircle2, Gift, Megaphone, Pause, PanelTop, Pencil, Play, Plus, Power, Square, Star, Ticket, Trash2, Undo2, XCircle, Zap } from "lucide-react";
import { PageHeading, SummaryStrip } from "../../components/ui";
import { CampaignCard, CampaignForm, CouponCard, CouponForm } from "../../components/promo/PromoUI";
import { STATUS_LABEL, STATUS_ORDER, couponStatus, etb, rpc, type Coupon, type CouponResult, type Promo, type PromoResult, type PromoStatus } from "../../lib/promo";
import { requireSupabase } from "../../lib/supabase";
import { useAdmin } from "../AdminData";
import CampaignScenes from "./CampaignScenes";
import { ErrorNote, Modal, Tabs, callRpc, useAction, useLoad } from "../suite";

type Supplier = { id: string; name: string };
type Tab = "campaigns" | "approvals" | "coupons" | "featured" | "analytics" | "banner";

export default function Marketing() {
  const { can, categories, products, search } = useAdmin();
  const edit = can("marketing.manage");
  const [tab, setTab] = useState<Tab>("campaigns");
  const [filter, setFilter] = useState<PromoStatus | "all">("all");
  const [promoForm, setPromoForm] = useState<Promo | null | "new">(null);
  const [couponForm, setCouponForm] = useState<Coupon | null | "new">(null);
  const [reject, setReject] = useState<{ kind: "promo" | "coupon"; id: string; name: string } | null>(null);
  const [reason, setReason] = useState("");
  const { busy, run } = useAction();

  const promos = useLoad(async () => {
    await callRpc("expire_promotions");                      // starts, ends or pauses whatever is due
    const { data, error } = await requireSupabase().from("promotions").select("*, promotion_items(product_id)").order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as Promo[];
  }, []);
  const coupons = useLoad(async () => {
    const { data, error } = await requireSupabase().from("coupons").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as Coupon[];
  }, []);
  const pres = useLoad(() => callRpc<PromoResult[]>("promotion_results"), []);
  const cres = useLoad(() => callRpc<CouponResult[]>("coupon_results"), []);
  const sups = useLoad(async () => {
    const { data, error } = await requireSupabase().from("suppliers").select("id,name").eq("status", "approved").eq("active", true).order("name");
    if (error) throw error;
    return (data ?? []) as Supplier[];
  }, []);
  const feat = useLoad(async () => {
    const { data, error } = await requireSupabase().from("featured_items").select("kind,ref_id");
    if (error) throw error;
    return (data ?? []) as { kind: "product" | "supplier"; ref_id: string }[];
  }, []);
  const reloadAll = () => { promos.reload(); coupons.reload(); pres.reload(); cres.reload(); };

  const rows = promos.data ?? [];
  const crow = coupons.data ?? [];
  const supName = (id: string | null) => sups.data?.find(s => s.id === id)?.name;
  const pr = new Map((pres.data ?? []).map(r => [r.promotion_id, r]));
  const cr = new Map((cres.data ?? []).map(r => [r.coupon_id, r]));
  const s = search.toLowerCase();
  const scopeText = (p: Promo) => p.scope === "all" ? "All retail products" : p.scope === "category" ? `Category: ${categories.find(c => c.id === p.category_id)?.name ?? "removed"}`
    : p.scope === "store" ? `Store: ${supName(p.supplier_id) ?? "supplier"}` : `Product: ${products.find(x => x.id === p.product_id)?.name ?? "removed"}`;
  const pendingPromos = rows.filter(r => r.status === "pending");
  const pendingCoupons = crow.filter(c => c.approval === "pending");
  const productOpts = useMemo(() => products.filter(p => p.active).map(p => ({ id: p.id, name: p.name, retail: Number(p.retail_price) > 0 && p.audience !== "b2b" })), [products]);
  const act = (id: string, action: string, done: string, note?: string) => run(async () => { await rpc("promotion_action", { p_id: id, p_action: action, p_note: note ?? null }); reloadAll(); }, done);
  const cact = (id: string, action: string, done: string, note?: string) => run(async () => { await rpc("coupon_action", { p_id: id, p_action: action, p_note: note ?? null }); reloadAll(); }, done);

  const counts = useMemo(() => { const m = new Map<string, number>(); rows.forEach(r => m.set(r.status, (m.get(r.status) ?? 0) + 1)); return m; }, [rows]);
  const shown = rows.filter(r => (filter === "all" || r.status === filter) && `${r.name} ${supName(r.supplier_id) ?? ""}`.toLowerCase().includes(s));

  const promoActions = (r: Promo) => {
    if (!edit) return null;
    const mine = r.owner === "store";
    return (
      <>
        {r.status === "draft" && mine && <>
          <button className="btn outline" onClick={() => setPromoForm(r)}><Pencil size={14} /> Edit</button>
          <button className="btn green" disabled={busy} onClick={() => void act(r.id, "start", r.starts_at && new Date(r.starts_at) > new Date() ? "Scheduled. It will start by itself." : "Promotion started.")}><Play size={14} /> {r.starts_at && new Date(r.starts_at) > new Date() ? "Schedule" : "Start"}</button>
          <button className="btn outline" disabled={busy} aria-label="Delete draft" onClick={() => void act(r.id, "delete", "Draft deleted.")}><Trash2 size={14} /></button>
        </>}
        {r.status === "draft" && !mine && <small className="su-muted">Supplier is still editing.</small>}
        {r.status === "pending" && <>
          <button className="btn green" disabled={busy} onClick={() => void act(r.id, "approve", "Approved.")}><CheckCircle2 size={14} /> Approve</button>
          <button className="btn outline" disabled={busy} onClick={() => { setReason(""); setReject({ kind: "promo", id: r.id, name: r.name }); }}><XCircle size={14} /> Reject</button>
        </>}
        {r.status === "scheduled" && <button className="btn outline" disabled={busy} onClick={() => void act(r.id, "cancel", "Scheduled campaign cancelled.")}><Undo2 size={14} /> Cancel</button>}
        {r.status === "active" && <>
          <button className="btn outline" disabled={busy} onClick={() => void act(r.id, "pause", "Paused. Earlier prices are back.")}><Pause size={14} /> Pause</button>
          <button className="btn outline" disabled={busy} onClick={() => void act(r.id, "end", "Ended. Earlier prices are back.")}><Square size={14} /> End</button>
        </>}
        {r.status === "paused" && <>
          <button className="btn green" disabled={busy} onClick={() => void act(r.id, "resume", "Resumed.")}><Play size={14} /> Resume</button>
          <button className="btn outline" disabled={busy} onClick={() => void act(r.id, "end", "Ended.")}><Square size={14} /> End</button>
        </>}
      </>
    );
  };

  const couponActions = (c: Coupon) => {
    if (!edit) return null;
    return (
      <>
        {c.approval === "pending" && <>
          <button className="btn green" disabled={busy} onClick={() => void cact(c.id, "approve", "Coupon approved.")}><CheckCircle2 size={14} /> Approve</button>
          <button className="btn outline" disabled={busy} onClick={() => { setReason(""); setReject({ kind: "coupon", id: c.id, name: c.code }); }}><XCircle size={14} /> Reject</button>
        </>}
        {c.approval === "approved" && <button className="btn outline" disabled={busy} onClick={() => void cact(c.id, c.active ? "pause" : "resume", c.active ? "Coupon paused." : "Coupon is live again.")}><Power size={14} /> {c.active ? "Pause" : "Resume"}</button>}
        {c.owner === "store" && !(cr.get(c.id)?.uses) && <button className="btn outline" onClick={() => setCouponForm(c)}><Pencil size={14} /> Edit</button>}
        {!(cr.get(c.id)?.uses) && (c.owner === "store" || c.approval !== "pending") && <button className="btn outline" disabled={busy} aria-label="Delete coupon" onClick={() => void cact(c.id, "delete", "Coupon deleted.")}><Trash2 size={14} /></button>}
      </>
    );
  };

  const running = rows.filter(r => r.status === "active");
  const revenue = (pres.data ?? []).reduce((a, r) => a + Number(r.revenue), 0);
  const topResults = rows.filter(r => pr.get(r.id)).map(r => ({ r, res: pr.get(r.id)! })).sort((a, b) => Number(b.res.revenue) - Number(a.res.revenue)).slice(0, 8);
  const maxRev = Math.max(1, ...topResults.map(x => Number(x.res.revenue)));
  const err = promos.error || coupons.error;

  return (
    <>
      <PageHeading title="Marketing & Promotions" sub="Campaigns, coupons and featured picks for TradeLink and its suppliers." action={edit && (tab === "campaigns" || tab === "coupons") ? <button className="btn green" onClick={() => (tab === "campaigns" ? setPromoForm("new") : setCouponForm("new"))}><Plus size={16} /> {tab === "campaigns" ? "New campaign" : "New coupon"}</button> : undefined} />
      <ErrorNote text={err} />
      <SummaryStrip items={[
        { icon: <Play />, tone: "mint", value: running.length, label: "Running" },
        { icon: <CalendarClock />, tone: "blue", value: counts.get("scheduled") ?? 0, label: "Scheduled" },
        { icon: <CheckCircle2 />, tone: "gold", value: pendingPromos.length + pendingCoupons.length, label: "Waiting for approval" },
        { icon: <Ticket />, tone: "red", value: crow.filter(c => couponStatus(c, cr.get(c.id)?.uses) === "active").length, label: "Live coupons" },
      ]} />
      <Tabs label="Marketing views" value={tab} onChange={setTab} tabs={[
        { id: "campaigns", label: "Campaigns", icon: <Megaphone /> },
        { id: "approvals", label: "Approvals", icon: <CheckCircle2 />, count: pendingPromos.length + pendingCoupons.length },
        { id: "coupons", label: "Coupons", icon: <Ticket /> },
        { id: "featured", label: "Featured", icon: <Star /> },
        { id: "analytics", label: "Analytics", icon: <BarChart3 /> },
        { id: "banner", label: "Homepage banner", icon: <PanelTop /> },
      ]} />

      {tab === "banner" && <CampaignScenes canEdit={edit} />}

      {tab === "campaigns" && <>
        <div className="pm-chips" role="group" aria-label="Filter by status">
          <button className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>All <i>{rows.length}</i></button>
          {STATUS_ORDER.filter(st => counts.get(st)).map(st => <button key={st} className={filter === st ? "on" : ""} onClick={() => setFilter(st)}>{STATUS_LABEL[st]} <i>{counts.get(st)}</i></button>)}
        </div>
        {shown.length === 0 ? <div className="pm-empty"><Megaphone size={26} />{promos.loading ? "Loading…" : rows.length ? "No campaign matches." : "No campaigns yet. Create your first sale, flash sale or Buy X Get Y."}</div> : (
          <div className="pm-grid">{shown.map(r => <CampaignCard key={r.id} p={r} scopeText={scopeText(r)} owner={r.owner === "supplier" && r.scope !== "store" ? supName(r.supplier_id) ?? "Supplier" : undefined} result={pr.get(r.id)} banner={r.show_banner} actions={promoActions(r)} />)}</div>
        )}
        <p className="su-muted" style={{ marginTop: 14 }}>Sales put the discounted price on each product, so the storefront shows it and quotes use it. Buy X Get Y adds free units when a request is priced. A product can be in only one promotion at a time. Wholesale prices are never changed.</p>
      </>}

      {tab === "approvals" && <>
        {pendingPromos.length + pendingCoupons.length === 0 ? <div className="pm-empty"><CheckCircle2 size={26} />Nothing is waiting for approval.</div> : (
          <div className="pm-grid">
            {pendingPromos.map(r => <CampaignCard key={r.id} p={r} scopeText={scopeText(r)} owner={r.scope !== "store" ? supName(r.supplier_id) ?? "Supplier" : undefined} actions={promoActions(r)} />)}
            {pendingCoupons.map(c => <CouponCard key={c.id} c={c} owner={supName(c.supplier_id) ?? "Supplier"} actions={couponActions(c)} />)}
          </div>
        )}
        <p className="su-muted" style={{ marginTop: 14 }}>Approving checks again that the campaign does not overlap another one. A campaign with a future start time becomes Scheduled; otherwise it goes live now.</p>
      </>}

      {tab === "coupons" && <>
        {crow.length === 0 ? <div className="pm-empty"><Ticket size={26} />{coupons.loading ? "Loading…" : "No coupons yet."}</div> : (
          <div className="pm-grid">{crow.filter(c => `${c.code} ${c.name ?? ""}`.toLowerCase().includes(s)).map(c => <CouponCard key={c.id} c={c} used={cr.get(c.id)?.uses} result={cr.get(c.id)} owner={c.owner === "supplier" ? supName(c.supplier_id) ?? "Supplier" : undefined} actions={couponActions(c)} />)}</div>
        )}
        <p className="su-muted" style={{ marginTop: 14 }}>Customers type a code on the request form. The discount comes off when the request is priced and shows on the quote, order and sale. Orders, discount and revenue count only paid sales.</p>
      </>}

      {tab === "featured" && <Featured edit={edit} products={products.filter(p => p.active).map(p => ({ id: p.id, name: p.name }))} suppliers={sups.data ?? []} on={feat.data ?? []} search={s} onChange={feat.reload} />}

      {tab === "analytics" && <>
        <SummaryStrip items={[
          { icon: <Megaphone />, tone: "blue", value: rows.filter(r => r.started_at).length, label: "Campaigns run" },
          { icon: <BarChart3 />, tone: "mint", value: etb(revenue), label: "Revenue from promoted products" },
          { icon: <Zap />, tone: "gold", value: (pres.data ?? []).reduce((a, r) => a + Number(r.units), 0), label: "Units sold on promotion" },
          { icon: <Gift />, tone: "red", value: (pres.data ?? []).reduce((a, r) => a + Number(r.free_units), 0), label: "Free units given" },
        ]} />
        <section className="pm-panel">
          <h3>Revenue by campaign</h3>
          {topResults.length === 0 ? <p className="su-muted">Results appear here once a campaign has run and its products have paid sales.</p> : topResults.map(({ r, res }) => (
            <div className="pm-bar" key={r.id}><span className="n">{r.name}<small>{Number(res.units)} units · {Number(res.orders)} orders</small></span><span className="t"><i style={{ width: `${Math.max(3, (Number(res.revenue) / maxRev) * 100)}%` }} /></span><b>{etb(res.revenue)}</b></div>
          ))}
        </section>
        <section className="pm-panel">
          <h3>Coupons</h3>
          {crow.length === 0 ? <p className="su-muted">No coupons yet.</p> : crow.map(c => { const x = cr.get(c.id); return (
            <div className="pm-bar" key={c.id}><span className="n"><span className="pm-code sm">{c.code}</span><small>{Number(x?.uses ?? 0)} requests · {Number(x?.orders ?? 0)} orders</small></span><span className="t"><i style={{ width: `${Math.min(100, (Number(x?.orders ?? 0) / Math.max(1, Number(x?.uses ?? 0))) * 100)}%` }} /></span><b>{etb(x?.discount ?? 0)} given</b></div>
          ); })}
        </section>
        <p className="su-muted" style={{ marginTop: 10 }}>Counted from paid sales of the promoted products while the campaign was live. A pause is not counted. Coupon bars show how many requests became orders.</p>
      </>}

      {promoForm && <Modal title={promoForm === "new" ? "New campaign" : "Edit campaign"} kicker="MARKETING" onClose={() => setPromoForm(null)}>
        <CampaignForm role="admin" initial={promoForm === "new" ? null : promoForm} products={productOpts} categories={categories.map(c => ({ id: c.id, name: c.name }))} suppliers={sups.data ?? []}
          onCancel={() => setPromoForm(null)} onDone={() => { setPromoForm(null); reloadAll(); }} />
      </Modal>}
      {couponForm && <Modal title={couponForm === "new" ? "New coupon" : "Edit coupon"} kicker="MARKETING" onClose={() => setCouponForm(null)}>
        <CouponForm role="admin" initial={couponForm === "new" ? null : couponForm} onCancel={() => setCouponForm(null)} onDone={() => { setCouponForm(null); reloadAll(); }} />
      </Modal>}
      {reject && <Modal title={`Reject ${reject.name}`} kicker="APPROVALS" onClose={() => setReject(null)}>
        <form className="pm-form" onSubmit={e => { e.preventDefault(); const r = reject; void (r.kind === "promo" ? act : cact)(r.id, "reject", "Sent back to the supplier.", reason).then(ok => { if (ok) setReject(null); }); }}>
          <label>Reason the supplier will see<textarea required rows={3} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. The discount is too deep for this product" /></label>
          <div className="pm-foot"><button type="button" className="btn outline" onClick={() => setReject(null)}>Cancel</button><button className="btn green" disabled={busy || !reason.trim()}>Send back</button></div>
        </form>
      </Modal>}
    </>
  );
}

/** Featured products and stores: the public homepage shows these first. */
function Featured({ edit, products, suppliers, on, search, onChange }: { edit: boolean; products: { id: string; name: string }[]; suppliers: Supplier[]; on: { kind: string; ref_id: string }[]; search: string; onChange: () => void }) {
  const { busy, run } = useAction();
  const [q, setQ] = useState("");
  const isOn = (kind: string, id: string) => on.some(x => x.kind === kind && x.ref_id === id);
  const toggle = (kind: "product" | "supplier", id: string, next: boolean) => run(async () => { await rpc("set_featured", { p_kind: kind, p_id: id, p_on: next }); onChange(); }, next ? "Featured on the homepage." : "Removed from featured.");
  const term = (q || search).toLowerCase();
  const prods = products.filter(p => p.name.toLowerCase().includes(term)).sort((a, b) => Number(isOn("product", b.id)) - Number(isOn("product", a.id))).slice(0, 40);
  const row = (kind: "product" | "supplier", id: string, name: string) => { const f = isOn(kind, id); return (
    <li key={id} className={f ? "on" : ""}><span>{name}</span><button disabled={!edit || busy} aria-pressed={f} aria-label={f ? `Remove ${name} from featured` : `Feature ${name}`} onClick={() => void toggle(kind, id, !f)}><Star size={17} fill={f ? "currentColor" : "none"} /></button></li>
  ); };
  return (
    <div className="pm-feat">
      <section className="pm-panel"><h3>Featured stores <small>{on.filter(x => x.kind === "supplier").length} chosen</small></h3>
        {suppliers.length === 0 ? <p className="su-muted">No approved suppliers yet.</p> : <ul>{suppliers.map(s => row("supplier", s.id, s.name))}</ul>}</section>
      <section className="pm-panel"><h3>Featured products <small>{on.filter(x => x.kind === "product").length} chosen</small></h3>
        <input className="pm-find" value={q} onChange={e => setQ(e.target.value)} placeholder="Find a product" aria-label="Find a product" />
        <ul>{prods.map(p => row("product", p.id, p.name))}</ul>
        {prods.length === 0 && <p className="su-muted">No product matches.</p>}</section>
    </div>
  );
}
