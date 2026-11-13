/* WIN WORK: Dashboard analytics, CRM, Estimates / takeoff / mapping / proposals */
const VIEWS = {};

/* ================= DASHBOARD / ANALYTICS ================= */
VIEWS.dashboard = () => {
  const ests = DB.estimates, T = e => estTotals(e).total;
  const open = ests.filter(isOpenEst);
  const signed = ests.filter(e => e.status === 'signed'), declined = ests.filter(e => e.status === 'declined'), sent = ests.filter(e => e.status === 'sent');
  const decided = signed.length + declined.length + sent.length;
  const winRate = decided ? Math.round(signed.length / decided * 100) : 0;
  const pays = DB.invoices.flatMap(i => i.payments);
  const ar = DB.invoices.filter(i => invStatus(i) !== 'draft').reduce((a, i) => a + invBalance(i), 0);
  const overdue = DB.invoices.filter(i => invStatus(i) === 'overdue');
  const done = DB.jobs.filter(j => j.status === 'complete' && j.costs.length);
  const rev = done.reduce((a, j) => a + jobContract(j), 0), cost = done.reduce((a, j) => a + jobCost(j), 0);
  const margin = rev ? Math.round((rev - cost) / rev * 100) : null;
  // revenue collected per month, last 6 months
  const months = []; const now = new Date();
  for (let k = 5; k >= 0; k--) { const d = new Date(now.getFullYear(), now.getMonth() - k, 1); months.push({ key: iso(d).slice(0, 7), label: d.toLocaleString('en-US', { month: 'short' }), value: 0 }); }
  pays.forEach(p => { const m = months.find(m => m.key === p.date.slice(0, 7)); if (m) m.value += +p.amount; });
  const backlog = DB.jobs.filter(j => j.status !== 'complete'), finished = DB.jobs.filter(j => j.status === 'complete');
  const doneMonths = months.map(m => ({ ...m, value: 0 }));
  finished.forEach(j => { const m = doneMonths.find(m => m.key === String(j.completedAt || j.date || '').slice(0, 7)); if (m) m.value += jobContract(j); });
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
      <div class="kpi"><span>Contract backlog</span><b>${money(backlog.reduce((a, j) => a + jobContract(j), 0))}</b><small>${backlog.length} jobs signed, not finished</small></div>
      <div class="kpi"><span>Completed work</span><b>${money(finished.reduce((a, j) => a + jobContract(j), 0))}</b><small>${finished.length} jobs finished</small></div>
      <div class="kpi"><span>Collected (all time)</span><b>${money(pays.reduce((a, p) => a + +p.amount, 0))}</b><small>${pays.length} payments</small></div>
      <div class="kpi ${overdue.length ? 'warn' : ''}"><span>Outstanding A/R</span><b>${money(ar)}</b><small>${overdue.length} overdue</small></div>
      <div class="kpi"><span>Margin, completed jobs</span><b>${margin === null ? '—' : margin + '%'}</b><small>${done.length} jobs with costs logged</small></div>
      <div class="kpi"><span>Active jobs</span><b>${DB.jobs.filter(j => j.status === 'in-progress').length}</b><small>${thisWeek.length} on this week’s board</small></div>
    </div>
    <div class="cols">
      <div class="card"><h3>Completed work by month</h3>${barChart(doneMonths)}</div>
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
    <div class="card flush"><table class="hover"><tr><th>Name</th><th>Contact</th><th>Phone</th><th>Status</th><th>Open proposals</th><th class="num">Contracted</th></tr>
    ${list.map(c => { const es = DB.estimates.filter(e => e.customerId === c.id); const op = es.filter(isOpenEst), won = es.filter(e => e.status === 'signed').reduce((a, e) => a + estTotals(e).total, 0); return `<tr data-act="openCustomer" data-id="${c.id}"><td><b>${esc(c.name)}</b><br><small>${esc(c.address)}</small></td><td>${esc(c.contact)}<br><small>${esc(c.email)}</small></td><td>${esc(c.phone)}</td><td>${badge(c.status)}</td><td>${op.length ? op.length + ' · ' + money(op.reduce((a, e) => a + estTotals(e).total, 0)) : '—'}</td><td class="num">${money(won)}</td></tr>`; }).join('') || `<tr><td colspan="6">${empty('No customers match')}</td></tr>`}</table></div>`,
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
let estFilter = null, estColor = 'all', estFrom = '', estTo = '';
const AGE_LABEL = { green: '0–90 days', yellow: '90–180 days', red: 'Over 180 days' };
VIEWS.estimates = args => {
  if (args[0]) return estimateEditor(byId('estimates', args[0]));
  const tab = estFilter || (DB.estimates.some(isOpenEst) ? 'open' : 'all');
  const inTab = (e, s) => s === 'all' || (s === 'open' ? isOpenEst(e) : e.status === s);
  const inDates = e => (!estFrom || e.createdAt >= estFrom) && (!estTo || e.createdAt <= estTo);
  const base = DB.estimates.filter(e => inTab(e, tab) && inDates(e));
  const list = base.filter(e => estColor === 'all' || (isOpenEst(e) && ageColor(e) === estColor)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || b.number - a.number);
  const cc = c => base.filter(e => isOpenEst(e) && ageColor(e) === c).length;
  return {
    title: 'Estimates & Proposals', html: `
  <div class="toolbar"><div class="tabs">${['open', 'draft', 'sent', 'signed', 'declined', 'all'].map(s => `<button class="${tab === s ? 'on' : ''}" data-act="estFilter" data-v="${s}">${s} <i>${DB.estimates.filter(e => inTab(e, s)).length}</i></button>`).join('')}</div><span class="grow"></span><button class="btn primary" data-act="newEstimate">+ New estimate</button></div>
  <div class="toolbar"><div class="tabs"><button class="${estColor === 'all' ? 'on' : ''}" data-act="estColor" data-v="all">Any age</button>${['green', 'yellow', 'red'].map(c => `<button class="${estColor === c ? 'on' : ''}" data-act="estColor" data-v="${c}"><span class="dot ${c}"></span>${AGE_LABEL[c]} <i>${cc(c)}</i></button>`).join('')}</div>
    <label class="inl">Proposal date from <input type="date" id="estFrom" value="${estFrom}"></label><label class="inl">to <input type="date" id="estTo" value="${estTo}"></label>${estFrom || estTo || estColor !== 'all' ? '<button class="btn sm" data-act="estClear">Clear filters</button>' : ''}
    <span class="grow"></span><b>${list.length} shown · ${money(list.reduce((a, e) => a + estTotals(e).total, 0))}</b></div>
  <div class="card flush"><table class="hover"><tr><th>#</th><th>Project</th><th>Customer</th><th>Proposal date</th><th>Age</th><th class="num">Total</th><th>Status</th></tr>
  ${list.map(e => { const t = estTotals(e), o = isOpenEst(e); return `<tr class="${o ? 'age-' + ageColor(e) : ''}" onclick="location.hash='#/estimates/${e.id}'"><td>${e.number}</td><td><b>${esc(e.title)}</b><br><small>${esc(e.address)}</small></td><td>${esc(custName(e.customerId))}</td><td>${fmtD(e.createdAt)}</td><td>${o ? `<span class="dot ${ageColor(e)}"></span>${estAge(e)} d` : '—'}</td><td class="num">${money(t.total)}</td><td>${badge(e.status)}</td></tr>`; }).join('') || `<tr><td colspan="7">${empty('No proposals match', 'Change the filters or create a new estimate')}</td></tr>`}</table></div>
  <p class="hint">Open proposals are colored by proposal date: green = last 90 days, yellow = 90–180 days, red = older than 180 days.</p>`,
    mount() { $('#estFrom').onchange = e => { estFrom = e.target.value; render(); }; $('#estTo').onchange = e => { estTo = e.target.value; render(); }; }
  };
};
ACT.estFilter = el => { estFilter = el.dataset.v; render(); };
ACT.estColor = el => { estColor = el.dataset.v; render(); };
ACT.estClear = () => { estColor = 'all'; estFrom = estTo = ''; render(); };
ACT.newEstimate = () => {
  if (!DB.customers.length) return toast('Add a customer first', 'err');
  openForm({
    title: 'New estimate', submit: 'Create', fields: [{ name: 'customerId', label: 'Customer / contractor', type: 'select', options: DB.customers.map(c => [c.id, c.name]), wide: 1 }, { name: 'title', label: 'Project title', req: 1, wide: 1, ph: 'e.g. Walmart 1006-279 — Cordele, GA' }],
    onSubmit(v) { newEstimate(v.customerId, v.title); }
  });
};
const blankLine = () => ({ id: uid('l'), desc: '', note: '', qty: '', unit: '', price: '' });
function newEstimate(customerId, title) {
  const c = byId('customers', customerId);
  const e = { id: uid('e'), number: nextNum('est'), customerId, title: title || 'New project', address: c.address || '', status: 'draft', createdAt: today(), taxRate: 0, terms: DB.settings.terms, rows: [], lines: [...Array(8)].map(blankLine), lumpSum: null, hidePrices: true, signature: null };
  DB.estimates.push(e); save(); location.hash = '#/estimates/' + e.id;
}

const LINE_FIELDS = ['desc', 'note', 'qty', 'unit', 'price'];
const numIn = v => { v = String(v ?? '').replace(/[$,\s]/g, ''); return v === '' || isNaN(+v) ? '' : +v; };
function estimateEditor(e) {
  if (!e) return { title: 'Estimate', html: empty('Estimate not found') };
  const t = estTotals(e), locked = e.status === 'signed', dis = locked ? 'disabled' : '';
  const svcOpts = r => DB.settings.services.map(s => `<option value="${s.id}" ${s.id === r.service ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  const rowHTML = r => {
    const c = rowCalc(r), u = c.unit, d = f => (locked || (f === 'dims' && (u === 'lf' || u === 'ea')) || (f === 'depth' && u !== 'ton')) ? 'disabled' : '';
    return `<tr data-row="${r.id}"><td><select data-r="${r.id}" data-f="service" ${dis}>${svcOpts(r)}</select></td>
    <td><input data-r="${r.id}" data-f="label" value="${esc(r.label)}" ${dis}></td>
    <td><input type="number" class="n" data-r="${r.id}" data-f="length" value="${esc(r.length)}" ${d('dims')}></td>
    <td><input type="number" class="n" data-r="${r.id}" data-f="width" value="${esc(r.width)}" ${d('dims')}></td>
    <td><input type="number" class="n" data-r="${r.id}" data-f="area" value="${esc(r.area)}" ${d('dims')}></td>
    <td><input type="number" step="0.25" class="n s" data-r="${r.id}" data-f="depth" value="${esc(r.depth)}" ${d('depth')}></td>
    <td class="num">${(u === 'lf' || u === 'ea') ? `<input type="number" class="n" data-r="${r.id}" data-f="qty" value="${esc(r.qty)}" ${dis}>` : `<span id="q-${r.id}">${num(c.qty, 1)}</span>`} <small>${UNIT_LABEL[u]}</small></td>
    <td><input type="number" step="0.01" class="n" data-r="${r.id}" data-f="price" value="${r.price === null ? '' : esc(r.price)}" placeholder="${svc(r.service).price}" ${dis}></td>
    <td class="num"><b id="a-${r.id}">${money(c.amt)}</b></td><td>${locked ? '' : `<button class="ico" data-act="delRow" data-id="${r.id}">×</button>`}</td></tr>`;
  };
  const lineHTML = l => `<tr data-line="${l.id}" class="${isSection(l) ? 'sec' : ''}"><td><input data-l="${l.id}" data-f="desc" value="${esc(l.desc)}" ${dis}></td><td><input data-l="${l.id}" data-f="note" value="${esc(l.note)}" ${dis}></td><td><input class="n s" inputmode="decimal" data-l="${l.id}" data-f="qty" value="${esc(l.qty)}" ${dis}></td><td><input class="s" data-l="${l.id}" data-f="unit" value="${esc(l.unit)}" ${dis}></td><td><input class="n" inputmode="decimal" data-l="${l.id}" data-f="price" value="${esc(l.price)}" ${dis}></td><td class="num"><b id="la-${l.id}">${isSection(l) ? '' : money2(lineAmt(l))}</b></td><td>${locked ? '' : `<button class="ico" tabindex="-1" data-act="delLine" data-id="${l.id}">×</button>`}</td></tr>`;
  const job = DB.jobs.find(j => j.estimateId === e.id);
  return {
    title: `Estimate #${e.number}`, html: `
    <div class="page-head"><div><a href="#/estimates" class="link">← Estimates</a><h1>#${e.number} · ${esc(e.title)} ${badge(e.status)}</h1></div>
    <div class="btns noprint"><button class="btn" data-act="preview" data-id="${e.id}">Preview proposal</button>
    ${e.status === 'draft' ? `<button class="btn" data-act="markSent" data-id="${e.id}">Mark sent</button>` : ''}
    ${isOpenEst(e) ? `<button class="btn primary" data-act="signEst" data-id="${e.id}">Capture signature</button><button class="btn ghost" data-act="declineEst" data-id="${e.id}">Declined</button>` : ''}
    ${e.status === 'signed' && !job ? `<button class="btn primary" data-act="toJob" data-id="${e.id}">Create job</button>` : ''}${job ? `<a class="btn" href="#/jobs/${job.id}">Open job →</a>` : ''}
    ${e.status === 'signed' || e.status === 'declined' ? `<button class="btn ghost" data-act="reopenEst" data-id="${e.id}">Reopen</button>` : ''}${e.driveUrl ? `<a class="btn" target="_blank" rel="noopener" href="${esc(e.driveUrl)}">Drive folder ↗</a>` : ''}</div></div>
    <div class="card"><div class="grid4">
      <label><span>Customer / contractor</span><select data-e="customerId" ${dis}>${DB.customers.map(c => `<option value="${c.id}" ${c.id === e.customerId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
      <label><span>Project title</span><input data-e="title" value="${esc(e.title)}" ${dis}></label>
      <label><span>Location</span><input data-e="address" value="${esc(e.address)}" ${dis}></label>
      <label><span>Proposal date</span><input type="date" data-e="createdAt" value="${esc(e.createdAt)}" ${dis}></label></div></div>
    <div class="card"><h3>Proposed items ${locked ? '' : `<span class="btns"><button class="btn sm" data-act="xlsImport" data-id="${e.id}">⬆ Import Excel</button><button class="btn sm" data-act="mapMeasure" data-id="${e.id}">🛰 Measure on map</button><button class="btn sm" data-act="addLine" data-id="${e.id}" data-n="10">+ 10 rows</button><button class="btn sm primary" data-act="addLine" data-id="${e.id}">+ Row</button></span>`}</h3>
      <div class="scroll"><table class="edit grid"><tr><th>Proposed item</th><th>Description</th><th>Qty</th><th>Units</th><th>Unit price</th><th class="num">Total</th><th></th></tr>${e.lines.map(lineHTML).join('')}</table></div>
      <p class="hint">Works like a spreadsheet: Enter / ↑ ↓ move between rows, and you can paste a block of cells copied from Excel. A row with only a name (no qty, unit or price) becomes a section heading.</p></div>
    ${e.rows.length ? `<div class="card"><h3>Paving take-off</h3><div class="scroll"><table class="edit"><tr><th>Service</th><th>Area / note</th><th>L (ft)</th><th>W (ft)</th><th>Area (sf)</th><th>Depth (in)</th><th>Qty</th><th>$ / unit</th><th>Amount</th><th></th></tr>${e.rows.map(rowHTML).join('')}</table></div></div>` : ''}
    <div class="cols"><div class="card"><h3>Terms</h3><textarea class="terms" data-e="terms" rows="8" ${dis}>${esc(e.terms || DB.settings.terms)}</textarea></div>
    <div class="card totals">
      <label class="check"><span class="switch"><input type="checkbox" data-e="hidePrices" ${e.hidePrices !== false ? 'checked' : ''} ${dis}><i></i></span> <span><b>Lump-sum proposal</b><br><small>Customer sees items, quantities and the total only — unit prices and line totals are hidden.</small></span></label>
      <div><span>Calculated from line items</span><b id="t-calc">${money2(t.calc)}</b></div>
      <label class="check"><input type="checkbox" data-e="roundDown" ${e.roundDown !== false ? 'checked' : ''} ${dis}> Round total down to whole dollars</label>
      <div><span>Lump-sum override <small>(blank = use calculated)</small></span><input class="n" style="max-width:140px" inputmode="decimal" data-e="lumpSum" value="${e.lumpSum ?? ''}" ${dis}></div>
      <div><span>Sales tax %</span><input class="n" style="max-width:140px" type="number" step="0.01" data-e="taxRate" value="${e.taxRate}" ${dis}></div>
      <div class="grand"><span>Proposal total</span><b id="t-total">${money(t.total)}</b></div></div></div>`
  };
}
function refreshEstimate(e) {
  e.rows.forEach(r => { const c = rowCalc(r); const q = $('#q-' + r.id), a = $('#a-' + r.id); if (q) q.textContent = num(c.qty, 1); if (a) a.textContent = money(c.amt); });
  e.lines.forEach(l => { const a = $('#la-' + l.id), tr = $(`tr[data-line="${l.id}"]`); if (a) a.textContent = isSection(l) ? '' : money2(lineAmt(l)); if (tr) tr.classList.toggle('sec', isSection(l)); });
  const t = estTotals(e); $('#t-calc').textContent = money2(t.calc); $('#t-total').textContent = money(t.total);
}
const curEst = () => byId('estimates', location.hash.split('/')[2]);
CHG.estimate = el => {
  const e = curEst(); if (!e) return;
  if (el.dataset.e) {
    const k = el.dataset.e;
    e[k] = el.type === 'checkbox' ? el.checked : k === 'lumpSum' ? (numIn(el.value) === '' ? null : numIn(el.value)) : el.value;
    save(); refreshEstimate(e); return;
  }
  if (el.dataset.r) {
    const r = e.rows.find(x => x.id === el.dataset.r), f = el.dataset.f; r[f] = (f === 'service' || f === 'label') ? el.value : (el.value === '' ? (f === 'price' ? null : '') : +el.value);
    if (f === 'length' || f === 'width') { if (r.length && r.width) { r.area = Math.round(r.length * r.width); const ai = $(`[data-r="${r.id}"][data-f="area"]`); if (ai) ai.value = r.area; } }
    if (f === 'service') { const s = svc(r.service); if (s.unit === 'ton' && !r.depth) r.depth = 2; save(); render(); return; }
  } else if (el.dataset.l) { const l = e.lines.find(x => x.id === el.dataset.l), f = el.dataset.f; l[f] = (f === 'qty' || f === 'price') ? numIn(el.value) : el.value; }
  save(); refreshEstimate(e);
};
ACT.delRow = el => { const e = curEst(); e.rows = e.rows.filter(r => r.id !== el.dataset.id); save(); render(); };
ACT.addLine = el => { const e = byId('estimates', el.dataset.id); for (let i = 0; i < (+el.dataset.n || 1); i++) e.lines.push(blankLine()); save(); render(); };
ACT.delLine = el => { const e = curEst(); e.lines = e.lines.filter(l => l.id !== el.dataset.id); save(); render(); };
ACT.markSent = el => { const e = byId('estimates', el.dataset.id); e.status = 'sent'; e.sentAt = today(); save(); render(); toast('Marked sent — customer can view it in their portal'); };
ACT.declineEst = el => { byId('estimates', el.dataset.id).status = 'declined'; save(); render(); };
ACT.reopenEst = el => confirmBox('Reopen this proposal for edits? Any signature is cleared.', () => { const e = byId('estimates', el.dataset.id); e.status = 'draft'; e.signature = null; save(); render(); });
ACT.toJob = el => { const e = byId('estimates', el.dataset.id); const j = makeJob(e); DB.jobs.push(j); save(); location.hash = '#/jobs/' + j.id; toast('Job created'); };
ACT.signEst = el => signEstimate(el.dataset.id);

/* spreadsheet behaviour: Enter / arrows move between rows, multi-cell paste from Excel */
document.addEventListener('keydown', ev => {
  const el = ev.target; if (!el.matches || !el.matches('input[data-l]')) return;
  if (!['Enter', 'ArrowDown', 'ArrowUp'].includes(ev.key)) return;
  ev.preventDefault();
  const trs = $$('tr[data-line]'), i = trs.indexOf(el.closest('tr')), f = el.dataset.f, to = trs[i + (ev.key === 'ArrowUp' ? -1 : 1)];
  if (to) { const n = to.querySelector(`[data-f="${f}"]`); n.focus(); n.select(); return; }
  if (ev.key === 'Enter' && i === trs.length - 1) { el.blur(); const e = curEst(); e.lines.push(blankLine()); save(); render(); const n = $$('tr[data-line]').pop().querySelector(`[data-f="${f}"]`); n.focus(); }
});
document.addEventListener('paste', ev => {
  const el = ev.target; if (!el.matches || !el.matches('input[data-l]')) return;
  const text = (ev.clipboardData || window.clipboardData).getData('text'); if (!/[\t\n]/.test(text.replace(/\r?\n$/, ''))) return;
  ev.preventDefault();
  const e = curEst(), grid = text.replace(/\r?\n$/, '').split(/\r?\n/).map(r => r.split('\t'));
  let ri = e.lines.findIndex(l => l.id === el.dataset.l); const c0 = LINE_FIELDS.indexOf(el.dataset.f);
  grid.forEach(cells => { if (!e.lines[ri]) e.lines.push(blankLine()); const l = e.lines[ri++]; cells.forEach((v, k) => { const f = LINE_FIELDS[c0 + k]; if (f) l[f] = (f === 'qty' || f === 'price') ? numIn(v) : v.trim(); }); });
  save(); render(); toast(`Pasted ${grid.length} row${grid.length > 1 ? 's' : ''}`);
});

/* Excel import: reads a proposal workbook laid out as  Proposed Item | Description | Qty | Units | Unit Price | Total */
function parseProposalSheet(aoa) {
  const str = v => v instanceof Date ? iso(new Date(v.getTime() + 12 * 36e5)) : String(v ?? '').trim();
  const out = { date: '', title: '', location: '', lines: [], total: null };
  const hi = aoa.findIndex(r => r.some(c => /^qty\.?$|^quantity$/i.test(str(c))));
  const col = { desc: 0, note: 1, qty: 2, unit: 3, price: 4 };
  if (hi >= 0) aoa[hi].forEach((c, i) => { const s = str(c); if (/^qty\.?$|^quantity$/i.test(s)) col.qty = i; else if (/unit\s*price|^price$|^rate$/i.test(s)) col.price = i; else if (/^units?$|^uom$/i.test(s)) col.unit = i; else if (/^desc/i.test(s)) col.note = i; else if (/item/i.test(s)) col.desc = i; });
  aoa.slice(0, Math.max(hi, 0)).forEach(r => {
    const cells = r.map(str), k = cells.findIndex(Boolean); if (k < 0) return; const val = cells.slice(k + 1).find(Boolean) || '';
    if (/^date/i.test(cells[k])) { const m = val.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); out.date = m ? `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : (/^\d{4}-\d\d-\d\d$/.test(val) ? val : ''); }
    else if (/^project title/i.test(cells[k])) out.title = val; else if (/^location/i.test(cells[k])) out.location = val;
  });
  for (const r of aoa.slice(hi + 1)) {
    const desc = str(r[col.desc]), note = str(r[col.note]), qty = numIn(r[col.qty]), unit = str(r[col.unit]), price = numIn(r[col.price]);
    if (/^total of|^grand total|^total\s*:?$/i.test(desc)) { out.total = numIn(r.map(str).filter(Boolean).pop()); break; }
    if (!desc && !note && qty === '' && price === '') continue;
    out.lines.push({ id: uid('l'), desc, note, qty, unit, price });
  }
  return out;
}
function loadXLSX() {
  return window.XLSX ? Promise.resolve() : new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload = ok; s.onerror = () => no(new Error('Could not load the Excel reader (check your internet connection)')); document.head.appendChild(s); });
}
ACT.xlsImport = el => {
  const e = byId('estimates', el.dataset.id), inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.xlsx,.xls,.csv';
  inp.onchange = async () => {
    try {
      await loadXLSX(); const wb = XLSX.read(await inp.files[0].arrayBuffer(), { type: 'array', cellDates: true });
      const p = parseProposalSheet(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' }));
      if (!p.lines.length) return toast('No line items found in that file', 'err');
      const apply = () => { e.lines = p.lines; if (p.date) e.createdAt = p.date; if (p.location) e.address = p.location; if (p.title && (e.title === 'New project' || !e.title)) e.title = p.title; save(); render(); toast(`Imported ${p.lines.filter(l => !isSection(l)).length} items from Excel`); };
      if (e.lines.some(l => l.desc || l.qty !== '')) confirmBox(`Replace the current items with ${p.lines.length} rows from “${inp.files[0].name}”?`, apply); else apply();
    } catch (x) { toast(x.message || 'Could not read that file', 'err'); }
  };
  inp.click();
};

function proposalHTML(e) {
  const c = byId('customers', e.customerId) || {}, t = estTotals(e), s = DB.settings, hide = e.hidePrices !== false, n = hide ? 4 : 6;
  const px = (a, b) => hide ? '' : `<td class="num">${a}</td><td class="num">${b}</td>`;
  const legacy = e.rows.map(r => ({ r, c: rowCalc(r) })).filter(x => x.c.amt || x.r.label);
  const lines = e.lines.filter(l => String(l.desc || '').trim() || String(l.note || '').trim());
  return `<div class="proposal"><header><div><h2>${esc(s.company)}</h2><small>${esc(s.address)}<br>${esc(s.phone)} · ${esc(s.email)}</small></div><div class="right"><h2>PROPOSAL #${e.number}</h2><small>DATE: ${fmtD(e.createdAt)}</small></div></header>
  <div class="cols"><div><small>PREPARED FOR</small><p><b>${esc(c.name)}</b>${c.contact ? '<br>' + esc(c.contact) : ''}${c.email || c.phone ? '<br>' + esc([c.email, c.phone].filter(Boolean).join(' · ')) : ''}</p></div><div><small>PROJECT TITLE</small><p><b>${esc(e.title)}</b><br><small>LOCATION</small> ${esc(e.address)}</p></div></div>
  <table><tr><th>Proposed item</th><th>Description</th><th class="num">Qty</th><th>Units</th>${hide ? '' : '<th class="num">Unit price</th><th class="num">Total</th>'}</tr>
  ${legacy.map(({ r, c }) => `<tr><td>${esc(svc(r.service).name)}</td><td>${esc(r.label)}${c.unit === 'ton' ? ` <small>${num(c.area, 0)} sf @ ${r.depth}"</small>` : ''}</td><td class="num">${num(c.qty, c.unit === 'ton' ? 1 : 0)}</td><td>${UNIT_LABEL[c.unit]}</td>${px(money2(c.price), money2(c.amt))}</tr>`).join('')}
  ${lines.map(l => isSection(l) ? `<tr class="sec"><td colspan="${n}">${esc(l.desc)}</td></tr>` : `<tr><td>${esc(l.desc)}</td><td>${esc(l.note)}</td><td class="num">${l.qty === '' || l.qty == null ? '' : num(l.qty, 2)}</td><td>${esc(l.unit)}</td>${px(l.price === '' || l.price == null ? '' : money2(l.price), money2(lineAmt(l)))}</tr>`).join('')}
  ${t.tax ? `<tr><td colspan="${n - 1}" class="num">Tax (${e.taxRate}%)</td><td class="num">${money2(t.tax)}</td></tr>` : ''}
  <tr class="grand"><td colspan="${n - 1}" class="num"><b>Total of proposed items listed above:</b></td><td class="num"><b>${money2(t.total)}</b></td></tr></table>
  <h4>Contract notes &amp; terms</h4><p class="terms-text">${esc(e.terms || s.terms)}</p>
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
  <div id="map"></div><div class="mapbar"><b id="mRes">Click the map to place points</b><span class="grow"></span><button class="btn primary sm" id="mAdd">Add to items</button></div>`, { wide: true });
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
    const area = mode === 'area' && pts.length > 2;
    e.lines.push({ id: uid('l'), desc: 'Measured on map', note: '', qty: Math.round(area ? toSqFt(pts) : toFeet(pts)), unit: area ? 'SQ FT' : 'FT', price: '' }); save(); closeModal(); render(); toast('Added to proposed items');
  };
};

const portalURL = c => location.origin + location.pathname + '#/p/' + c.portalToken;
ACT.copyPortal = el => {
  const c = byId('customers', el.dataset.id); if (!c.portalToken) { c.portalToken = newToken(); save(); }
  navigator.clipboard.writeText(portalURL(c)).then(() => toast(CLOUD ? 'Portal link copied — send it to the customer' : 'Copied (demo mode: only works on this device — set up the backend)'), () => prompt('Copy this link:', portalURL(c)));
};
ACT.rotatePortal = el => confirmBox('Create a new private link? The old link stops working immediately.', () => { byId('customers', el.dataset.id).portalToken = newToken(); save(); toast('New link created — copy it again'); });
