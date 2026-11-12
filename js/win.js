/* WIN WORK: Dashboard analytics, CRM, Estimates / takeoff / mapping / proposals */
const VIEWS = {};

/* ================= DASHBOARD / ANALYTICS ================= */
VIEWS.dashboard = () => {
  const ests = DB.estimates, T = e => estTotals(e).total;
  const open = ests.filter(e => e.status === 'draft' || e.status === 'sent');
  const signed = ests.filter(e => e.status === 'signed'), declined = ests.filter(e => e.status === 'declined'), sent = ests.filter(e => e.status === 'sent');
  const decided = signed.length + declined.length + sent.length;
  const winRate = decided ? Math.round(signed.length / decided * 100) : 0;
  const pays = DB.invoices.flatMap(i => i.payments);
  const ar = DB.invoices.filter(i => invStatus(i) !== 'draft').reduce((a, i) => a + invBalance(i), 0);
  const overdue = DB.invoices.filter(i => invStatus(i) === 'overdue');
  const done = DB.jobs.filter(j => j.status === 'complete');
  const rev = done.reduce((a, j) => a + jobContract(j), 0), cost = done.reduce((a, j) => a + jobCost(j), 0);
  const margin = rev ? Math.round((rev - cost) / rev * 100) : null;
  // revenue collected per month, last 6 months
  const months = []; const now = new Date();
  for (let k = 5; k >= 0; k--) { const d = new Date(now.getFullYear(), now.getMonth() - k, 1); months.push({ key: iso(d).slice(0, 7), label: d.toLocaleString('en-US', { month: 'short' }), value: 0 }); }
  pays.forEach(p => { const m = months.find(m => m.key === p.date.slice(0, 7)); if (m) m.value += +p.amount; });
  const ws = weekStart(today()), we = addDays(ws, 6);
  const thisWeek = DB.jobs.filter(j => j.date && j.date <= we && addDays(j.date, j.days - 1) >= ws && j.status !== 'complete');
  const unread = DB.notifications.filter(n => !n.read).slice(0, 5);
  const funnel = ['draft', 'sent', 'signed', 'declined'].map(s => ({ label: s, value: ests.filter(e => e.status === s).reduce((a, e) => a + T(e), 0) }));
  const jobMargins = DB.jobs.filter(j => j.costs.length).map(j => { const c = jobContract(j), k = jobCost(j); return { j, m: c ? (c - k) / c * 100 : 0 }; });
  return {
    title: 'Dashboard', html: `
    <div class="kpis">
      <div class="kpi"><span>Open pipeline</span><b>${money(open.reduce((a, e) => a + T(e), 0))}</b><small>${open.length} proposals out</small></div>
      <div class="kpi"><span>Win rate</span><b>${winRate}%</b><small>${signed.length} signed of ${decided}</small></div>
      <div class="kpi"><span>Collected (all time)</span><b>${money(pays.reduce((a, p) => a + +p.amount, 0))}</b><small>${pays.length} payments</small></div>
      <div class="kpi ${overdue.length ? 'warn' : ''}"><span>Outstanding A/R</span><b>${money(ar)}</b><small>${overdue.length} overdue</small></div>
      <div class="kpi"><span>Margin, completed jobs</span><b>${margin === null ? '—' : margin + '%'}</b><small>${done.length} jobs</small></div>
      <div class="kpi"><span>Active jobs</span><b>${DB.jobs.filter(j => j.status === 'in-progress').length}</b><small>${thisWeek.length} on this week’s board</small></div>
    </div>
    <div class="cols">
      <div class="card"><h3>Cash collected by month</h3>${barChart(months)}</div>
      <div class="card"><h3>Proposal value by stage</h3>${barChart(funnel)}</div>
    </div>
    <div class="cols">
      <div class="card"><h3>Needs attention <a class="link" href="#/automation">Inbox →</a></h3>
        ${unread.length ? unread.map(n => `<a class="note" href="${n.link || '#/automation'}"><b>${esc(n.title)}</b><span>${esc(n.body)}</span><em>${esc(n.to)}</em></a>`).join('') : empty('All clear', 'No unread alerts')}
      </div>
      <div class="card"><h3>This week on the board <a class="link" href="#/schedule">Schedule →</a></h3>
        ${thisWeek.length ? thisWeek.map(j => `<a class="note" href="#/jobs/${j.id}"><b>${esc(j.name)}</b><span>${esc(custName(j.customerId))} · ${fmtShort(j.date)} · ${j.days}d</span><em>${esc((byId('crews', j.crewId) || {}).name || '')}</em></a>`).join('') : empty('Nothing scheduled', 'Drag jobs onto the board')}
      </div>
    </div>
    <div class="card"><h3>Job margin (cost to date vs contract)</h3>
      ${jobMargins.length ? `<table><tr><th>Job</th><th>Contract</th><th>Cost</th><th>Margin</th></tr>${jobMargins.map(({ j, m }) => `<tr><td><a href="#/jobs/${j.id}">${esc(j.name)}</a></td><td>${money(jobContract(j))}</td><td>${money(jobCost(j))}</td><td>${j.status === 'complete' ? `<b class="${m < 15 ? 'neg' : 'pos'}">${num(m, 0)}%</b>` : `<span class="muted">in progress</span>`}</td></tr>`).join('')}</table>` : empty('No costs yet')}
    </div>`
  };
};

