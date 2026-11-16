/* Change orders, schedule of values, pay applications (progress billing) and retainage — all on the job.
   job.changeOrders: [{ id, number, date, title, desc, amount, status: pending|approved|rejected, approvedBy, approvedAt }]
   job.sov:          [{ id, desc, value }]            (base contract lines; approved change orders are added automatically)
   job.retainagePct: number
   job.payApps:      [{ id, number, periodTo, date, work: { sovLineId: amountThisPeriod }, retainagePct, release, status: draft|submitted, invoiceId }] */
const r2 = n => Math.round((+n || 0) * 100) / 100;
const jobCOs = j => j.changeOrders || (j.changeOrders = []);
const jobApps = j => j.payApps || (j.payApps = []);
const coApproved = j => (j.changeOrders || []).filter(c => c.status === 'approved').reduce((a, c) => a + (+c.amount || 0), 0);
const coPending = j => (j.changeOrders || []).filter(c => c.status === 'pending').reduce((a, c) => a + (+c.amount || 0), 0);
const jobBilled = j => DB.invoices.filter(i => i.jobId === j.id && i.status !== 'draft').reduce((a, i) => a + invTotal(i), 0);
const jobPaid = j => DB.invoices.filter(i => i.jobId === j.id).reduce((a, i) => a + invPaid(i), 0);

/* ---------- schedule of values ---------- */
function jobSOV(j) {   // base lines (default: one line for the original contract) + one line per approved change order
  if (!j.sov || !j.sov.length) j.sov = [{ id: uid('v'), desc: 'Original contract work', value: r2(jobBaseContract(j)) }];
  return [...j.sov.map(l => ({ ...l, kind: 'base' })), ...(j.changeOrders || []).filter(c => c.status === 'approved').map(c => ({ id: 'co:' + c.id, desc: `Change order #${c.number} — ${c.title}`, value: r2(c.amount), kind: 'co' }))];
}
const sovBaseTotal = j => (j.sov || []).reduce((a, l) => a + (+l.value || 0), 0);
function sovFromEstimate(j) {
  const e = byId('estimates', j.estimateId); if (!e) return null;
  const lines = [], t = estTotals(e); let sec = '';
  e.lines.forEach(l => { if (isSection(l)) { sec = l.desc; return; } const amt = lineAmt(l); if (amt) lines.push({ id: uid('v'), desc: (sec ? sec + ': ' : '') + l.desc, value: r2(amt) }); });
  const sum = lines.reduce((a, l) => a + l.value, 0);
  if (!lines.length || Math.abs(sum - t.total) > t.total * 0.25) return null;            // lump-sum proposals have no usable line prices
  if (Math.abs(sum - t.total) >= 0.01) lines[lines.length - 1].value = r2(lines[lines.length - 1].value + t.total - sum);   // rounding / tax goes on the last line
  return lines;
}

/* ---------- pay application maths (same shape as an AIA G702 / G703) ---------- */
function payAppCalc(j, app) {
  const apps = jobApps(j).slice().sort((a, b) => a.number - b.number), idx = apps.findIndex(a => a.id === app.id), prior = apps.slice(0, idx);
  const rows = jobSOV(j).map(l => {
    const prev = r2(prior.reduce((a, p) => a + (+(p.work || {})[l.id] || 0), 0)), now = r2((app.work || {})[l.id]), done = r2(prev + now);
    return { ...l, prev, now, done, pct: l.value ? done / l.value * 100 : 0, balance: r2(l.value - done) };
  });
  const sum = k => r2(rows.reduce((a, r) => a + r[k], 0));
  const contract = sum('value'), completed = sum('done'), pct = +app.retainagePct || 0;
  const retainage = app.release ? 0 : r2(completed * pct / 100);
  const earnedLess = r2(completed - retainage);
  const previous = r2(prior.reduce((a, p) => a + payAppCalc(j, p).due, 0));
  return { rows, contract, original: r2(sovBaseTotal(j)), cos: r2(contract - sovBaseTotal(j)), completed, thisPeriod: sum('now'), retainage, earnedLess, previous, due: r2(earnedLess - previous), balance: r2(contract - earnedLess), pct };
}
const retainageHeld = j => { const apps = jobApps(j).slice().sort((a, b) => a.number - b.number), last = apps[apps.length - 1]; return last ? payAppCalc(j, last).retainage : 0; };

