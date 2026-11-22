// Customer account sign-up (shoppers, not staff). Creates a Supabase Auth user flagged account_type=customer.
// The handle_new_user trigger (migration 0025) gives such a user NO staff profile, so it can never open the admin.
// Deploy:  supabase functions deploy customer-signup
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (set automatically); optional TURNSTILE_SECRET_KEY to require a CAPTCHA.
// The service-role key lives only here, never in the browser.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const clean = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const b = await req.json();
    if (clean(b.website, 200)) return json({ success: true });                       // honeypot
    const ip = (req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
    const secret = Deno.env.get("TURNSTILE_SECRET_KEY");
    if (secret) {
      if (typeof b.token !== "string" || !b.token) throw new Error("Please complete the security check.");
      const v = await (await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST", body: new URLSearchParams({ secret, response: b.token, ...(ip ? { remoteip: ip } : {}) }),
      })).json();
      if (!v.success) throw new Error("The security check failed. Please try again.");
    }
    const email = clean(b.email, 160).toLowerCase();
    const password = typeof b.password === "string" ? b.password : "";
    const name = clean(b.full_name, 120), phone = clean(b.phone, 30);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Please enter a valid email address.");
    if (password.length < 8 || password.length > 72) throw new Error("The password must be 8 to 72 characters.");
    if (name.length < 2) throw new Error("Please enter your name.");

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { account_type: "customer", full_name: name, phone },
    });
    if (error) {
      if (/already|registered|exists/i.test(error.message)) throw new Error("An account with this email already exists. Please sign in.");
      throw new Error("We could not create the account. Please try again.");
    }
    return json({ success: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 400);
  }
});
