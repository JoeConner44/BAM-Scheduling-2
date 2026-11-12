/* MANAGE JOBS + RUN BUSINESS: Schedule, Jobs, Costing, Portal, Invoices, Automation, Settings */

/* ================= SCHEDULING & DISPATCH ================= */
let weekOf = weekStart(today()), dragJob = null;
const jobCovers = (j, d) => j.date && j.date <= d && addDays(j.date, (+j.days || 1) - 1) >= d;
VIEWS.schedule = () => {
  const days = [...Array(7)].map((_, i) => addDays(weekOf, i));
  const tray = DB.jobs.filter(j => !j.date && j.status !== 'complete');
  const card = (j, d) => { const cr = byId('crews', j.crewId), first = j.date === d; return `<div class="jcard ${j.status}" draggable="true" data-job="${j.id}" style="--c:${cr ? cr.color : '#9ca3af'}"><a href="#/jobs/${j.id}"><b>${esc(j.name)}</b></a><small>${esc(custName(j.customerId))}${j.days > 1 ? ` · day ${Math.round((parseD(d) - parseD(j.date)) / 864e5) + 1}/${j.days}` : ''}</small>${first ? '' : '<small class="muted">continued</small>'}</div>`; };
  return {
    title: 'Scheduling & Dispatch', html: `
    <div class="toolbar"><div class="btns"><button class="btn" data-act="wk" data-v="-7">‹</button><button class="btn" data-act="wk" data-v="0">Today</button><button class="btn" data-act="wk" data-v="7">›</button></div><b class="grow">${fmtD(days[0])} – ${fmtD(days[6])}</b><button class="btn" data-act="newCrew">+ Crew</button><button class="btn primary" data-act="dispatch">📨 Dispatch day sheet</button></div>
    <div class="tray" data-drop="tray"><b>Unscheduled (${tray.length})</b> ${tray.map(j => `<div class="jcard chip" draggable="true" data-job="${j.id}" style="--c:#9ca3af"><b>${esc(j.name)}</b><small>${esc(custName(j.customerId))}</small></div>`).join('') || '<span class="muted">Everything is on the board. Drag cards between days & crews to reschedule; drop here to unschedule.</span>'}</div>
    <div class="board scroll"><table class="sched"><tr><th class="crewcol"></th>${days.map(d => `<th class="${d === today() ? 'today' : ''}">${fmtShort(d)}</th>`).join('')}</tr>
    ${DB.crews.map(c => `<tr><th class="crewcol" style="--c:${c.color}"><i></i>${esc(c.name)}</th>${days.map(d => `<td data-drop="cell" data-crew="${c.id}" data-day="${d}" class="${d === today() ? 'today' : ''}">${DB.jobs.filter(j => j.crewId === c.id && jobCovers(j, d)).map(j => card(j, d)).join('')}</td>`).join('')}</tr>`).join('')}</table></div>`
  };
};
ACT.wk = el => { const v = +el.dataset.v; weekOf = v === 0 ? weekStart(today()) : addDays(weekOf, v); render(); };
ACT.newCrew = () => openForm({ title: 'New crew', fields: [{ name: 'name', label: 'Crew name', req: 1, wide: 1 }, { name: 'color', label: 'Color', type: 'color' }], values: { color: '#8b5cf6' }, onSubmit(v) { DB.crews.push({ id: uid('c'), ...v }); save(); render(); } });
ACT.dispatch = () => {
  const day = today() >= weekOf && today() <= addDays(weekOf, 6) ? today() : weekOf;
  modal(`<h3>Dispatch day sheet</h3><label class="block"><span>Day</span><input type="date" id="dDay" value="${day}"></label><div id="dOut"></div>`, { print: true, wide: true });
  const paint = () => {
    const d = $('#dDay').value; const txt = [];
    const html = DB.crews.map(c => { const js = DB.jobs.filter(j => j.crewId === c.id && jobCovers(j, d)); txt.push(`${c.name}:`); return `<div class="dispatch" style="--c:${c.color}"><h4>${esc(c.name)}</h4>${js.length ? js.map(j => { const e = byId('estimates', j.estimateId), t = e ? estTotals(e) : null; txt.push(`  • ${j.name} @ ${j.address} (${custName(j.customerId)})${t ? ' ' + num(t.tons, 0) + ' tons' : ''}`); return `<div class="dj"><b>${esc(j.name)}</b><br>${esc(j.address)} · ${esc(custName(j.customerId))}${t ? ` · ~${num(t.tons, 0)} tons` : ''}<br><small>${esc(j.notes)}</small></div>`; }).join('') : (txt.push('  (off)'), '<p class="muted">No work</p>')}</div>`; }).join('');
    $('#dOut').innerHTML = html + `<div class="actions noprint"><button class="btn" id="dCopy">Copy as text</button><button class="btn primary" onclick="window.print()">Print</button></div>`;
    $('#dCopy').onclick = () => { navigator.clipboard.writeText(`Dispatch ${fmtShort(d)}\n` + txt.join('\n')).then(() => toast('Copied — paste into text/email to crews'), () => toast('Copy blocked by browser', 'err')); };
  };
  $('#dDay').onchange = paint; paint();
};
document.addEventListener('dragstart', e => { const c = e.target.closest && e.target.closest('[data-job]'); if (c) { dragJob = c.dataset.job; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragJob); c.classList.add('dragging'); } });
document.addEventListener('dragend', () => { dragJob = null; $$('.dragging,.over').forEach(x => x.classList.remove('dragging', 'over')); });
document.addEventListener('dragover', e => { const t = e.target.closest && e.target.closest('[data-drop]'); if (t && dragJob) { e.preventDefault(); $$('.over').forEach(x => x.classList.remove('over')); t.classList.add('over'); } });
document.addEventListener('drop', e => {
  const t = e.target.closest && e.target.closest('[data-drop]'); if (!t || !dragJob) return; e.preventDefault();
  const j = byId('jobs', dragJob);
  if (t.dataset.drop === 'tray') { j.date = null; j.crewId = null; if (j.status === 'scheduled') j.status = 'unscheduled'; }
  else {
    // when dragging a continuation day, keep the offset so the whole job shifts naturally
    const offset = j.date ? Math.max(0, Math.round((parseD(t.dataset.day) - parseD(j.date)) / 864e5)) : 0;
    const dragged = $(`[data-job="${dragJob}"]`); let startDay = t.dataset.day;
    if (dragged && dragged.closest('td') && j.date) { const from = dragged.closest('td').dataset.day; startDay = addDays(j.date, Math.round((parseD(t.dataset.day) - parseD(from)) / 864e5)); }
    j.date = startDay; j.crewId = t.dataset.crew; if (j.status === 'unscheduled') j.status = 'scheduled';
    void offset;
  }
  save(); render();
});

