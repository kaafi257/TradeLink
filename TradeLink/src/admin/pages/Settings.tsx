import { PageHeading } from "../../components/ui";

export default function SettingsPage() {
  return (
    <>
      <PageHeading title="Settings" sub="Business configuration and platform preferences." />
      <div className="settings-grid">
        <div className="setting-card"><h3>Business profile</h3><p>TradeLink Food Wholesale</p><small>Business name, contact details and brand identity.</small></div>
        <div className="setting-card"><h3>Regional preferences</h3><p>Currency: ETB</p><small>Languages: English · Somali · Amharic</small></div>
        <div className="setting-card"><h3>Warehouse</h3><p>One central warehouse</p><small>Configure the main warehouse details in your database.</small></div>
        <div className="setting-card"><h3>Security</h3><p>Supabase authentication + row-level security</p><small>Access is governed by database policies and staff roles.</small></div>
      </div>
    </>
  );
}