/* ================= CRM ================= */
let crmFilter = 'all', crmQ = '';
VIEWS.crm = () => {
  const list = DB.customers.filter(c => (crmFilter === 'all' || c.status === crmFilter) && (!crmQ || (c.name + c.contact + c.email + c.address).toLowerCase().includes(crmQ.toLowerCase())));
  const cnt = s => DB.customers.filter(c => s === 'all' || c.status === s).length;
  return {
    title: 'CRM', html: `
    <div class="toolbar">
      <div class="tabs">${['all', 'lead', 'prospect', 'customer'].map(s => `<button class="${crmFilter === s ? 'on' : ''}" data-act="crmFilter" data-v="${s}">${s} <i>${cnt(s)}</i></button>`).join('')}</div>
      <input type="search" id="crmSearch" placeholder="Search customers…" value="${esc(crmQ)}">
      <button class="btn primary" data-act="newCustomer">+ New customer</button>
    </div>
    <div class="card flush"><table class="hover"><tr><th>Name</th><th>Contact</th><th>Phone</th><th>Status</th><th>Pipeline</th><th>Lifetime</th></tr>
    ${list.map(c => { const es = DB.estimates.filter(e => e.customerId === c.id); const life = DB.invoices.filter(i => i.customerId === c.id).reduce((a, i) => a + invPaid(i), 0); return `<tr data-act="openCustomer" data-id="${c.id}"><td><b>${esc(c.name)}</b><br><small>${esc(c.address)}</small></td><td>${esc(c.contact)}<br><small>${esc(c.email)}</small></td><td>${esc(c.phone)}</td><td>${badge(c.status)}</td><td>${es.filter(e => e.status !== 'signed').length} open</td><td>${money(life)}</td></tr>`; }).join('') || `<tr><td colspan="6">${empty('No customers match')}</td></tr>`}</table></div>`,
    mount() { const s = $('#crmSearch'); s.oninput = () => { crmQ = s.value; const p = s.selectionStart; render(); const n = $('#crmSearch'); n.focus(); n.setSelectionRange(p, p); }; }
  };
};
ACT.crmFilter = el => { crmFilter = el.dataset.v; render(); };
const CUST_FIELDS = [
  { name: 'name', label: 'Company / customer', req: 1, wide: 1 }, { name: 'contact', label: 'Contact person' }, { name: 'phone', label: 'Phone', type: 'tel' },
  { name: 'email', label: 'Email', type: 'email' }, { name: 'status', label: 'Status', type: 'select', options: ['lead', 'prospect', 'customer'] },
  { name: 'address', label: 'Site / mailing address', wide: 1 }, { name: 'source', label: 'Lead source' }, { name: 'notes', label: 'Notes', type: 'textarea', wide: 1 }];
