import { useEffect, useState } from "react";
import { Building2, Globe, Lock, ShieldCheck, Warehouse } from "lucide-react";
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
        <div className="setting-card"><span className="sc-ico"><Building2 /></span><div><h3>Business</h3><p>TradeLink Food Wholesale</p></div></div>
        <div className="setting-card"><span className="sc-ico"><Globe /></span><div><h3>Region</h3><p>ETB · English</p></div></div>
        <div className="setting-card"><span className="sc-ico"><Warehouse /></span><div><h3>Warehouse</h3><p>Central</p></div></div>
        <div className="setting-card"><span className="sc-ico"><ShieldCheck /></span><div><h3>Security</h3><p>Role-based access</p></div></div>
      </div>
      <div className="table-panel" style={{ marginTop: 18 }}>
        <div className="table-toolbar"><b>Permissions</b><span className="lock-note">{isOwner ? <ShieldCheck size={16} /> : <Lock size={16} />}</span></div>
        <div className="table-scroll"><table className="rt rt-m">
          <thead><tr><th>Action</th>{ROLES.map(r => <th key={r}>{r}</th>)}</tr></thead>
          <tbody>{PERMISSIONS.map(p => (
            <tr key={p.key}><td data-label="Action">{p.label}</td>{ROLES.map(r => (
              <td key={r} data-label={r}><input type="checkbox" aria-label={`${r}: ${p.label}`} disabled={!isOwner || granted === null} checked={granted?.has(key(r, p.key)) ?? false} onChange={e => void toggle(r, p.key, e.target.checked)} /></td>
            ))}</tr>
          ))}</tbody>
        </table></div>
      </div>
    </>
  );
}
