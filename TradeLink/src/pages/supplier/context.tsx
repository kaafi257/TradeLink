import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "../../lib/auth";
import { errorText, requireSupabase, type AppNotification, type Profile, type Supplier } from "../../lib/supabase";

type Ctx = {
  profile: Profile;
  supplier: Supplier | null;
  /** "none" when the signed-in supplier account has no business record (should not happen). */
  loading: boolean;
  loadError: string;
  refresh: () => Promise<void>;
  notifications: AppNotification[];
  unread: number;
  markRead: (id?: string) => Promise<void>;
};
const SupplierCtx = createContext<Ctx | null>(null);
export const useSupplier = () => {
  const v = useContext(SupplierCtx);
  if (!v) throw new Error("useSupplier must be used inside <SupplierProvider>");
  return v;
};

export function SupplierProvider({ profile, children }: { profile: Profile; children: ReactNode }) {
  const { session } = useAuth();
  const uid = session?.user.id;
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  const refresh = useCallback(async () => {
    if (!uid) return;
    const db = requireSupabase();
    const [s, n] = await Promise.all([
      db.from("suppliers").select("*").eq("profile_id", uid).maybeSingle(),
      db.from("notifications").select("*").order("created_at", { ascending: false }).limit(50),
    ]);
    if (s.error) setLoadError(errorText(s.error, "Could not load your business")); else { setLoadError(""); setSupplier((s.data as Supplier | null) ?? null); }
    if (!n.error) setNotifications((n.data ?? []) as AppNotification[]);
    setLoading(false);
  }, [uid]);

  useEffect(() => {
    void refresh();
    // New approvals and messages arrive while the portal is open.
    const t = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 60_000);
    return () => { window.clearInterval(t); };
  }, [refresh]);

  const markRead = useCallback(async (id?: string) => {
    const now = new Date().toISOString();
    setNotifications(list => list.map(n => (!id || n.id === id) && !n.read_at ? { ...n, read_at: now } : n));
    let q = requireSupabase().from("notifications").update({ read_at: now }).is("read_at", null);
    if (id) q = q.eq("id", id);
    await q;
  }, []);

  const value = useMemo<Ctx>(() => ({
    profile, supplier, loading, loadError, refresh, notifications, unread: notifications.filter(n => !n.read_at).length, markRead,
  }), [profile, supplier, loading, loadError, refresh, notifications, markRead]);
  return <SupplierCtx.Provider value={value}>{children}</SupplierCtx.Provider>;
}
