// Email sender + automatic follow-ups for AsphaltPro — Supabase Edge Function (Deno). No imports needed.
//
// Sends through Resend (https://resend.com). Deploy with "Verify JWT" turned OFF: the daily schedule calls this
// function without a login, so every request is checked here instead — either a signed-in staff member, or the
// scheduler's secret (stored in public.email_cron, readable only by the service role).
//
// Secrets to set (Edge Functions -> Secrets):
//   RESEND_API_KEY   from resend.com
//   EMAIL_FROM       e.g.  Brown's Asphalt Maintenance <proposals@yourdomain.com>   (domain must be verified in Resend)
//   EMAIL_REPLY_TO   optional — where customer replies should go, e.g. your office inbox
//   APP_URL          where the app lives, e.g. https://yourname.github.io/BAM-Scheduling-2/
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

const env = (k: string) => Deno.env.get(k) ?? "";
const SUPA = env("SUPABASE_URL"), SERVICE = env("SUPABASE_SERVICE_ROLE_KEY");
const RESEND_KEY = env("RESEND_API_KEY"), FROM = env("EMAIL_FROM"), REPLY_TO = env("EMAIL_REPLY_TO"), APP_URL = env("APP_URL");
const RESEND_URL = env("RESEND_API_URL") || "https://api.resend.com/emails";   // override is for automated tests only

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (msg: string, status = 400) => json({ error: msg }, status);

const dbHeaders = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" };
async function db(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SUPA}/rest/v1/${path}`, { ...init, headers: { ...dbHeaders, ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`database error ${r.status}: ${await r.text()}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}
async function isStaff(req: Request): Promise<boolean> {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const u = await fetch(`${SUPA}/auth/v1/user`, { headers: { apikey: SERVICE, Authorization: `Bearer ${token}` } });
  if (!u.ok) return false;
  const email = String((await u.json()).email || "").toLowerCase();
  if (!email) return false;
  const row = (await db(`staff?select=*&email=ilike.${encodeURIComponent(email.replace(/[%_*,()]/g, (c) => "\\" + c))}`) || []).find((r: { email: string }) => r.email.toLowerCase() === email);
  return !!row && (!row.role || row.role !== "crew");   // crew logins cannot send email (role column exists once supabase/roles.sql has been run)
}
async function isScheduler(req: Request): Promise<boolean> {
  const got = req.headers.get("x-cron-secret") || "";
  if (got.length < 32) return false;
  const rows = await db("email_cron?id=eq.1&select=secret");
  return !!rows?.[0]?.secret && rows[0].secret === got;
}

