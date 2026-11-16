// QuickBooks Online bridge for AsphaltPro — Supabase Edge Function (Deno). No imports needed.
//
// Why this exists: QuickBooks will not let a website hold its client secret, so sign-in, token storage/refresh and
// the API calls happen here. Tokens live in public.qbo_tokens, which only this function (service role) can read.
//
// Deploy with "Verify JWT" turned OFF (Intuit's sign-in redirect arrives without a Supabase login). Every other
// request is checked below: the caller must be a signed-in user whose email is in public.staff.
//
// Secrets to set (Edge Functions -> Secrets):
//   QBO_CLIENT_ID, QBO_CLIENT_SECRET   from your Intuit developer app
//   QBO_ENV                            "production" (real company) or "sandbox"
//   APP_URL                            where the app lives, e.g. https://yourname.github.io/BAM-Scheduling-2/
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

const env = (k: string) => Deno.env.get(k) ?? "";
const SUPA = env("SUPABASE_URL"), SERVICE = env("SUPABASE_SERVICE_ROLE_KEY");
const CLIENT_ID = env("QBO_CLIENT_ID"), CLIENT_SECRET = env("QBO_CLIENT_SECRET");
const SANDBOX = env("QBO_ENV").toLowerCase() === "sandbox";
const APP_URL = env("APP_URL");
const API = env("QBO_API_BASE") || (SANDBOX ? "https://sandbox-quickbooks.api.intuit.com" : "https://quickbooks.api.intuit.com");   // override is for automated tests only
const SELF = `${SUPA}/functions/v1/quickbooks`;            // also the OAuth redirect URI
const TOKEN_URL = env("QBO_TOKEN_URL") || "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";
const MINOR = "70";
const ENTITIES = ["customer", "invoice", "payment", "item"];   // what "create" may write

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (msg: string, status = 400) => json({ error: msg }, status);

