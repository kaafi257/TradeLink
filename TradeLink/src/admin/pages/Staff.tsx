import { useState, type FormEvent } from "react";
import { ShieldCheck } from "lucide-react";
import { DataTable, PageHeading } from "../../components/ui";
import { logActivity, requireSupabase, type Profile, type Role } from "../../lib/supabase";
import { useAdmin } from "../AdminData";

const ALL_ROLES: Role[] = ["manager", "sales", "inventory", "delivery", "staff"];

export default function Staff() {
  const { staff, profile, search, notify, reload } = useAdmin();
  const isOwner = profile.role === "owner";
  // Mirrors the database rule: only an owner can grant or change the manager/owner roles.
  const assignable: Role[] = isOwner ? ALL_ROLES : ALL_ROLES.filter(r => r !== "manager");
  const [busy, setBusy] = useState(false);
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
        body: { email: String(f.get("email")).trim(), full_name: String(f.get("full_name")).trim(), role: String(f.get("role")) },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      notify("Invitation sent.");
      form.reset();
      await reload();
    } catch (err) { notify(err instanceof Error ? err.message : "Could not send invitation"); }
    finally { setBusy(false); }
  };

  const change = async (m: Profile, patch: Partial<Pick<Profile, "role" | "active">>, what: string) => {
    try {
      const { error } = await requireSupabase().from("profiles").update(patch).eq("id", m.id);
      if (error) throw error;
      await logActivity("staff_updated", "staff", `${what} for ${m.full_name || m.email}`);
      notify("Staff member updated.");
      await reload();
    } catch (err) { notify(err instanceof Error ? err.message : "Update failed"); }
  };

  return (
    <>
      <PageHeading title="Staff Management" sub="Invite employees and manage their access roles." />
      <div className="info-banner"><ShieldCheck /> Invitations are sent by a secure server function. Only the owner can grant the manager role.</div>
      <form className="inline-form" onSubmit={invite}>
        <label>Full name<input name="full_name" required placeholder="Staff member name" /></label>
        <label>Email<input name="email" type="email" required placeholder="name@company.com" /></label>
        <label>Role<select name="role" defaultValue="staff">{assignable.map(r => <option key={r}>{r}</option>)}</select></label>
        <button className="btn green" disabled={busy}>{busy ? "Sending…" : "Send invitation"}</button>
      </form>
      <DataTable headers={["Staff member", "Email", "Role", "Account status"]} isEmpty={!rows.length} empty="No staff profiles found.">
        {rows.map(m => (
          <tr key={m.id}>
            <td><b>{m.full_name || "—"}</b></td><td>{m.email}</td>
            <td>{canEdit(m)
              ? <select aria-label={`Role of ${m.email}`} value={m.role} onChange={e => void change(m, { role: e.target.value as Role }, `Role changed to ${e.target.value}`)}>
                  {[...assignable, ...(assignable.includes(m.role) ? [] : [m.role])].map(r => <option key={r}>{r}</option>)}
                </select>
              : <span className="role-pill">{m.role}</span>}</td>
            <td><span className={`status ${m.active ? "good" : "muted"}`}>{m.active ? "Active" : "Inactive"}</span>{" "}
              {canEdit(m) && <button className="btn outline" onClick={() => void change(m, { active: !m.active }, m.active ? "Account deactivated" : "Account activated")}>{m.active ? "Deactivate" : "Activate"}</button>}</td>
          </tr>
        ))}
      </DataTable>
    </>
  );
}
