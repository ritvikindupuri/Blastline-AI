import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { STSClient, AssumeRoleCommand, GetCallerIdentityCommand } from "https://esm.sh/@aws-sdk/client-sts@3.658.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "unauthenticated" }, 401);

    const { connection_id } = await req.json();
    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: conn } = await admin.from("aws_connections").select("*").eq("id", connection_id).eq("user_id", user.id).single();
    if (!conn) return json({ error: "connection not found" }, 404);

    const sts = new STSClient({
      region: conn.default_region,
      credentials: {
        accessKeyId: Deno.env.get("AWS_BOOTSTRAP_ACCESS_KEY_ID")!,
        secretAccessKey: Deno.env.get("AWS_BOOTSTRAP_SECRET_ACCESS_KEY")!,
      },
    });

    try {
      const assumed = await sts.send(new AssumeRoleCommand({
        RoleArn: conn.role_arn,
        RoleSessionName: `sentrygrid-verify-${Date.now()}`,
        ExternalId: conn.external_id,
        DurationSeconds: 900,
      }));
      const c = assumed.Credentials!;
      const sts2 = new STSClient({
        region: conn.default_region,
        credentials: { accessKeyId: c.AccessKeyId!, secretAccessKey: c.SecretAccessKey!, sessionToken: c.SessionToken! },
      });
      const id = await sts2.send(new GetCallerIdentityCommand({}));
      await admin.from("aws_connections").update({
        verification_status: "verified",
        last_verified_at: new Date().toISOString(),
        aws_account_id: id.Account,
      }).eq("id", connection_id);
      return json({ ok: true, arn: id.Arn, account: id.Account });
    } catch (e: any) {
      await admin.from("aws_connections").update({
        verification_status: "failed",
        last_verified_at: new Date().toISOString(),
      }).eq("id", connection_id);
      return json({ ok: false, error: e.message ?? String(e) });
    }
  } catch (e: any) {
    return json({ error: e.message ?? String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}