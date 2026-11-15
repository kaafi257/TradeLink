// Public quote form with a Cloudflare Turnstile check.
// Deploy:  supabase functions deploy submit-quote
// Secret:  supabase secrets set TURNSTILE_SECRET_KEY=your-turnstile-secret
// The function verifies the CAPTCHA token, then calls submit_request() with the service role,
// forwarding the visitor's IP so the database rate limits still work per connection.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const secret = Deno.env.get("TURNSTILE_SECRET_KEY");
    if (!secret) throw new Error("The quote form is not fully configured yet. Please contact us by phone.");
    const b = await req.json();
    if (typeof b.token !== "string" || !b.token) throw new Error("Please complete the security check.");

    const ip = (req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
    const verify = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: new URLSearchParams({ secret, response: b.token, ...(ip ? { remoteip: ip } : {}) }),
    });
    const result = await verify.json();
    if (!result.success) throw new Error("The security check failed. Please try again.");

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      global: { headers: ip ? { "x-forwarded-for": ip } : {} },
    });
    const { data, error } = await admin.rpc("submit_request", {
      p_name: b.name ?? "", p_phone: b.phone ?? "", p_email: b.email ?? "", p_location: b.location ?? "",
      p_items: Array.isArray(b.items) ? b.items : [], p_notes: b.notes ?? "", p_website: b.website ?? "",
      p_customer_type: b.customer_type === "individual" ? "individual" : "business",
    });
    if (error) throw new Error(error.message);
    return json({ quote_number: data });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 400);
  }
});
