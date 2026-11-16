/* Bid tracking: bid due dates, the contractors each proposal went to, awards, win rate by contractor,
   and a bulk tool for giving "Unassigned" proposals a contractor.
   Per estimate: bidDue (date), bidders: [{ id, customerId, sentAt }], lostReason. The winner is always e.customerId. */
const realCust = id => { const c = byId('customers', id); return c && c.name !== 'Unassigned' ? c : null; };
const bidders = e => e.bidders || [];
const unassignedCust = () => DB.customers.find(c => c.name === 'Unassigned') || (DB.customers.push({ id: uid('c'), name: 'Unassigned', contact: '', email: '', phone: '', address: '', status: 'prospect', source: '', notes: '', portalToken: newToken(), activity: [] }), DB.customers[DB.customers.length - 1]);
function findOrCreateCustomer(name) {
  name = String(name || '').trim(); if (!name || normName(name) === 'unassigned') return null;
  let c = DB.customers.find(x => normName(x.name) === normName(name));
  if (!c) { c = { id: uid('c'), name, contact: '', email: '', phone: '', address: '', status: 'prospect', source: 'Bid', notes: '', portalToken: newToken(), activity: [{ date: today(), text: 'Added from a bid' }] }; DB.customers.push(c); }
  return c;
}
// everyone a proposal was bid to: the bidder list, or just its customer when there is only one
const bidParticipants = e => bidders(e).length ? bidders(e) : (realCust(e.customerId) ? [{ id: 'self', customerId: e.customerId, sentAt: e.sentAt || null }] : []);
const bidOutcome = (e, cid) => e.status === 'signed' ? (cid === e.customerId ? 'won' : 'lost') : e.status === 'declined' ? 'lost' : e.status === 'sent' ? 'pending' : 'draft';
const OUTCOME_BADGE = { won: 'green', lost: 'red', pending: 'blue', draft: 'gray' };
const outcomeBadge = o => `<span class="badge ${OUTCOME_BADGE[o]}">${o === 'draft' ? 'not sent' : o}</span>`;
function addBidder(e, c) {
  if (!e.bidders) { e.bidders = []; const cur = realCust(e.customerId); if (cur && cur.id !== c.id) e.bidders.push({ id: uid('b'), customerId: cur.id, sentAt: e.sentAt || null }); }
  if (!e.bidders.some(b => b.customerId === c.id)) e.bidders.push({ id: uid('b'), customerId: c.id, sentAt: null });
  if (!realCust(e.customerId)) e.customerId = c.id;      // first contractor named becomes the customer until someone is awarded
}
const estCustLabel = e => bidders(e).length > 1 ? bidders(e).map(b => custName(b.customerId)).join(', ') : custName(e.customerId);
const dueClass = d => !d ? '' : d < today() ? 'neg' : d <= addDays(today(), 3) ? 'warnt' : '';

