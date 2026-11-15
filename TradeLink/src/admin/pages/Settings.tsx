import { useEffect, useState } from "react";
import { PageHeading } from "../../components/ui";
import { PERMISSIONS, errorText, requireSupabase, type Role } from "../../lib/supabase";
import { useAdmin } from "../AdminData";

const ROLES: Role[] = ["manager", "sales", "inventory", "delivery", "staff"];

export default function SettingsPage() {
  const { profile, notify, reload } = useAdmin();
  const [granted, setGranted] = useState<Set<string> | null>(null);
  const isOwner = profile.role === "owner";
  const key = (r: string, p: string) => `${r}|${p}`;

  const load = async () => {
    const { data, error } = await requireSupabase().from("role_permissions").select("role, permission");
    if (error) { notify(errorText(error, "Could not load permissions")); return; }
    setGranted(new Set((data ?? []).map(r => key(r.role as string, r.permission as string))));
  };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async (role: Role, permission: string, on: boolean) => {
    try {
      const t = requireSupabase().from("role_permissions");
      const { error } = on ? await t.insert({ role, permission }) : await t.delete().eq("role", role).eq("permission", permission);
      if (error) throw error;
      await load();
      await reload();
    } catch (e) { notify(errorText(e, "Could not change the permission")); }
  };

  return (
    <>
      <PageHeading title="Settings" sub="Business configuration and platform preferences." />
      <div className="settings-grid">
        <div className="setting-card"><h3>Business profile</h3><p>TradeLink Food Wholesale</p><small>Contact channels are set on the Communication page.</small></div>
        <div className="setting-card"><h3>Regional preferences</h3><p>Currency: ETB</p><small>Interface language: English</small></div>
        <div className="setting-card"><h3>Warehouse</h3><p>One central warehouse</p><small>Warehouse details are not configurable in the app yet.</small></div>
        <div className="setting-card"><h3>Security</h3><p>Supabase authentication + row-level security</p><small>Access is governed by database policies, staff roles and the permissions below.</small></div>
      </div>
      <div className="table-panel" style={{ marginTop: 18 }}>
        <div className="table-toolbar"><b>Permissions by role</b><span>{isOwner ? "The owner always has every permission." : "Only the owner can change these."}</span></div>
        <div className="table-scroll"><table>
          <thead><tr><th>Action</th>{ROLES.map(r => <th key={r}>{r}</th>)}</tr></thead>
          <tbody>{PERMISSIONS.map(p => (
            <tr key={p.key}><td>{p.label}</td>{ROLES.map(r => (
              <td key={r}><input type="checkbox" aria-label={`${r}: ${p.label}`} disabled={!isOwner || granted === null} checked={granted?.has(key(r, p.key)) ?? false} onChange={e => void toggle(r, p.key, e.target.checked)} /></td>
            ))}</tr>
          ))}</tbody>
        </table></div>
      </div>
    </>
  );
}
