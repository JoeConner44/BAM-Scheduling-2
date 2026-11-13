/* Shared backend (Supabase): staff login + record sync, and token-based customer portal.
   When js/config.js is blank, CLOUD is false and the app runs in local demo mode. */
const CFG = window.ASPHALT_CONFIG || {};
let CLOUD = !!(CFG.supabaseUrl && CFG.supabaseAnonKey && window.supabase);
let PORTAL = null;            // portal token when a customer is viewing their link
let SB = null, snap = {}, pushTimer = null, pushing = false, again = false, pollTimer = null, lastSeen = '', pollN = 0;
const COLLS = ['customers', 'estimates', 'jobs', 'invoices', 'crews', 'rules', 'notifications'];
const isPortalHash = () => /^#\/p\//.test(location.hash);
const portalTokenFromHash = () => decodeURIComponent(location.hash.slice(4).split(/[/?]/)[0]);
if (CLOUD) SB = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } });

const flatten = db => {
  const m = {};
  COLLS.forEach(c => (db[c] || []).forEach(x => { m[c + '|' + x.id] = JSON.stringify(x); }));
  m['meta|settings'] = JSON.stringify(db.settings); m['meta|seq'] = JSON.stringify(db.seq);
  return m;
};
function rowsToDB(rows) {
  const meta = Object.fromEntries(rows.filter(r => r.coll === 'meta').map(r => [r.id, r.data]));
  if (!meta.settings) return null;
  const db = { v: 1, settings: meta.settings, seq: meta.seq || { est: 1000, inv: 2000 } };
  COLLS.forEach(c => { db[c] = rows.filter(r => r.coll === c).map(r => r.data); });
  return db;
}
async function fetchAllRows() {
  let all = [], from = 0;
  for (;;) {
    const { data, error } = await SB.from('records').select('coll,id,data,updated_at').order('coll').order('id').range(from, from + 999);
    if (error) throw error; all = all.concat(data); data.forEach(r => { if (r.updated_at > lastSeen) lastSeen = r.updated_at; }); if (data.length < 1000) return all; from += 1000;
  }
}

/* ---------- push (debounced, diff-based) ---------- */
function cloudQueue() { clearTimeout(pushTimer); pushTimer = setTimeout(cloudPush, 500); }
async function cloudPush() {
  pushTimer = null;
  if (pushing) { again = true; return; }
  pushing = true;
  try {
    const cur = flatten(DB), up = [], del = {};
    Object.keys(cur).forEach(k => { if (cur[k] !== snap[k]) { const [coll, ...r] = k.split('|'); up.push({ coll, id: r.join('|'), data: JSON.parse(cur[k]) }); } });
    Object.keys(snap).forEach(k => { if (!(k in cur)) { const [coll, ...r] = k.split('|'); (del[coll] = del[coll] || []).push(r.join('|')); } });
    for (let i = 0; i < up.length; i += 100) { const { error } = await SB.from('records').upsert(up.slice(i, i + 100), { onConflict: 'coll,id' }); if (error) throw error; }
    for (const c of Object.keys(del)) { const { error } = await SB.from('records').delete().eq('coll', c).in('id', del[c]); if (error) throw error; }
    snap = cur; setSync('ok');
  } catch (e) { setSync('err'); toast('Sync failed: ' + (e.message || e) + ' — retrying', 'err'); setTimeout(cloudQueue, 6000); }
  finally { pushing = false; if (again) { again = false; cloudQueue(); } }
}
function setSync(s) { const el = $('#sync'); if (el) el.textContent = s === 'ok' ? '● Synced' : s === 'err' ? '● Offline — retrying' : '● Saving…'; }

