import { useCallback, useEffect, useState } from "react";

export type Lang = "en" | "am" | "so";
export const LANGS: { id: Lang; short: string; name: string }[] = [
  { id: "en", short: "EN", name: "English" },
  { id: "am", short: "አማ", name: "አማርኛ" },
  { id: "so", short: "SO", name: "Soomaali" },
];

const en = {
  welcome: "Welcome", back: "Back!", tagline: "Connect. Trade. Grow.", lead: "Sign in to access your TradeLink marketplace account.",
  tabIn: "Sign In", tabReg: "Register as Supplier", title: "Sign In", sub: "Enter your details to continue",
  email: "Email address", password: "Password", show: "Show password", hide: "Hide password", submit: "Sign In Securely", busy: "Signing in…",
  remember: "Remember me", forgot: "Forgot password?", or: "OR", register: "New supplier? Register your business", home: "Back to homepage",
  trust1: "Trusted Marketplace", trust2: "Secure & Reliable", trust3: "Grow Your Business", foot: "TradeLink — Your Trusted Trade Partner",
  lang: "Language", welcomeTo: "Welcome to TradeLink!", opening: "Opening your workspace…", skip: "Skip",
  needEmail: "Enter your email address above first.", resetSent: "If that email belongs to an account, a reset link is on its way.",
  notConfigured: "Supabase is not configured yet. Add your environment variables before signing in.",
};
export type Text = typeof en;

const am: Text = {
  ...en, welcome: "እንኳን ደህና", back: "ተመለሱ!", tagline: "ይገናኙ። ይነግዱ። ያድጉ።", lead: "ወደ TradeLink የገበያ መለያዎ ለመግባት ይግቡ።",
  tabIn: "ይግቡ", tabReg: "እንደ አቅራቢ ይመዝገቡ", title: "ይግቡ", sub: "ለመቀጠል መረጃዎን ያስገቡ", email: "የኢሜይል አድራሻ", password: "የይለፍ ቃል",
  show: "የይለፍ ቃል አሳይ", hide: "የይለፍ ቃል ደብቅ", submit: "በደህንነት ይግቡ", busy: "በመግባት ላይ…", remember: "አስታውሰኝ", forgot: "የይለፍ ቃል ረሱ?", or: "ወይም",
  register: "አዲስ አቅራቢ ነዎት? ንግድዎን ይመዝግቡ", home: "ወደ መነሻ ገጽ ተመለስ", trust1: "የታመነ ገበያ", trust2: "ደህንነቱ የተጠበቀ", trust3: "ንግድዎን ያሳድጉ",
  foot: "TradeLink — የታመነ የንግድ አጋርዎ", lang: "ቋንቋ", welcomeTo: "ወደ TradeLink እንኳን በደህና መጡ!", opening: "የሥራ ቦታዎን በመክፈት ላይ…", skip: "ዝለል",
  needEmail: "እባክዎ መጀመሪያ የኢሜይል አድራሻዎን ያስገቡ።", resetSent: "ይህ ኢሜይል መለያ ካለው፣ የማስጀመሪያ አገናኝ በመላክ ላይ ነው።",
};
const so: Text = {
  ...en, welcome: "Ku soo dhawaaw", back: "mar kale!", tagline: "Xidhiidh. Ganacsi. Kobac.", lead: "Gal si aad u gasho akoonkaaga suuqa TradeLink.",
  tabIn: "Gal", tabReg: "Isdiiwaangeli alaab-qeybiye", title: "Gal", sub: "Geli xogtaada si aad u sii wadato", email: "Cinwaanka iimaylka", password: "Erayga sirta ah",
  show: "Muuji erayga sirta ah", hide: "Qari erayga sirta ah", submit: "Si ammaan ah u gal", busy: "Waa la galayaa…", remember: "I xasuuso", forgot: "Ma illowday erayga sirta ah?", or: "AMA",
  register: "Alaab-qeybiye cusub? Diiwaangeli ganacsigaaga", home: "Ku noqo bogga hore", trust1: "Suuq la aamini karo", trust2: "Ammaan iyo isku-halayn", trust3: "Kobci ganacsigaaga",
  foot: "TradeLink — Lammaanahaaga ganacsi ee la aamini karo", lang: "Luqad", welcomeTo: "Ku soo dhawaaw TradeLink!", opening: "Goobtaada shaqada ayaa furmaysa…", skip: "Ka bood",
  needEmail: "Marka hore geli cinwaanka iimaylkaaga.", resetSent: "Haddii iimaylkaas uu leeyahay akoon, isku xiraha dib-u-dejinta ayaa soo socda.",
};
const ALL: Record<Lang, Text> = { en, am, so };
const KEY = "tl-lang";

/** The login screen's own language switch. The rest of the site is English; server messages stay in English too. */
export function useLoginText(): { t: Text; lang: Lang; setLang: (l: Lang) => void } {
  const [lang, set] = useState<Lang>("en");
  useEffect(() => { try { const v = localStorage.getItem(KEY) as Lang | null; if (v && v in ALL) set(v); } catch { /* storage blocked */ } }, []);
  const setLang = useCallback((l: Lang) => { set(l); try { localStorage.setItem(KEY, l); } catch { /* storage blocked */ } }, []);
  return { t: ALL[lang], lang, setLang };
}
