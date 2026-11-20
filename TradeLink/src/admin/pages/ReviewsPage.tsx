import { useState } from "react";
import { BadgeCheck, Eye, EyeOff, MessageSquareQuote, Plus, Star } from "lucide-react";
import { PageHeading, SummaryStrip } from "../../components/ui";
import { StatusChip, type Tone } from "../Records";
import { requireSupabase } from "../../lib/supabase";
import { useAdmin } from "../AdminData";
import { ErrorNote, Form, Modal, Stars, Tabs, callRpc, dateOf, label, useAction, useLoad } from "../suite";

type Rev = { id: string; product_id: string; customer_name: string; rating: number; comment: string | null; verified_purchase: boolean; status: string; reply: string | null; created_at: string; products: { name: string } | null };
const TONE: Record<string, Tone> = { pending: "warn", published: "good", hidden: "muted" };

export default function ReviewsPage() {
  const { can, search } = useAdmin();
  const [tab, setTab] = useState<"pending" | "published" | "hidden">("pending");
  const [modal, setModal] = useState(false);
  const [reply, setReply] = useState<Rev | null>(null);
  const { busy, run } = useAction();
  const list = useLoad(async () => {
    const { data, error } = await requireSupabase().from("product_reviews").select("*, products(name)").order("created_at", { ascending: false }).limit(300);
    if (error) throw error;
    return (data ?? []) as unknown as Rev[];
  }, []);
  const rows = list.data ?? [];
  const pub = rows.filter(r => r.status === "published");
  const avg = pub.length ? pub.reduce((a, r) => a + r.rating, 0) / pub.length : 0;
  const edit = can("reviews.moderate");
  const s = search.toLowerCase();
  const shown = rows.filter(r => r.status === tab && `${r.customer_name} ${r.products?.name ?? ""} ${r.comment ?? ""}`.toLowerCase().includes(s));
  const setStatus = (r: Rev, status: string, text: string) => void run(async () => { await callRpc("moderate_review", { p_id: r.id, p_status: status, p_reply: r.reply }); list.reload(); }, text);

  return (
    <>
      <PageHeading title="Reviews & Ratings" sub="Record customer feedback and choose what the public sees." action={edit ? <button className="btn green" onClick={() => setModal(true)}><Plus size={16} /> Add review</button> : undefined} />
      <ErrorNote text={list.error} />
      <SummaryStrip items={[
        { icon: <Star />, tone: "gold", value: pub.length ? avg.toFixed(1) : "—", label: "Average (published)" },
        { icon: <MessageSquareQuote />, tone: "blue", value: rows.filter(r => r.status === "pending").length, label: "Waiting" },
        { icon: <Eye />, tone: "mint", value: pub.length, label: "Published" },
        { icon: <EyeOff />, tone: "red", value: rows.filter(r => r.status === "hidden").length, label: "Hidden" },
      ]} />
      <Tabs label="Review views" value={tab} onChange={setTab} tabs={[{ id: "pending", label: "Waiting", icon: <MessageSquareQuote /> }, { id: "published", label: "Published", icon: <Eye /> }, { id: "hidden", label: "Hidden", icon: <EyeOff /> }]} />
      {!shown.length ? <div className="empty-state"><Star size={34} /><p>{list.loading ? "Loading…" : "No reviews here."}</p></div> : (
        <div className="su-grid">
          {shown.map(r => (
            <article className="su-card" key={r.id}>
              <h3>{r.products?.name ?? "Product"}<StatusChip tone={TONE[r.status] ?? "muted"}>{label(r.status)}</StatusChip></h3>
              <div className="su-row"><Stars value={r.rating} />{r.verified_purchase && <StatusChip tone="good" icon={<BadgeCheck size={14} />}>Verified purchase</StatusChip>}</div>
              <p>{r.comment || <i>No comment</i>}</p>
              {r.reply && <p className="su-msg"><small>Our reply</small>{r.reply}</p>}
              <p className="su-muted">{r.customer_name} · {dateOf(r.created_at)}</p>
              {edit && <div className="su-row end">
                <button className="su-ico-btn" onClick={() => setReply(r)}>Reply</button>
                {r.status !== "published" && <button className="su-ico-btn good" disabled={busy} onClick={() => setStatus(r, "published", "Review published.")}><Eye size={14} />Publish</button>}
                {r.status !== "hidden" && <button className="su-ico-btn bad" disabled={busy} onClick={() => setStatus(r, "hidden", "Review hidden.")}><EyeOff size={14} />Hide</button>}
              </div>}
            </article>
          ))}
        </div>
      )}
      {modal && <AddReview onClose={() => setModal(false)} onDone={() => { setModal(false); list.reload(); }} />}
      {reply && <ReplyModal r={reply} onClose={() => setReply(null)} onDone={() => { setReply(null); list.reload(); }} />}
    </>
  );
}

function AddReview({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { products, orders } = useAdmin();
  const { busy, run } = useAction();
  const [orderId, setOrderId] = useState("");
  const [prod, setProd] = useState("");
  const [name, setName] = useState("");
  const [rating, setRating] = useState("5");
  const [comment, setComment] = useState("");
  const order = orders.find(o => o.id === orderId);
  const names = new Set((order?.order_items ?? []).map(i => i.product_name));
  const choices = order ? products.filter(p => names.has(p.name)) : products.filter(p => p.active);
  const pick = (id: string) => { setOrderId(id); setProd(""); const o = orders.find(x => x.id === id); if (o) setName(o.customer_name); };
  const submit = async () => {
    const ok = await run(() => callRpc("add_review", { p_product: prod, p_name: name, p_rating: Number(rating), p_comment: comment, p_order: orderId || null }), "Saved. Publish it when you are happy with it.");
    if (ok) onDone();
  };
  return (
    <Modal title="Add a customer review" kicker="REVIEWS" onClose={onClose}>
      <Form onSubmit={() => void submit()} busy={busy} submit="Save review">
        <label>Order (links it to a real purchase)<select value={orderId} onChange={e => pick(e.target.value)}><option value="">No order (not verified)</option>{orders.filter(o => o.status !== "cancelled").map(o => <option key={o.id} value={o.id}>{o.order_number} · {o.customer_name}</option>)}</select></label>
        <label>Product<select required value={prod} onChange={e => setProd(e.target.value)}><option value="">Choose…</option>{choices.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <div className="two">
          <label>Customer name<input required minLength={2} maxLength={80} value={name} onChange={e => setName(e.target.value)} /></label>
          <label>Rating<select value={rating} onChange={e => setRating(e.target.value)}>{[5, 4, 3, 2, 1].map(n => <option key={n} value={n}>{n} star{n > 1 ? "s" : ""}</option>)}</select></label>
        </div>
        <label>What they said<textarea maxLength={1000} value={comment} onChange={e => setComment(e.target.value)} /></label>
      </Form>
    </Modal>
  );
}

function ReplyModal({ r, onClose, onDone }: { r: Rev; onClose: () => void; onDone: () => void }) {
  const { busy, run } = useAction();
  const [text, setText] = useState(r.reply ?? "");
  const submit = async () => { const ok = await run(() => callRpc("moderate_review", { p_id: r.id, p_status: r.status, p_reply: text }), "Reply saved."); if (ok) onDone(); };
  return (
    <Modal title="Reply to review" kicker={r.customer_name.toUpperCase()} onClose={onClose}>
      <Form onSubmit={() => void submit()} busy={busy} submit="Save reply"><label>Public reply<textarea maxLength={600} value={text} onChange={e => setText(e.target.value)} /></label></Form>
    </Modal>
  );
}