/* ================= JOBS & SITE MANAGEMENT ================= */
let jobFilter = 'all';
VIEWS.jobs = args => args[0] ? jobDetail(byId('jobs', args[0])) : {
  title: 'Jobs', html: `<div class="toolbar"><div class="tabs">${['all', 'unscheduled', 'scheduled', 'in-progress', 'complete'].map(s => `<button class="${jobFilter === s ? 'on' : ''}" data-act="jobFilter" data-v="${s}">${s} <i>${DB.jobs.filter(j => s === 'all' || j.status === s).length}</i></button>`).join('')}</div><button class="btn primary" data-act="newJob">+ New job</button></div>
  <div class="cards">${DB.jobs.filter(j => jobFilter === 'all' || j.status === jobFilter).map(j => { const cr = byId('crews', j.crewId), pct = jobBudget(j) ? jobCost(j) / jobBudget(j) * 100 : 0, done = j.checklist.filter(c => c.done).length; return `<a class="jobcard" href="#/jobs/${j.id}" style="--c:${cr ? cr.color : '#9ca3af'}"><div>${badge(j.status)}<h3>${esc(j.name)}</h3><p>${esc(custName(j.customerId))}<br><small>${esc(j.address)}</small></p></div><div><small>${j.date ? fmtShort(j.date) + ' · ' + j.days + 'd · ' + esc(cr ? cr.name : '') : 'Not scheduled'}</small><small>Checklist ${done}/${j.checklist.length}</small>${bar(done / j.checklist.length * 100, 101)}<small>Budget used ${Math.round(pct)}%</small>${bar(pct)}</div></a>`; }).join('') || empty('No jobs', 'Sign a proposal or create one manually')}</div>`
};
ACT.jobFilter = el => { jobFilter = el.dataset.v; render(); };
ACT.newJob = () => openForm({
  title: 'New job', fields: [{ name: 'customerId', label: 'Customer', type: 'select', options: DB.customers.map(c => [c.id, c.name]), wide: 1 }, { name: 'name', label: 'Job name', req: 1, wide: 1 }, { name: 'address', label: 'Site address', wide: 1 }, { name: 'contract', label: 'Contract value $', type: 'number' }], values: { contract: 0 },
  onSubmit(v) { const j = makeJob({ id: null, title: v.name, customerId: v.customerId, address: v.address, rows: [], lines: [], taxRate: 0 }); j.estimateId = null; j.contract = v.contract; j.budget = { material: Math.round(v.contract * .38), labor: Math.round(v.contract * .22), equipment: Math.round(v.contract * .12), other: Math.round(v.contract * .06) }; DB.jobs.push(j); save(); location.hash = '#/jobs/' + j.id; }
});
let jobTab = 'overview';
function jobDetail(j) {
  if (!j) return { title: 'Job', html: empty('Job not found') };
  const cr = byId('crews', j.crewId), contract = jobContract(j), cost = jobCost(j), bud = jobBudget(j);
  const tabs = ['overview', 'daily log', 'checklist', 'photos', 'costs'];
  let body = '';
  if (jobTab === 'overview') body = `<div class="cols"><div class="card"><h3>Schedule</h3>
    <div class="grid2"><label><span>Start date</span><input type="date" data-j="${j.id}" data-f="date" value="${j.date || ''}"></label><label><span>Days</span><input type="number" min="1" data-j="${j.id}" data-f="days" value="${j.days}"></label>
    <label class="wide"><span>Crew</span><select data-j="${j.id}" data-f="crewId"><option value="">— unassigned —</option>${DB.crews.map(c => `<option value="${c.id}" ${c.id === j.crewId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label></div>
    <label class="block"><span>Foreman notes / instructions</span><textarea rows="4" data-j="${j.id}" data-f="notes">${esc(j.notes)}</textarea></label></div>
    <div class="card"><h3>Money</h3><div class="totals"><div><span>Contract</span><b>${money(contract)}</b></div><div><span>Budget (cost)</span><b>${money(bud)}</b></div><div><span>Cost to date</span><b>${money(cost)}</b></div><div class="grand"><span>Margin to date</span><b class="${contract - cost < 0 ? 'neg' : 'pos'}">${money(contract - cost)}</b></div></div>
    <p>${(byId('estimates', j.estimateId)) ? `<a href="#/estimates/${j.estimateId}" class="link">View proposal →</a>` : ''}</p></div></div>`;
  else if (jobTab === 'daily log') body = `<div class="card"><h3>Daily log</h3><form id="logForm" class="grid4"><label><span>Date</span><input type="date" name="date" value="${today()}"></label><label><span>Weather</span><input name="weather" placeholder="Sunny 65°F"></label><label><span>Crew count</span><input type="number" name="crew" value="6"></label><label><span>Tons placed</span><input type="number" step="0.1" name="tons" value="0"></label><label class="wide4"><span>Notes</span><textarea name="text" rows="2" required placeholder="What got done, delays, safety, customer talk…"></textarea></label><button class="btn primary">Add entry</button></form>
    ${j.logs.length ? [...j.logs].sort((a, b) => b.date.localeCompare(a.date)).map(g => `<div class="log"><b>${fmtD(g.date)}</b> <small>${esc(g.weather)} · ${g.crew} crew · ${num(g.tons, 0)} tons</small><p>${esc(g.text)}</p></div>`).join('') : empty('No log entries yet')}</div>`;
  else if (jobTab === 'checklist') body = `<div class="card"><h3>Checklist ${j.checklist.filter(c => c.done).length}/${j.checklist.length}</h3>${j.checklist.map((c, i) => `<label class="check big"><input type="checkbox" data-chk="${i}" data-j="${j.id}" ${c.done ? 'checked' : ''}> ${esc(c.t)}</label>`).join('')}<form id="chkForm" class="inline"><input name="t" placeholder="Add item…" required><button class="btn sm">Add</button></form></div>`;
  else if (jobTab === 'photos') body = `<div class="card"><h3>Site photos</h3><label class="btn primary">📷 Add photo<input type="file" id="photoIn" accept="image/*" capture="environment" hidden multiple></label><div class="photos">${j.photos.map(p => `<figure><img src="${p.src}" alt=""><figcaption>${fmtD(p.date)}<button class="ico" data-act="delPhoto" data-j="${j.id}" data-id="${p.id}">×</button></figcaption></figure>`).join('')}</div>${j.photos.length ? '' : empty('No photos yet', 'Snap before/after shots from the field')}</div>`;
  else body = jobCostsHTML(j);
  return {
    title: j.name, html: `<div class="page-head"><div><a class="link" href="#/jobs">← Jobs</a><h1>${esc(j.name)} ${badge(j.status)}</h1><p class="muted">${esc(custName(j.customerId))} · ${esc(j.address)}</p></div>
    <div class="btns">${j.status !== 'in-progress' && j.status !== 'complete' ? `<button class="btn primary" data-act="jobStatus" data-id="${j.id}" data-v="in-progress">▶ Start job</button>` : ''}${j.status === 'in-progress' ? `<button class="btn primary" data-act="jobStatus" data-id="${j.id}" data-v="complete">✓ Mark complete</button>` : ''}${j.status === 'complete' ? `<button class="btn" data-act="jobStatus" data-id="${j.id}" data-v="in-progress">Reopen</button>` : ''}<a class="btn" href="#/portal/${j.customerId}">Portal</a></div></div>
    <div class="tabs big">${tabs.map(t => `<button class="${jobTab === t ? 'on' : ''}" data-act="jobTab" data-v="${t}">${t}</button>`).join('')}</div>${body}`,
    mount() {
      const lf = $('#logForm'); if (lf) lf.onsubmit = e => { e.preventDefault(); const f = Object.fromEntries(new FormData(lf)); j.logs.push({ id: uid('g'), ...f, crew: +f.crew, tons: +f.tons }); if (j.status !== 'in-progress' && j.status !== 'complete') j.status = 'in-progress'; save(); render(); toast('Log saved'); };
      const cf = $('#chkForm'); if (cf) cf.onsubmit = e => { e.preventDefault(); j.checklist.push({ t: new FormData(cf).get('t'), done: false }); save(); render(); };
      const pi = $('#photoIn'); if (pi) pi.onchange = async () => { for (const f of pi.files) j.photos.push({ id: uid('p'), date: today(), src: await shrinkImage(f) }); save(); render(); };
      mountCosts(j);
    }
  };
}
ACT.jobTab = el => { jobTab = el.dataset.v; render(); };
ACT.delPhoto = el => { const j = byId('jobs', el.dataset.j); j.photos = j.photos.filter(p => p.id !== el.dataset.id); save(); render(); };
ACT.jobStatus = el => {
  const j = byId('jobs', el.dataset.id), v = el.dataset.v; j.status = v;
  if (v === 'complete') { j.completedAt = today(); fire('job.completed', { job: j, title: `Job complete: ${j.name}`, body: custName(j.customerId), link: '#/jobs/' + j.id }); }
  save(); render(); toast(v === 'complete' ? 'Job complete — automations ran' : 'Job started');
};
CHG.job = el => {
  const j = byId('jobs', el.dataset.j);
  if (el.dataset.chk !== undefined) { j.checklist[+el.dataset.chk].done = el.checked; save(); render(); return; }
  const f = el.dataset.f; j[f] = f === 'days' ? Math.max(1, +el.value) : (el.value || null);
  if (f === 'notes') j.notes = el.value;
  if ((f === 'date' || f === 'crewId') && j.date && j.crewId && j.status === 'unscheduled') j.status = 'scheduled';
  save(); toast('Saved');
};

/* ================= JOB COSTING ================= */
const CATS = ['material', 'labor', 'equipment', 'other'];
function jobCostsHTML(j) {
  const contract = jobContract(j);
  const act = c => j.costs.filter(x => x.cat === c).reduce((a, x) => a + +x.amount, 0);
  return `<div class="cols"><div class="card"><h3>Budget vs actual</h3><table><tr><th>Category</th><th>Budget</th><th>Actual</th><th>Used</th></tr>
  ${CATS.map(c => { const b = +j.budget[c] || 0, a = act(c), p = b ? a / b * 100 : (a ? 101 : 0); return `<tr><td>${c}</td><td><input class="n" type="number" data-bud="${c}" data-j="${j.id}" value="${b}"></td><td>${money(a)}</td><td style="width:35%">${bar(p)}<small>${Math.round(p)}%</small></td></tr>`; }).join('')}
  <tr class="grand"><td>Total</td><td>${money(jobBudget(j))}</td><td>${money(jobCost(j))}</td><td></td></tr></table>
  <div class="totals"><div><span>Contract</span><b>${money(contract)}</b></div><div class="grand"><span>Projected margin if budget holds</span><b>${money(contract - jobBudget(j))} (${contract ? num((contract - jobBudget(j)) / contract * 100, 0) : 0}%)</b></div></div></div>
  <div class="card"><h3>Add cost</h3><form id="costForm" class="grid2"><label><span>Date</span><input type="date" name="date" value="${today()}"></label><label><span>Category</span><select name="cat">${CATS.map(c => `<option>${c}</option>`).join('')}</select></label><label class="wide"><span>Description</span><input name="desc" required placeholder="e.g. 40 tons surface mix — ticket #8841"></label><label><span>Amount $</span><input type="number" step="0.01" name="amount" required></label><button class="btn primary">Add</button></form></div></div>
  <div class="card flush"><table><tr><th>Date</th><th>Category</th><th>Description</th><th class="num">Amount</th><th></th></tr>${[...j.costs].sort((a, b) => b.date.localeCompare(a.date)).map(c => `<tr><td>${fmtD(c.date)}</td><td>${c.cat}</td><td>${esc(c.desc)}</td><td class="num">${money2(c.amount)}</td><td><button class="ico" data-act="delCost" data-j="${j.id}" data-id="${c.id}">×</button></td></tr>`).join('') || `<tr><td colspan="5">${empty('No costs logged')}</td></tr>`}</table></div>`;
}
function mountCosts(j) {
  const f = $('#costForm'); if (f) f.onsubmit = e => { e.preventDefault(); const v = Object.fromEntries(new FormData(f)); j.costs.push({ id: uid('k'), ...v, amount: +v.amount }); save(); runChecks(); render(); toast('Cost added'); };
}
CHG.budget = el => { const j = byId('jobs', el.dataset.j); j.budget[el.dataset.bud] = +el.value; j.overNotified = false; save(); render(); };
ACT.delCost = el => { const j = byId('jobs', el.dataset.j); j.costs = j.costs.filter(c => c.id !== el.dataset.id); save(); render(); };
VIEWS.costing = () => {
  const rows = DB.jobs.map(j => { const c = jobContract(j), k = jobCost(j), b = jobBudget(j); return { j, c, k, b, m: c - k, mp: c ? (c - k) / c * 100 : 0, used: b ? k / b * 100 : 0 }; });
  const tot = rows.reduce((a, r) => ({ c: a.c + r.c, k: a.k + r.k, b: a.b + r.b }), { c: 0, k: 0, b: 0 });
  return {
    title: 'Job Costing', html: `<div class="kpis"><div class="kpi"><span>Total contract value</span><b>${money(tot.c)}</b></div><div class="kpi"><span>Cost to date</span><b>${money(tot.k)}</b></div><div class="kpi"><span>Total budget</span><b>${money(tot.b)}</b></div><div class="kpi"><span>Planned margin</span><b>${tot.c ? num((tot.c - tot.b) / tot.c * 100, 0) : 0}%</b></div></div>
    <div class="card flush"><table class="hover"><tr><th>Job</th><th>Status</th><th class="num">Contract</th><th class="num">Budget</th><th class="num">Actual</th><th style="width:18%">Budget used</th><th class="num">Margin $</th><th class="num">Margin %</th></tr>
    ${rows.map(r => `<tr onclick="jobTab='costs';location.hash='#/jobs/${r.j.id}'"><td><b>${esc(r.j.name)}</b><br><small>${esc(custName(r.j.customerId))}</small></td><td>${badge(r.j.status)}</td><td class="num">${money(r.c)}</td><td class="num">${money(r.b)}</td><td class="num">${money(r.k)}</td><td>${bar(r.used)}<small>${Math.round(r.used)}%</small></td><td class="num ${r.m < 0 ? 'neg' : ''}">${money(r.m)}</td><td class="num"><b class="${r.mp < 15 ? 'neg' : 'pos'}">${num(r.mp, 0)}%</b></td></tr>`).join('')}</table></div>
    <p class="hint">Margin $ = contract − cost to date. Click a job to log costs and edit budgets. Alerts fire when a job passes your budget threshold (Automation).</p>`
  };
};

/* ================= INVOICES & PAYMENTS ================= */
let invFilter = 'all';
VIEWS.invoices = () => {
  const all = DB.invoices.map(i => ({ i, s: invStatus(i) })), list = all.filter(x => invFilter === 'all' || x.s === invFilter);
  const sum = f => all.filter(f).reduce((a, x) => a + invBalance(x.i), 0);
  return {
    title: 'Invoicing & Payments', html: `<div class="kpis"><div class="kpi"><span>Outstanding</span><b>${money(sum(x => x.s !== 'draft'))}</b></div><div class="kpi ${sum(x => x.s === 'overdue') ? 'warn' : ''}"><span>Overdue</span><b>${money(sum(x => x.s === 'overdue'))}</b></div><div class="kpi"><span>Drafts</span><b>${money(sum(x => x.s === 'draft'))}</b></div><div class="kpi"><span>Collected</span><b>${money(DB.invoices.reduce((a, i) => a + invPaid(i), 0))}</b></div></div>
    <div class="toolbar"><div class="tabs">${['all', 'draft', 'sent', 'partial', 'overdue', 'paid'].map(s => `<button class="${invFilter === s ? 'on' : ''}" data-act="invFilter" data-v="${s}">${s} <i>${all.filter(x => s === 'all' || x.s === s).length}</i></button>`).join('')}</div><button class="btn primary" data-act="newInvoice">+ New invoice</button></div>
    <div class="card flush"><table class="hover"><tr><th>#</th><th>Customer</th><th>Issued</th><th>Due</th><th class="num">Total</th><th class="num">Balance</th><th>Status</th></tr>
    ${list.sort((a, b) => b.i.number - a.i.number).map(({ i, s }) => `<tr data-act="openInvoice" data-id="${i.id}"><td>${i.number}</td><td>${esc(custName(i.customerId))}</td><td>${fmtD(i.issued)}</td><td>${fmtD(i.due)}</td><td class="num">${money(invTotal(i))}</td><td class="num">${money(invBalance(i))}</td><td>${badge(s)}</td></tr>`).join('') || `<tr><td colspan="7">${empty('No invoices')}</td></tr>`}</table></div>`
  };
};
ACT.invFilter = el => { invFilter = el.dataset.v; render(); };
ACT.newInvoice = () => {
  openForm({
    title: 'New invoice', fields: [{ name: 'jobId', label: 'For job', type: 'select', options: [['', '— none (manual) —'], ...DB.jobs.map(j => [j.id, j.name])], wide: 1 }, { name: 'customerId', label: 'Customer (if no job)', type: 'select', options: DB.customers.map(c => [c.id, c.name]), wide: 1 }, { name: 'desc', label: 'Description', wide: 1, ph: 'Leave blank to bill the remaining contract balance' }, { name: 'amount', label: 'Amount $ (0 = remaining balance)', type: 'number' }], values: { amount: 0 },
    onSubmit(v) {
      const j = v.jobId ? byId('jobs', v.jobId) : null;
      let inv;
      if (j && !v.amount) { inv = makeInvoice(j, true); if (!inv) { toast('Nothing left to bill on that job', 'err'); return false; } if (v.desc) inv.items[0].desc = v.desc; }
      else inv = (DB.invoices.push({ id: uid('i'), number: nextNum('inv'), customerId: j ? j.customerId : v.customerId, jobId: j ? j.id : null, items: [{ desc: v.desc || (j ? j.name : 'Services'), qty: 1, unit: 'ls', price: v.amount }], taxRate: 0, issued: today(), due: addDays(today(), 30), status: 'draft', payments: [] }), DB.invoices[DB.invoices.length - 1]);
      save(); render(); setTimeout(() => ACT.openInvoice({ dataset: { id: inv.id } }), 0);
    }
  });
};
ACT.openInvoice = el => {
  const i = byId('invoices', el.dataset.id), s = invStatus(i), c = byId('customers', i.customerId) || {}, co = DB.settings;
  modal(`<div class="noprint btns">${i.status === 'draft' ? `<button class="btn" data-act="sendInvoice" data-id="${i.id}">Send to customer</button>` : ''}${s !== 'paid' && s !== 'draft' ? `<button class="btn primary" data-act="payInvoice" data-id="${i.id}">Record payment</button>` : ''}<button class="btn" onclick="window.print()">Print / PDF</button><a class="btn" href="#/portal/${i.customerId}" data-act="closeModal">Portal link</a><button class="btn danger ghost" data-act="delInvoice" data-id="${i.id}">Delete</button></div>
  <div class="proposal"><header><div><h2>${esc(co.company)}</h2><small>${esc(co.address)} · ${esc(co.phone)}</small></div><div class="right"><h2>INVOICE #${i.number}</h2>${badge(s)}</div></header>
  <div class="cols"><div><small>BILL TO</small><p><b>${esc(c.name)}</b><br>${esc(c.contact)}<br>${esc(c.address)}</p></div><div><small>ISSUED</small> ${fmtD(i.issued)}<br><small>DUE</small> <b>${fmtD(i.due)}</b></div></div>
  <table><tr><th>Description</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Amount</th></tr>${i.items.map(l => `<tr><td>${esc(l.desc)}</td><td class="num">${l.qty}</td><td class="num">${money2(l.price)}</td><td class="num">${money2(l.qty * l.price)}</td></tr>`).join('')}
  ${i.payments.map(p => `<tr><td colspan="3" class="num"><small>Payment ${fmtD(p.date)} (${esc(p.method)})</small></td><td class="num">−${money2(p.amount)}</td></tr>`).join('')}
  <tr class="grand"><td colspan="3" class="num"><b>BALANCE DUE</b></td><td class="num"><b>${money2(invBalance(i))}</b></td></tr></table></div>`, { wide: true, print: true });
};
ACT.sendInvoice = el => { const i = byId('invoices', el.dataset.id); i.status = 'sent'; save(); render(); closeModal(); toast('Invoice marked sent — customer can pay in their portal'); };
ACT.delInvoice = el => confirmBox('Delete this invoice?', () => { DB.invoices = DB.invoices.filter(i => i.id !== el.dataset.id); save(); render(); });
function paymentForm(id, after) {
  const i = byId('invoices', id);
  openForm({
    title: `Payment — invoice #${i.number}`, submit: 'Record payment', fields: [{ name: 'amount', label: 'Amount $', type: 'number', step: '0.01', req: 1 }, { name: 'method', label: 'Method', type: 'select', options: ['Card', 'ACH', 'Check', 'Cash'] }, { name: 'date', label: 'Date', type: 'date' }], values: { amount: invBalance(i).toFixed(2), date: today(), method: 'ACH' },
    onSubmit(v) { if (!(v.amount > 0)) { toast('Enter an amount', 'err'); return false; } i.payments.push({ id: uid('p'), date: v.date, amount: v.amount, method: v.method }); if (i.status === 'draft') i.status = 'sent'; if (invStatus(i) === 'paid') fire('invoice.paid', { title: `Invoice #${i.number} paid`, body: `${custName(i.customerId)} — ${money(invTotal(i))}`, link: '#/invoices' }); save(); if (after) after(); else render(); toast('Payment recorded'); }
  });
}
ACT.payInvoice = el => paymentForm(el.dataset.id);

