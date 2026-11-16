/* QuickBooks Online sync (via the "quickbooks" Supabase Edge Function).
   Links: customer.qboId, invoice.qboId, payment.qboId. Settings in priv().qbo = { itemId, since, lastSync, log }. */
const qboCfg = () => priv().qbo || (priv().qbo = {});
let QBO = { status: null, items: null, busy: false, err: '' };
const qboLog = msg => { const c = qboCfg(); (c.log = c.log || []).unshift(`${new Date().toLocaleString()} — ${msg}`); c.log = c.log.slice(0, 40); };

async function qboCall(action, extra = {}) {
  const s = await cloudSession(); if (!s) throw new Error('Please sign in again');
  let r;
  try { r = await fetch(CFG.supabaseUrl + '/functions/v1/quickbooks', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: CFG.supabaseAnonKey, Authorization: 'Bearer ' + s.access_token }, body: JSON.stringify({ action, ...extra }) }); }
  catch (x) { const e = new Error('The QuickBooks connector is not reachable. It may not be installed yet.'); e.missing = true; throw e; }
  const j = await r.json().catch(() => ({}));
  if (r.status === 404) { const e = new Error('The QuickBooks connector is not installed in Supabase yet.'); e.missing = true; throw e; }
  if (!r.ok) throw new Error(j.error || j.message || `QuickBooks connector error ${r.status}`);
  return j;
}
async function qboQuery(sql) {
  let out = [], start = 1;
  for (;;) {
    const qr = (await qboCall('query', { query: `${sql} STARTPOSITION ${start} MAXRESULTS 500` })).QueryResponse || {};
    const key = Object.keys(qr).find(k => Array.isArray(qr[k])), rows = key ? qr[key] : [];
    out = out.concat(rows); if (rows.length < 500) return out; start += 500;
  }
}
const qboSince = () => qboCfg().since || addDays(today(), -365);
const qboAddr = a => a ? [a.Line1, a.Line2, [a.City, a.CountrySubDivisionCode].filter(Boolean).join(', '), a.PostalCode].filter(Boolean).join(', ') : '';

/* ---------- 1. bring customers + invoices in ---------- */
async function qboImport() {
  const res = { customers: 0, linked: 0, invoices: 0 };
  const custs = await qboQuery('select * from Customer where Active = true');
  const byQ = Object.fromEntries(DB.customers.filter(c => c.qboId).map(c => [c.qboId, c])), byN = Object.fromEntries(DB.customers.map(c => [normName(c.name), c]));
  custs.forEach(q => {
    let c = byQ[q.Id] || byN[normName(q.DisplayName)];
    const info = { contact: [q.GivenName, q.FamilyName].filter(Boolean).join(' '), email: (q.PrimaryEmailAddr || {}).Address || '', phone: (q.PrimaryPhone || {}).FreeFormNumber || '', address: qboAddr(q.BillAddr) };
    if (c) { if (!c.qboId) { c.qboId = q.Id; res.linked++; } Object.keys(info).forEach(k => { if (!c[k] && info[k]) c[k] = info[k]; }); }
    else { c = { id: uid('c'), name: q.DisplayName, ...info, status: 'customer', source: 'QuickBooks', notes: '', portalToken: newToken(), qboId: q.Id, activity: [{ date: today(), text: 'Imported from QuickBooks' }] }; DB.customers.push(c); byN[normName(c.name)] = c; res.customers++; }
    byQ[q.Id] = c;
  });
  const have = new Set(DB.invoices.map(i => i.qboId).filter(Boolean));
  (await qboQuery(`select * from Invoice where TxnDate >= '${qboSince()}'`)).forEach(q => {
    if (have.has(q.Id)) return;
    const c = byQ[(q.CustomerRef || {}).value]; if (!c) return;
    const items = (q.Line || []).filter(l => l.DetailType === 'SalesItemLineDetail').map(l => { const d = l.SalesItemLineDetail || {}, qty = +d.Qty || 1; return { desc: l.Description || (d.ItemRef || {}).name || 'Item', qty, unit: '', price: d.UnitPrice != null ? +d.UnitPrice : (+l.Amount || 0) / qty }; });
    const diff = Math.round(((+q.TotalAmt || 0) - items.reduce((a, l) => a + l.qty * l.price, 0)) * 100) / 100;
    if (Math.abs(diff) >= 0.01) items.push({ desc: 'Tax / discounts / adjustments (from QuickBooks)', qty: 1, unit: '', price: diff });
    DB.invoices.push({ id: uid('i'), number: /^\d+$/.test(q.DocNumber || '') ? +q.DocNumber : (q.DocNumber || 'QB-' + q.Id), customerId: c.id, jobId: null, items, taxRate: 0, issued: q.TxnDate, due: q.DueDate || q.TxnDate, status: 'sent', payments: [], qboId: q.Id, overdueNotified: true });
    res.invoices++;
  });
  qboLog(`Imported ${res.customers} new customers (${res.linked} matched to existing), ${res.invoices} invoices`);
  return res;
}