// ---- database helpers (service role, via the REST API) ----
const dbHeaders = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" };
async function db(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SUPA}/rest/v1/${path}`, { ...init, headers: { ...dbHeaders, ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`database error ${r.status}: ${await r.text()}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}
const getTokens = async () => (await db("qbo_tokens?id=eq.1&select=*"))?.[0] ?? null;
const saveTokens = (row: Record<string, unknown>) =>
  db("qbo_tokens?on_conflict=id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ id: 1, ...row, updated_at: new Date().toISOString() }) });

// ---- who is calling? must be a signed-in staff member ----
async function requireStaff(req: Request): Promise<string> {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("not signed in");
  const u = await fetch(`${SUPA}/auth/v1/user`, { headers: { apikey: SERVICE, Authorization: `Bearer ${token}` } });
  if (!u.ok) throw new Error("not signed in");
  const email = String((await u.json()).email || "").toLowerCase();
  if (!email) throw new Error("not signed in");
  const rows = await db(`staff?select=email&email=ilike.${encodeURIComponent(email.replace(/[%_*,()]/g, (c) => "\\" + c))}`);
  if (!rows || !rows.some((r: { email: string }) => r.email.toLowerCase() === email)) throw new Error("not on the staff list");
  return email;
}

// ---- Intuit OAuth ----
const basic = () => "Basic " + btoa(`${CLIENT_ID}:${CLIENT_SECRET}`);
async function tokenRequest(params: Record<string, string>) {
  const r = await fetch(TOKEN_URL, { method: "POST", headers: { Authorization: basic(), Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error_description || j.error || `Intuit token error ${r.status}`);
  return j as { access_token: string; refresh_token: string; expires_in: number; x_refresh_token_expires_in: number };
}
const tokenRow = (j: Awaited<ReturnType<typeof tokenRequest>>) => ({
  access_token: j.access_token, refresh_token: j.refresh_token,
  access_expires_at: new Date(Date.now() + (j.expires_in - 120) * 1000).toISOString(),
  refresh_expires_at: new Date(Date.now() + j.x_refresh_token_expires_in * 1000).toISOString(),
});
async function accessToken() {
  const t = await getTokens();
  if (!t || !t.refresh_token) throw new Error("QuickBooks is not connected");
  if (t.access_token && new Date(t.access_expires_at).getTime() > Date.now()) return t;
  const j = await tokenRequest({ grant_type: "refresh_token", refresh_token: t.refresh_token });   // refresh tokens rotate: always store the new one
  const row = { ...t, ...tokenRow(j) }; await saveTokens(row); return row;
}
async function qbo(method: string, path: string, body?: unknown) {
  const t = await accessToken();
  const sep = path.includes("?") ? "&" : "?";
  const r = await fetch(`${API}/v3/company/${t.realm_id}/${path}${sep}minorversion=${MINOR}`, {
    method, headers: { Authorization: `Bearer ${t.access_token}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = j?.Fault?.Error?.[0];
    return { ok: false, status: r.status, error: e ? `${e.Message}${e.Detail ? " — " + e.Detail : ""}` : `QuickBooks error ${r.status}`, code: e?.code ?? null };
  }
  return { ok: true, data: j };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  const back = (tail: string) => Response.redirect(`${APP_URL}#/quickbooks/${tail}`, 302);
  try {
    if (!CLIENT_ID || !CLIENT_SECRET || !APP_URL) return fail("The QuickBooks function is missing its secrets (QBO_CLIENT_ID, QBO_CLIENT_SECRET, APP_URL).", 500);

    // 1) Intuit sends the user back here after they approve the connection
    if (req.method === "GET") {
      const code = url.searchParams.get("code"), state = url.searchParams.get("state"), realm = url.searchParams.get("realmId");
      if (url.searchParams.get("error")) return back("error/" + encodeURIComponent(url.searchParams.get("error") || "denied"));
      if (!code || !state || !realm) return fail("Nothing to do here.", 404);
      const st = await db(`qbo_state?state=eq.${encodeURIComponent(state)}&select=state,created_at`);
      await db(`qbo_state?state=eq.${encodeURIComponent(state)}`, { method: "DELETE" });
      if (!st?.length || Date.now() - new Date(st[0].created_at).getTime() > 15 * 60 * 1000) return back("error/" + encodeURIComponent("Sign-in expired — please click Connect again"));
      const j = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: SELF });
      await saveTokens({ realm_id: realm, company_name: null, ...tokenRow(j) });
      const info = await qbo("GET", `companyinfo/${realm}`);
      if (info.ok) await saveTokens({ ...(await getTokens()), company_name: info.data?.CompanyInfo?.CompanyName ?? null });
      return back("connected");
    }
    if (req.method !== "POST") return fail("Unsupported method", 405);

    // 2) Everything else comes from the app and must be a signed-in staff member
    try { await requireStaff(req); } catch (e) { return fail((e as Error).message, 401); }
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");

    if (action === "status") {
      const t = await getTokens();
      const live = !!(t && t.refresh_token && new Date(t.refresh_expires_at).getTime() > Date.now());
      return json({ connected: live, company: live ? t.company_name : null, environment: SANDBOX ? "sandbox" : "production", redirectUri: SELF });
    }
    if (action === "authUrl") {
      const state = crypto.randomUUID() + crypto.randomUUID();
      await db(`qbo_state?created_at=lt.${new Date(Date.now() - 3600 * 1000).toISOString()}`, { method: "DELETE" });
      await db("qbo_state", { method: "POST", body: JSON.stringify({ state }) });
      const q = new URLSearchParams({ client_id: CLIENT_ID, response_type: "code", scope: "com.intuit.quickbooks.accounting", redirect_uri: SELF, state });
      return json({ url: `https://appcenter.intuit.com/connect/oauth2?${q}` });
    }
    if (action === "disconnect") {
      const t = await getTokens();
      if (t?.refresh_token) await fetch(REVOKE_URL, { method: "POST", headers: { Authorization: basic(), Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ token: t.refresh_token }) }).catch(() => null);
      await db("qbo_tokens?id=eq.1", { method: "DELETE" });
      return json({ connected: false });
    }
    if (action === "query") {            // read-only: QuickBooks query language, SELECT statements only
      const q = String(body.query || "").trim();
      if (!/^select\s/i.test(q) || q.length > 2000) return fail("Only SELECT queries are allowed");
      const r = await qbo("GET", `query?query=${encodeURIComponent(q)}`);
      return r.ok ? json(r.data) : json({ error: r.error, code: r.code }, 502);
    }
    if (action === "create") {           // create one Customer / Invoice / Payment / Item
      const entity = String(body.entity || "").toLowerCase();
      if (!ENTITIES.includes(entity) || typeof body.data !== "object" || !body.data) return fail("Unsupported entity");
      const r = await qbo("POST", entity, body.data);
      return r.ok ? json(r.data) : json({ error: r.error, code: r.code }, 502);
    }
    return fail("Unknown action");
  } catch (e) {
    const msg = (e as Error).message || "Unexpected error";
    return req.method === "GET" ? back("error/" + encodeURIComponent(msg)) : fail(msg, 500);
  }
});
