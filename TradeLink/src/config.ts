/**
 * TradeLink public contact details.
 * Fill these in (or set VITE_CONTACT_PHONE / VITE_CONTACT_WHATSAPP / VITE_CONTACT_TELEGRAM in Vercel).
 * A channel left empty is hidden from the website, so no broken buttons appear.
 *
 *   phone     e.g. "+251911000000"   (with country code)
 *   whatsapp  e.g. "+251911000000"   (with country code)
 *   telegram  e.g. "tradelink_et"    (username only, no @)
 */
const FALLBACK = {
  phone: "",
  whatsapp: "",
  telegram: "",
};

const env = import.meta.env as Record<string, string | undefined>;
const pick = (fromEnv: string | undefined, fallback: string) => (fromEnv ?? "").trim() || fallback.trim();

export const CONTACT = {
  phone: pick(env.VITE_CONTACT_PHONE, FALLBACK.phone),
  whatsapp: pick(env.VITE_CONTACT_WHATSAPP, FALLBACK.whatsapp),
  telegram: pick(env.VITE_CONTACT_TELEGRAM, FALLBACK.telegram),
};
