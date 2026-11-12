/* AsphaltPro core: helpers, data store, seed data, automation engine */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => (n < 0 ? '-' : '') + '$' + Math.abs(Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
const money2 = n => (n < 0 ? '-' : '') + '$' + Math.abs(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (n, d = 1) => (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: d });
const uid = p => p + '_' + Math.random().toString(36).slice(2, 9);
const iso = d => { d = new Date(d); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const parseD = s => new Date(s + 'T00:00:00');
const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return iso(d); };
const today = () => iso(new Date());
const fmtD = s => s ? parseD(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const fmtShort = s => parseD(s).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const weekStart = s => { const d = parseD(s); const k = (d.getDay() + 6) % 7; d.setDate(d.getDate() - k); return iso(d); };

const KEY = 'asphaltpro.v1';
let DB = null;

const DEFAULT_SERVICES = [
  { id: 'hma', name: 'Hot mix asphalt paving', unit: 'ton', price: 165 },
  { id: 'overlay', name: 'Asphalt overlay', unit: 'ton', price: 150 },
  { id: 'mill', name: 'Mill & remove existing', unit: 'sqft', price: 1.1 },
  { id: 'base', name: 'Stone base prep', unit: 'sqft', price: 1.6 },
  { id: 'patch', name: 'Full-depth patching', unit: 'sqft', price: 9 },
  { id: 'seal', name: 'Sealcoating', unit: 'sqft', price: 0.22 },
  { id: 'crack', name: 'Crack filling', unit: 'lf', price: 1.35 },
  { id: 'stripe', name: 'Line striping', unit: 'lf', price: 0.55 },
  { id: 'signs', name: 'Signs / wheel stops', unit: 'ea', price: 85 },
];
const UNIT_LABEL = { ton: 'tons', sqft: 'sf', lf: 'lf', ea: 'ea' };

const TRIGGERS = {
  'lead.new': { label: 'New lead added', actions: ['notify'] },
  'estimate.signed': { label: 'Proposal signed', actions: ['notify', 'createJob'] },
  'job.completed': { label: 'Job marked complete', actions: ['notify', 'createInvoice'] },
  'job.overbudget': { label: 'Job cost passes budget threshold', actions: ['notify'] },
  'invoice.overdue': { label: 'Invoice becomes overdue', actions: ['notify'] },
  'invoice.paid': { label: 'Invoice paid in full', actions: ['notify'] },
};
const ACTIONS = { notify: 'Send alert to role', createJob: 'Create job from proposal', createInvoice: 'Draft invoice for balance' };
const ROLES = ['Owner', 'Estimator', 'Office', 'Foreman'];

function loadDB() {
  try { DB = JSON.parse(localStorage.getItem(KEY)); } catch (e) { DB = null; }
  if (!DB || DB.v !== 1) { DB = seed(); save(); }
}
function save() {
  if (typeof PORTAL !== 'undefined' && PORTAL) return;           // customers never write directly
  if (typeof CLOUD !== 'undefined' && CLOUD) return cloudQueue(); // shared backend
  try { localStorage.setItem(KEY, JSON.stringify(DB)); } catch (e) { toast('Storage full — export your data from Settings', 'err'); }
}
const newToken = () => crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
function resetDemo() { DB = seed(); save(); }

/* ---------- calculations ---------- */
const svc = id => DB.settings.services.find(s => s.id === id) || DB.settings.services[0];
function rowCalc(r) {
  const s = svc(r.service);
  const area = +r.area || 0;
  let qty;
  if (s.unit === 'ton') qty = area * (+r.depth || 0) / 12 * 145 / 2000; // 145 lb/cu ft compacted HMA
  else if (s.unit === 'sqft') qty = area;
  else qty = +r.qty || 0;
  const price = r.price === null || r.price === '' || r.price === undefined ? s.price : +r.price;
  return { unit: s.unit, area, qty, price, amt: qty * price };
}
const lineAmt = l => (+l.qty || 0) * (+l.price || 0);
const blank = v => v === '' || v === null || v === undefined;
const isSection = l => !!String(l.desc || '').trim() && blank(l.qty) && blank(l.price) && !String(l.unit || '').trim();
const isOpenEst = e => e.status === 'draft' || e.status === 'sent';
const estAge = e => Math.floor((parseD(today()) - parseD(e.createdAt)) / 864e5);
const ageColor = e => { const d = estAge(e); return d <= 90 ? 'green' : d <= 180 ? 'yellow' : 'red'; };
function estTotals(e) {
  const rows = e.rows.reduce((a, r) => a + rowCalc(r).amt, 0);
  const lines = e.lines.reduce((a, l) => a + lineAmt(l), 0);
  const calc = rows + lines;
  // lump-sum override wins; otherwise the calculated total, rounded down to whole dollars unless switched off
  const sub = !blank(e.lumpSum) ? +e.lumpSum : (e.roundDown === false ? calc : Math.floor(calc + 1e-6));
  const tax = sub * (+e.taxRate || 0) / 100;
  return { rows, lines, calc, sub, tax, total: sub + tax, tons: e.rows.reduce((a, r) => { const c = rowCalc(r); return a + (c.unit === 'ton' ? c.qty : 0); }, 0) };
}
const invTotal = i => { const s = i.items.reduce((a, l) => a + (+l.qty || 0) * (+l.price || 0), 0); return s + s * (+i.taxRate || 0) / 100; };
const invPaid = i => i.payments.reduce((a, p) => a + (+p.amount || 0), 0);
const invBalance = i => Math.max(0, invTotal(i) - invPaid(i));
function invStatus(i) {
  if (invTotal(i) > 0 && invBalance(i) < 0.005) return 'paid';
  if (i.status === 'draft') return 'draft';
  if (i.due < today()) return 'overdue';
  return invPaid(i) > 0 ? 'partial' : 'sent';
}
const jobCost = j => j.costs.reduce((a, c) => a + (+c.amount || 0), 0);
const jobBudget = j => Object.values(j.budget).reduce((a, b) => a + (+b || 0), 0);
const jobContract = j => { const e = byId('estimates', j.estimateId); return e ? estTotals(e).total : (+j.contract || 0); };
const byId = (coll, id) => DB[coll].find(x => x.id === id);
const custName = id => (byId('customers', id) || { name: '(deleted)' }).name;
const nextNum = k => ++DB.seq[k];

/* ---------- automation engine ---------- */
function pushNote(n) { DB.notifications.unshift({ id: uid('n'), date: new Date().toISOString(), read: false, ...n }); }
function fire(trigger, ctx = {}) {
  DB.rules.filter(r => r.enabled && r.trigger === trigger).forEach(r => {
    if (r.action === 'createJob' && ctx.estimate) {
      const e = ctx.estimate;
      if (!DB.jobs.some(j => j.estimateId === e.id)) {
        const j = makeJob(e); DB.jobs.push(j);
        pushNote({ to: r.notifyTo, title: `Job created: ${j.name}`, body: 'Auto-created from signed proposal. Schedule a crew.', link: '#/schedule', rule: r.name });
      }
    } else if (r.action === 'createInvoice' && ctx.job) {
      const inv = makeInvoice(ctx.job, true);
      if (inv) pushNote({ to: r.notifyTo, title: `Draft invoice #${inv.number} created`, body: `${custName(ctx.job.customerId)} — ${money(invTotal(inv))}. Review and send.`, link: '#/invoices', rule: r.name });
    } else if (r.action === 'notify') {
      pushNote({ to: r.notifyTo, rule: r.name, link: ctx.link || '#/dashboard', title: ctx.title || TRIGGERS[trigger].label, body: ctx.body || '' });
    }
  });
  save();
}
function makeJob(e) {
  const t = estTotals(e).total;
  return {
    id: uid('j'), name: e.title, customerId: e.customerId, estimateId: e.id, address: e.address || '',
    status: 'unscheduled', date: null, days: 1, crewId: null,
    budget: { material: Math.round(t * .38), labor: Math.round(t * .22), equipment: Math.round(t * .12), other: Math.round(t * .06) },
    costs: [], logs: [], photos: [], notes: '',
    checklist: ['Utilities marked / 811 call confirmed', 'Customer notified of schedule', 'Traffic control & barricades staged', 'Mix design & tickets verified', 'Subgrade inspected', 'Compaction / density verified', 'Striping & cleanup complete', 'Final walkthrough with customer'].map(t => ({ t, done: false })),
  };
}
function makeInvoice(job, onlyBalance) {
  const total = jobContract(job);
  const billed = DB.invoices.filter(i => i.jobId === job.id).reduce((a, i) => a + invTotal(i), 0);
  const amt = onlyBalance ? total - billed : total;
  if (amt <= 0.5) return null;
  const inv = { id: uid('i'), number: nextNum('inv'), customerId: job.customerId, jobId: job.id, items: [{ desc: `${job.name}${billed ? ' — final balance' : ''}`, qty: 1, unit: 'ls', price: Math.round(amt * 100) / 100 }], taxRate: 0, issued: today(), due: addDays(today(), 30), status: 'draft', payments: [] };
  DB.invoices.push(inv); return inv;
}
function runChecks() {
  DB.customers.forEach(c => { if (!c.portalToken) c.portalToken = newToken(); });
  // proposals signed by customers through the portal: run the same automations as an in-office signature
  DB.estimates.forEach(e => {
    if (e.status === 'signed' && e.autoRan === false) {
      e.autoRan = true; const c = byId('customers', e.customerId);
      if (c) { if (c.status !== 'customer') c.status = 'customer'; c.activity.push({ date: today(), text: `Customer signed proposal #${e.number} online — ${e.title}` }); }
      fire('estimate.signed', { estimate: e, title: `Proposal #${e.number} signed online — ${money(estTotals(e).total)}`, body: `${custName(e.customerId)} · ${e.title}`, link: '#/estimates/' + e.id });
    }
  });
  DB.invoices.forEach(i => {
    if (invStatus(i) === 'overdue' && !i.overdueNotified) {
      i.overdueNotified = true;
      fire('invoice.overdue', { title: `Invoice #${i.number} overdue`, body: `${custName(i.customerId)} owes ${money(invBalance(i))} (due ${fmtD(i.due)}).`, link: '#/invoices' });
    }
  });
  DB.jobs.forEach(j => {
    const b = jobBudget(j); if (!b || j.overNotified) return;
    const pct = jobCost(j) / b * 100;
    const rule = DB.rules.find(r => r.enabled && r.trigger === 'job.overbudget');
    if (rule && pct >= (+rule.threshold || 90)) {
      j.overNotified = true;
      fire('job.overbudget', { title: `${j.name} at ${Math.round(pct)}% of budget`, body: 'Review costs before more spend is approved.', link: '#/jobs/' + j.id });
    }
  });
  save();
}

/* ---------- seed data ---------- */
function seed() {
  const t = today(), ws = weekStart(t);
  const D = {
    v: 1, seq: { est: 1000, inv: 2000 },
    settings: { company: 'Your Asphalt Co.', phone: '(555) 010-2030', email: 'office@yourasphalt.com', address: '100 Quarry Rd', terms: 'Pricing valid 30 days. 50% deposit due at signing, balance due net 30 on completion. Price excludes unforeseen subgrade failure, permits, and engineering unless listed. Warranty: 1 year workmanship.', services: JSON.parse(JSON.stringify(DEFAULT_SERVICES)) },
    crews: [{ id: 'cA', name: 'Crew A — Paving', color: '#f59e0b' }, { id: 'cB', name: 'Crew B — Paving', color: '#3b82f6' }, { id: 'cC', name: 'Crew C — Seal & Stripe', color: '#10b981' }],
    customers: [], estimates: [], jobs: [], invoices: [], notifications: [],
    rules: [
      { id: 'r1', name: 'Signed proposal → create job', trigger: 'estimate.signed', action: 'createJob', notifyTo: 'Office', enabled: true },
      { id: 'r2', name: 'Signed proposal → alert owner', trigger: 'estimate.signed', action: 'notify', notifyTo: 'Owner', enabled: true },
      { id: 'r3', name: 'Job complete → draft invoice', trigger: 'job.completed', action: 'createInvoice', notifyTo: 'Office', enabled: true },
      { id: 'r4', name: 'Job at 90% of budget → alert owner', trigger: 'job.overbudget', action: 'notify', notifyTo: 'Owner', threshold: 90, enabled: true },
      { id: 'r5', name: 'Overdue invoice → alert office', trigger: 'invoice.overdue', action: 'notify', notifyTo: 'Office', enabled: true },
      { id: 'r6', name: 'New lead → alert estimator', trigger: 'lead.new', action: 'notify', notifyTo: 'Estimator', enabled: true },
    ],
  };
  DB = D; // helpers (estTotals, svc…) read the global DB while seeding
  const C = (name, contact, status, addr, src) => { const c = { id: uid('c'), name, contact, email: contact.split(' ')[0].toLowerCase() + '@example.com', phone: '(555) 01' + Math.floor(Math.random() * 90 + 10) + '-' + Math.floor(Math.random() * 9000 + 1000), address: addr, status, source: src, notes: '', activity: [{ date: addDays(t, -20), text: 'Added to CRM' }] }; D.customers.push(c); return c; };
  const c1 = C('Riverside Shopping Plaza', 'Dana Whitfield', 'customer', '2200 River Rd', 'Referral');
  const c2 = C('Maple Grove HOA', 'Tom Reyes', 'customer', 'Maple Grove Dr', 'Repeat');
  const c3 = C('Hartley Logistics', 'Priya Nair', 'prospect', '8 Industrial Pkwy', 'Web form');
  const c4 = C("St. Anne's Church", 'Michael Doyle', 'lead', '45 Church St', 'Door hanger');
  const c5 = C('Kline Auto Group', 'Brett Kline', 'customer', '910 Route 9', 'Repeat');
  const c6 = C('Oakridge Apartments', 'Susan Lee', 'prospect', '300 Oakridge Ln', 'Google');
  const E = (c, title, status, rows, lines, daysAgo, sig) => {
    const e = { id: uid('e'), number: ++D.seq.est, customerId: c.id, title, address: c.address, status, createdAt: addDays(t, -daysAgo), taxRate: 0, terms: D.settings.terms, rows: rows.map(r => ({ id: uid('r'), price: null, length: '', width: '', depth: '', qty: '', label: '', ...r })), lines: lines.map(l => ({ id: uid('l'), ...l })), signature: null };
    if (sig) e.signature = { name: c.contact, date: addDays(t, -daysAgo + 3), img: null };
    D.estimates.push(e); return e;
  };
  const e1 = E(c1, 'Parking lot mill & overlay', 'signed', [{ service: 'mill', label: 'Main lot', area: 42000 }, { service: 'overlay', label: 'Main lot 2" lift', area: 42000, depth: 2 }, { service: 'stripe', label: 'Stalls & lanes', qty: 3800 }, { service: 'signs', label: 'ADA signs', qty: 6 }], [{ desc: 'Traffic control & mobilization', qty: 1, unit: 'ls', price: 2400 }], 75, true);
  const e2 = E(c2, 'Street resurfacing — Maple Grove Dr', 'signed', [{ service: 'mill', label: 'Roadway', area: 61000 }, { service: 'overlay', label: '1.5" surface course', area: 61000, depth: 1.5 }, { service: 'patch', label: 'Failed sections', area: 900 }], [{ desc: 'Mobilization', qty: 1, unit: 'ls', price: 1800 }], 22, true);
  const e3 = E(c3, 'New truck court — 4" binder + 2" surface', 'sent', [{ service: 'base', label: 'Subgrade & stone', area: 85000 }, { service: 'hma', label: 'Binder 4"', area: 85000, depth: 4 }, { service: 'hma', label: 'Surface 2"', area: 85000, depth: 2 }, { service: 'stripe', label: 'Truck lanes', qty: 5200 }], [{ desc: 'Mobilization', qty: 2, unit: 'ls', price: 3500 }], 6);
  const e4 = E(c5, 'Dealership seal coat & restripe', 'signed', [{ service: 'crack', label: 'Cracks', qty: 2600 }, { service: 'seal', label: 'Front & rear lots', area: 54000 }, { service: 'stripe', label: 'Stalls', qty: 4200 }], [], 14, true);
  E(c6, 'Apartment drive repave', 'draft', [{ service: 'mill', label: 'Drive aisle', area: 18000 }, { service: 'overlay', label: '2" surface', area: 18000, depth: 2 }], [{ desc: 'Mobilization', qty: 1, unit: 'ls', price: 1500 }], 2);
  const J = (e, status, off, days, crew, pct, notes) => {
    const j = makeJob(e); j.status = status; j.date = off === null ? null : addDays(ws, off); j.days = days; j.crewId = crew; j.notes = notes || '';
    const tot = estTotals(e).total, b = j.budget;
    if (pct) { [['material', .95], ['labor', .9], ['equipment', .9], ['other', .6]].forEach(([k, f]) => { j.costs.push({ id: uid('k'), date: j.date || t, cat: k, desc: { material: 'Hot mix & stone tickets', labor: 'Crew payroll', equipment: 'Equipment & fuel', other: 'Traffic control / permits' }[k], amount: Math.round(b[k] * f * pct) }); }); }
    D.jobs.push(j); return j;
  };
  const j1 = J(e1, 'complete', -14, 3, 'cA', 1.02, 'Customer wants work done overnight.');
  j1.logs.push({ id: uid('g'), date: addDays(ws, -14), weather: 'Sunny, 64°F', crew: 8, tons: 410, text: 'Milled and removed. Tack coat applied.' }, { id: uid('g'), date: addDays(ws, -12), weather: 'Clear, 61°F', crew: 8, tons: 460, text: 'Placed overlay, 2 lifts. Striping scheduled.' });
  j1.checklist.forEach(c => c.done = true);
  const j2 = J(e2, 'in-progress', 0, 4, 'cB', .55, 'Notify residents 48 hrs ahead; one lane open at all times.');
  j2.logs.push({ id: uid('g'), date: today(), weather: 'Overcast, 58°F', crew: 7, tons: 238, text: 'Milling complete on east half. Hauled 14 loads.' });
  j2.checklist.slice(0, 3).forEach(c => c.done = true);
  J(e4, 'scheduled', 2, 2, 'cC', 0, 'Crack fill before seal; weather dependent.');
  const I = (j, items, issued, due, status, pays) => { const i = { id: uid('i'), number: ++D.seq.inv, customerId: j.customerId, jobId: j.id, items, taxRate: 0, issued, due, status, payments: pays || [] }; D.invoices.push(i); return i; };
  const t1 = estTotals(e1).total;
  I(j1, [{ desc: 'Parking lot mill & overlay — deposit', qty: 1, unit: 'ls', price: Math.round(t1 / 2) }], addDays(t, -75), addDays(t, -60), 'sent', [{ id: uid('p'), date: addDays(t, -70), amount: Math.round(t1 / 2), method: 'Check' }]);
  I(j1, [{ desc: 'Parking lot mill & overlay — balance', qty: 1, unit: 'ls', price: Math.round(t1) - Math.round(t1 / 2) }], addDays(t, -12), addDays(t, 18), 'sent', [{ id: uid('p'), date: addDays(t, -4), amount: Math.round(t1) - Math.round(t1 / 2), method: 'ACH' }]);
  const t2 = estTotals(e2).total;
  I(j2, [{ desc: 'Maple Grove resurfacing — 50% deposit', qty: 1, unit: 'ls', price: Math.round(t2 / 2) }], addDays(t, -22), addDays(t, -8), 'sent');
  D.customers[0].activity.push({ date: addDays(t, -12), text: 'Project completed — Parking lot mill & overlay' });
  return D;
}