ACT.newCustomer = () => openForm({
  title: 'New customer', fields: CUST_FIELDS, values: { status: 'lead' }, onSubmit(v) {
    const c = { id: uid('c'), ...v, portalToken: newToken(), activity: [{ date: today(), text: 'Added to CRM' }] }; DB.customers.push(c);
    if (c.status === 'lead') fire('lead.new', { title: `New lead: ${c.name}`, body: `${c.contact || ''} · ${c.source || 'no source'}`, link: '#/crm' }); save(); render(); toast('Customer added');
  }
});
ACT.openCustomer = el => {
  const c = byId('customers', el.dataset.id), es = DB.estimates.filter(e => e.customerId === c.id), js = DB.jobs.filter(j => j.customerId === c.id), is = DB.invoices.filter(i => i.customerId === c.id);
  modal(`<h3>${esc(c.name)} ${badge(c.status)}</h3>
  <div class="two"><div><p><b>${esc(c.contact)}</b><br>${esc(c.phone)} · ${esc(c.email)}<br>${esc(c.address)}<br><small>Source: ${esc(c.source || '—')}</small></p><p class="muted">${esc(c.notes)}</p>
  <div class="btns"><button class="btn" data-act="editCustomer" data-id="${c.id}">Edit</button><button class="btn primary" data-act="newEstimateFor" data-id="${c.id}">+ Estimate</button><button class="btn" data-act="copyPortal" data-id="${c.id}">🔗 Copy portal link</button><a class="btn" href="#/portal/${c.id}" data-act="closeModal">Preview portal</a><button class="btn ghost" data-act="rotatePortal" data-id="${c.id}">Reset link</button><button class="btn danger ghost" data-act="delCustomer" data-id="${c.id}">Delete</button></div></div>
  <div><h4>Activity</h4><form id="actForm" class="inline"><input name="t" placeholder="Log a call, note, site visit…" required><button class="btn sm">Add</button></form>
  <ul class="timeline">${[...c.activity].reverse().map(a => `<li><em>${fmtD(a.date)}</em> ${esc(a.text)}</li>`).join('')}</ul></div></div>
  <h4>Estimates</h4>${es.length ? `<table>${es.map(e => `<tr><td><a href="#/estimates/${e.id}" data-act="closeModal">#${e.number} ${esc(e.title)}</a></td><td>${badge(e.status)}</td><td>${money(estTotals(e).total)}</td></tr>`).join('')}</table>` : '<p class="muted">None yet</p>'}
  <h4>Jobs</h4>${js.length ? `<table>${js.map(j => `<tr><td><a href="#/jobs/${j.id}" data-act="closeModal">${esc(j.name)}</a></td><td>${badge(j.status)}</td><td>${j.date ? fmtD(j.date) : '—'}</td></tr>`).join('')}</table>` : '<p class="muted">None yet</p>'}
  <h4>Invoices</h4>${is.length ? `<table>${is.map(i => `<tr><td>#${i.number}</td><td>${badge(invStatus(i))}</td><td>${money(invTotal(i))}</td><td>${money(invBalance(i))} due</td></tr>`).join('')}</table>` : '<p class="muted">None yet</p>'}`, { wide: true });
  $('#actForm').onsubmit = ev => { ev.preventDefault(); c.activity.push({ date: today(), text: new FormData(ev.target).get('t') }); save(); ACT.openCustomer(el); };
};
ACT.editCustomer = el => { const c = byId('customers', el.dataset.id); openForm({ title: 'Edit customer', fields: CUST_FIELDS, values: c, onSubmit(v) { Object.assign(c, v); save(); render(); toast('Saved'); } }); };
ACT.delCustomer = el => confirmBox('Delete this customer? Their estimates, jobs and invoices stay but show as “(deleted)”.', () => { DB.customers = DB.customers.filter(c => c.id !== el.dataset.id); save(); render(); });
ACT.newEstimateFor = el => { closeModal(); newEstimate(el.dataset.id); };

