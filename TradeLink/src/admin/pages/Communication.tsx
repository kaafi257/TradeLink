import { useEffect, useState, type FormEvent } from "react";
import { Mail, MessageCircle, Phone } from "lucide-react";
import { DataTable, PageHeading } from "../../components/ui";
import { buildChannels, loadContact, waNumber, type Contact } from "../../lib/contact";
import { shortDate } from "../../lib/format";
import { errorText, requireSupabase, type Quote } from "../../lib/supabase";
import { useAdmin } from "../AdminData";

const TEMPLATES: { key: string; label: string; text: (name: string, ref: string) => string }[] = [
  { key: "quoted", label: "Your quote is ready", text: (n, r) => `Hello ${n}, this is TradeLink. Your wholesale quotation ${r} is ready. Please reply to confirm your order.` },
  { key: "details", label: "We need more details", text: (n, r) => `Hello ${n}, this is TradeLink about your quote request ${r}. Could you confirm the quantity and delivery location?` },
  { key: "delivery", label: "Delivery update", text: (n, r) => `Hello ${n}, this is TradeLink with an update on your order for quote ${r}. Our driver will contact you shortly.` },
];
const EMPTY: Contact = { phone: "", whatsapp: "", telegram: "", email: "", address: "", hours: "" };
const describe = (q: Quote) => q.quotation_items?.map(i => `${i.quantity} ${i.unit} ${i.product_name}`).join(", ") || "—";

export default function Communication() {
  const { profile, quotes, search, notify } = useAdmin();
  const canEdit = ["owner", "manager"].includes(profile.role);
  const [form, setForm] = useState<Contact>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tpl, setTpl] = useState(TEMPLATES[0].key);

  useEffect(() => {
    requireSupabase().from("contact_settings").select("*").maybeSingle().then(({ data, error }) => {
      if (error) { notify(errorText(error, "Could not load contact settings. Run migration 0004 in Supabase.")); return; }
      if (data) setForm({ phone: data.phone, whatsapp: data.whatsapp, telegram: data.telegram, email: data.email, address: data.address, hours: data.working_hours });
      setLoaded(true);
    });
  }, [notify]);

  const set = (k: keyof Contact) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const t = (v: string) => v.trim();
      const { error } = await requireSupabase().from("contact_settings").update({
        phone: t(form.phone), whatsapp: t(form.whatsapp), telegram: t(form.telegram).replace(/^https?:\/\/t\.me\//i, "").replace(/^@/, ""),
        email: t(form.email), address: t(form.address), working_hours: t(form.hours),
      }).eq("id", true);
      if (error) throw error;
      await loadContact();
      notify("Contact details saved. The website now shows them.");
    } catch (err) { notify(errorText(err, "Could not save contact details")); }
    finally { setBusy(false); }
  };

  const preview = buildChannels(form);
  const template = TEMPLATES.find(x => x.key === tpl) ?? TEMPLATES[0];
  const s = search.toLowerCase();
  const rows = quotes.filter(q => `${q.quote_number} ${q.customer_name} ${q.phone}`.toLowerCase().includes(s)).slice(0, 100);

  return (
    <>
      <PageHeading title="Communication" sub="Set the contact channels customers see on the website, and reply to customers in one tap." />
      <div className="table-panel" style={{ padding: 20 }}>
        <h3 style={{ marginTop: 0 }}>Business contact channels</h3>
        <form className="form-grid" onSubmit={save}>
          <label>Phone (calls)<input value={form.phone} onChange={set("phone")} disabled={!canEdit || !loaded} placeholder="+251 911 000 000" maxLength={40} /></label>
          <label>WhatsApp number<input value={form.whatsapp} onChange={set("whatsapp")} disabled={!canEdit || !loaded} placeholder="+251 911 000 000 (with country code)" maxLength={40} /></label>
          <label>Telegram username<input value={form.telegram} onChange={set("telegram")} disabled={!canEdit || !loaded} placeholder="tradelink_et (no @)" maxLength={80} /></label>
          <label>Email<input type="email" value={form.email} onChange={set("email")} disabled={!canEdit || !loaded} placeholder="sales@yourbusiness.com" maxLength={160} /></label>
          <label>Address<input value={form.address} onChange={set("address")} disabled={!canEdit || !loaded} placeholder="Warehouse address" maxLength={200} /></label>
          <label>Working hours<input value={form.hours} onChange={set("hours")} disabled={!canEdit || !loaded} placeholder="Mon–Sat, 8:00–18:00" maxLength={120} /></label>
          {canEdit
            ? <button className="btn green full" type="submit" disabled={busy || !loaded}>{busy ? "Saving…" : "Save contact details"}</button>
            : <p className="full inline-note">Only the owner or a manager can change these details.</p>}
        </form>
        <p className="inline-note">Channels left empty are hidden from the website. Customers see these as WhatsApp, Telegram and Call buttons on every product, in the header, and as floating buttons.</p>
        <div className="contact-pills-wrap"><small>Preview of what customers see</small>
          <div className="contact-pills">{preview.length ? preview.map(c => <a key={c.key} className={`pill pill-${c.key}`} href={c.href} target="_blank" rel="noopener noreferrer">{c.label}</a>) : <small>Nothing to show yet. Fill in at least one channel and save.</small>}</div>
        </div>
      </div>

      <h3 style={{ margin: "26px 0 10px" }}>Reply to customers</h3>
      <div className="inline-form" style={{ marginBottom: 12 }}>
        <label>Message to send<select value={tpl} onChange={e => setTpl(e.target.value)}>{TEMPLATES.map(x => <option key={x.key} value={x.key}>{x.label}</option>)}</select></label>
      </div>
      <DataTable headers={["Reference", "Customer", "Phone", "Request", "Received", "Contact"]} isEmpty={!rows.length} empty="No customer enquiries yet.">
        {rows.map(q => {
          const msg = encodeURIComponent(template.text(q.customer_name, q.quote_number));
          const tel = q.phone.replace(/[^\d+]/g, "");
          return (
            <tr key={q.id}>
              <td><b>{q.quote_number}</b></td><td>{q.customer_name}</td><td>{q.phone}</td><td>{describe(q)}</td><td>{shortDate(q.created_at)}</td>
              <td>
                <a className="pill pill-call" href={`tel:${tel}`}><Phone size={14} />Call</a>{" "}
                <a className="pill pill-whatsapp" target="_blank" rel="noopener noreferrer" href={`https://wa.me/${waNumber(q.phone)}?text=${msg}`}><MessageCircle size={14} />WhatsApp</a>
                {q.email && <>{" "}<a className="pill pill-telegram" href={`mailto:${q.email}?subject=${encodeURIComponent(`TradeLink quotation ${q.quote_number}`)}&body=${msg}`}><Mail size={14} />Email</a></>}
              </td>
            </tr>
          );
        })}
      </DataTable>
    </>
  );
}