/* ---------- job tab: change orders ---------- */
function jobCOsHTML(j) {
  const cos = jobCOs(j), base = jobBaseContract(j);
  return `<div class="cols"><div class="card"><h3>Change orders <button class="btn sm primary" data-act="coNew" data-j="${j.id}">+ Change order</button></h3>
    ${cos.length ? `<table class="hover"><tr><th>#</th><th>Description</th><th>Date</th><th>Status</th><th class="num">Amount</th><th></th></tr>${cos.map(c => `<tr><td>${c.number}</td><td><b>${esc(c.title)}</b>${c.desc ? `<br><small>${esc(c.desc)}</small>` : ''}${c.status === 'approved' && c.approvedBy ? `<br><small>Approved by ${esc(c.approvedBy)} · ${fmtD(c.approvedAt)}</small>` : ''}</td><td>${fmtD(c.date)}</td><td>${badge(c.status === 'approved' ? 'signed' : c.status === 'rejected' ? 'declined' : 'sent').replace(/>[a-z]+</, '>' + c.status + '<')}</td><td class="num">${money2(c.amount)}</td>
      <td class="num"><span class="btns" style="justify-content:flex-end">${c.status === 'pending' ? `<button class="btn sm primary" data-act="coApprove" data-j="${j.id}" data-id="${c.id}">Approve</button><button class="btn sm ghost" data-act="coReject" data-j="${j.id}" data-id="${c.id}">Reject</button>` : ''}<button class="btn sm" data-act="coDoc" data-j="${j.id}" data-id="${c.id}">View</button><button class="btn sm" data-act="coEdit" data-j="${j.id}" data-id="${c.id}">Edit</button></span></td></tr>`).join('')}</table>` : empty('No change orders', 'Add one when the scope changes — approved change orders raise the contract value')}</div>
    <div class="card"><h3>Contract</h3><div class="totals"><div><span>Original contract</span><b>${money2(base)}</b></div><div><span>Approved change orders</span><b>${money2(coApproved(j))}</b></div><div class="grand"><span>Revised contract</span><b>${money2(jobContract(j))}</b></div><div><span>Pending change orders (not counted yet)</span><b>${money2(coPending(j))}</b></div></div></div></div>`;
}
const CO_FIELDS = [{ name: 'title', label: 'Short title', req: 1, wide: 1, ph: 'e.g. Add 12 wheel stops at rear lot' }, { name: 'desc', label: 'Description of the change', type: 'textarea', wide: 1 }, { name: 'amount', label: 'Amount $ (use a minus for a deduct)', type: 'number', step: '0.01' }, { name: 'date', label: 'Date', type: 'date' }];
ACT.coNew = el => { const j = byId('jobs', el.dataset.j); openForm({ title: 'New change order', fields: CO_FIELDS, values: { date: today(), amount: 0 }, onSubmit(v) { const cos = jobCOs(j); cos.push({ id: uid('co'), number: cos.reduce((m, c) => Math.max(m, c.number), 0) + 1, ...v, status: 'pending' }); save(); render(); toast('Change order added — approve it once the customer signs off'); } }); };
ACT.coEdit = el => { const j = byId('jobs', el.dataset.j), c = jobCOs(j).find(x => x.id === el.dataset.id); openForm({ title: `Change order #${c.number}`, fields: [...CO_FIELDS, { name: 'status', label: 'Status', type: 'select', options: ['pending', 'approved', 'rejected'] }], values: c, extra: `<button type="button" class="btn danger ghost" data-act="coDel" data-j="${j.id}" data-id="${c.id}">Delete</button>`, onSubmit(v) { if (v.status === 'approved' && c.status !== 'approved') { c.approvedAt = today(); } Object.assign(c, v); save(); render(); } }); };
ACT.coDel = el => { const j = byId('jobs', el.dataset.j), id = 'co:' + el.dataset.id; if (jobApps(j).some(a => +(a.work || {})[id])) return toast('This change order has been billed on a pay application and cannot be deleted', 'err'); j.changeOrders = jobCOs(j).filter(c => c.id !== el.dataset.id); save(); closeModal(); render(); };
ACT.coApprove = el => { const j = byId('jobs', el.dataset.j), c = jobCOs(j).find(x => x.id === el.dataset.id); openForm({ title: `Approve change order #${c.number} — ${money2(c.amount)}`, submit: 'Approve', fields: [{ name: 'approvedBy', label: 'Approved by (customer contact)', wide: 1 }, { name: 'approvedAt', label: 'Date approved', type: 'date' }], values: { approvedAt: today(), approvedBy: (byId('customers', j.customerId) || {}).contact || '' }, onSubmit(v) { Object.assign(c, v, { status: 'approved' }); j.overNotified = false; save(); render(); toast(`Approved — contract is now ${money(jobContract(j))}`); } }); };
ACT.coReject = el => { const j = byId('jobs', el.dataset.j), c = jobCOs(j).find(x => x.id === el.dataset.id); c.status = 'rejected'; save(); render(); };
function docHeaderHTML(title, sub) {
  const s = DB.settings, t = PT(), head = (t.headerLines || [s.address, s.phone, s.email].filter(Boolean).join('\n')).split('\n').filter(x => x.trim());
  return `<header><div class="pco">${t.logo ? `<img class="plogo" src="${t.logo}" style="height:${+t.logoH || 70}px" alt="">` : ''}<div><h2>${esc(s.company)}</h2>${head.map(l => `<div>${esc(l)}</div>`).join('')}</div></div><div class="ptitle"><h1>${esc(title)}</h1>${sub ? `<div>${esc(sub)}</div>` : ''}</div></header>`;
}
const docWrap = inner => { const t = PT(); return `<div class="proposal pf-${t.font} pz-${t.size} ph-${t.header} pt-${t.table}" style="--pa:${esc(t.accent)}">${inner}</div>`; };
function changeOrderDocHTML(j, c) {
  const cust = byId('customers', j.customerId) || {}, base = jobBaseContract(j), before = (j.changeOrders || []).filter(x => x.status === 'approved' && x.number < c.number).reduce((a, x) => a + (+x.amount || 0), 0);
  return docWrap(`${docHeaderHTML('Change Order', '#' + c.number)}
    <table class="pmeta"><tr><th>DATE:</th><td>${fmtD(c.date)}</td></tr><tr><th>Project:</th><td><b>${esc(j.name)}</b></td></tr><tr><th>Location:</th><td>${esc(j.address)}</td></tr><tr><th>Contractor:</th><td>${esc(cust.name || '')}</td></tr></table>
    <h4>${esc(c.title)}</h4><p style="white-space:pre-wrap;margin:4px 0 14px">${esc(c.desc || '')}</p>
    <table class="pitems"><tr><td>Original contract sum</td><td class="num">${money2(base)}</td></tr><tr><td>Net change by previously approved change orders</td><td class="num">${money2(before)}</td></tr><tr><td>Contract sum before this change order</td><td class="num">${money2(base + before)}</td></tr>
    <tr><td><b>This change order</b></td><td class="num"><b>${money2(c.amount)}</b></td></tr><tr class="grand"><td>New contract sum including this change order</td><td class="num">${money2(base + before + (+c.amount || 0))}</td></tr></table>
    <p class="paccept">This change order becomes part of the contract when signed below. All other terms of the original agreement remain unchanged.</p>
    <div class="psign"><div><span>Approved by (Contractor / Owner):</span><b>${c.status === 'approved' ? esc(c.approvedBy || '') : ''}</b></div><div class="two"><div><span>Signature:</span><b></b></div><div><span>Date:</span><b>${c.status === 'approved' ? fmtD(c.approvedAt) : ''}</b></div></div></div>`);
}
ACT.coDoc = el => { const j = byId('jobs', el.dataset.j), c = jobCOs(j).find(x => x.id === el.dataset.id); modal(`<div class="noprint btns"><button class="btn primary" data-act="docEmail" data-kind="co" data-j="${j.id}" data-id="${c.id}">✉ Email</button><button class="btn" onclick="window.print()">Print / Save PDF</button></div>${changeOrderDocHTML(j, c)}`, { wide: true, print: true }); };