/* ================= ESTIMATES ================= */
let estFilter = 'all';
VIEWS.estimates = args => args[0] ? estimateEditor(byId('estimates', args[0])) : {
  title: 'Estimates & Proposals', html: `
  <div class="toolbar"><div class="tabs">${['all', 'draft', 'sent', 'signed', 'declined'].map(s => `<button class="${estFilter === s ? 'on' : ''}" data-act="estFilter" data-v="${s}">${s} <i>${DB.estimates.filter(e => s === 'all' || e.status === s).length}</i></button>`).join('')}</div><button class="btn primary" data-act="newEstimate">+ New estimate</button></div>
  <div class="card flush"><table class="hover"><tr><th>#</th><th>Project</th><th>Customer</th><th>Tons</th><th>Total</th><th>Status</th><th>Created</th></tr>
  ${DB.estimates.filter(e => estFilter === 'all' || e.status === estFilter).sort((a, b) => b.number - a.number).map(e => { const t = estTotals(e); return `<tr onclick="location.hash='#/estimates/${e.id}'"><td>${e.number}</td><td><b>${esc(e.title)}</b></td><td>${esc(custName(e.customerId))}</td><td>${num(t.tons, 0)}</td><td>${money(t.total)}</td><td>${badge(e.status)}</td><td>${fmtD(e.createdAt)}</td></tr>`; }).join('') || `<tr><td colspan="7">${empty('No estimates', 'Create one to start a take-off')}</td></tr>`}</table></div>`
};
ACT.estFilter = el => { estFilter = el.dataset.v; render(); };
ACT.newEstimate = () => {
  if (!DB.customers.length) return toast('Add a customer first', 'err');
  openForm({
    title: 'New estimate', submit: 'Create & start take-off', fields: [{ name: 'customerId', label: 'Customer', type: 'select', options: DB.customers.map(c => [c.id, c.name]), wide: 1 }, { name: 'title', label: 'Project title', req: 1, wide: 1, ph: 'e.g. Parking lot mill & overlay' }],
    onSubmit(v) { newEstimate(v.customerId, v.title); }
  });
};
function newEstimate(customerId, title) {
  const c = byId('customers', customerId);
  const e = { id: uid('e'), number: nextNum('est'), customerId, title: title || 'New project', address: c.address, status: 'draft', createdAt: today(), taxRate: 0, terms: DB.settings.terms, rows: [{ id: uid('r'), service: 'hma', label: '', area: '', length: '', width: '', depth: 2, qty: '', price: null }], lines: [], signature: null };
  DB.estimates.push(e); save(); location.hash = '#/estimates/' + e.id;
}

