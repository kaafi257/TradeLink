/** Types and small helpers for cities, areas, driver cities and the delivery "needs attention" flags (migration 0042). */
export type Zone = { id: string; name: string; active: boolean };
export type City = { id: string; name: string; active: boolean; drivers: number; orders: number; zones: Zone[] };
export type DriverLoad = { profileId: string; cities: string[]; openJobs: number; online: boolean; lastSeen: string | null };
export type Candidate = { profileId: string; name: string; role: string; verified: boolean; online: boolean; lastSeen: string | null; openJobs: number };
export type Candidates = { citiesOn: boolean; cityId: string | null; cityName: string | null; zoneId: string | null; zoneName: string | null; needsCity: boolean; drivers: Candidate[] };
export type ListExtra = { id: string; cityId: string | null; city: string | null; zone: string | null; attention: string[]; failCategory?: string | null; attempt?: number; retryOf?: string | null; codeLocked?: boolean };
export type ListExtras = { thresholds: { notAcceptedMinutes: number }; rows: ListExtra[] };

export const ATTENTION: Record<string, string> = {
  not_accepted: "Not accepted yet",
  late: "Late",
  failed_open: "Failed, needs a new driver",
  no_pins: "No map pins",
  no_city: "No city",
  code_locked: "Code locked",
  many_failures: "3+ failed attempts",
};

/** Drivers before office staff; online first, then fewest open jobs. */
export const byAvailability = (a: { role?: string; online: boolean; openJobs: number; name: string }, b: { role?: string; online: boolean; openJobs: number; name: string }) =>
  Number(a.role !== undefined && a.role !== "delivery") - Number(b.role !== undefined && b.role !== "delivery") || Number(b.online) - Number(a.online) || a.openJobs - b.openJobs || a.name.localeCompare(b.name);
