import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Check, Clock, Factory, Power, ShieldCheck, Users } from "lucide-react";
import { PageHeading } from "../../components/ui";
import { IconBtn, RecCard, RecordList, StatusChip, initialsOf } from "../Records";
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

  return (
    <>
      <PageHeading title="Staff Management" sub="Invite employees and manage their access roles." />
      <div className="info-banner"><ShieldCheck /> Invite by email, or set a password.</div>
      <form className="inline-form" onSubmit={invite}>
        <label>Full name<input name="full_name" required placeholder="Staff member name" /></label>
        <label>Email<input name="email" type="email" required placeholder="name@company.com" /></label>
        <label>Password (optional)<input name="password" type="text" minLength={8} autoComplete="off" placeholder="Leave empty to email an invite" /></label>
        <label>Role<select name="role" defaultValue="staff">{assignable.map(r => <option key={r}>{r}</option>)}</select></label>
        <button className="btn green" disabled={busy}>{busy ? "Saving…" : "Add staff"}</button>
      </form>
      <RecordList isEmpty={!rows.length} empty="No staff yet" icon={<Users />}>
        {rows.map((m, i) => (
          <RecCard key={m.id} i={i} tone={m.active ? "good" : "muted"} initials={initialsOf(m.full_name || m.email)} title={m.full_name || "—"} sub={m.email}
            control={canEdit(m)
              ? <select className="status-select info" aria-label={`Role of ${m.email}`} value={m.role} onChange={e => void change(m, { role: e.target.value as Role })}>
                  {[...assignable, ...(assignable.includes(m.role) ? [] : [m.role])].map(r => <option key={r}>{r}</option>)}
                </select>
              : <span className="role-pill"><ShieldCheck size={14} />{m.role}</span>}
            status={<StatusChip tone={m.active ? "good" : "muted"} icon={m.active ? <Check size={14} /> : <Power size={14} />}>{m.active ? "Active" : "Off"}</StatusChip>}
            actions={canEdit(m) ? <IconBtn tone={m.active ? "red" : "green"} icon={<Power size={17} />} label={m.active ? "Deactivate" : "Activate"} onClick={() => void change(m, { active: !m.active })} /> : undefined} />
        ))}
      </RecordList>
      <h3 className="staff-sub"><Factory size={18} /> Suppliers <small>{sups.length}</small></h3>
      <RecordList isEmpty={!sups.length} empty="No supplier accounts yet" icon={<Factory />}>
        {sups.filter(x => `${x.name} ${x.email ?? ""} ${x.owner_name ?? ""}`.toLowerCase().includes(s)).map((x, i) => {
          const st = x.status ?? "pending";
          const tone = st === "approved" ? "good" : st === "pending" ? "warn" : "muted";
          return (
            <RecCard key={x.id} i={i} tone={tone} initials={initialsOf(x.name)} title={x.name} sub={x.email || x.owner_name || "—"}
              control={<span className="role-pill"><Factory size={14} />supplier</span>}
              status={<StatusChip tone={tone} icon={st === "approved" ? <Check size={14} /> : st === "pending" ? <Clock size={14} /> : <Power size={14} />}>{st === "approved" ? "Approved" : st === "pending" ? "Pending" : st}</StatusChip>}
              actions={<Link className="role-pill" to="/admin/verification">Review</Link>} />);
        })}
      </RecordList>
    </>
  );
}
