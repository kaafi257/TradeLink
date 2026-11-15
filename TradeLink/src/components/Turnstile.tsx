import { useEffect, useRef } from "react";

/** Cloudflare Turnstile site key. Leave VITE_TURNSTILE_SITE_KEY empty to run without a CAPTCHA. */
export const TURNSTILE_SITE_KEY = ((import.meta.env as Record<string, string | undefined>).VITE_TURNSTILE_SITE_KEY ?? "").trim();

type TurnstileApi = { render: (el: HTMLElement, o: Record<string, unknown>) => string; remove: (id: string) => void };
declare global { interface Window { turnstile?: TurnstileApi } }

let loader: Promise<void> | null = null;
const loadScript = () => (loader ??= new Promise<void>((resolve, reject) => {
  if (window.turnstile) { resolve(); return; }
  const s = document.createElement("script");
  s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  s.async = true;
  s.onload = () => resolve();
  s.onerror = () => { loader = null; reject(new Error("Security check could not load")); };
  document.head.appendChild(s);
}));

export function Turnstile({ onToken }: { onToken: (token: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let id: string | undefined;
    let gone = false;
    loadScript().then(() => {
      if (gone || !box.current || !window.turnstile) return;
      id = window.turnstile.render(box.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (t: string) => onToken(t),
        "expired-callback": () => onToken(""),
        "error-callback": () => onToken(""),
      });
    }).catch(() => onToken(""));
    return () => { gone = true; if (id && window.turnstile) window.turnstile.remove(id); };
  }, [onToken]);
  return <div ref={box} className="full turnstile-box" />;
}