function estimateEditor(e) {
  if (!e) return { title: 'Estimate', html: empty('Estimate not found') };
  const t = estTotals(e), locked = e.status === 'signed';
  const svcOpts = r => DB.settings.services.map(s => `<option value="${s.id}" ${s.id === r.service ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  const rowHTML = r => {
    const c = rowCalc(r), u = c.unit, dis = f => (locked || (f === 'dims' && (u === 'lf' || u === 'ea')) || (f === 'depth' && u !== 'ton')) ? 'disabled' : '';
    return `<tr data-row="${r.id}"><td><select data-r="${r.id}" data-f="service" ${locked ? 'disabled' : ''}>${svcOpts(r)}</select></td>
    <td><input data-r="${r.id}" data-f="label" value="${esc(r.label)}" placeholder="Area / note" ${locked ? 'disabled' : ''}></td>
    <td><input type="number" class="n" data-r="${r.id}" data-f="length" value="${esc(r.length)}" ${dis('dims')}></td>
    <td><input type="number" class="n" data-r="${r.id}" data-f="width" value="${esc(r.width)}" ${dis('dims')}></td>
    <td><input type="number" class="n" data-r="${r.id}" data-f="area" value="${esc(r.area)}" ${dis('dims')}></td>
    <td><input type="number" step="0.25" class="n s" data-r="${r.id}" data-f="depth" value="${esc(r.depth)}" ${dis('depth')}></td>
    <td class="num">${(u === 'lf' || u === 'ea') ? `<input type="number" class="n" data-r="${r.id}" data-f="qty" value="${esc(r.qty)}" ${locked ? 'disabled' : ''}>` : `<span id="q-${r.id}">${num(c.qty, 1)}</span>`} <small>${UNIT_LABEL[u]}</small></td>
    <td><input type="number" step="0.01" class="n" data-r="${r.id}" data-f="price" value="${r.price === null ? '' : esc(r.price)}" placeholder="${svc(r.service).price}" ${locked ? 'disabled' : ''}></td>
    <td class="num"><b id="a-${r.id}">${money(c.amt)}</b></td><td>${locked ? '' : `<button class="ico" data-act="delRow" data-id="${r.id}" title="Remove">×</button>`}</td></tr>`;
  };
  const lineHTML = l => `<tr><td><input data-l="${l.id}" data-f="desc" value="${esc(l.desc)}" ${locked ? 'disabled' : ''}></td><td><input type="number" class="n s" data-l="${l.id}" data-f="qty" value="${esc(l.qty)}" ${locked ? 'disabled' : ''}></td><td><input class="s" data-l="${l.id}" data-f="unit" value="${esc(l.unit)}" ${locked ? 'disabled' : ''}></td><td><input type="number" step="0.01" class="n" data-l="${l.id}" data-f="price" value="${esc(l.price)}" ${locked ? 'disabled' : ''}></td><td class="num"><b id="la-${l.id}">${money2((+l.qty || 0) * (+l.price || 0))}</b></td><td>${locked ? '' : `<button class="ico" data-act="delLine" data-id="${l.id}">×</button>`}</td></tr>`;
  const job = DB.jobs.find(j => j.estimateId === e.id);
  return {
    title: `Estimate #${e.number}`, html: `
    <div class="page-head"><div><a href="#/estimates" class="link">← Estimates</a><h1>#${e.number} · ${esc(e.title)} ${badge(e.status)}</h1></div>
    <div class="btns noprint"><button class="btn" data-act="preview" data-id="${e.id}">Preview proposal</button>
    ${e.status === 'draft' ? `<button class="btn" data-act="markSent" data-id="${e.id}">Mark sent</button>` : ''}
    ${(e.status === 'draft' || e.status === 'sent') ? `<button class="btn primary" data-act="signEst" data-id="${e.id}">Capture signature</button><button class="btn ghost" data-act="declineEst" data-id="${e.id}">Declined</button>` : ''}
    ${e.status === 'signed' && !job ? `<button class="btn primary" data-act="toJob" data-id="${e.id}">Create job</button>` : ''}${job ? `<a class="btn" href="#/jobs/${job.id}">Open job →</a>` : ''}
    ${e.status === 'signed' ? `<button class="btn ghost" data-act="reopenEst" data-id="${e.id}">Reopen</button>` : ''}</div></div>
    <div class="card"><div class="grid4">
      <label><span>Customer</span><select data-e="customerId" ${locked ? 'disabled' : ''}>${DB.customers.map(c => `<option value="${c.id}" ${c.id === e.customerId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
      <label><span>Project title</span><input data-e="title" value="${esc(e.title)}" ${locked ? 'disabled' : ''}></label>
      <label><span>Job site address</span><input data-e="address" value="${esc(e.address)}" ${locked ? 'disabled' : ''}></label>
      <label><span>Sales tax %</span><input type="number" step="0.01" data-e="taxRate" value="${e.taxRate}" ${locked ? 'disabled' : ''}></label></div></div>
    <div class="card"><h3>Take-off ${locked ? '' : `<span class="btns"><button class="btn sm" data-act="mapMeasure" data-id="${e.id}">🛰 Measure on map</button><button class="btn sm primary" data-act="addRow" data-id="${e.id}">+ Line</button></span>`}</h3>
      <div class="scroll"><table class="edit"><tr><th>Service</th><th>Area / note</th><th>L (ft)</th><th>W (ft)</th><th>Area (sf)</th><th>Depth (in)</th><th>Qty</th><th>$ / unit</th><th>Amount</th><th></th></tr>${e.rows.map(rowHTML).join('')}</table></div>
      <p class="hint">Tons = area × depth ÷ 12 × 145 lb/ft³ ÷ 2000. Edit unit prices under Settings.</p></div>
    <div class="card"><h3>Other line items ${locked ? '' : `<button class="btn sm" data-act="addLine" data-id="${e.id}">+ Item</button>`}</h3>
      ${e.lines.length ? `<div class="scroll"><table class="edit"><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Price</th><th>Amount</th><th></th></tr>${e.lines.map(lineHTML).join('')}</table></div>` : '<p class="muted">Mobilization, traffic control, permits, etc.</p>'}</div>
    <div class="cols"><div class="card"><h3>Terms</h3><textarea class="terms" data-e="terms" rows="6" ${locked ? 'disabled' : ''}>${esc(e.terms)}</textarea></div>
    <div class="card totals"><div><span>Subtotal</span><b id="t-sub">${money(t.sub)}</b></div><div><span>Tax</span><b id="t-tax">${money(t.tax)}</b></div><div class="grand"><span>Total</span><b id="t-total">${money(t.total)}</b></div><div><span>Asphalt tonnage</span><b id="t-tons">${num(t.tons, 1)} t</b></div><div><span>Deposit (50%)</span><b id="t-dep">${money(t.total / 2)}</b></div></div></div>`
  };
}
function refreshEstimate(e) {
  e.rows.forEach(r => { const c = rowCalc(r); const q = $('#q-' + r.id), a = $('#a-' + r.id); if (q) q.textContent = num(c.qty, 1); if (a) a.textContent = money(c.amt); });
  e.lines.forEach(l => { const a = $('#la-' + l.id); if (a) a.textContent = money2((+l.qty || 0) * (+l.price || 0)); });
  const t = estTotals(e); $('#t-sub').textContent = money(t.sub); $('#t-tax').textContent = money(t.tax); $('#t-total').textContent = money(t.total); $('#t-tons').textContent = num(t.tons, 1) + ' t'; $('#t-dep').textContent = money(t.total / 2);
}
const curEst = () => byId('estimates', location.hash.split('/')[2]);
CHG.estimate = el => {
  const e = curEst(); if (!e) return;
  if (el.dataset.e) { e[el.dataset.e] = el.value; save(); if (el.dataset.e === 'taxRate') refreshEstimate(e); return; }
  if (el.dataset.r) {
    const r = e.rows.find(x => x.id === el.dataset.r), f = el.dataset.f; r[f] = (f === 'service' || f === 'label') ? el.value : (el.value === '' ? (f === 'price' ? null : '') : +el.value);
    if (f === 'length' || f === 'width') { if (r.length && r.width) { r.area = Math.round(r.length * r.width); const ai = $(`[data-r="${r.id}"][data-f="area"]`); if (ai) ai.value = r.area; } }
    if (f === 'service') { const s = svc(r.service); if (s.unit === 'ton' && !r.depth) r.depth = 2; save(); render(); return; }
  } else if (el.dataset.l) { const l = e.lines.find(x => x.id === el.dataset.l); l[el.dataset.f] = ['desc', 'unit'].includes(el.dataset.f) ? el.value : +el.value; }
  save(); refreshEstimate(e);
};
ACT.addRow = el => { const e = byId('estimates', el.dataset.id); e.rows.push({ id: uid('r'), service: 'hma', label: '', area: '', length: '', width: '', depth: 2, qty: '', price: null }); save(); render(); };
ACT.delRow = el => { const e = curEst(); e.rows = e.rows.filter(r => r.id !== el.dataset.id); save(); render(); };
ACT.addLine = el => { const e = byId('estimates', el.dataset.id); e.lines.push({ id: uid('l'), desc: '', qty: 1, unit: 'ls', price: 0 }); save(); render(); };
ACT.delLine = el => { const e = curEst(); e.lines = e.lines.filter(l => l.id !== el.dataset.id); save(); render(); };
ACT.markSent = el => { const e = byId('estimates', el.dataset.id); e.status = 'sent'; e.sentAt = today(); save(); render(); toast('Marked sent — customer can view it in their portal'); };
ACT.declineEst = el => { byId('estimates', el.dataset.id).status = 'declined'; save(); render(); };
ACT.reopenEst = el => confirmBox('Reopen this signed proposal for edits? The signature is cleared.', () => { const e = byId('estimates', el.dataset.id); e.status = 'draft'; e.signature = null; save(); render(); });
ACT.toJob = el => { const e = byId('estimates', el.dataset.id); const j = makeJob(e); DB.jobs.push(j); save(); location.hash = '#/jobs/' + j.id; toast('Job created'); };
ACT.signEst = el => signEstimate(el.dataset.id);

function proposalHTML(e) {
  const c = byId('customers', e.customerId) || {}, t = estTotals(e), s = DB.settings;
  const rows = e.rows.map(r => ({ r, c: rowCalc(r) })).filter(x => x.c.amt || x.r.label);
  return `<div class="proposal"><header><div><h2>${esc(s.company)}</h2><small>${esc(s.address)} · ${esc(s.phone)} · ${esc(s.email)}</small></div><div class="right"><h2>PROPOSAL #${e.number}</h2><small>${fmtD(e.createdAt)}</small></div></header>
  <div class="cols"><div><small>PREPARED FOR</small><p><b>${esc(c.name)}</b><br>${esc(c.contact)}<br>${esc(c.email)} · ${esc(c.phone)}</p></div><div><small>PROJECT</small><p><b>${esc(e.title)}</b><br>${esc(e.address)}</p></div></div>
  <table><tr><th>Scope of work</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Amount</th></tr>
  ${rows.map(({ r, c }) => `<tr><td>${esc(svc(r.service).name)}${r.label ? ' — ' + esc(r.label) : ''}${c.unit === 'ton' ? `<br><small>${num(c.area, 0)} sf @ ${r.depth}" compacted depth</small>` : ''}</td><td class="num">${num(c.qty, c.unit === 'ton' ? 1 : 0)} ${UNIT_LABEL[c.unit]}</td><td class="num">${money2(c.price)}</td><td class="num">${money(c.amt)}</td></tr>`).join('')}
  ${e.lines.map(l => `<tr><td>${esc(l.desc)}</td><td class="num">${num(l.qty, 0)} ${esc(l.unit)}</td><td class="num">${money2(l.price)}</td><td class="num">${money((+l.qty || 0) * (+l.price || 0))}</td></tr>`).join('')}
  ${t.tax ? `<tr><td colspan="3" class="num">Tax (${e.taxRate}%)</td><td class="num">${money(t.tax)}</td></tr>` : ''}
  <tr class="grand"><td colspan="3" class="num"><b>TOTAL</b></td><td class="num"><b>${money(t.total)}</b></td></tr></table>
  <h4>Terms &amp; conditions</h4><p class="terms-text">${esc(e.terms)}</p>
  <div class="sigblock"><div>${e.signature ? `${e.signature.img ? `<img src="${e.signature.img}" alt="signature">` : `<div class="typed">${esc(e.signature.name)}</div>`}` : '<div class="sigline"></div>'}<small>Accepted by ${e.signature ? esc(e.signature.name) + ' on ' + fmtD(e.signature.date) : '________________________'}</small></div><div><div class="sigline"></div><small>${esc(s.company)} authorized signature</small></div></div></div>`;
}
ACT.preview = el => { const e = byId('estimates', el.dataset.id); modal(`<div class="noprint btns"><button class="btn primary" onclick="window.print()">Print / Save PDF</button></div>${proposalHTML(e)}`, { wide: true, print: true }); };

function signEstimate(id, after) {
  const e = byId('estimates', id), t = estTotals(e);
  modal(`<h3>Accept proposal #${e.number}</h3><p>${esc(e.title)} — <b>${money(t.total)}</b></p>
  <label class="block"><span>Printed name</span><input id="sgName" value="${esc((byId('customers', e.customerId) || {}).contact || '')}"></label>
  <label class="block"><span>Sign below</span></label><canvas id="sgPad" width="640" height="200"></canvas>
  <label class="check"><input type="checkbox" id="sgAgree"> I have read and agree to the terms and scope above.</label>
  <div class="actions"><button class="btn" id="sgClear">Clear</button><button class="btn" data-act="closeModal">Cancel</button><button class="btn primary" id="sgOk">Sign &amp; accept</button></div>`);
  const pad = signPad($('#sgPad')); $('#sgClear').onclick = pad.clear;
  $('#sgOk').onclick = () => {
    if (!$('#sgAgree').checked) return toast('Please check the agreement box', 'err');
    if (!pad.isDirty() && !$('#sgName').value.trim()) return toast('Add a signature or typed name', 'err');
    if (PORTAL) { const nm = $('#sgName').value.trim(); if (!nm) return toast('Please type your name', 'err'); $('#sgOk').disabled = true; return portalCall('portal_sign', { p_estimate_id: e.id, p_name: nm, p_img: pad.isDirty() ? pad.data() : '' }).then(ok => { closeModal(); toast(ok ? 'Signed — thank you!' : 'Could not sign (already signed?)', ok ? '' : 'err'); return portalReload(); }, er => { $('#sgOk').disabled = false; toast(er.message, 'err'); }); }
    e.signature = { name: $('#sgName').value || 'Signed', date: today(), img: pad.isDirty() ? pad.data() : null }; e.status = 'signed'; e.signedAt = today(); e.autoRan = true;
    const c = byId('customers', e.customerId); if (c) { if (c.status !== 'customer') c.status = 'customer'; c.activity.push({ date: today(), text: `Signed proposal #${e.number} — ${e.title}` }); }
    closeModal(); fire('estimate.signed', { estimate: e, title: `Proposal #${e.number} signed — ${money(t.total)}`, body: `${custName(e.customerId)} · ${e.title}`, link: '#/estimates/' + e.id });
    save(); toast('Signed! Automations ran.'); if (after) after(); else render();
  };
}

/* ---------- satellite measure (Leaflet) ---------- */
const toSqFt = pts => { if (pts.length < 3) return 0; const lat0 = pts.reduce((a, p) => a + p[0], 0) / pts.length * Math.PI / 180, kx = 111320 * Math.cos(lat0), ky = 110540; const xy = pts.map(p => [p[1] * kx, p[0] * ky]); let s = 0; xy.forEach((p, i) => { const q = xy[(i + 1) % xy.length]; s += p[0] * q[1] - q[0] * p[1]; }); return Math.abs(s) / 2 * 10.7639; };
const toFeet = pts => { let m = 0; for (let i = 1; i < pts.length; i++) { const [a, b] = [pts[i - 1], pts[i]], R = 6371000, r = Math.PI / 180, dl = (b[0] - a[0]) * r, dn = (b[1] - a[1]) * r, h = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dn / 2) ** 2; m += 2 * R * Math.asin(Math.sqrt(h)); } return m * 3.28084; };
ACT.mapMeasure = el => {
  const e = byId('estimates', el.dataset.id);
  modal(`<h3>Measure site</h3><div class="mapbar"><input id="mapQ" placeholder="Search address…" value="${esc(e.address)}"><button class="btn sm" id="mapGo">Find</button>
  <div class="tabs"><button class="on" id="mArea">Area</button><button id="mLen">Length</button></div><button class="btn sm" id="mUndo">Undo</button><button class="btn sm" id="mClr">Clear</button></div>
  <div id="map"></div><div class="mapbar"><b id="mRes">Click the map to place points</b><span class="grow"></span><select id="mSvc">${DB.settings.services.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select><button class="btn primary sm" id="mAdd">Add to take-off</button></div>`, { wide: true });
  if (typeof L === 'undefined') { $('#map').innerHTML = '<div class="empty"><b>Map library unavailable</b><span>Connect to the internet to use satellite measuring, or type L × W directly.</span></div>'; return; }
  const map = window._map = L.map('map').setView([39.5, -98.35], 4);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 20, attribution: 'Imagery © Esri' }).addTo(map);
  let pts = [], mode = 'area', layer = L.layerGroup().addTo(map);
  const draw = () => {
    layer.clearLayers(); pts.forEach(p => L.circleMarker(p, { radius: 5, color: '#f59e0b', fillOpacity: 1 }).addTo(layer));
    if (pts.length > 1) (mode === 'area' && pts.length > 2 ? L.polygon(pts, { color: '#f59e0b', weight: 2 }) : L.polyline(pts, { color: '#f59e0b', weight: 3 })).addTo(layer);
    $('#mRes').textContent = pts.length ? (mode === 'area' ? `${num(toSqFt(pts), 0)} sq ft  (${num(toSqFt(pts) / 9, 0)} sq yd)` : `${num(toFeet(pts), 0)} linear ft`) : 'Click the map to place points';
  };
  map.on('click', ev => { pts.push([ev.latlng.lat, ev.latlng.lng]); draw(); });
  $('#mUndo').onclick = () => { pts.pop(); draw(); }; $('#mClr').onclick = () => { pts = []; draw(); };
  const setMode = m => { mode = m; $('#mArea').classList.toggle('on', m === 'area'); $('#mLen').classList.toggle('on', m === 'length'); draw(); };
  $('#mArea').onclick = () => setMode('area'); $('#mLen').onclick = () => setMode('length');
  const go = async () => { try { const r = await (await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent($('#mapQ').value))).json(); if (r[0]) map.setView([+r[0].lat, +r[0].lon], 19); else toast('Address not found', 'err'); } catch (x) { toast('Search failed — pan the map manually', 'err'); } };
  $('#mapGo').onclick = go; if (e.address) go();
  $('#mAdd').onclick = () => {
    if (pts.length < 2) return toast('Place points first', 'err');
    const s = svc($('#mSvc').value), row = { id: uid('r'), service: s.id, label: 'Measured on map', area: '', length: '', width: '', depth: s.unit === 'ton' ? 2 : '', qty: '', price: null };
    if (s.unit === 'lf' || s.unit === 'ea') row.qty = Math.round(toFeet(pts)); else row.area = Math.round(toSqFt(pts));
    e.rows.push(row); save(); closeModal(); render(); toast('Added to take-off');
  };
};

const portalURL = c => location.origin + location.pathname + '#/p/' + c.portalToken;
ACT.copyPortal = el => {
  const c = byId('customers', el.dataset.id); if (!c.portalToken) { c.portalToken = newToken(); save(); }
  navigator.clipboard.writeText(portalURL(c)).then(() => toast(CLOUD ? 'Portal link copied — send it to the customer' : 'Copied (demo mode: only works on this device — set up the backend)'), () => prompt('Copy this link:', portalURL(c)));
};
ACT.rotatePortal = el => confirmBox('Create a new private link? The old link stops working immediately.', () => { byId('customers', el.dataset.id).portalToken = newToken(); save(); toast('New link created — copy it again'); });
