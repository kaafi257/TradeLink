import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, type Profile } from "./supabase";

type AuthState = {
  loading: boolean;
  session: Session | null;
  /** null when signed out OR when the signed-in user has no staff profile. */
  profile: Profile | null;
  signOut: () => Promise<void>;
};
const AuthContext = createContext<AuthState>({ loading: true, session: null, profile: null, signOut: async () => {} });
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(!supabase);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileReady, setProfileReady] = useState(true);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setSessionReady(true); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => subscription.unsubscribe();
  }, []);

  // Load the staff profile once per signed-in user (token refreshes keep the same id).
  const userId = session?.user.id;
  useEffect(() => {
    if (!supabase || !userId) { setProfile(null); setProfileReady(true); return; }
    let cancelled = false;
    setProfileReady(false);
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle().then(({ data }) => {
      if (cancelled) return;
      setProfile((data as Profile | null) ?? null);
      setProfileReady(true);
    });
    return () => { cancelled = true; };
  }, [userId]);

  const value = useMemo<AuthState>(() => ({
    loading: !sessionReady || !profileReady,
    session, profile,
    signOut: async () => { await supabase?.auth.signOut(); },
  }), [sessionReady, profileReady, session, profile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