/* ================= AUTOMATION & INBOX ================= */
VIEWS.automation = () => ({
  title: 'Automation & Approvals', html: `
  <div class="cols"><div class="card"><h3>Inbox <span class="btns"><button class="btn sm" data-act="readAll">Mark all read</button></span></h3>
    ${DB.notifications.length ? DB.notifications.slice(0, 40).map(n => `<a class="note ${n.read ? 'read' : ''}" href="${n.link || '#'}" data-act="readNote" data-id="${n.id}"><b>${esc(n.title)}</b><span>${esc(n.body)}</span><em>→ ${esc(n.to)} · ${new Date(n.date).toLocaleDateString()}</em></a>`).join('') : empty('No alerts yet')}</div>
  <div class="card"><h3>Workflow rules <button class="btn sm primary" data-act="newRule">+ Rule</button></h3>
    ${DB.rules.map(r => `<div class="rule"><label class="switch"><input type="checkbox" data-rule="${r.id}" ${r.enabled ? 'checked' : ''}><i></i></label><div><b>${esc(r.name)}</b><small>WHEN ${esc(TRIGGERS[r.trigger].label)}${r.threshold ? ` (≥${r.threshold}%)` : ''} → ${esc(ACTIONS[r.action])} · ${esc(r.notifyTo)}</small></div><button class="ico" data-act="delRule" data-id="${r.id}">×</button></div>`).join('')}
    <p class="hint">Rules run instantly in this app when events happen (signing, completing jobs, logging costs, new leads) and on every page load for overdue invoices.</p></div></div>`
});
ACT.readAll = () => { DB.notifications.forEach(n => n.read = true); save(); render(); };
ACT.readNote = el => { const n = DB.notifications.find(x => x.id === el.dataset.id); if (n) { n.read = true; save(); } };
CHG.rule = el => { DB.rules.find(r => r.id === el.dataset.rule).enabled = el.checked; save(); };
ACT.delRule = el => { DB.rules = DB.rules.filter(r => r.id !== el.dataset.id); save(); render(); };
ACT.newRule = () => openForm({
  title: 'New workflow rule', fields: [{ name: 'name', label: 'Rule name', req: 1, wide: 1 }, { name: 'trigger', label: 'When…', type: 'select', options: Object.entries(TRIGGERS).map(([k, v]) => [k, v.label]) }, { name: 'action', label: 'Then…', type: 'select', options: Object.entries(ACTIONS) }, { name: 'notifyTo', label: 'Alert who', type: 'select', options: ROLES }, { name: 'threshold', label: 'Budget % threshold (budget trigger only)', type: 'number' }], values: { threshold: 90, action: 'notify' },
  onSubmit(v) { if (!TRIGGERS[v.trigger].actions.includes(v.action)) { toast('That action doesn’t fit that trigger', 'err'); return false; } DB.rules.push({ id: uid('r'), ...v, enabled: true }); save(); render(); }
});