/* ---------- card on the estimate ---------- */
function bidCardHTML(e) {
  const locked = e.status === 'signed', parts = bidParticipants(e), open = isOpenEst(e);
  return `<div class="card"><h3>Bid ${e.status === 'declined' && e.lostReason ? `<small class="muted">Lost: ${esc(e.lostReason)}</small>` : ''}</h3>
    <div class="grid4"><label><span>Bid due date</span><input type="date" data-e="bidDue" value="${esc(e.bidDue || '')}" ${locked ? 'disabled' : ''}></label>
    ${locked ? '' : `<label class="wide2"><span>Bidding this job to (add every contractor it goes to)</span><form id="bidAdd" class="inline" style="margin:0"><input name="n" list="custList" placeholder="Contractor name — pick or type a new one" autocomplete="off"><button class="btn sm">Add</button></form></label>`}</div>
    ${parts.length ? `<table class="bidt"><tr><th>Contractor</th><th>Email</th><th>Sent</th><th>Result</th><th></th></tr>${parts.map(b => { const c = byId('customers', b.customerId) || {}, o = bidOutcome(e, b.customerId); return `<tr><td><b>${esc(c.name)}</b>${c.contact ? `<br><small>${esc(c.contact)}</small>` : ''}</td><td>${locked ? esc(c.email || '') : `<input data-cemail="${c.id}" value="${esc(c.email || '')}" placeholder="email address">`}</td><td>${b.sentAt ? fmtD(b.sentAt) : '<span class="muted">—</span>'}</td><td>${outcomeBadge(o)}</td>
      <td class="num">${open ? `<button class="btn sm primary" data-act="bidWon" data-id="${e.id}" data-c="${b.customerId}">Won</button>` : ''}${!locked && b.id !== 'self' ? ` <button class="ico" data-act="bidRemove" data-id="${e.id}" data-b="${b.id}" title="Remove">×</button>` : ''}</td></tr>`; }).join('')}</table>
    ${open ? `<div class="btns" style="margin-top:8px"><button class="btn sm ghost" data-act="bidLost" data-id="${e.id}">Mark lost…</button></div>` : ''}` : '<p class="muted">No contractor yet — add who this bid is going to.</p>'}
    <datalist id="custList">${DB.customers.filter(c => c.name !== 'Unassigned').map(c => `<option value="${esc(c.name)}">`).join('')}</datalist></div>`;
}
function bidCardMount(e) {
  const f = $('#bidAdd'); if (f) f.onsubmit = ev => { ev.preventDefault(); const c = findOrCreateCustomer(new FormData(f).get('n')); if (!c) return toast('Type a contractor name', 'err'); addBidder(e, c); save(); render(); };
}
CHG.cemail = el => { const c = byId('customers', el.dataset.cemail); if (c) { c.email = el.value.trim(); save(); } };
ACT.bidRemove = el => {
  const e = byId('estimates', el.dataset.id), b = bidders(e).find(x => x.id === el.dataset.b); if (!b) return;
  e.bidders = e.bidders.filter(x => x.id !== b.id);
  if (e.customerId === b.customerId) e.customerId = e.bidders[0] ? e.bidders[0].customerId : unassignedCust().id;
  if (e.followList) e.followList = e.followList.filter(x => x.customerId !== b.customerId);
  if (!e.bidders.length) delete e.bidders; save(); render();
};
ACT.bidWon = el => {
  const e = byId('estimates', el.dataset.id), c = byId('customers', el.dataset.c);
  confirmBox(`Mark this bid as WON with ${c.name}? The proposal is marked signed and your automations run (for example, creating the job).`, () => {
    e.customerId = c.id; e.status = 'signed'; e.signedAt = today(); e.autoRan = true; e.follow = false;
    if (!e.signature) e.signature = { name: `Awarded — ${c.name}`, date: today(), img: null };
    if (c.status !== 'customer') c.status = 'customer'; c.activity.push({ date: today(), text: `Won bid #${e.number} — ${e.title}` });
    fire('estimate.signed', { estimate: e, title: `Bid won: #${e.number} — ${money(estTotals(e).total)}`, body: `${c.name} · ${e.title}`, link: '#/estimates/' + e.id });
    save(); render(); toast('Marked won');
  });
};
ACT.bidLost = el => {
  const e = byId('estimates', el.dataset.id);
  openForm({ title: 'Mark bid lost', submit: 'Mark lost', fields: [{ name: 'reason', label: 'Why? (optional)', type: 'select', options: ['', 'Price', 'Contractor did not win the job', 'Went with another sub', 'Project cancelled / on hold', 'No response', 'Other'], wide: 1 }, { name: 'note', label: 'Note', wide: 1 }],
    onSubmit(v) { e.status = 'declined'; e.follow = false; e.lostReason = [v.reason, v.note].filter(Boolean).join(' — '); save(); render(); toast('Marked lost'); } });
};

