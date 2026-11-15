// Deploy with Supabase CLI. Configure SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY as function secrets.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization");
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    const { data: actor } = await userClient.from("profiles").select("role, active").eq("id", user.id).single();
    if (!actor || !actor.active || !["owner", "manager"].includes(actor.role)) throw new Error("Only an active owner or manager can invite staff");
    const { email, full_name, role, redirect_to, password } = await req.json();
    if (typeof email !== "string" || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 160) throw new Error("Please enter a valid email address");
    if (typeof full_name !== "string" || full_name.trim().length < 2 || full_name.length > 120) throw new Error("Please enter the staff member's full name");
    if (!["manager","sales","inventory","delivery","staff"].includes(role)) throw new Error("Invalid invitation details");
    if (role === "manager" && actor.role !== "owner") throw new Error("Only the owner can invite a manager");
    const hasPassword = typeof password === "string" && password.length > 0;
    if (hasPassword && password.length < 8) throw new Error("The password must be at least 8 characters");
    const admin = createClient(url, service);
    // Only send people back to the site that made the request (never to an arbitrary address).
    let redirectTo: string | undefined;
    try { const u = new URL(String(redirect_to)); if (u.origin === req.headers.get("origin")) redirectTo = u.toString(); } catch { /* no redirect */ }
    // With a password the owner sets it directly (no email); otherwise an invitation email is sent.
    const { data, error } = hasPassword
      ? await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name } })
      : await admin.auth.admin.inviteUserByEmail(email, { data: { full_name }, redirectTo });
    if (error) throw error;
    if (data.user) {
      // If this fails the invitee would silently stay a plain "staff" user, so report it instead of ignoring it.
      const { error: profileError } = await admin.from("profiles").upsert({ id: data.user.id, full_name, email, role, active: true });
      if (profileError) throw new Error(`The account was created, but the role could not be saved: ${profileError.message}. Set the role on the Staff page.`);
      await admin.from("activity_logs").insert({ actor_id: user.id, actor_name: user.email, action: "staff_invited", entity_type: "staff", description: `Invited ${full_name} as ${role}` });
    }
    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unexpected error" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
