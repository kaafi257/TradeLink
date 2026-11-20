import { useMemo, useState } from "react";
import { CheckCircle2, Megaphone, Pause, Pencil, Play, Plus, Power, Send, Square, Ticket, Trash2, Undo2 } from "lucide-react";
import { CampaignCard, CampaignForm, CouponCard, CouponForm, Seg } from "../../components/promo/PromoUI";
import { STATUS_LABEL, STATUS_ORDER, rpc, type Coupon, type CouponResult, type Promo, type PromoResult, type PromoStatus } from "../../lib/promo";
import { requireSupabase } from "../../lib/supabase";
import { useSupplier } from "./context";
import { Modal, Spinner, useLoad } from "./ops";

type Mine = { id: string; name: string; retail_price: number | null };

export default function Promotions() {
  const { supplier } = useSupplier();
  const [tab, setTab] = useState<"campaigns" | "coupons">("campaigns");
  const [filter, setFilter] = useState<PromoStatus | "all">("all");
  const [promoForm, setPromoForm] = useState<Promo | null | "new">(null);
  const [couponForm, setCouponForm] = useState<Coupon | null | "new">(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const sid = supplier?.id;

  const promos = useLoad(async () => {
    const { data, error } = await requireSupabase().from("promotions").select("*, promotion_items(product_id)").order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as Promo[];
  }, [sid]);
  const coupons = useLoad(async () => {
    const { data, error } = await requireSupabase().from("coupons").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as Coupon[];
  }, [sid]);
  const pres = useLoad(async () => (await rpc<PromoResult[]>("promotion_results")) ?? [], [sid]);
  const cres = useLoad(async () => (await rpc<CouponResult[]>("coupon_results")) ?? [], [sid]);
  const mine = useLoad(async () => {
    if (!sid) return [] as Mine[];
    const { data, error } = await requireSupabase().from("public_products").select("id,name,retail_price").eq("supplier_id", sid).order("name");
    if (error) throw error;
    return (data ?? []) as Mine[];
  }, [sid]);
  const reload = () => { promos.reload(); coupons.reload(); pres.reload(); cres.reload(); };

  const rows = promos.data ?? [];
  const crow = coupons.data ?? [];
  const pr = new Map((pres.data ?? []).map(r => [r.promotion_id, r]));
  const cr = new Map((cres.data ?? []).map(r => [r.coupon_id, r]));
  const counts = useMemo(() => { const m = new Map<string, number>(); rows.forEach(r => m.set(r.status, (m.get(r.status) ?? 0) + 1)); return m; }, [rows]);
  const shown = rows.filter(r => filter === "all" || r.status === filter);
  const prodName = (id: string | null) => mine.data?.find(p => p.id === id)?.name ?? "removed";
  const scopeText = (p: Promo) => (p.scope === "product" ? `Product: ${prodName(p.product_id)}` : "My whole store");

  const go = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg({ ok: true, text: done }); reload(); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); }
  };
  const act = (id: string, action: string, done: string) => go(() => rpc("promotion_action", { p_id: id, p_action: action }), done);
  const cact = (id: string, action: string, done: string) => go(() => rpc("coupon_action", { p_id: id, p_action: action }), done);

  const promoActions = (r: Promo) => {
    if (r.owner !== "supplier") return <small className="sp-muted">Run by TradeLink on your products</small>;
    return (
      <>
        {r.status === "draft" && <>
          <button className="sp-btn line" onClick={() => setPromoForm(r)}><Pencil size={14} /> Edit</button>
          <button className="sp-btn primary" disabled={busy} onClick={() => void act(r.id, "submit", "Sent to TradeLink for approval.")}><Send size={14} /> Submit</button>
          <button className="sp-icon" aria-label="Delete draft" disabled={busy} onClick={() => void act(r.id, "delete", "Draft deleted.")}><Trash2 size={16} /></button>
        </>}
        {r.status === "pending" && <button className="sp-btn line" disabled={busy} onClick={() => void act(r.id, "withdraw", "Withdrawn. It is a draft again.")}><Undo2 size={14} /> Withdraw</button>}
        {r.status === "scheduled" && <button className="sp-btn line" disabled={busy} onClick={() => void act(r.id, "cancel", "Cancelled. It is a draft again.")}><Undo2 size={14} /> Cancel</button>}
        {r.status === "active" && <>
          <button className="sp-btn line" disabled={busy} onClick={() => void act(r.id, "pause", "Paused. Earlier prices are back.")}><Pause size={14} /> Pause</button>
          <button className="sp-btn line" disabled={busy} onClick={() => void act(r.id, "end", "Ended.")}><Square size={14} /> End</button>
        </>}
        {r.status === "paused" && (r.paused_by === "store"
          ? <small className="sp-muted">Paused by TradeLink</small>
          : <><button className="sp-btn primary" disabled={busy} onClick={() => void act(r.id, "resume", "Resumed.")}><Play size={14} /> Resume</button>
              <button className="sp-btn line" disabled={busy} onClick={() => void act(r.id, "end", "Ended.")}><Square size={14} /> End</button></>)}
      </>
    );
  };
  const couponActions = (c: Coupon) => (
    <>
      {c.approval === "draft" && <>
        <button className="sp-btn line" onClick={() => setCouponForm(c)}><Pencil size={14} /> Edit</button>
        <button className="sp-btn primary" disabled={busy} onClick={() => void cact(c.id, "submit", "Sent to TradeLink for approval.")}><Send size={14} /> Submit</button>
      </>}
      {c.approval === "pending" && <button className="sp-btn line" disabled={busy} onClick={() => void cact(c.id, "withdraw", "Withdrawn. It is a draft again.")}><Undo2 size={14} /> Withdraw</button>}
      {c.approval === "approved" && <button className="sp-btn line" disabled={busy} onClick={() => void cact(c.id, c.active ? "pause" : "resume", c.active ? "Coupon paused." : "Coupon is live again.")}><Power size={14} /> {c.active ? "Pause" : "Resume"}</button>}
      {!(cr.get(c.id)?.uses) && (c.approval === "draft" || c.approval === "approved") && <button className="sp-icon" aria-label="Delete coupon" disabled={busy} onClick={() => void cact(c.id, "delete", "Coupon deleted.")}><Trash2 size={16} /></button>}
    </>
  );

  if (!supplier) return null;
  const loading = promos.loading && coupons.loading;
  const err = promos.error || coupons.error;
  return (
    <>
      <div className="sp-toolbar">
        <Seg value={tab} onChange={setTab} items={[{ id: "campaigns", label: `Campaigns${rows.length ? ` (${rows.length})` : ""}`, icon: <Megaphone size={15} /> }, { id: "coupons", label: `Coupons${crow.length ? ` (${crow.length})` : ""}`, icon: <Ticket size={15} /> }]} />
        <span style={{ flex: 1 }} />
        <button className="sp-btn primary" onClick={() => (tab === "campaigns" ? setPromoForm("new") : setCouponForm("new"))}><Plus size={16} /> {tab === "campaigns" ? "New campaign" : "New coupon"}</button>
      </div>
      {msg && <p className={`sp-note ${msg.ok ? "" : "err"}`} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
      {err && <p className="sp-note err" role="alert">{err}</p>}
      {loading ? <Spinner /> : tab === "campaigns" ? <>
        {rows.length > 0 && (
          <div className="pm-chips" role="group" aria-label="Filter by status">
            <button className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>All <i>{rows.length}</i></button>
            {STATUS_ORDER.filter(st => counts.get(st)).map(st => <button key={st} className={filter === st ? "on" : ""} onClick={() => setFilter(st)}>{STATUS_LABEL[st]} <i>{counts.get(st)}</i></button>)}
          </div>
        )}
        {shown.length === 0 ? <div className="pm-empty"><Megaphone size={26} />{rows.length ? "No campaign has that status." : "No campaigns yet. Make a discount for your store or one product, then send it to TradeLink for approval."}</div>
          : <div className="pm-grid">{shown.map(r => <CampaignCard key={r.id} p={r} scopeText={scopeText(r)} result={pr.get(r.id)} actions={promoActions(r)} />)}</div>}
        <p className="sp-muted" style={{ marginTop: 14 }}><CheckCircle2 size={13} style={{ verticalAlign: "-2px" }} /> Campaigns go live only after TradeLink approves them. Sales change the retail price shown on the marketplace; wholesale prices are never touched.</p>
      </> : <>
        {crow.length === 0 ? <div className="pm-empty"><Ticket size={26} />No coupons yet. A coupon takes money off your items when a customer enters the code on a request.</div>
          : <div className="pm-grid">{crow.map(c => <CouponCard key={c.id} c={c} used={cr.get(c.id)?.uses} result={cr.get(c.id)} actions={couponActions(c)} />)}</div>}
        <p className="sp-muted" style={{ marginTop: 14 }}>Your coupon only discounts your own products. Each phone number can use a code once.</p>
      </>}

      {promoForm && <Modal title={promoForm === "new" ? "New campaign" : "Edit campaign"} onClose={() => setPromoForm(null)} wide>
        <CampaignForm role="supplier" initial={promoForm === "new" ? null : promoForm} products={(mine.data ?? []).map(p => ({ id: p.id, name: p.name, retail: Number(p.retail_price) > 0 }))}
          onCancel={() => setPromoForm(null)} onDone={() => { setPromoForm(null); setMsg({ ok: true, text: "Saved as a draft. Submit it when you are ready." }); reload(); }} />
      </Modal>}
      {couponForm && <Modal title={couponForm === "new" ? "New coupon" : "Edit coupon"} onClose={() => setCouponForm(null)} wide>
        <CouponForm role="supplier" initial={couponForm === "new" ? null : couponForm} onCancel={() => setCouponForm(null)}
          onDone={() => { setCouponForm(null); setMsg({ ok: true, text: "Saved as a draft. Submit it when you are ready." }); reload(); }} />
      </Modal>}
    </>
  );
}