/* ---------- job tab: billing (schedule of values, pay applications, retainage) ---------- */
function jobBillingHTML(j) {
  const sov = jobSOV(j), apps = jobApps(j).slice().sort((a, b) => a.number - b.number), last = apps[apps.length - 1], lc = last ? payAppCalc(j, last) : null;
  const contract = jobContract(j), sovTotal = sov.reduce((a, l) => a + l.value, 0), off = Math.abs(sovTotal - contract) >= 0.01, billedOnApps = apps.length > 0;
  return `<div class="cols"><div class="card"><h3>Schedule of values ${billedOnApps ? '' : `<span class="btns"><button class="btn sm" data-act="sovFromEst" data-j="${j.id}">Build from proposal lines</button><button class="btn sm primary" data-act="sovAdd" data-j="${j.id}">+ Line</button></span>`}</h3>
      <table class="edit"><tr><th>Description of work</th><th class="num">Scheduled value</th><th></th></tr>
      ${sov.map(l => l.kind === 'co' ? `<tr><td>${esc(l.desc)}</td><td class="num">${money2(l.value)}</td><td></td></tr>` : `<tr><td><input data-sov="${l.id}" data-j="${j.id}" data-f="desc" value="${esc(l.desc)}"></td><td><input class="n" type="number" step="0.01" data-sov="${l.id}" data-j="${j.id}" data-f="value" value="${l.value}" ${billedOnApps ? 'disabled' : ''}></td><td>${billedOnApps || j.sov.length < 2 ? '' : `<button class="ico" data-act="sovDel" data-j="${j.id}" data-id="${l.id}">×</button>`}</td></tr>`).join('')}
      <tr class="grand"><td>Total</td><td class="num">${money2(sovTotal)}</td><td></td></tr></table>
      ${off ? `<div class="banner bad" style="margin-top:10px">The schedule adds up to ${money2(sovTotal)} but the contract is ${money2(contract)}. Adjust the lines so they match.</div>` : ''}
      <p class="hint">${billedOnApps ? 'Values are locked once a pay application exists. Approved change orders are added as their own lines.' : 'Break the contract into the lines your contractor wants to see on a pay application. Approved change orders are added automatically.'}</p></div>
    <div class="card"><h3>Retainage &amp; billing</h3>
      <label class="inl" style="margin-bottom:10px">Retainage held by the contractor <input type="number" min="0" max="50" step="0.5" style="width:80px" data-ret="${j.id}" value="${+j.retainagePct || 0}"> %</label>
      <div class="totals"><div><span>Revised contract</span><b>${money2(contract)}</b></div><div><span>Work completed to date</span><b>${money2(lc ? lc.completed : 0)}</b></div><div><span>Retainage held</span><b>${money2(lc ? lc.retainage : 0)}</b></div><div><span>Invoiced</span><b>${money2(jobBilled(j))}</b></div><div><span>Paid</span><b>${money2(jobPaid(j))}</b></div><div class="grand"><span>Left to bill (incl. retainage)</span><b>${money2(lc ? lc.balance : contract)}</b></div></div></div></div>
    <div class="card"><h3>Pay applications <button class="btn sm primary" data-act="paNew" data-j="${j.id}" ${off ? 'disabled' : ''}>+ Pay application</button></h3>
      ${apps.length ? `<table class="hover"><tr><th>#</th><th>Period to</th><th class="num">This period</th><th class="num">Completed to date</th><th class="num">Retainage</th><th class="num">Payment due</th><th>Status</th><th></th></tr>${apps.map(a => { const c = payAppCalc(j, a), inv = a.invoiceId && byId('invoices', a.invoiceId); return `<tr><td>${a.number}</td><td>${fmtD(a.periodTo)}</td><td class="num">${money2(c.thisPeriod)}</td><td class="num">${money2(c.completed)}</td><td class="num">${a.release ? 'released' : money2(c.retainage)}</td><td class="num"><b>${money2(c.due)}</b></td><td>${inv ? badge(invStatus(inv)) + ` <small>inv #${esc(inv.number)}</small>` : badge(a.status === 'submitted' ? 'sent' : 'draft')}</td>
        <td class="num"><span class="btns" style="justify-content:flex-end"><button class="btn sm" data-act="paOpen" data-j="${j.id}" data-id="${a.id}">${a.id === last.id && !inv ? 'Edit' : 'Open'}</button><button class="btn sm" data-act="paDoc" data-j="${j.id}" data-id="${a.id}">View / print</button>${!inv && c.due > 0 ? `<button class="btn sm primary" data-act="paInvoice" data-j="${j.id}" data-id="${a.id}">Create invoice</button>` : ''}</span></td></tr>`; }).join('')}</table>` : empty('No pay applications yet', 'Bill progress against the schedule of values; retainage is worked out for you')}</div>`;
}
CHG.sov = el => { const j = byId('jobs', el.dataset.j), l = (j.sov || []).find(x => x.id === el.dataset.sov); if (!l) return; l[el.dataset.f] = el.dataset.f === 'value' ? r2(el.value) : el.value; save(); render(); };
CHG.ret = el => { const j = byId('jobs', el.dataset.ret); j.retainagePct = Math.max(0, +el.value || 0); const apps = jobApps(j); const open = apps.slice().sort((a, b) => b.number - a.number)[0]; if (open && !open.invoiceId) open.retainagePct = j.retainagePct; save(); render(); };
ACT.sovAdd = el => { const j = byId('jobs', el.dataset.j); jobSOV(j); j.sov.push({ id: uid('v'), desc: '', value: 0 }); save(); render(); };
ACT.sovDel = el => { const j = byId('jobs', el.dataset.j); j.sov = j.sov.filter(l => l.id !== el.dataset.id); save(); render(); };
ACT.sovFromEst = el => { const j = byId('jobs', el.dataset.j), lines = sovFromEstimate(j); if (!lines) return toast('This proposal is a lump sum without line prices — type the schedule lines in by hand', 'err'); j.sov = lines; save(); render(); toast(`Built ${lines.length} lines from the proposal`); };
ACT.paNew = el => {
  const j = byId('jobs', el.dataset.j), apps = jobApps(j), last = apps.slice().sort((a, b) => b.number - a.number)[0];
  if (last && !last.invoiceId && payAppCalc(j, last).due > 0) return toast(`Finish pay application #${last.number} first (create its invoice)`, 'err');
  const a = { id: uid('pa'), number: (last ? last.number : 0) + 1, periodTo: today(), date: today(), work: {}, retainagePct: +j.retainagePct || 0, release: false, status: 'draft', invoiceId: null };
  apps.push(a); save(); openPayApp(j, a);
};
ACT.paOpen = el => { const j = byId('jobs', el.dataset.j); openPayApp(j, jobApps(j).find(a => a.id === el.dataset.id)); };
function openPayApp(j, a) {
  const apps = jobApps(j).slice().sort((x, y) => x.number - y.number), isLast = apps[apps.length - 1].id === a.id, locked = !!a.invoiceId || !isLast, dis = locked ? 'disabled' : '';
  const c0 = payAppCalc(j, a), cell = (k, id) => `data-c="${k}:${esc(id)}"`;
  modal(`<h3>Pay application #${a.number} — ${esc(j.name)}</h3>
    <div class="grid4"><label><span>Period to</span><input type="date" id="paTo" value="${esc(a.periodTo)}" ${dis}></label><label><span>Retainage %</span><input type="number" step="0.5" id="paRet" value="${c0.pct}" ${dis}></label>
      <label class="check" style="align-self:end"><input type="checkbox" id="paRel" ${a.release ? 'checked' : ''} ${dis}> Release retainage (final billing)</label>${locked ? '' : `<button class="btn sm" id="paAll" style="align-self:end">Bill everything remaining</button>`}</div>
    <div class="scroll"><table class="edit pa"><tr><th>Description of work</th><th class="num">Scheduled</th><th class="num">Previous</th><th class="num">This period $</th><th class="num">% complete</th><th class="num">Balance</th></tr>
    ${c0.rows.map(r => `<tr><td>${esc(r.desc)}</td><td class="num">${money2(r.value)}</td><td class="num">${money2(r.prev)}</td><td><input class="n" type="number" step="0.01" data-pa="${esc(r.id)}" data-f="now" ${dis}></td><td><input class="n s" type="number" step="1" min="0" max="100" data-pa="${esc(r.id)}" data-f="pct" ${dis}></td><td class="num" ${cell('bal', r.id)}></td></tr>`).join('')}
    <tr class="grand"><td>Totals</td><td class="num">${money2(c0.contract)}</td><td class="num">${money2(r2(c0.completed - c0.thisPeriod))}</td><td class="num" id="paTNow"></td><td class="num" id="paTPct"></td><td class="num" id="paTBal"></td></tr></table></div>
    <div class="totals" style="max-width:460px;margin-left:auto"><div><span>Total completed to date</span><b id="paS4"></b></div><div><span id="paRetLbl"></span><b id="paS5"></b></div><div><span>Total earned less retainage</span><b id="paS6"></b></div><div><span>Less previous applications</span><b id="paS7"></b></div><div class="grand"><span>Current payment due</span><b id="paS8"></b></div></div>
    <div class="actions">${locked ? '' : `<button class="btn danger ghost" id="paDel">Delete</button>`}<span class="grow"></span><button class="btn" data-act="paDoc" data-j="${j.id}" data-id="${a.id}">View / print</button><button class="btn primary" id="paDone">Done</button></div>`, { wide: true });
  // figures are refreshed in place (never by rebuilding the dialog) so a click on a button is never lost while a number is being typed
  const refresh = skip => {
    const c = payAppCalc(j, a), set = (id, v) => { const el = $('#' + id); if (el) el.textContent = v; };
    c.rows.forEach(r => {
      const now = $(`[data-pa="${CSS.escape(r.id)}"][data-f="now"]`), pct = $(`[data-pa="${CSS.escape(r.id)}"][data-f="pct"]`), bal = $(`[data-c="bal:${CSS.escape(r.id)}"]`);
      if (now && now !== skip) now.value = r.now || ''; if (pct && pct !== skip) pct.value = r.value ? Math.round(r.pct * 10) / 10 : ''; if (bal) bal.textContent = money2(r.balance);
    });
    set('paTNow', money2(c.thisPeriod)); set('paTPct', (c.contract ? Math.round(c.completed / c.contract * 100) : 0) + '%'); set('paTBal', money2(r2(c.contract - c.completed)));
    set('paS4', money2(c.completed)); set('paRetLbl', a.release ? 'Less retainage (released)' : `Less retainage (${c.pct}%)`); set('paS5', money2(c.retainage)); set('paS6', money2(c.earnedLess)); set('paS7', money2(c.previous)); set('paS8', money2(c.due));
    const ret = $('#paRet'); if (ret) ret.disabled = locked || !!a.release;
    return c;
  };
  refresh();
  if (!locked) {
    $$('[data-pa]').forEach(inp => inp.onchange = () => {
      const row = payAppCalc(j, a).rows.find(r => r.id === inp.dataset.pa), want = inp.dataset.f === 'now' ? +inp.value || 0 : row.value * Math.min(100, Math.max(0, +inp.value || 0)) / 100 - row.prev;
      const lo = Math.min(0, -row.prev, row.value - row.prev), hi = Math.max(0, row.value - row.prev);      // never bill past the line's value (works for deduct lines too)
      a.work = { ...(a.work || {}), [row.id]: r2(Math.min(Math.max(want, lo), hi)) }; save(); refresh();
    });
    $('#paTo').onchange = e => { a.periodTo = e.target.value; save(); };
    $('#paRet').onchange = e => { a.retainagePct = Math.max(0, +e.target.value || 0); save(); refresh(); };
    $('#paRel').onchange = e => { a.release = e.target.checked; save(); refresh(); };
    $('#paAll').onclick = () => { payAppCalc(j, a).rows.forEach(r => { a.work = { ...(a.work || {}), [r.id]: r2(r.value - r.prev) }; }); save(); refresh(); };
    $('#paDel').onclick = () => { j.payApps = jobApps(j).filter(x => x.id !== a.id); save(); closeModal(); render(); };
  }
  $('#paDone').onclick = () => { closeModal(); render(); };
}
ACT.paInvoice = el => {
  const j = byId('jobs', el.dataset.j), a = jobApps(j).find(x => x.id === el.dataset.id), c = payAppCalc(j, a);
  if (a.invoiceId || c.due <= 0) return;
  const inv = { id: uid('i'), number: nextNum('inv'), customerId: j.customerId, jobId: j.id, items: [{ desc: `Pay application #${a.number} — ${j.name} (work through ${fmtD(a.periodTo)})${a.release ? ', including release of retainage' : c.retainage ? `, less ${c.pct}% retainage` : ''}`, qty: 1, unit: 'ls', price: c.due }], taxRate: 0, issued: today(), due: addDays(today(), 30), status: 'draft', payments: [], payAppId: a.id };
  DB.invoices.push(inv); a.invoiceId = inv.id; a.status = 'submitted'; save(); render(); toast(`Draft invoice #${inv.number} created for ${money2(c.due)}`); setTimeout(() => ACT.openInvoice({ dataset: { id: inv.id } }), 0);
};
function payAppDocHTML(j, a) {
  const c = payAppCalc(j, a), cust = byId('customers', j.customerId) || {}, row = (n, label, v, strong) => `<tr${strong ? ' class="grand"' : ''}><td>${n}.</td><td>${label}</td><td class="num">${money2(v)}</td></tr>`;
  return docWrap(`${docHeaderHTML('Application for Payment', '#' + a.number)}
    <table class="pmeta"><tr><th>To (Contractor):</th><td><b>${esc(cust.name || '')}</b></td></tr><tr><th>Project:</th><td><b>${esc(j.name)}</b> — ${esc(j.address)}</td></tr><tr><th>Period to:</th><td>${fmtD(a.periodTo)}</td></tr><tr><th>Application date:</th><td>${fmtD(a.date)}</td></tr></table>
    <table class="pitems pasum">${row(1, 'Original contract sum', c.original)}${row(2, 'Net change by change orders', c.cos)}${row(3, 'Contract sum to date (line 1 + 2)', c.contract)}${row(4, 'Total completed to date', c.completed)}${row(5, a.release ? 'Retainage (released with this application)' : `Retainage (${c.pct}% of completed work)`, c.retainage)}${row(6, 'Total earned less retainage (line 4 − 5)', c.earnedLess)}${row(7, 'Less previous applications for payment', c.previous)}${row(8, 'CURRENT PAYMENT DUE', c.due, true)}${row(9, 'Balance to finish, including retainage (line 3 − 6)', c.balance)}</table>
    <h4>Continuation sheet — schedule of values</h4>
    <table class="pitems pacont"><tr><th>Description of work</th><th class="num">Scheduled value</th><th class="num">Previous applications</th><th class="num">This period</th><th class="num">Completed to date</th><th class="num">%</th><th class="num">Balance to finish</th></tr>
    ${c.rows.map(r => `<tr><td>${esc(r.desc)}</td><td class="num">${money2(r.value)}</td><td class="num">${money2(r.prev)}</td><td class="num">${money2(r.now)}</td><td class="num">${money2(r.done)}</td><td class="num">${Math.round(r.pct)}%</td><td class="num">${money2(r.balance)}</td></tr>`).join('')}
    <tr class="grand"><td>Totals</td><td class="num">${money2(c.contract)}</td><td class="num">${money2(r2(c.completed - c.thisPeriod))}</td><td class="num">${money2(c.thisPeriod)}</td><td class="num">${money2(c.completed)}</td><td class="num">${c.contract ? Math.round(c.completed / c.contract * 100) : 0}%</td><td class="num">${money2(r2(c.contract - c.completed))}</td></tr></table>
    <p class="paccept">The undersigned certifies that the work covered by this application has been completed in accordance with the contract, and that current payment shown is now due.</p>
    <div class="psign"><div><span>Subcontractor:</span><b>${esc(DB.settings.company)}</b></div><div class="two"><div><span>By:</span><b></b></div><div><span>Date:</span><b></b></div></div></div>`);
}
ACT.paDoc = el => { const j = byId('jobs', el.dataset.j), a = jobApps(j).find(x => x.id === el.dataset.id); modal(`<div class="noprint btns"><button class="btn primary" data-act="docEmail" data-kind="pa" data-j="${j.id}" data-id="${a.id}">✉ Email</button><button class="btn" onclick="window.print()">Print / Save PDF</button><button class="btn" data-act="paOpen" data-j="${j.id}" data-id="${a.id}">← Back to figures</button></div>${payAppDocHTML(j, a)}`, { wide: true, print: true }); };