/* ---------- 2. pull payments ---------- */
async function qboPullPayments() {
  const res = { payments: 0, adjusted: 0, paid: 0 };
  const inv = Object.fromEntries(DB.invoices.filter(i => i.qboId).map(i => [i.qboId, i])); if (!Object.keys(inv).length) return res;
  const wasPaid = new Set(Object.values(inv).filter(i => invStatus(i) === 'paid').map(i => i.id));
  (await qboQuery(`select * from Payment where TxnDate >= '${qboSince()}'`)).forEach(p => (p.Line || []).forEach(l => (l.LinkedTxn || []).forEach(t => {
    const i = t.TxnType === 'Invoice' && inv[t.TxnId], key = `${p.Id}:${t.TxnId}`;
    if (!i || i.payments.some(x => x.qboId === key)) return;
    i.payments.push({ id: uid('p'), date: p.TxnDate, amount: +l.Amount || 0, method: 'QuickBooks' + ((p.PaymentMethodRef || {}).name ? ' · ' + p.PaymentMethodRef.name : ''), qboId: key }); res.payments++;
  })));
  // reconcile to QuickBooks' own balance (covers credit memos, discounts and payments older than the window)
  (await qboQuery(`select Id, Balance, TotalAmt from Invoice where TxnDate >= '${qboSince()}'`)).forEach(q => {
    const i = inv[q.Id]; if (!i) return;
    const isAdj = x => String(x.qboId || '').startsWith('adj:'), old = i.payments.filter(isAdj).reduce((a, x) => a + x.amount, 0);
    i.payments = i.payments.filter(x => !isAdj(x));      // recompute the adjustment from scratch each time, so it can never double up
    const gap = Math.round(((+q.TotalAmt || 0) - (+q.Balance || 0) - invPaid(i)) * 100) / 100;
    if (gap >= 0.01) { i.payments.push({ id: uid('p'), date: today(), amount: gap, method: 'QuickBooks · balance adjustment', qboId: 'adj:' + q.Id }); if (Math.abs(gap - old) >= 0.01) res.adjusted++; }
  });
  res.paid = Object.values(inv).filter(i => invStatus(i) === 'paid' && !wasPaid.has(i.id)).length;
  qboLog(`Payments: ${res.payments} new, ${res.adjusted} balance adjustments, ${res.paid} invoices now paid`);
  return res;
}