// ---------- sending ----------
const isPayLink = (u: unknown) => typeof u === "string" && /^https:\/\/[^\s"<>]+$/.test(u);
const isEmail = (s: string) => /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(s);
const list = (v: unknown) => (Array.isArray(v) ? v : String(v || "").split(/[,;]/)).map((s) => String(s).trim()).filter(Boolean);
type Mail = { to: string[]; cc?: string[]; subject: string; html: string; attachments?: { filename: string; content: string }[] };
async function sendMail(m: Mail) {
  if (!RESEND_KEY || !FROM) throw new Error("Email is not set up yet (RESEND_API_KEY / EMAIL_FROM secrets are missing).");
  const body: Record<string, unknown> = { from: FROM, to: m.to, subject: m.subject, html: m.html };
  if (m.cc?.length) body.cc = m.cc;
  if (REPLY_TO) body.reply_to = REPLY_TO;
  if (m.attachments?.length) body.attachments = m.attachments;
  const r = await fetch(RESEND_URL, { method: "POST", headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || j.error || `Email service error ${r.status}`);
  return String(j.id || "");
}

// ---------- templates (kept in step with js/email.js) ----------
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
const money = (n: number) => "$" + (Math.round(n * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fill = (t: string, v: Record<string, string>) => String(t || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => v[k] ?? "");
const DEFAULTS = {
  followSubject: "Following up: {{project}} proposal",
  followBody: "Hi {{contact}},\n\nI wanted to follow up on the proposal we sent on {{date}} for {{project}} ({{total}}). You can review and accept it online using the button below.\n\nIf you have any questions, or the scope has changed, just reply to this email.\n\nThank you,\n{{company}}",
  reminderSubject: "Reminder: invoice #{{number}} is past due",
  reminderBody: "Hi {{contact}},\n\nThis is a friendly reminder that invoice #{{number}} for {{balance}} was due on {{due}}. You can view it using the button below.\n\nIf payment is already on its way, thank you — please disregard this note.\n\n{{company}}",
};
function emailHTML(text: string, button: { label: string; url: string } | null, s: Record<string, unknown>, accent: string) {
  const paras = esc(text).split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, "<br>")}</p>`).join("");
  const btn = button ? `<p style="margin:22px 0"><a href="${esc(button.url)}" style="background:${esc(accent)};color:#111;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:6px;display:inline-block">${esc(button.label)}</a></p>` : "";
  const foot = [s.company, s.phone, s.email].filter(Boolean).map(esc).join(" · ");
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:600px">${paras}${btn}<hr style="border:0;border-top:1px solid #ddd;margin:22px 0 10px"><p style="font-size:12px;color:#666;margin:0">${foot}</p></div>`;
}

// ---------- automatic follow-ups ----------
const today = () => new Date().toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.floor((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);
const fmtDate = (d: string) => d ? new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
const numList = (v: unknown, dflt: number[]) => { const a = list(v).map(Number).filter((n) => Number.isFinite(n) && n > 0).sort((x, y) => x - y); return a.length ? a : dflt; };
// deno-lint-ignore no-explicit-any
type Rec = { id: string; data: any };
function estimateTotal(e: Rec["data"]) {   // lump sum wins; otherwise sum of line items (rounded down unless switched off), plus tax
  const calc = (e.lines || []).reduce((a: number, l: Rec["data"]) => a + (+l.qty || 0) * (+l.price || 0), 0);
  const sub = e.lumpSum !== null && e.lumpSum !== undefined && e.lumpSum !== "" ? +e.lumpSum : (e.roundDown === false ? calc : Math.floor(calc + 1e-6));
  return sub * (1 + (+e.taxRate || 0) / 100);
}
function invoiceBalance(i: Rec["data"]) {
  const sub = (i.items || []).reduce((a: number, l: Rec["data"]) => a + (+l.qty || 0) * (+l.price || 0), 0);
  return Math.max(0, sub * (1 + (+i.taxRate || 0) / 100) - (i.payments || []).reduce((a: number, p: Rec["data"]) => a + (+p.amount || 0), 0));
}
async function runFollowups(dryRun: boolean) {
  const settings = ((await db("records?coll=eq.meta&id=eq.settings&select=data"))?.[0]?.data) || {};
  const f = settings.followups || {}, tpl = { ...DEFAULTS, ...(settings.email || {}) }, accent = (settings.proposal || {}).accent || "#f59e0b";
  const out = { enabled: !!f.enabled, sent: 0, due: [] as Record<string, unknown>[], errors: [] as string[] };
  if (!f.enabled && !dryRun) return out;
  const customers: Record<string, Rec["data"]> = Object.fromEntries(((await db("records?coll=eq.customers&select=id,data")) || []).map((r: Rec) => [r.id, r.data]));
  const t = today(), base = APP_URL.replace(/#.*$/, "");
  const firstName = (c: Rec["data"]) => String(c?.contact || "").trim().split(/\s+/)[0] || "there";
  const link = (c: Rec["data"]) => c?.portalToken && c.name !== "Unassigned" ? `${base}#/p/${c.portalToken}` : "";

  // proposals: still open, opted in to follow-ups, and due for the next one in the schedule
  const days = numList(f.days, [7, 21, 45]), maxAge = +f.maxAge || 90;
  for (const r of ((await db("records?coll=eq.estimates&data->>status=eq.sent&select=id,data")) || []) as Rec[]) {
    const e = r.data, c = customers[e.customerId];
    // a bid sent to several contractors carries followList; otherwise it is the single address it was sent to
    const targets: { to: string[]; contact: string; customer: string; link: string }[] = (Array.isArray(e.followList) && e.followList.length
      ? e.followList.map((x: Rec["data"]) => ({ to: list(x.to).filter(isEmail), contact: String(x.contact || "there"), customer: customers[x.customerId]?.name || "", link: x.customerId === e.customerId ? link(c) : "" }))
      : [{ to: list(e.followTo || c?.email).filter(isEmail), contact: firstName(c), customer: c?.name || "", link: link(c) }]).filter((x: { to: string[] }) => x.to.length);
    const start = e.sentAt || e.createdAt, k = +e.followCount || 0;
    if (!e.follow || !targets.length || !start || k >= days.length) continue;
    const age = daysBetween(start, t);
    if (age < days[k] || age > maxAge || e.lastFollowAt === t) continue;
    const common = { company: settings.company || "", project: e.title || "", total: money(estimateTotal(e)), date: fmtDate(start), number: String(e.number ?? "") };
    for (const tg of targets) out.due.push({ kind: "proposal", id: r.id, number: e.number, title: e.title, to: tg.to, step: k + 1, age });
    if (dryRun) continue;
    const log: Record<string, unknown>[] = [];
    for (const tg of targets) {      // one separate email per contractor, so they never see each other
      const vars = { ...common, contact: tg.contact, customer: tg.customer, link: tg.link };
      const subject = fill(tpl.followSubject, vars);
      try {
        await sendMail({ to: tg.to, subject, html: emailHTML(fill(tpl.followBody, vars), tg.link ? { label: "View proposal", url: tg.link } : null, settings, accent) });
        log.push({ date: t, to: tg.to.join(", "), subject, kind: `follow-up ${k + 1}`, auto: true }); out.sent++;
      } catch (x) { out.errors.push(`Proposal #${e.number} (${tg.to.join(", ")}): ${(x as Error).message}`); }
    }
    if (log.length) {
      try { await db(`records?coll=eq.estimates&id=eq.${encodeURIComponent(r.id)}`, { method: "PATCH", body: JSON.stringify({ data: { ...e, followCount: k + 1, lastFollowAt: t, emails: [...(e.emails || []), ...log] } }) }); }
      catch (x) { out.errors.push(`Proposal #${e.number}: ${(x as Error).message}`); }
    }
  }

  // invoices: sent, unpaid and past due
  const idays = numList(f.invoiceDays, [3, 14, 30]);
  if (f.invoices !== false) for (const r of ((await db("records?coll=eq.invoices&data->>status=eq.sent&select=id,data")) || []) as Rec[]) {
    const i = r.data, c = customers[i.customerId], to = list(i.followTo || c?.email).filter(isEmail), k = +i.remindCount || 0, bal = invoiceBalance(i);
    if (!i.follow || !to.length || !i.due || bal < 0.01 || k >= idays.length) continue;
    const late = daysBetween(i.due, t);
    if (late < idays[k] || i.lastRemindAt === t) continue;
    const vars = { contact: firstName(c), customer: c?.name || "", company: settings.company || "", number: String(i.number ?? ""), balance: money(bal), due: fmtDate(i.due), link: link(c) };
    const subject = fill(tpl.reminderSubject, vars);
    out.due.push({ kind: "invoice", id: r.id, number: i.number, to, step: k + 1, late });
    if (dryRun) continue;
    try {
      await sendMail({ to, subject, html: emailHTML(fill(tpl.reminderBody, vars), isPayLink(i.payLink) ? { label: "Pay invoice online", url: i.payLink } : vars.link ? { label: "View invoice", url: vars.link } : null, settings, accent) });
      const data = { ...i, remindCount: k + 1, lastRemindAt: t, emails: [...(i.emails || []), { date: t, to: to.join(", "), subject, kind: `reminder ${k + 1}`, auto: true }] };
      await db(`records?coll=eq.invoices&id=eq.${encodeURIComponent(r.id)}`, { method: "PATCH", body: JSON.stringify({ data }) });
      out.sent++;
    } catch (x) { out.errors.push(`Invoice #${i.number}: ${(x as Error).message}`); }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("Unsupported method", 405);
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");
    const staff = await isStaff(req);
    if (action === "runFollowups") {
      if (!staff && !(await isScheduler(req))) return fail("not allowed", 401);
      return json(await runFollowups(!!body.dryRun));
    }
    if (!staff) return fail("not signed in as staff", 401);

    if (action === "status") return json({ configured: !!(RESEND_KEY && FROM), from: FROM || null, replyTo: REPLY_TO || null });
    if (action === "send") {
      const to = list(body.to), cc = list(body.cc);
      if (!to.length || to.length + cc.length > 12 || ![...to, ...cc].every(isEmail)) return fail("Check the email addresses (up to 12, separated by commas).");
      if (!body.subject || !body.html) return fail("Subject and message are required.");
      const attachments = (Array.isArray(body.attachments) ? body.attachments : []).map((a: Record<string, unknown>) => ({ filename: String(a.filename || "attachment.pdf").replace(/[^\w.\- ]+/g, "_").slice(0, 120), content: String(a.content || "") }));
      if (attachments.reduce((n: number, a: { content: string }) => n + a.content.length, 0) > 12_000_000) return fail("Attachments are too large to email (limit about 9 MB).");
      const id = await sendMail({ to, cc, subject: String(body.subject).slice(0, 300), html: String(body.html), attachments });
      return json({ id });
    }
    return fail("Unknown action");
  } catch (e) {
    return fail((e as Error).message || "Unexpected error", 500);
  }
});
