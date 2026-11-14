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
    const { email, full_name, role } = await req.json();
    if (!email || !full_name || !["manager","sales","inventory","delivery","staff"].includes(role)) throw new Error("Invalid invitation details");
    if (role === "manager" && actor.role !== "owner") throw new Error("Only the owner can invite a manager");
    const admin = createClient(url, service);
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { data: { full_name } });
    if (error) throw error;
    if (data.user) {
      await admin.from("profiles").upsert({ id: data.user.id, full_name, email, role, active: true });
      await admin.from("activity_logs").insert({ actor_id: user.id, actor_name: user.email, action: "staff_invited", entity_type: "staff", description: `Invited ${full_name} as ${role}` });
    }
    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unexpected error" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
