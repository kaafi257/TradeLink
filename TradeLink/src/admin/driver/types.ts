export type Pt = { lat: number; lng: number };
export type Job = {
  id: string; ref: string; status: "assigned" | "in_transit"; customer: string; phone: string | null; address: string; notes: string | null;
  accepted: boolean; pickedUp: boolean; fee: number | null; createdAt: string; items: string;
  supplier: (Pt & { name: string }) | null; dropoff: Pt | null;
};
export type Mine = { online: boolean; vehicle: string; jobs: Job[] };
export type Earn = { today: { amount: number; count: number }; week: { amount: number; count: number }; month: { amount: number; count: number }; unpriced: number; days: { day: string; amount: number; count: number }[] };
export type Hist = { id: string; ref: string; customer: string; address: string; status: string; rejected: boolean; fee: number | null; note: string | null; at: string };
export type Prof = { name: string; email: string; phone: string | null; vehicle: string; plate: string | null; photo: string | null; verified: boolean; delivered: number };
export type Ctx = {
  mine: Mine | null; online: boolean; here: [number, number] | null; gps: string; busy: boolean; reload: () => void;
  toggle: () => void; act: (fn: () => Promise<unknown>, done?: string) => Promise<boolean>; go: (tab: "home" | "jobs" | "earn" | "me") => void;
};
export const etb = (n: number | null | undefined) => `${Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} ETB`;
export const navUrl = (p: Pt) => `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=driving`;
