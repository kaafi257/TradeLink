import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";

export type AgentStatus = "free" | "to_pickup" | "delivering" | "paused" | "offline";
export type JobStatus = "waiting" | "assigned" | "picked_up" | "delivered" | "failed";

export type Agent = {
  id: string; name: string; phone?: string | null; vehicle: string; status: AgentStatus;
  lat: number | null; lng: number | null; updatedAt: string | null; jobId: string | null;
};
export type Job = {
  id: string; ref: string; status: JobStatus; agentId: string | null; items: string; fee: number; distanceKm: number | null;
  readyAt: string; promisedAt: string | null;
  supplier: { name: string; lat: number; lng: number };
  customer: { name: string; area: string; lat: number; lng: number };
};
export type Snapshot = { agents: Agent[]; jobs: Job[] };

/** A phone that has not reported for this long is shown as paused, never as live. */
export const STALE_AFTER_MS = 90_000;
export const LATE_AFTER_MIN = 30;

export const minutesSince = (iso: string | null, now = Date.now()) => (iso ? Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000)) : null);
export const secondsSince = (iso: string | null, now = Date.now()) => (iso ? Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000)) : null);

export function lastSeenText(iso: string | null, now = Date.now()) {
  const s = secondsSince(iso, now);
  if (s === null) return "No location yet";
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

export const isStale = (a: Agent, now = Date.now()) => a.status !== "offline" && (a.updatedAt === null || now - new Date(a.updatedAt).getTime() > STALE_AFTER_MS);
/** The status the admin should see, after the freshness check. */
export const effectiveStatus = (a: Agent, now = Date.now()): AgentStatus => (isStale(a, now) ? "paused" : a.status);

export const AGENT_LABEL: Record<AgentStatus, string> = { free: "Free", to_pickup: "To pickup", delivering: "Delivering", paused: "Location paused", offline: "Offline" };
export const JOB_LABEL: Record<JobStatus, string> = { waiting: "Needs a driver", assigned: "Driver coming", picked_up: "On the way", delivered: "Delivered", failed: "Failed" };

export const isOpen = (j: Job) => j.status !== "delivered" && j.status !== "failed";
export const waitingMinutes = (j: Job, now = Date.now()) => minutesSince(j.readyAt, now) ?? 0;
export const isLate = (j: Job, now = Date.now()) =>
  isOpen(j) && (j.promisedAt ? now > new Date(j.promisedAt).getTime() : waitingMinutes(j, now) > LATE_AFTER_MIN);

/** Straight-line distance in km. Road distance is longer, so callers label it as an estimate. */
export function km(aLat: number, aLng: number, bLat: number, bLng: number) {
  const r = 6371, rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat), dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

/* ---------- Data hook ---------- */

export type Unpinned = { id: string; ref: string; customer: string; area: string; status: string };
export type OpsState = { snapshot: Snapshot; unpinned: Unpinned[]; loading: boolean; error: string | null; refreshedAt: number; now: number; reload: () => void };

/** Reads the whole picture from one database function (ops_live_snapshot), which only owner and manager may call. No placeholder data. */
export function useOpsData(pollMs = 10_000): OpsState {
  const [snapshot, setSnapshot] = useState<Snapshot>({ agents: [], jobs: [] });
  const [unpinned, setUnpinned] = useState<Unpinned[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState(Date.now());
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    const { data, error: err } = await supabase.rpc("ops_live_snapshot");
    if (err || !data) {
      const missing = err && (err.code === "PGRST202" || /could not find the function|does not exist/i.test(err.message));
      setError(missing ? "Live map is not set up yet. Run migration 0035 in Supabase." : err?.message ?? "Could not load.");
    } else {
      setSnapshot({ agents: (data.agents ?? []) as Agent[], jobs: (data.jobs ?? []) as Job[] });
      setUnpinned((data.unpinned ?? []) as Unpinned[]);
      setError(null); setRefreshedAt(Date.now());
    }
    setNow(Date.now()); setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), pollMs);
    return () => window.clearInterval(t);
  }, [load, pollMs]);

  // Keep "seen 8 s ago" honest between refreshes.
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, []);

  return useMemo(() => ({ snapshot, unpinned, loading, error, refreshedAt, now, reload: () => void load() }), [snapshot, unpinned, loading, error, refreshedAt, now, load]);
}