/* ---------- pull / poll ---------- */
async function cloudPull() {
  const rows = await fetchAllRows(), db = rowsToDB(rows);
  if (!db) return false;
  DB = db; snap = flatten(db); return true;
}
/* Incremental poll: fetch only records changed since the last one we saw (keeps bandwidth tiny even with thousands of records). */
const canon = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x).sort().reduce((o, q) => (o[q] = x[q], o), {}) : x);
function applyRow(r) {
  const key = r.coll + '|' + r.id;
  if (snap[key] && canon(JSON.parse(snap[key])) === canon(r.data)) return false;   // our own save coming back
  if (r.coll === 'meta') { if (r.id === 'settings') DB.settings = r.data; else if (r.id === 'seq') DB.seq = r.data; }
  else if (COLLS.includes(r.coll)) { const arr = DB[r.coll], i = arr.findIndex(x => x.id === r.id); if (i >= 0) arr[i] = r.data; else arr.push(r.data); }
  snap[key] = JSON.stringify(r.data); return true;
}
async function cloudPollChanges() {
  let changed = false;
  for (;;) {
    const { data, error } = await SB.from('records').select('coll,id,data,updated_at').gt('updated_at', lastSeen).order('updated_at').limit(500);
    if (error) throw error;
    data.forEach(r => { if (applyRow(r)) changed = true; if (r.updated_at > lastSeen) lastSeen = r.updated_at; });
    if (data.length < 500) break;
  }
  if (++pollN % 15 === 0) {   // every ~5 minutes: cheap id-only listing to notice records deleted elsewhere
    const remote = new Set(); let from = 0;
    for (;;) { const { data, error } = await SB.from('records').select('coll,id').order('coll').order('id').range(from, from + 999); if (error) throw error; data.forEach(r => remote.add(r.coll + '|' + r.id)); if (data.length < 1000) break; from += 1000; }
    Object.keys(snap).forEach(k => { if (remote.has(k)) return; const [c, ...rest] = k.split('|'); if (COLLS.includes(c)) DB[c] = DB[c].filter(x => x.id !== rest.join('|')); delete snap[k]; changed = true; });
  }
  return changed;
}
const idle = () => !pushTimer && !pushing && !$('#modal.open') && !/INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '');
async function cloudPoll() {
  if (!CLOUD || PORTAL || document.hidden || !idle()) return;
  try {
    let changed = await cloudPollChanges();
    if (await processPortalEvents()) changed = true;
    if (changed) { runChecks(); render(); }
  } catch (e) { setSync('err'); }
}
async function processPortalEvents() {
  const { data, error } = await SB.from('portal_events').select('*').order('created_at');
  if (error || !data || !data.length) return false;
  data.forEach(ev => {
    const c = byId('customers', ev.customer_id), inv = ev.payload.invoiceId && byId('invoices', ev.payload.invoiceId);
    if (ev.kind === 'message') { if (c) c.activity.push({ date: today(), text: 'Portal message: ' + ev.payload.text }); pushNote({ to: 'Office', title: `Message from ${c ? c.name : 'a customer'}`, body: ev.payload.text, link: '#/crm', rule: 'Customer portal' }); }
    else if (ev.kind === 'pay_request') pushNote({ to: 'Office', title: `${c ? c.name : 'Customer'} wants to pay invoice #${inv ? inv.number : '?'}`, body: inv ? money(invBalance(inv)) + ' due — send payment instructions or record the payment.' : '', link: '#/invoices', rule: 'Customer portal' });
  });
  const { error: e2 } = await SB.from('portal_events').delete().in('id', data.map(d => d.id));
  if (e2) return false;
  save(); return true;
}

/* ---------- auth ---------- */
async function cloudSession() { const { data } = await SB.auth.getSession(); return data.session; }
function showGate(html) { document.body.classList.add('portal-mode'); $('#title').textContent = ''; $('#main').innerHTML = `<div class="gate card">${html}</div>`; }
function showLogin(msg) {
  showGate(`<h1>${esc((DB && DB.settings && DB.settings.company) || 'AsphaltPro')}</h1><p class="muted">Staff sign-in</p>${msg ? `<p class="neg">${esc(msg)}</p>` : ''}
  <form id="loginForm"><label class="block"><span>Email</span><input type="email" name="email" required autocomplete="username"></label><label class="block"><span>Password</span><input type="password" name="pw" required autocomplete="current-password"></label><button class="btn primary" style="width:100%;justify-content:center">Sign in</button></form>`);
  $('#loginForm').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target); const { error } = await SB.auth.signInWithPassword({ email: f.get('email'), password: f.get('pw') }); if (error) showLogin(error.message); else location.reload(); };
}
async function cloudSignOut() { await SB.auth.signOut(); location.hash = ''; location.reload(); }
ACT.signOut = cloudSignOut;

/* ---------- customer portal ---------- */
async function portalCall(fn, args) {
  const { data, error } = await SB.rpc(fn, { p_token: PORTAL, ...args });
  if (error) throw new Error(error.message); return data;
}
async function portalReload() {
  const d = await SB.rpc('portal_get', { p_token: PORTAL }).then(r => r.data);
  if (!d) throw new Error('This link is no longer valid.');
  DB = { v: 1, seq: {}, settings: d.settings || { company: 'Your contractor', services: JSON.parse(JSON.stringify(DEFAULT_SERVICES)) }, crews: [], rules: [], notifications: [], customers: [d.customer], estimates: d.estimates, jobs: d.jobs, invoices: d.invoices };
  render();
}
async function bootPortal(token) {
  PORTAL = token;
  try { await portalReload(); location.hash = '#/p/' + token; }
  catch (e) { showGate(`<h1>Link not valid</h1><p class="muted">This portal link has expired or was reset. Please ask your contractor for a new one.</p>`); }
}

/* ---------- first-run choice when the server is empty ---------- */
function firstRun() {
  const local = (() => { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } })();
  showGate(`<h1>Set up your company</h1><p class="muted">The shared database is empty. Start fresh, try the demo data, or move over what’s saved in this browser.</p>
  <div class="btns col"><button class="btn primary" data-act="frEmpty">Start with an empty company</button><button class="btn" data-act="frDemo">Load demo data</button>${local && local.v === 1 ? '<button class="btn" data-act="frLocal">Use data from this browser</button>' : ''}</div>`);
}
const frGo = async db => { DB = db; runChecks(); snap = {}; await cloudPush(); location.reload(); };
ACT.frEmpty = () => { const d = seed(); Object.assign(d, { customers: [], estimates: [], jobs: [], invoices: [], notifications: [] }); frGo(d); };
ACT.frDemo = () => frGo(seed());
ACT.frLocal = () => frGo(JSON.parse(localStorage.getItem(KEY)));