/* ---------- online payment links (QuickBooks Payments) ---------- */
const isPayLink = u => typeof u === 'string' && /^https:\/\/[^\s"<>]+$/.test(u);
async function qboFetchLink(i) {      // returns true when QuickBooks handed back a payment page for this invoice
  const r = await qboCall('invoiceLink', { id: String(i.qboId) });
  if (isPayLink(r.link)) { i.payLink = r.link; return true; }
  i.payLinkChecked = today(); return false;
}
async function qboFetchLinks(max = 40) {
  const list = DB.invoices.filter(i => i.qboId && !i.payLink && invBalance(i) > 0.005 && i.payLinkChecked !== today()).slice(0, max); let n = 0;
  for (const i of list) { try { if (await qboFetchLink(i)) n++; } catch (x) { break; } }
  if (list.length) qboLog(`Online payment links: ${n} of ${list.length} unpaid invoices have one`);
  return { tried: list.length, got: n };
}
/* ---------- 3. send customers + invoices out ---------- */
const qboReady = () => DB.invoices.filter(i => !i.qboId && i.status !== 'draft' && invTotal(i) > 0 && custName(i.customerId) !== 'Unassigned' && byId('customers', i.customerId));
async function qboItems() { if (!QBO.items) QBO.items = await qboQuery("select * from Item where Type = 'Service' and Active = true"); return QBO.items; }
async function qboEnsureCustomer(c) {
  if (c.qboId) return c.qboId;
  const safe = c.name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const found = await qboQuery(`select * from Customer where DisplayName = '${safe}'`);
  if (found[0]) return (c.qboId = found[0].Id);
  const data = { DisplayName: c.name.slice(0, 100) }; if (c.email) data.PrimaryEmailAddr = { Address: c.email }; if (c.phone) data.PrimaryPhone = { FreeFormNumber: c.phone }; if (c.address) data.BillAddr = { Line1: c.address.slice(0, 500) };
  if (c.contact) { const [g, ...f] = c.contact.split(' '); data.GivenName = g.slice(0, 100); if (f.length) data.FamilyName = f.join(' ').slice(0, 100); }
  return (c.qboId = (await qboCall('create', { entity: 'Customer', data })).Customer.Id);
}
async function qboPush(list) {
  const res = { sent: 0, failed: [], notes: [], links: 0 }, itemId = qboCfg().itemId;
  if (!itemId) throw new Error('Choose which QuickBooks product/service to use for invoice lines first');
  for (const i of list) {
    try {
      const c = byId('customers', i.customerId), cid = await qboEnsureCustomer(c), job = i.jobId && byId('jobs', i.jobId);
      const data = { CustomerRef: { value: cid }, TxnDate: i.issued, DueDate: i.due, PrivateNote: `From AsphaltPro invoice #${i.number}${job ? ' — ' + job.name : ''}`,
        Line: i.items.filter(l => (+l.qty || 0) * (+l.price || 0) !== 0).map(l => ({ DetailType: 'SalesItemLineDetail', Amount: Math.round((+l.qty || 0) * (+l.price || 0) * 100) / 100, Description: String(l.desc || '').slice(0, 4000), SalesItemLineDetail: { ItemRef: { value: itemId }, Qty: +l.qty || 1, UnitPrice: +l.price || 0 } })) };
      let q;
      if (qboCfg().onlinePay !== false && c.email) {      // let the customer pay this invoice online through QuickBooks Payments
        try { q = (await qboCall('create', { entity: 'Invoice', data: { ...data, BillEmail: { Address: c.email.split(/[,;]/)[0].trim() }, AllowOnlineCreditCardPayment: true, AllowOnlineACHPayment: true } })).Invoice; }
        catch (x) { res.notes.push(`#${i.number}: created without online payment (${x.message})`); }
      }
      if (!q) q = (await qboCall('create', { entity: 'Invoice', data })).Invoice;
      i.qboId = q.Id; if (q.DocNumber) i.number = /^\d+$/.test(q.DocNumber) ? +q.DocNumber : q.DocNumber; res.sent++;
      try { if (await qboFetchLink(i)) res.links++; } catch (x) { /* link can be fetched later from the QuickBooks page */ }
      save();   // keep the link even if a later invoice fails, so nothing is ever sent twice
    } catch (x) { res.failed.push(`#${i.number}: ${x.message}`); }
  }
  if (res.notes.length) qboLog(res.notes.join('; '));
  qboLog(`Sent ${res.sent} invoices to QuickBooks (${res.links} with an online payment link)${res.failed.length ? `, ${res.failed.length} failed: ${res.failed.join('; ')}` : ''}`);
  return res;
}

/* ---------- page ---------- */
VIEWS.quickbooks = args => {
  if (!CLOUD) return { title: 'QuickBooks', html: `<div class="card">${empty('QuickBooks needs the shared backend', 'Connect Supabase first (see README) — the QuickBooks connection runs there.')}</div>` };
  const st = QBO.status, c = qboCfg(), ready = qboReady(), linkedInv = DB.invoices.filter(i => i.qboId).length, linkedCust = DB.customers.filter(x => x.qboId).length;
  const note = args[0] === 'connected' ? '<div class="banner ok">QuickBooks is connected.</div>' : args[0] === 'error' ? `<div class="banner bad">QuickBooks did not connect: ${esc(decodeURIComponent(args.slice(1).join('/') || 'unknown error'))}</div>` : '';
  const busy = QBO.busy ? 'disabled' : '';
  let body;
  if (QBO.err && QBO.missing) body = `<div class="card"><h3>One-time setup needed</h3><p>The QuickBooks connector has not been installed in your Supabase project yet. Setup steps are in the README under “QuickBooks Online”. Once it is installed, reload this page.</p><p class="muted">${esc(QBO.err)}</p></div>`;
  else if (QBO.err) body = `<div class="card"><div class="banner bad">${esc(QBO.err)}</div><button class="btn" data-act="qboRefresh">Try again</button></div>`;
  else if (!st) body = `<div class="card">${empty('Checking the QuickBooks connection…')}</div>`;
  else if (!st.connected) body = `<div class="card"><h3>Connect your QuickBooks Online company</h3><p class="muted">You will be sent to Intuit to sign in and approve access, then brought straight back here. Sign in as a QuickBooks admin.</p><button class="btn primary" data-act="qboConnect" ${busy}>Connect QuickBooks</button>${st.environment === 'sandbox' ? '<p class="hint">This connector is in sandbox (test) mode — it can only connect to Intuit test companies.</p>' : ''}</div>`;
  else body = `
    <div class="card"><h3>Connected to ${esc(st.company || 'QuickBooks')} ${st.environment === 'sandbox' ? badge('draft').replace('draft', 'sandbox') : ''}<span class="btns"><button class="btn primary" data-act="qboSyncAll" ${busy}>${QBO.busy ? 'Working…' : '⟳ Sync from QuickBooks now'}</button><button class="btn ghost danger" data-act="qboDisconnect" ${busy}>Disconnect</button></span></h3>
      <p class="muted" style="margin:0">${linkedCust} customers and ${linkedInv} invoices are linked to QuickBooks.${c.lastSync ? ' Last synced ' + new Date(c.lastSync).toLocaleString() + '.' : ''}</p></div>
    <div class="cols">
      <div class="card"><h3>1 · Bring in from QuickBooks</h3><p class="muted">Adds QuickBooks customers and invoices that are not here yet, and matches customers that already exist by name. Nothing in QuickBooks is changed.</p>
        <label class="inl">Invoices and payments dated from <input type="date" id="qboSince" value="${esc(qboSince())}"></label>
        <div class="btns" style="margin-top:10px"><button class="btn" data-act="qboImport" ${busy}>Import customers &amp; invoices</button><button class="btn" data-act="qboPay" ${busy}>Pull payments</button></div>
        <p class="hint">“Sync from QuickBooks now” does both. Payments recorded in QuickBooks mark the matching invoices here as paid.</p></div>
      <div class="card"><h3>2 · Send to QuickBooks</h3><p class="muted">Creates these invoices (and any customers QuickBooks does not have yet) in your books. QuickBooks assigns the invoice number.</p>
        <label class="block"><span>QuickBooks product/service to use for invoice lines</span><select id="qboItem"><option value="">— choose —</option>${(QBO.items || []).map(i => `<option value="${esc(i.Id)}" ${i.Id === c.itemId ? 'selected' : ''}>${esc(i.FullyQualifiedName || i.Name)}</option>`).join('')}</select></label>
        ${ready.length ? `<table>${ready.slice(0, 8).map(i => `<tr><td>#${esc(i.number)}</td><td>${esc(custName(i.customerId))}</td><td class="num">${money2(invTotal(i))}</td></tr>`).join('')}${ready.length > 8 ? `<tr><td colspan="3" class="muted">…and ${ready.length - 8} more</td></tr>` : ''}</table>
        <button class="btn primary" style="margin-top:10px" data-act="qboSend" ${busy}>Send ${ready.length} invoice${ready.length > 1 ? 's' : ''} (${money(ready.reduce((a, i) => a + invTotal(i), 0))}) to QuickBooks</button>` : '<p><b>Nothing waiting.</b> Invoices marked “sent” here that are not yet in QuickBooks will be listed.</p>'}
        <label class="check"><input type="checkbox" id="qboOnline" ${c.onlinePay !== false ? 'checked' : ''}> Let customers pay these online (card / bank) through QuickBooks Payments</label>
        <p class="hint">Draft invoices and invoices for the “Unassigned” customer are never sent. Sales tax is left for QuickBooks to work out. ${DB.invoices.filter(i => i.payLink).length} invoices have an online payment link.</p></div>
    </div>
    <div class="card"><h3>Activity</h3>${(c.log || []).length ? `<ul class="timeline">${c.log.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : '<p class="muted">No sync yet.</p>'}</div>`;
  return {
    title: 'QuickBooks', html: note + body,
    mount() {
      if (!st && !QBO.err) qboRefresh();
      const s = $('#qboSince'); if (s) s.onchange = () => { qboCfg().since = s.value; save(); };
      const it = $('#qboItem'); if (it) it.onchange = () => { qboCfg().itemId = it.value; save(); };
      const on = $('#qboOnline'); if (on) on.onchange = () => { qboCfg().onlinePay = on.checked; save(); };
    }
  };
};
async function qboRefresh() {
  QBO.err = ''; QBO.missing = false;
  try {
    QBO.status = await qboCall('status');
    if (QBO.status.connected) { await qboItems(); const c = qboCfg(); if (!c.itemId && QBO.items.length) { const pick = QBO.items.find(i => /^(services?|sales)$/i.test(i.Name)); if (pick) { c.itemId = pick.Id; save(); } } }
  } catch (x) { QBO.err = x.message; QBO.missing = !!x.missing; }
  if (route().name === 'quickbooks') render();
}
async function qboRun(label, fn) {
  if (QBO.busy) return; QBO.busy = true; render();
  try { const msg = await fn(); qboCfg().lastSync = new Date().toISOString(); save(); toast(msg); }
  catch (x) { qboLog(`${label} failed: ${x.message}`); save(); toast(`${label} failed: ${x.message}`, 'err'); if (/not connected/i.test(x.message)) QBO.status = null; }
  QBO.busy = false; if (route().name === 'quickbooks') render();
}
ACT.qboRefresh = () => { QBO.status = null; QBO.err = ''; render(); };
ACT.qboConnect = async () => { try { location.href = (await qboCall('authUrl')).url; } catch (x) { toast(x.message, 'err'); } };
ACT.qboDisconnect = () => confirmBox('Disconnect QuickBooks? Links on customers and invoices are kept, so you can reconnect later without duplicates.', async () => { try { await qboCall('disconnect'); qboLog('Disconnected'); save(); QBO = { status: null, items: null, busy: false, err: '' }; render(); } catch (x) { toast(x.message, 'err'); } });
ACT.qboImport = () => qboRun('Import', async () => { const r = await qboImport(); return `Imported ${r.customers} customers and ${r.invoices} invoices`; });
ACT.qboPay = () => qboRun('Payment pull', async () => { const r = await qboPullPayments(), l = await qboFetchLinks(); return `${r.payments + r.adjusted} payments applied — ${r.paid} invoices now paid${l.tried ? ` · ${l.got} payment links` : ''}`; });
ACT.qboSyncAll = () => qboRun('Sync', async () => { const a = await qboImport(), b = await qboPullPayments(); await qboFetchLinks(); return `Synced: ${a.customers} customers, ${a.invoices} invoices, ${b.payments + b.adjusted} payments`; });
ACT.qboSend = () => { const list = qboReady(); if (!qboCfg().itemId) return toast('Choose the QuickBooks product/service for invoice lines first', 'err'); confirmBox(`Create ${list.length} invoice${list.length > 1 ? 's' : ''} totalling ${money(list.reduce((a, i) => a + invTotal(i), 0))} in QuickBooks? This writes to your real books.`, () => qboRun('Send', async () => { const r = await qboPush(list); if (r.failed.length) throw new Error(`${r.sent} sent, ${r.failed.length} failed — ${r.failed[0]}`); return `Sent ${r.sent} invoices to QuickBooks`; })); };
