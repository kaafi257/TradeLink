import { useState } from "react";
import { Eye, EyeOff, Globe, Megaphone, MessageCircle, Plus, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { DataTable, PageHeading, SummaryStrip } from "../../components/ui";
import { StatusChip } from "../Records";
import { requireSupabase } from "../../lib/supabase";
import { useAdmin } from "../AdminData";
import { ErrorNote, Form, Modal, callRpc, dateOf, useAction, useLoad } from "../suite";

type Banner = { id: string; message: string; link: string | null; active: boolean; starts_at: string | null; ends_at: string | null; sort_order: number };
type Day = { day: string; visits: number };

const liveNow = (b: Banner) => b.active && (!b.starts_at || new Date(b.starts_at) <= new Date()) && (!b.ends_at || new Date(b.ends_at) > new Date());

export default function Website() {
  const { can, search, profile } = useAdmin();
  const [modal, setModal] = useState(false);
  const { busy, run } = useAction();
  const edit = can("website.manage");
  const banners = useLoad(async () => {
    const { data, error } = await requireSupabase().from("site_banners").select("*").order("sort_order").order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as Banner[];
  }, []);
  const traffic = useLoad(() => callRpc<Day[]>("site_traffic", { p_days: 14 }), []);
  const rows = banners.data ?? [];
  const days = traffic.data ?? [];
  const max = Math.max(1, ...days.map(d => Number(d.visits)));
  const total = days.reduce((a, d) => a + Number(d.visits), 0);
  const s = search.toLowerCase();
  const toggle = (b: Banner) => void run(async () => { const { error } = await requireSupabase().from("site_banners").update({ active: !b.active }).eq("id", b.id); if (error) throw error; banners.reload(); }, b.active ? "Banner turned off." : "Banner turned on.");
  const remove = (b: Banner) => { if (!window.confirm("Delete this banner?")) return; void run(async () => { const { error } = await requireSupabase().from("site_banners").delete().eq("id", b.id); if (error) throw error; banners.reload(); }, "Banner deleted."); };

  return (
    <>
      <PageHeading title="Website Management" sub="Announcement banners and traffic for the public website." action={edit ? <button className="btn green" onClick={() => setModal(true)}><Plus size={16} /> New banner</button> : undefined} />
      <ErrorNote text={banners.error} />
      <SummaryStrip items={[
        { icon: <Megaphone />, tone: "mint", value: rows.filter(liveNow).length, label: "Live banners" },
        { icon: <Globe />, tone: "blue", value: total, label: "Visits, last 14 days" },
      ]} />
      <div className="su-card" style={{ marginBottom: 14 }}>
        <h3><span>Visits per day</span><span className="su-muted">last 14 days</span></h3>
        <ErrorNote text={traffic.error} />
        <div className="su-chart" role="img" aria-label={`${total} visits in the last 14 days`}>{days.map(d => <i key={d.day} title={`${d.day}: ${Number(d.visits)}`} style={{ height: `${Math.max(3, (Number(d.visits) / max) * 100)}%` }} />)}</div>
      </div>
      <DataTable headers={["Message", "Link", "Shows", "Status", "Actions"]} isEmpty={!rows.length} empty={banners.loading ? "Loading…" : "No banners yet. A live banner appears at the top of the website."}>
        {rows.filter(b => b.message.toLowerCase().includes(s)).map(b => (
          <tr key={b.id}><td><b>{b.message}</b></td><td>{b.link || "—"}</td><td>{b.starts_at || b.ends_at ? `${dateOf(b.starts_at)} → ${b.ends_at ? dateOf(b.ends_at) : "no end"}` : "Always"}</td>
            <td>{liveNow(b) ? <StatusChip tone="good">Live</StatusChip> : <StatusChip tone="muted">{b.active ? "Scheduled / ended" : "Off"}</StatusChip>}</td>
            <td>{edit && <span className="su-row" style={{ flexWrap: "nowrap" }}>
              <button className="su-ico-btn" disabled={busy} onClick={() => toggle(b)}>{b.active ? <EyeOff size={14} /> : <Eye size={14} />}{b.active ? "Turn off" : "Turn on"}</button>
              <button className="su-ico-btn bad" disabled={busy} aria-label="Delete banner" onClick={() => remove(b)}><Trash2 size={14} /></button></span>}</td></tr>
        ))}
      </DataTable>
      <p className="su-muted" style={{ marginTop: 12 }}><MessageCircle size={13} /> Phone, WhatsApp and address shown on the website are set in <Link to="/admin/communication">Communication</Link>; products, industries and categories in <Link to="/admin/categories">Categories</Link>.</p>
      {modal && <NewBanner uid={profile.id} onClose={() => setModal(false)} onDone={() => { setModal(false); banners.reload(); }} />}
    </>
  );
}

function NewBanner({ uid, onClose, onDone }: { uid: string; onClose: () => void; onDone: () => void }) {
  const { busy, run } = useAction();
  const [message, setMessage] = useState("");
  const [link, setLink] = useState("");
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const submit = async () => {
    const ok = await run(async () => {
      const { error } = await requireSupabase().from("site_banners").insert({
        message: message.trim(), link: link.trim() || null, starts_at: starts ? new Date(starts).toISOString() : null, ends_at: ends ? new Date(ends).toISOString() : null, created_by: uid,
      });
      if (error) throw error;
    }, "Banner saved.");
    if (ok) onDone();
  };
  return (
    <Modal title="New banner" kicker="WEBSITE" onClose={onClose}>
      <Form onSubmit={() => void submit()} busy={busy} submit="Save banner">
        <label>Message<input required minLength={3} maxLength={160} value={message} onChange={e => setMessage(e.target.value)} placeholder="Free delivery on orders this week" /></label>
        <label>Link (optional)<input value={link} pattern="(/|https://).*" title="Start with / or https://" onChange={e => setLink(e.target.value)} placeholder="/industry/…  or  https://…" /></label>
        <div className="two"><label>Starts (optional)<input type="datetime-local" value={starts} onChange={e => setStarts(e.target.value)} /></label><label>Ends (optional)<input type="datetime-local" value={ends} onChange={e => setEnds(e.target.value)} /></label></div>
      </Form>
    </Modal>
  );
}