/* ---------- email a change order or pay application as a PDF ---------- */
ACT.docEmail = el => {
  const j = byId('jobs', el.dataset.j), isCO = el.dataset.kind === 'co', item = (isCO ? jobCOs(j) : jobApps(j)).find(x => x.id === el.dataset.id), c = byId('customers', j.customerId) || {}, first = String(c.contact || '').trim().split(/\s+/)[0] || 'there';
  const label = isCO ? `Change order #${item.number}` : `Pay application #${item.number}`, amount = isCO ? money2(item.amount) : money2(payAppCalc(j, item).due);
  openForm({ title: `✉ Email ${label.toLowerCase()}`, submit: 'Send email', fields: [{ name: 'to', label: 'To (separate several with commas)', req: 1, wide: 1 }, { name: 'subject', label: 'Subject', req: 1, wide: 1 }, { name: 'body', label: 'Message', type: 'textarea', wide: 1 }],
    values: { to: c.name === 'Unassigned' ? '' : (c.email || ''), subject: `${label} — ${j.name}`, body: isCO ? `Hi ${first},\n\nAttached is ${label.toLowerCase()} for ${j.name} (${amount}): ${item.title}.\n\nPlease sign and return it so we can proceed.\n\nThank you,\n${DB.settings.company}` : `Hi ${first},\n\nAttached is ${label.toLowerCase()} for ${j.name}, for work through ${fmtD(item.periodTo)}. Current payment due is ${amount}.\n\nThank you,\n${DB.settings.company}` },
    onSubmit(v) {
      const to = addrList(v.to); if (!to.length || !to.every(isEmailAddr)) { toast('Check the email addresses', 'err'); return false; }
      const btn = $('#mform button.primary'); btn.disabled = true; btn.textContent = 'Sending…';
      (async () => {
        try {
          const content = await htmlToPdfBase64(isCO ? changeOrderDocHTML(j, item) : payAppDocHTML(j, item), 'document.pdf');
          await emailCall('send', { to, subject: v.subject, html: emailHTML(v.body, null), attachments: [{ filename: safeFile(`${label} - ${j.name}`) + '.pdf', content }] });
          (item.emails = item.emails || []).push({ date: today(), to: to.join(', '), subject: v.subject }); if (!isCO && item.status === 'draft') item.status = 'submitted';
          if (c.activity) c.activity.push({ date: today(), text: `Emailed ${label.toLowerCase()} for ${j.name} to ${to.join(', ')}` });
          save(); closeModal(); render(); toast('Email sent');
        } catch (x) { btn.disabled = false; btn.textContent = 'Send email'; toast(x.message, 'err'); }
      })();
      return false;
    } });
};