/* ---------- Bids page ---------- */
let bidSel = new Set(), bidQ = '', bidSort = 'value';
function bidStats() {
  const m = new Map();
  DB.estimates.forEach(e => bidParticipants(e).forEach(b => {
    const o = bidOutcome(e, b.customerId); if (o === 'draft') return;
    const s = m.get(b.customerId) || { id: b.customerId, bids: 0, won: 0, lost: 0, pending: 0, wonVal: 0, bidVal: 0 }; m.set(b.customerId, s);
    const v = estTotals(e).total; s.bids++; s[o]++; s.bidVal += v; if (o === 'won') s.wonVal += v;
  }));
  return [...m.values()].map(s => ({ ...s, name: custName(s.id), rate: s.won + s.lost ? s.won / (s.won + s.lost) * 100 : null }));
}
VIEWS.bids = () => {
  const t = today(), un = unassignedCust().id, stats = bidStats();
  const due = DB.estimates.filter(e => e.bidDue && isOpenEst(e)).sort((a, b) => a.bidDue.localeCompare(b.bidDue));
  const dueSoon = due.filter(e => e.status === 'draft' && e.bidDue <= addDays(t, 7));
  const won = stats.reduce((a, s) => a + s.won, 0), lost = stats.reduce((a, s) => a + s.lost, 0);
  const unass = DB.estimates.filter(e => e.customerId === un && !bidders(e).length);
  const q = bidQ.toLowerCase(), list = unass.filter(e => !q || (e.title + ' ' + e.address).toLowerCase().includes(q)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const sorted = [...stats].sort((a, b) => bidSort === 'name' ? a.name.localeCompare(b.name) : bidSort === 'rate' ? (b.rate ?? -1) - (a.rate ?? -1) : bidSort === 'bids' ? b.bids - a.bids : b.wonVal - a.wonVal);
  const th = (k, l, cls = '') => `<th class="${cls} sortable ${bidSort === k ? 'on' : ''}" data-act="bidSort" data-v="${k}">${l}</th>`;
  return {
    title: 'Bids', html: `
    <div class="kpis"><div class="kpi ${dueSoon.some(e => e.bidDue < t) ? 'warn' : ''}"><span>Bids to submit, next 7 days</span><b>${dueSoon.length}</b><small>${dueSoon.filter(e => e.bidDue < t).length} past due</small></div>
      <div class="kpi"><span>Bids out, awaiting result</span><b>${stats.reduce((a, s) => a + s.pending, 0)}</b><small>across ${stats.filter(s => s.pending).length} contractors</small></div>
      <div class="kpi"><span>Win rate (decided bids)</span><b>${won + lost ? Math.round(won / (won + lost) * 100) + '%' : '—'}</b><small>${won} won · ${lost} lost</small></div>
      <div class="kpi ${unass.length ? 'warn' : ''}"><span>Proposals with no contractor</span><b>${unass.length}</b><small>assign them below</small></div></div>
    <div class="cols"><div class="card"><h3>Bid due dates</h3>${due.length ? `<table class="hover">${due.slice(0, 15).map(e => `<tr onclick="location.hash='#/estimates/${e.id}'"><td><b class="${dueClass(e.bidDue)}">${fmtShort(e.bidDue)}</b></td><td><b>${esc(e.title)}</b><br><small>${esc(estCustLabel(e))}</small></td><td>${badge(e.status)}</td><td class="num">${money(estTotals(e).total)}</td></tr>`).join('')}</table>${due.length > 15 ? `<p class="muted">…and ${due.length - 15} more</p>` : ''}` : empty('No bid dates set', 'Add a “Bid due date” on an estimate and it shows here')}</div>
    <div class="card"><h3>Win rate by contractor</h3>${sorted.length ? `<div class="scroll" style="max-height:420px;overflow:auto"><table><tr>${th('name', 'Contractor')}${th('bids', 'Bids', 'num')}<th class="num">Won</th><th class="num">Lost</th><th class="num">Open</th>${th('rate', 'Win %', 'num')}${th('value', 'Won $', 'num')}</tr>
      ${sorted.map(s => `<tr><td><b>${esc(s.name)}</b></td><td class="num">${s.bids}</td><td class="num">${s.won}</td><td class="num">${s.lost}</td><td class="num">${s.pending}</td><td class="num">${s.rate === null ? '—' : `<b class="${s.rate >= 50 ? 'pos' : ''}">${Math.round(s.rate)}%</b>`}</td><td class="num">${money(s.wonVal)}</td></tr>`).join('')}</table></div>` : empty('No bids recorded yet')}</div></div>
    <div class="card"><h3>Proposals with no contractor (${unass.length})</h3>
      ${unass.length ? `<div class="toolbar"><input type="search" id="bidQ" placeholder="Filter by project or city…" value="${esc(bidQ)}"><span class="grow"></span><b>${bidSel.size} selected</b><input id="bidTo" list="custList2" placeholder="Contractor — pick or type new" style="max-width:260px" autocomplete="off"><button class="btn primary" data-act="bidAssign">Assign selected</button></div>
      <div class="scroll" style="max-height:520px;overflow:auto"><table class="hover"><tr><th style="width:34px"><input type="checkbox" id="bidAll" ${list.length && list.every(e => bidSel.has(e.id)) ? 'checked' : ''}></th><th>Project</th><th>Proposal date</th><th>Status</th><th class="num">Total</th></tr>
      ${list.slice(0, 200).map(e => `<tr><td><input type="checkbox" data-bidsel="${e.id}" ${bidSel.has(e.id) ? 'checked' : ''}></td><td><a href="#/estimates/${e.id}"><b>${esc(e.title)}</b></a><br><small>${esc(e.address)}</small></td><td>${fmtD(e.createdAt)}</td><td>${badge(e.status)}</td><td class="num">${money(estTotals(e).total)}</td></tr>`).join('')}</table></div>
      ${list.length > 200 ? `<p class="muted">Showing the first 200 of ${list.length} — use the filter to narrow down.</p>` : ''}<p class="hint">Tick the proposals that went to the same contractor (filtering by name helps, e.g. “Walmart”), choose the contractor, and assign them in one go. If a job was bid to several contractors, open it and add them on its Bid card.</p>
      <datalist id="custList2">${DB.customers.filter(c => c.name !== 'Unassigned').map(c => `<option value="${esc(c.name)}">`).join('')}</datalist>` : '<p class="muted">Every proposal has a contractor.</p>'}</div>`,
    mount() {
      const s = $('#bidQ'); if (s) s.oninput = () => { bidQ = s.value; const p = s.selectionStart; render(); const n = $('#bidQ'); n.focus(); n.setSelectionRange(p, p); };
      const all = $('#bidAll'); if (all) all.onchange = () => { list.slice(0, 200).forEach(e => all.checked ? bidSel.add(e.id) : bidSel.delete(e.id)); render(); };
      $$('[data-bidsel]').forEach(c => c.onchange = () => { c.checked ? bidSel.add(c.dataset.bidsel) : bidSel.delete(c.dataset.bidsel); render(); });
    }
  };
};
ACT.bidSort = el => { bidSort = el.dataset.v; render(); };
ACT.bidAssign = () => {
  if (!bidSel.size) return toast('Tick at least one proposal', 'err');
  const c = findOrCreateCustomer(($('#bidTo') || {}).value); if (!c) return toast('Choose or type the contractor', 'err');
  let n = 0; bidSel.forEach(id => { const e = byId('estimates', id); if (!e) return; e.customerId = c.id; n++; if (e.status === 'signed' && c.status !== 'customer') c.status = 'customer'; DB.jobs.filter(j => j.estimateId === e.id).forEach(j => j.customerId = c.id); DB.invoices.filter(i => i.jobId && DB.jobs.some(j => j.id === i.jobId && j.estimateId === e.id)).forEach(i => i.customerId = c.id); });
  bidSel = new Set(); save(); render(); toast(`Assigned ${n} proposal${n === 1 ? '' : 's'} to ${c.name}`);
};