/* ================= CUSTOMER PORTAL ================= */
VIEWS.portal = args => {
  if (!args[0]) return {
    title: 'Customer Portal', html: `<div class="card"><h3>Customer portals</h3><p class="muted">Each customer gets a single page with their proposals (sign online), project status, schedule, site updates and invoices (pay online). Open one to see exactly what they see.</p>
    <table class="hover">${DB.customers.map(c => `<tr onclick="location.hash='#/portal/${c.id}'"><td><b>${esc(c.name)}</b></td><td>${esc(c.contact)}</td><td>${DB.estimates.filter(e => e.customerId === c.id && e.status !== 'draft').length} proposals · ${DB.jobs.filter(j => j.customerId === c.id).length} jobs · ${DB.invoices.filter(i => i.customerId === c.id && i.status !== 'draft').length} invoices</td><td><a class="btn sm" href="#/portal/${c.id}">Open →</a></td></tr>`).join('')}</table>
    <p class="hint">Heads-up: this version stores data in your browser, so portal links work only on this device. A shared backend (see README roadmap) makes links work for real customers.</p></div>`
  };
  const c = byId('customers', args[0]); if (!c) return { title: 'Portal', html: empty('Customer not found') };
  const es = DB.estimates.filter(e => e.customerId === c.id && e.status !== 'draft'), js = DB.jobs.filter(j => j.customerId === c.id), is = DB.invoices.filter(i => i.customerId === c.id && i.status !== 'draft');
  const steps = ['Proposal signed', 'Scheduled', 'In progress', 'Complete'];
  const stage = j => ({ unscheduled: 0, scheduled: 1, 'in-progress': 2, complete: 3 }[j.status]);
  return {
    title: 'Customer Portal', portal: true, html: `<div class="portal"><header><h1>${esc(DB.settings.company)}</h1><span>Customer portal · ${esc(c.name)}</span><a class="btn sm noprint" href="#/portal">← Back to office view</a></header>
    <p class="hello">Hi ${esc((c.contact || '').split(' ')[0] || 'there')} — here is everything for your projects in one place.</p>
    <section><h2>Proposals</h2>${es.map(e => `<div class="pcard"><div><b>#${e.number} ${esc(e.title)}</b><br><small>${esc(e.address)}</small></div><div class="r"><b>${money(estTotals(e).total)}</b>${badge(e.status)}</div><div class="btns"><button class="btn sm" data-act="preview" data-id="${e.id}">View</button>${e.status === 'sent' ? `<button class="btn sm primary" data-act="portalSign" data-id="${e.id}">Review &amp; sign</button>` : ''}</div></div>`).join('') || '<p class="muted">No proposals yet.</p>'}</section>
    <section><h2>Projects</h2>${js.map(j => { const st = stage(j), cr = byId('crews', j.crewId), last = [...j.logs].sort((a, b) => b.date.localeCompare(a.date))[0]; return `<div class="pcard col"><div><b>${esc(j.name)}</b> ${badge(j.status)}<br><small>${j.date ? 'Scheduled ' + fmtD(j.date) + (j.days > 1 ? ' for ' + j.days + ' days' : '') : 'We will contact you with a start date.'}</small></div><ol class="steps">${steps.map((s, k) => `<li class="${k <= st ? 'on' : ''}">${s}</li>`).join('')}</ol>${last ? `<p><small>Latest update ${fmtD(last.date)}:</small> ${esc(last.text)}</p>` : ''}${j.photos.length ? `<div class="photos sm">${j.photos.slice(-4).map(p => `<img src="${p.src}" alt="">`).join('')}</div>` : ''}</div>`; }).join('') || '<p class="muted">No active projects.</p>'}</section>
    <section><h2>Invoices</h2>${is.map(i => { const s = invStatus(i); return `<div class="pcard"><div><b>Invoice #${i.number}</b><br><small>Due ${fmtD(i.due)}</small></div><div class="r"><b>${money(invBalance(i))}</b> ${badge(s)}</div><div class="btns"><button class="btn sm" data-act="openInvoice" data-id="${i.id}">View</button>${s !== 'paid' ? `<button class="btn sm primary" data-act="portalPay" data-id="${i.id}">Pay now</button>` : ''}</div></div>`; }).join('') || '<p class="muted">No invoices.</p>'}</section>
    <section><h2>Questions?</h2><form id="msgForm" class="inline"><input name="t" placeholder="Send us a message…" required><button class="btn primary">Send</button></form></section></div>`,
    mount() { $('#msgForm').onsubmit = e => { e.preventDefault(); const t = new FormData(e.target).get('t'); c.activity.push({ date: today(), text: 'Portal message: ' + t }); pushNote({ to: 'Office', title: `Message from ${c.name}`, body: t, link: '#/crm', rule: 'Customer portal' }); save(); e.target.reset(); toast('Message sent'); }; }
  };
};
ACT.portalSign = el => signEstimate(el.dataset.id);
ACT.portalPay = el => { const i = byId('invoices', el.dataset.id); paymentForm(i.id); const m = $('#mform h3'); if (m) m.insertAdjacentHTML('afterend', '<p class="hint">Demo checkout: this records a payment. Wire a processor (Stripe/Square) in a later phase for real card & ACH.</p>'); };

/* ================= SETTINGS ================= */
VIEWS.settings = () => ({
  title: 'Settings', html: `<div class="card"><h3>Company</h3><div class="grid4">${[['company', 'Company name'], ['phone', 'Phone'], ['email', 'Email'], ['address', 'Address']].map(([k, l]) => `<label><span>${l}</span><input data-set="${k}" value="${esc(DB.settings[k])}"></label>`).join('')}</div>
  <label class="block"><span>Default proposal terms</span><textarea rows="4" data-set="terms">${esc(DB.settings.terms)}</textarea></label></div>
  <div class="card"><h3>Price list <button class="btn sm" data-act="addSvc">+ Service</button></h3><table class="edit"><tr><th>Service</th><th>Unit</th><th>Price / unit</th><th></th></tr>${DB.settings.services.map(s => `<tr><td><input data-svc="${s.id}" data-f="name" value="${esc(s.name)}"></td><td><select data-svc="${s.id}" data-f="unit">${Object.keys(UNIT_LABEL).map(u => `<option ${u === s.unit ? 'selected' : ''}>${u}</option>`).join('')}</select></td><td><input class="n" type="number" step="0.01" data-svc="${s.id}" data-f="price" value="${s.price}"></td><td><button class="ico" data-act="delSvc" data-id="${s.id}">×</button></td></tr>`).join('')}</table><p class="hint">ton = priced per ton (area × depth); sqft = per square foot; lf = per linear foot; ea = each.</p></div>
  <div class="card"><h3>Your data</h3><p class="muted">Everything lives in this browser’s storage. Export a backup, or move it to another device.</p><div class="btns"><button class="btn" data-act="exportData">⬇ Export JSON</button><label class="btn">⬆ Import JSON<input type="file" id="importIn" accept="application/json" hidden></label><button class="btn danger ghost" data-act="resetData">Reset to demo data</button><button class="btn danger ghost" data-act="clearData">Start empty</button></div></div>`,
  mount() { $('#importIn').onchange = async e => { try { const d = JSON.parse(await e.target.files[0].text()); if (d.v !== 1) throw 0; DB = d; save(); render(); toast('Imported'); } catch (x) { toast('Not a valid export file', 'err'); } }; }
});
CHG.set = el => { DB.settings[el.dataset.set] = el.value; save(); };
CHG.svc = el => { const s = svc(el.dataset.svc); s[el.dataset.f] = el.dataset.f === 'price' ? +el.value : el.value; save(); };
ACT.addSvc = () => { DB.settings.services.push({ id: uid('s'), name: 'New service', unit: 'sqft', price: 1 }); save(); render(); };
ACT.delSvc = el => { if (DB.settings.services.length < 2) return; DB.settings.services = DB.settings.services.filter(s => s.id !== el.dataset.id); save(); render(); };
ACT.exportData = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(DB, null, 2)], { type: 'application/json' })); a.download = `asphaltpro-backup-${today()}.json`; a.click(); };
ACT.resetData = () => confirmBox('Replace everything with fresh demo data?', () => { resetDemo(); runChecks(); location.hash = '#/dashboard'; render(); });
ACT.clearData = () => confirmBox('Delete ALL data and start with an empty company?', () => { const s = DB.settings; DB = seed(); Object.assign(DB, { customers: [], estimates: [], jobs: [], invoices: [], notifications: [] }); DB.settings = s; save(); location.hash = '#/dashboard'; render(); });
