import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, type Profile } from "./supabase";

type AuthState = {
  loading: boolean;
  session: Session | null;
  /** null when signed out OR when the signed-in user has no staff profile. */
  profile: Profile | null;
  /** Message from a failed profile read, so "No access" can say why. */
  profileError: string;
  signOut: () => Promise<void>;
};
const AuthContext = createContext<AuthState>({ loading: true, session: null, profile: null, profileError: "", signOut: async () => {} });
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(!supabase);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState("");
  // Which user id the loaded profile belongs to; until it matches the session we are still loading.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setSessionReady(true); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => subscription.unsubscribe();
  }, []);

  // Load the staff profile once per signed-in user (token refreshes keep the same id).
  const userId = session?.user.id;
  useEffect(() => {
    if (!supabase || !userId) { setProfile(null); setProfileError(""); setLoadedFor(null); return; }
    let cancelled = false;
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle().then(({ data, error }) => {
      if (cancelled) return;
      setProfile((data as Profile | null) ?? null);
      setProfileError(error?.message ?? "");
      setLoadedFor(userId);
    });
    return () => { cancelled = true; };
  }, [userId]);

  const value = useMemo<AuthState>(() => ({
    loading: !sessionReady || (!!userId && loadedFor !== userId),
    session, profile, profileError,
    signOut: async () => { await supabase?.auth.signOut(); },
  }), [sessionReady, userId, loadedFor, session, profile, profileError]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
