import { PageHeading } from "../../components/ui";

export default function SettingsPage() {
  return (
    <>
      <PageHeading title="Settings" sub="Business configuration and platform preferences." />
      <div className="settings-grid">
        <div className="setting-card"><h3>Business profile</h3><p>TradeLink Food Wholesale</p><small>Contact channels are set with VITE_CONTACT_* environment variables.</small></div>
        <div className="setting-card"><h3>Regional preferences</h3><p>Currency: ETB</p><small>Interface language: English</small></div>
        <div className="setting-card"><h3>Warehouse</h3><p>One central warehouse</p><small>Warehouse details are not configurable in the app yet.</small></div>
        <div className="setting-card"><h3>Security</h3><p>Supabase authentication + row-level security</p><small>Access is governed by database policies and staff roles.</small></div>
      </div>
    </>
  );
}
