import { useEffect, useState } from "react";
import { CONTACT } from "../config";
import { supabase } from "./supabase";

export type Contact = { phone: string; whatsapp: string; telegram: string; email: string; address: string; hours: string };

/** Contact details come from the database (Admin → Communication); the VITE_CONTACT_* variables are only a fallback. */
let current: Contact = { ...CONTACT, email: "", address: "", hours: "" };
let started = false;
const listeners = new Set<(c: Contact) => void>();

export async function loadContact() {
  if (!supabase) return;
  const { data } = await supabase.from("public_contact").select("*").maybeSingle();
  if (!data) return;
  const use = (v: string | null, fallback: string) => (v ?? "").trim() || fallback;
  current = {
    phone: use(data.phone, CONTACT.phone), whatsapp: use(data.whatsapp, CONTACT.whatsapp), telegram: use(data.telegram, CONTACT.telegram),
    email: use(data.email, ""), address: use(data.address, ""), hours: use(data.working_hours, ""),
  };
  listeners.forEach(l => l(current));
}

export function useContact(): Contact {
  const [c, setC] = useState(current);
  useEffect(() => {
    listeners.add(setC);
    if (!started) { started = true; void loadContact(); }
    setC(current);
    return () => { listeners.delete(setC); };
  }, []);
  return c;
}

export type Channel = { key: "whatsapp" | "telegram" | "call"; label: string; detail: string; href: string; external: boolean };
const digits = (v: string) => v.replace(/[^\d]/g, "");
const username = (v: string) => v.replace(/^https?:\/\/t\.me\//i, "").replace(/^@/, "").trim();

/** WhatsApp needs the country code: a local Ethiopian number like 0911… becomes 251911…. */
export function waNumber(v: string) {
  const d = digits(v);
  return d.startsWith("0") ? `251${d.slice(1)}` : d;
}

/** Only configured channels are returned, so the website never shows dead buttons. */
export function buildChannels(c: Contact, message = "Hello TradeLink, I would like a wholesale price."): Channel[] {
  const out: Channel[] = [];
  if (c.whatsapp) out.push({ key: "whatsapp", label: "WhatsApp", detail: c.whatsapp, external: true, href: `https://wa.me/${waNumber(c.whatsapp)}?text=${encodeURIComponent(message)}` });
  if (c.telegram) out.push({ key: "telegram", label: "Telegram", detail: `@${username(c.telegram)}`, external: true, href: `https://t.me/${username(c.telegram)}` });
  if (c.phone) out.push({ key: "call", label: "Call", detail: c.phone, external: false, href: `tel:${c.phone.replace(/[^\d+]/g, "")}` });
  return out;
}
export const useChannels = (message?: string) => buildChannels(useContact(), message);
