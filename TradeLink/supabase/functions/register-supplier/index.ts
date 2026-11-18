// Public supplier registration. Creates the sign-in account (role "supplier") and a PENDING supplier application.
// Nothing is published until the owner or a manager approves it in Admin -> Suppliers.
// Deploy:  supabase functions deploy register-supplier
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (set automatically); optional TURNSTILE_SECRET_KEY to require a CAPTCHA.
// The service-role key lives only here, never in the browser.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const BUSINESS_TYPES = ["manufacturer", "wholesaler", "distributor", "importer", "retailer", "farmer", "service", "other"];
const clean = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const sha256 = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))).map(b => b.toString(16).padStart(2, "0")).join("");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  let createdUser: string | null = null;
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const b = await req.json();
    if (clean(b.website, 200)) return json({ success: true });                       // honeypot field: bots fill it, people never see it

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
    const owner = clean(b.owner_name, 120), business = clean(b.business_name, 80), phone = clean(b.phone, 40);
    const location = clean(b.location, 80), address = clean(b.address, 200), about = clean(b.about, 300);
    const type = clean(b.business_type, 30), industryId = clean(b.industry_id, 60);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Please enter a valid email address.");
    if (password.length < 8 || password.length > 72) throw new Error("The password must be 8 to 72 characters.");
    if (owner.length < 2) throw new Error("Please enter the owner's full name.");
    if (business.length < 2) throw new Error("Please enter the business name.");
    if (phone.length < 6) throw new Error("Please enter a contact phone number.");
    if (location.length < 2) throw new Error("Please enter the business location.");
    if (about.length < 10) throw new Error("Please describe the business in a sentence or two.");
    if (!BUSINESS_TYPES.includes(type)) throw new Error("Please choose a business type.");
    if (!/^[0-9a-f-]{36}$/i.test(industryId)) throw new Error("Please choose an industry.");

    const { data: industry } = await admin.from("industries").select("id").eq("id", industryId).eq("active", true).maybeSingle();
    if (!industry) throw new Error("Please choose an industry.");

    // At most 3 applications per connection per hour.
    const hash = ip ? await sha256(`supplier:${ip}`) : null;
    if (hash) {
      const since = new Date(Date.now() - 3600_000).toISOString();
      const { count } = await admin.from("suppliers").select("id", { count: "exact", head: true }).eq("source_hash", hash).gte("created_at", since);
      if ((count ?? 0) >= 3) throw new Error("Too many applications from this connection. Please try again later.");
    }
    const { data: dup } = await admin.from("suppliers").select("id").ilike("name", business).maybeSingle();
    if (dup) throw new Error("A business with that name is already registered. If it is yours, please contact TradeLink.");

    const { data: created, error: userError } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: owner } });
    if (userError) throw new Error(/already|registered|exists/i.test(userError.message) ? "That email address already has an account. Please sign in instead." : userError.message);
    createdUser = created.user.id;

    // The sign-up trigger makes every new user a plain "staff" profile; this makes it a supplier account (server-side only).
    const { error: profileError } = await admin.from("profiles").upsert({ id: createdUser, full_name: owner, email, role: "supplier", active: true });
    if (profileError) throw new Error("Could not create the account. Please try again.");

    const { data: supplier, error: supplierError } = await admin.from("suppliers").insert({
      name: business, industry_id: industryId, profile_id: createdUser, status: "pending", active: false,
      owner_name: owner, phone, email, location, address: address || null, about, business_type: type, source_hash: hash,
    }).select("id").single();
    if (supplierError) throw new Error(supplierError.code === "23505" ? "A business with that name is already registered." : "Could not save the application. Please try again.");

    await admin.from("activity_logs").insert({ actor_id: createdUser, actor_name: email, action: "supplier_applied", entity_type: "suppliers", description: `New supplier application: ${business}`, metadata: { supplier_id: supplier.id } });
    return json({ success: true, supplier_id: supplier.id });
  } catch (e) {
    // Do not leave a half-created account behind.
    if (createdUser) await admin.auth.admin.deleteUser(createdUser).catch(() => undefined);
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 400);
  }
});
