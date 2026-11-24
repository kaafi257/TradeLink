import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Check, Clock, Factory, Power, ShieldCheck, UserPlus, Users } from "lucide-react";
import { initialsOf } from "../Records";
import { Tabs } from "../suite";
import "./payments.css";
import { requireSupabase, type Profile, type Role, type Supplier } from "../../lib/supabase";
import { useAdmin } from "../AdminData";

/** supabase-js hides the function's own message behind "non-2xx status code"; dig the real reason out. */
async function inviteError(error: unknown): Promise<string> {
  const e = error as { name?: string; message?: string; context?: unknown };
  if (e?.context instanceof Response) {
    try { const body = await e.context.clone().json(); if (body?.error) return String(body.error); } catch { /* not JSON */ }
    if (e.context.status === 404) return "The invite-staff function is not deployed yet. Deploy it with: supabase functions deploy invite-staff";
    if (e.context.status === 401) return "Your session has expired. Sign in again and retry.";
  }
  if (e?.name === "FunctionsFetchError") return "Could not reach the invite-staff function. Check that it is deployed and your connection is working.";
  return e?.message || "Could not send invitation";
}

const ALL_ROLES: Role[] = ["manager", "sales", "inventory", "delivery", "staff"];

export default function Staff() {
  const { staff, profile, search, notify, reload } = useAdmin();
  const isOwner = profile.role === "owner";
  // Mirrors the database rule: only an owner can grant or change the manager/owner roles.
  const assignable: Role[] = isOwner ? ALL_ROLES : ALL_ROLES.filter(r => r !== "manager");
  const [busy, setBusy] = useState(false);
  const [sups, setSups] = useState<Supplier[]>([]);
  useEffect(() => {
    void requireSupabase().from("suppliers").select("*").not("profile_id", "is", null).order("name").then(({ data }) => setSups((data ?? []) as Supplier[]));
  }, []);
  const s = search.toLowerCase();
  const rows = staff.filter(m => `${m.full_name} ${m.email} ${m.role}`.toLowerCase().includes(s));
  const canEdit = (m: Profile) => m.id !== profile.id && (isOwner ? m.role !== "owner" : !["owner", "manager"].includes(m.role));

  const invite = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setBusy(true);
    try {
      const { data, error } = await requireSupabase().functions.invoke("invite-staff", {
        body: { email: String(f.get("email")).trim(), full_name: String(f.get("full_name")).trim(), role: String(f.get("role")), password: String(f.get("password") ?? ""), redirect_to: `${window.location.origin}/set-password` },
      });
      if (error) throw new Error(await inviteError(error));
      if (data?.error) throw new Error(data.error);
      notify(String(f.get("password") ?? "") ? "Account created. Give them the email and password you typed." : "Invitation sent. They will get an email to set their password.");
      form.reset();
      await reload();
    } catch (err) { notify(err instanceof Error ? err.message : "Could not send invitation"); }
    finally { setBusy(false); }
  };

  const change = async (m: Profile, patch: Partial<Pick<Profile, "role" | "active">>) => {
    try {
      const { error } = await requireSupabase().from("profiles").update(patch).eq("id", m.id);
      if (error) throw error;
      notify("Staff member updated.");
      await reload();
    } catch (err) { notify(err instanceof Error ? err.message : "Update failed"); }
  };

  const [tab, setTab] = useState<"team" | "suppliers">("team");
  const [rf, setRf] = useState("all");
  const [adding, setAdding] = useState(false);
  const active = staff.filter(m => m.active).length;
  const roleN = (r: string) => staff.filter(m => m.role === r).length;
  const rowsR = rows.filter(m => rf === "all" || m.role === rf);
  const supsShown = sups.filter(x => `${x.name} ${x.email ?? ""} ${x.owner_name ?? ""}`.toLowerCase().includes(s));
  const filters = [["all", "All", staff.length], ...ALL_ROLES.filter(r => roleN(r) > 0).map(r => [r, r[0].toUpperCase() + r.slice(1), roleN(r)] as const)] as [string, string, number][];

  return (
    <div className="pm sop">
      <section className="pm-hero" aria-label="Team overview">
        <div className="pm-hero-top">
          <div><small>Team</small><h1>Staff Management</h1><p>Invite employees and manage their access roles.</p></div>
          {tab === "team" && <button className="pm-hero-btn" onClick={() => setAdding(a => !a)}><UserPlus size={16} /> {adding ? "Close" : "Add staff"}</button>}
        </div>
        <div className="pm-kpis">
          <div className="pm-kpi out"><span><Users /></span><small>Team members</small><b>{staff.length}</b></div>
          <div className="pm-kpi in"><span><Check /></span><small>Active</small><b>{active}</b></div>
          <div className="pm-kpi owe"><span><Power /></span><small>Off</small><b>{staff.length - active}</b></div>
          <div className="pm-kpi wait"><span><Factory /></span><small>Supplier accounts</small><b>{sups.length}</b></div>
        </div>
      </section>
      <Tabs label="Staff views" value={tab} onChange={setTab} tabs={[
        { id: "team", label: "Team", icon: <Users />, count: staff.length },
        { id: "suppliers", label: "Suppliers", icon: <Factory />, count: sups.length },
      ]} />

      {tab === "team" && <>
        {adding && (
          <form className="pm-form" onSubmit={invite}>
            <p className="pm-note"><ShieldCheck size={16} /> Invite by email, or set a password yourself.</p>
            <div className="pm-fgrid">
              <label>Full name<input name="full_name" required placeholder="Staff member name" /></label>
              <label>Email<input name="email" type="email" required placeholder="name@company.com" /></label>
              <label>Password <em>(optional)</em><input name="password" type="text" minLength={8} autoComplete="off" placeholder="Leave empty to email an invite" /></label>
              <label>Role<select name="role" defaultValue="staff">{assignable.map(r => <option key={r}>{r}</option>)}</select></label>
            </div>
            <button className="pm-go hot" disabled={busy}>{busy ? "Saving…" : "Add staff"}</button>
          </form>)}
        <div className="pm-filters" role="tablist" aria-label="Filter by role">
          {filters.map(([id, label, n]) => <button key={id} role="tab" aria-selected={rf === id} className={rf === id ? "on" : ""} onClick={() => setRf(id)}>{label}<i>{n}</i></button>)}
        </div>
        <div className="pm-list">
          {rowsR.map(m => (
            <div key={m.id} className="pm-card static so">
              <span className="pm-av">{initialsOf(m.full_name || m.email)}</span>
              <span className="pm-main"><b>{m.full_name || "—"}</b><small>{m.email}</small></span>
              <span className="pm-end"><span className={`pm-pill ${m.active ? "good" : "bad"}`}>{m.active ? "Active" : "Off"}</span></span>
              <span className="pm-acts">
                {canEdit(m)
                  ? <><select className="pm-sel" aria-label={`Role of ${m.email}`} value={m.role} onChange={e => void change(m, { role: e.target.value as Role })}>
                      {[...assignable, ...(assignable.includes(m.role) ? [] : [m.role])].map(r => <option key={r}>{r}</option>)}
                    </select>
                    <button className={`pm-go ${m.active ? "bad" : "hot"}`} onClick={() => void change(m, { active: !m.active })}><Power size={15} /> {m.active ? "Deactivate" : "Activate"}</button></>
                  : <span className="pm-pill info"><ShieldCheck size={12} />&nbsp;{m.role}</span>}
              </span>
            </div>))}
          {!rowsR.length && <div className="pm-empty"><Users /><b>{staff.length ? "Nothing matches" : "No staff yet"}</b></div>}
        </div>
      </>}

      {tab === "suppliers" && (
        <div className="pm-list">
          {supsShown.map(x => {
            const st = x.status ?? "pending";
            return (
              <div key={x.id} className="pm-card static so">
                <span className="pm-av">{initialsOf(x.name)}</span>
                <span className="pm-main"><b>{x.name}</b><small>{x.email || x.owner_name || "—"}</small></span>
                <span className="pm-end"><span className={`pm-pill ${st === "approved" ? "good" : st === "pending" ? "warn" : "bad"}`}>{st === "approved" ? "Approved" : st === "pending" ? "Pending" : st[0].toUpperCase() + st.slice(1)}</span></span>
                <span className="pm-acts"><Link className="pm-go" to="/admin/verification"><Clock size={15} /> Review</Link></span>
              </div>);
          })}
          {!supsShown.length && <div className="pm-empty"><Factory /><b>No supplier accounts yet</b></div>}
        </div>)}
    </div>
  );
}
