/* Email delivery of proposals and invoices + follow-up schedule (via the "email" Supabase Edge Function).
   Per record: emails[] (history), follow (opted in to automatic follow-ups), followTo, followCount / remindCount. */
const EMAIL_DEFAULTS = {
  proposalSubject: 'Proposal: {{project}}',
  proposalBody: 'Hi {{contact}},\n\nPlease find our proposal for {{project}} attached ({{total}}). You can also review and accept it online using the button below.\n\nIf you have any questions, just reply to this email.\n\nThank you,\n{{company}}',
  invoiceSubject: 'Invoice #{{number}} from {{company}}',
  invoiceBody: 'Hi {{contact}},\n\nPlease find invoice #{{number}} attached. The balance of {{balance}} is due {{due}}. You can also view it online using the button below.\n\nThank you for your business,\n{{company}}',
  followSubject: 'Following up: {{project}} proposal',
  followBody: 'Hi {{contact}},\n\nI wanted to follow up on the proposal we sent on {{date}} for {{project}} ({{total}}). You can review and accept it online using the button below.\n\nIf you have any questions, or the scope has changed, just reply to this email.\n\nThank you,\n{{company}}',
  reminderSubject: 'Reminder: invoice #{{number}} is past due',
  reminderBody: 'Hi {{contact}},\n\nThis is a friendly reminder that invoice #{{number}} for {{balance}} was due on {{due}}. You can view it using the button below.\n\nIf payment is already on its way, thank you — please disregard this note.\n\n{{company}}',
};
const emailTpl = () => ({ ...EMAIL_DEFAULTS, ...(DB.settings.email || {}) });
const followCfg = () => ({ enabled: false, days: '7, 21, 45', maxAge: 90, invoices: true, invoiceDays: '3, 14, 30', ...(DB.settings.followups || {}) });
const fillTpl = (t, v) => String(t || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => v[k] ?? '');
const isEmailAddr = s => /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(s);
const addrList = s => String(s || '').split(/[,;]/).map(x => x.trim()).filter(Boolean);
let EM = { status: null, err: '', missing: false, due: null };

async function emailCall(action, extra = {}) {
  if (!CLOUD) throw new Error('Email needs the shared backend (Supabase) to be connected.');
  const s = await cloudSession(); if (!s) throw new Error('Please sign in again');
  let r;
  try { r = await fetch(CFG.supabaseUrl + '/functions/v1/email', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: CFG.supabaseAnonKey, Authorization: 'Bearer ' + s.access_token }, body: JSON.stringify({ action, ...extra }) }); }
  catch (x) { const e = new Error('The email sender is not reachable. It may not be installed yet.'); e.missing = true; throw e; }
  const j = await r.json().catch(() => ({}));
  if (r.status === 404) { const e = new Error('The email sender is not installed in Supabase yet.'); e.missing = true; throw e; }
  if (!r.ok) throw new Error(j.error || j.message || `Email service error ${r.status}`);
  return j;
}
function emailHTML(text, button) {   // mirrors emailHTML() in supabase/functions/email/index.ts
  const s = DB.settings, accent = PT().accent || '#f59e0b';
  const paras = esc(text).split(/\n{2,}/).map(p => `<p style="margin:0 0 14px">${p.replace(/\n/g, '<br>')}</p>`).join('');
  const btn = button ? `<p style="margin:22px 0"><a href="${esc(button.url)}" style="background:${esc(accent)};color:#111;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:6px;display:inline-block">${esc(button.label)}</a></p>` : '';
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:600px">${paras}${btn}<hr style="border:0;border-top:1px solid #ddd;margin:22px 0 10px"><p style="font-size:12px;color:#666;margin:0">${[s.company, s.phone, s.email].filter(Boolean).map(esc).join(' · ')}</p></div>`;
}

/* ---------- PDF of a proposal / invoice, exactly as designed ---------- */
function loadPDF() {
  return window.html2pdf ? Promise.resolve() : new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js'; s.onload = ok; s.onerror = () => no(new Error('Could not load the PDF maker (check your internet connection)')); document.head.appendChild(s); });
}
async function htmlToPdfBase64(html, filename) {
  await loadPDF();
  // the PDF maker copies the element it is given, so the off-screen wrapper stays outside and only the plain inner page is copied
  const box = document.createElement('div'); box.style.cssText = 'position:fixed;left:-10000px;top:0'; box.innerHTML = '<div style="width:780px;background:#fff"></div>';
  const page = box.firstChild; page.innerHTML = html;
  const doc = page.querySelector('.proposal'); if (doc) { doc.style.border = '0'; doc.style.borderRadius = '0'; }
  document.body.appendChild(box);
  try {
    const uri = await html2pdf().set({ margin: [0.35, 0.3, 0.45, 0.3], filename, image: { type: 'jpeg', quality: 0.9 }, html2canvas: { scale: 1.6, useCORS: true, backgroundColor: '#ffffff' }, jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }, pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', '.psign', '.terms-text p'] } }).from(page).outputPdf('datauristring');
    return uri.slice(uri.indexOf(',') + 1);
  } finally { box.remove(); }
}
const safeFile = s => String(s).replace(/[^\w.\- ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

/* ---------- send dialog ---------- */
function emailVars(kind, rec, c) {
  const s = DB.settings, first = String((c && c.contact) || '').trim().split(/\s+/)[0] || 'there';
  const link = c && c.name !== 'Unassigned' && c.portalToken ? portalURL(c) : '';
  return kind === 'proposal'
    ? { contact: first, customer: (c && c.name) || '', company: s.company, project: rec.title, total: money2(estTotals(rec).total), date: fmtD(rec.createdAt), number: String(rec.number), link }
    : { contact: first, customer: (c && c.name) || '', company: s.company, number: String(rec.number), balance: money2(invBalance(rec)), total: money2(invTotal(rec)), due: fmtD(rec.due), link };
}
function openEmailDialog(kind, id) {
  const rec = byId(kind === 'proposal' ? 'estimates' : 'invoices', id), t = emailTpl(), isP = kind === 'proposal';
  const cur = byId('customers', rec.customerId), unassigned = !cur || cur.name === 'Unassigned';
  const multi = isP && bidders(rec).length > 1;      // bid going to several contractors: each gets their own separate email
  const firstOf = c => String((c && c.contact) || '').trim().split(/\s+/)[0] || 'there';
  const paint = custId => {
    const c = byId('customers', custId), v = emailVars(kind, rec, c);
    if (multi) { v.contact = '{{contact}}'; v.customer = '{{customer}}'; }
    modal(`<form id="emForm"><h3>✉ Email ${isP ? 'proposal' : 'invoice'} #${esc(rec.number)}</h3>
      ${multi ? `<label class="block"><span>Send to — each contractor gets their own separate email and never sees the others</span></label>
        <div class="bidsel">${bidders(rec).map(b => { const bc = byId('customers', b.customerId) || {}; return `<label class="check"><input type="checkbox" name="bid" value="${b.id}" ${b.sentAt ? '' : 'checked'}> <b>${esc(bc.name)}</b><input data-bemail="${b.id}" value="${esc(bc.email || '')}" placeholder="email address">${b.sentAt ? `<small>sent ${fmtD(b.sentAt)}</small>` : ''}</label>`; }).join('')}</div>`
      : `${isP && rec.status !== 'signed' ? `<label class="block"><span>Customer / contractor this is going to</span><select id="emCust">${unassigned ? '<option value="">— choose who this is for —</option>' : ''}${[...DB.customers].filter(x => x.name !== 'Unassigned').sort((a, b) => a.name.localeCompare(b.name)).map(x => `<option value="${x.id}" ${x.id === custId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}<option value="__new">+ New customer…</option></select></label>` : ''}`}
      <div class="grid2">${multi ? '' : `<label class="wide"><span>To (separate several with commas)</span><input name="to" required value="${esc(rec.followTo || (c && c.name !== 'Unassigned' && c.email) || '')}" placeholder="name@company.com"></label>
      <label class="wide"><span>Cc (optional)</span><input name="cc" value=""></label>`}
      <label class="wide"><span>Subject</span><input name="subject" required value="${esc(fillTpl(isP ? t.proposalSubject : t.invoiceSubject, v))}"></label>
      <label class="wide"><span>Message${multi ? ' — {{contact}} becomes each person’s first name' : ''}</span><textarea name="body" rows="9" required>${esc(fillTpl(isP ? t.proposalBody : t.invoiceBody, v))}</textarea></label></div>
      <label class="check"><input type="checkbox" name="pdf" checked> Attach the ${isP ? 'proposal' : 'invoice'} as a PDF</label>
      ${multi ? '' : `<label class="check"><input type="checkbox" name="link" ${v.link ? 'checked' : 'disabled'}> Include a button to ${isP ? 'review and sign' : 'view it'} online ${v.link ? '' : '<small>(choose a customer first)</small>'}</label>`}
      <label class="check"><input type="checkbox" name="follow" ${rec.follow === false ? '' : 'checked'}> Send automatic ${isP ? 'follow-ups while this proposal is still open' : 'reminders if this invoice goes past due'}</label>
      <p class="hint">Sent from your company email address; replies go to your office inbox.${followCfg().enabled ? '' : ' Automatic follow-ups are switched off — turn them on under Email & Follow-ups.'}</p>
      <div class="actions"><button type="button" class="btn" data-act="closeModal">Cancel</button><button class="btn primary" id="emGo">Send email</button></div></form>`, { wide: true });
    const sel = $('#emCust');
    if (sel) sel.onchange = () => {
      if (sel.value !== '__new') return paint(sel.value);
      const n = findOrCreateCustomer(prompt('New customer / contractor name:')); if (!n) return paint(custId);
      save(); paint(n.id);
    };
    $('#emForm').onsubmit = async ev => {
      ev.preventDefault(); const f = new FormData(ev.target), go = $('#emGo'), subject = f.get('subject'), body = f.get('body');
      const pdfName = safeFile(isP ? `Proposal - ${rec.title} - ${rec.createdAt}` : `Invoice ${rec.number}`) + '.pdf';
      const done = () => { rec.follow = !!f.get('follow'); if (rec.status === 'draft') rec.status = 'sent'; if (isP) { rec.sentAt = today(); rec.followCount = 0; } else rec.remindCount = 0; save(); closeModal(); render(); };
      if (multi) {   // ---- one separate email per ticked contractor
        const picks = f.getAll('bid').map(bid => { const b = bidders(rec).find(x => x.id === bid), bc = byId('customers', b.customerId); return { b, bc, to: addrList($(`[data-bemail="${bid}"]`).value) }; });
        if (!picks.length) return toast('Tick at least one contractor', 'err');
        const bad = picks.find(p => !p.to.length || !p.to.every(isEmailAddr)); if (bad) return toast(`Add a valid email address for ${bad.bc.name}`, 'err');
        go.disabled = true; let sent = 0; const failed = [];
        for (const p of picks) {
          go.textContent = `Sending ${sent + failed.length + 1} of ${picks.length}…`;
          try {
            if (!p.bc.email) p.bc.email = p.to[0];
            const vars = { contact: firstOf(p.bc), customer: p.bc.name }, subj = fillTpl(subject, vars);
            const attachments = f.get('pdf') ? [{ filename: pdfName, content: await htmlToPdfBase64(proposalHTML({ ...rec, customerId: p.bc.id }), 'document.pdf') }] : [];   // "Prepared for" names this contractor
            await emailCall('send', { to: p.to, subject: subj, html: emailHTML(fillTpl(body, vars), null), attachments });
            p.b.sentAt = today(); (rec.emails = rec.emails || []).push({ date: today(), to: p.to.join(', '), subject: subj, kind: 'proposal' });
            p.bc.activity.push({ date: today(), text: `Emailed proposal #${rec.number} to ${p.to.join(', ')}` }); sent++;
          } catch (x) { failed.push(`${p.bc.name}: ${x.message}`); }
        }
        if (!sent) { go.disabled = false; go.textContent = 'Send email'; return toast(failed[0], 'err'); }
        rec.followTo = ''; rec.followList = bidders(rec).filter(b => b.sentAt).map(b => { const bc = byId('customers', b.customerId) || {}; return { to: bc.email || '', contact: firstOf(bc), customerId: b.customerId }; }).filter(x => x.to);
        done(); return toast(failed.length ? `Sent ${sent}, ${failed.length} failed — ${failed[0]}` : `Sent ${sent} separate email${sent > 1 ? 's' : ''}`, failed.length ? 'err' : '');
      }
      const to = addrList(f.get('to')), cc = addrList(f.get('cc'));
      if (!to.length || ![...to, ...cc].every(isEmailAddr)) return toast('Check the email addresses', 'err');
      if (isP && sel && !sel.value) return toast('Choose who this proposal is for', 'err');
      go.disabled = true; go.textContent = 'Preparing…';
      try {
        const cust = byId('customers', custId);
        if (isP && cust && rec.customerId !== cust.id) rec.customerId = cust.id;      // assign before building the PDF so "Prepared for" is right
        const attachments = [];
        if (f.get('pdf')) { go.textContent = 'Making PDF…'; attachments.push({ filename: pdfName, content: await htmlToPdfBase64(isP ? proposalHTML(rec) : invoiceDocHTML(rec), 'document.pdf') }); }
        go.textContent = 'Sending…';
        const url = f.get('link') && cust && cust.name !== 'Unassigned' ? portalURL(cust) : '';
        await emailCall('send', { to, cc, subject, html: emailHTML(body, url ? { label: isP ? 'Review & accept proposal' : 'View invoice', url } : null), attachments });
        (rec.emails = rec.emails || []).push({ date: today(), to: to.join(', '), subject, kind: isP ? 'proposal' : 'invoice' });
        rec.followTo = to.join(', '); delete rec.followList;
        if (isP && bidders(rec).length === 1) bidders(rec)[0].sentAt = today();
        if (cust) { if (!cust.email) cust.email = to[0]; cust.activity.push({ date: today(), text: `Emailed ${isP ? 'proposal' : 'invoice'} #${rec.number} to ${to.join(', ')}` }); }
        done(); toast('Email sent');
      } catch (x) { go.disabled = false; go.textContent = 'Send email'; toast(x.message, 'err'); }
    };
  };
  paint(unassigned ? '' : cur.id);
}
ACT.emailProposal = el => openEmailDialog('proposal', el.dataset.id);
ACT.emailInvoice = el => openEmailDialog('invoice', el.dataset.id);
ACT.followToggle = el => { const rec = byId(el.dataset.coll, el.dataset.id); rec.follow = !(rec.follow === true); save(); render(); };
const emailHistoryHTML = (rec, coll) => (rec.emails || []).length || rec.followTo ? `<div class="card"><h3>Emails ${rec.followTo && (coll === 'estimates' ? rec.status === 'sent' : true) ? `<label class="check sm"><input type="checkbox" data-act="followToggle" data-coll="${coll}" data-id="${rec.id}" ${rec.follow ? 'checked' : ''}> automatic follow-ups</label>` : ''}</h3><ul class="timeline">${[...(rec.emails || [])].reverse().map(m => `<li><em>${fmtD(m.date)}</em> <b>${esc(m.kind)}</b>${m.auto ? ' (automatic)' : ''} → ${esc(m.to)}<br><small>${esc(m.subject)}</small></li>`).join('')}</ul></div>` : '';

/* ---------- what is due (mirrors runFollowups in the edge function, for display) ---------- */
const numDays = (v, d) => { const a = addrList(v).map(Number).filter(n => n > 0).sort((x, y) => x - y); return a.length ? a : d; };
function followSchedule() {
  const f = followCfg(), days = numDays(f.days, [7, 21, 45]), idays = numDays(f.invoiceDays, [3, 14, 30]), t = today(), rows = [];
  DB.estimates.forEach(e => {
    if (e.status !== 'sent' || !e.follow) return; const c = byId('customers', e.customerId), to = (e.followList && e.followList.length ? e.followList.map(x => x.to).join(' · ') : e.followTo) || (c && c.email), k = +e.followCount || 0, start = e.sentAt || e.createdAt;
    if (!to || k >= days.length) return; const on = addDays(start, days[k]); if (estAge({ createdAt: start }) > (+f.maxAge || 90)) return;
    rows.push({ kind: 'Proposal', label: `#${e.number} ${e.title}`, to, step: `Follow-up ${k + 1} of ${days.length}`, on, href: '#/estimates/' + e.id });
  });
  if (f.invoices !== false) DB.invoices.forEach(i => {
    if (i.status !== 'sent' || !i.follow || invBalance(i) < 0.01) return; const c = byId('customers', i.customerId), to = i.followTo || (c && c.email), k = +i.remindCount || 0;
    if (!to || k >= idays.length) return;
    rows.push({ kind: 'Invoice', label: `#${i.number} · ${custName(i.customerId)}`, to, step: `Reminder ${k + 1} of ${idays.length}`, on: addDays(i.due, idays[k]), href: '#/invoices' });
  });
  return rows.sort((a, b) => a.on.localeCompare(b.on)).map(r => ({ ...r, due: r.on <= t }));
}

/* ---------- Email & Follow-ups page ---------- */
VIEWS.email = () => {
  if (!CLOUD) return { title: 'Email & Follow-ups', html: `<div class="card">${empty('Email needs the shared backend', 'Connect Supabase first (see README) — sending runs there.')}</div>` };
  const st = EM.status, f = followCfg(), t = emailTpl(), sched = followSchedule(), dueNow = sched.filter(r => r.due);
  const recent = [...DB.estimates.flatMap(e => (e.emails || []).map(m => ({ ...m, what: `Proposal #${e.number} ${e.title}` }))), ...DB.invoices.flatMap(i => (i.emails || []).map(m => ({ ...m, what: `Invoice #${i.number}` })))].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 25);
  const head = EM.err ? (EM.missing ? `<div class="card"><h3>One-time setup needed</h3><p>The email sender has not been installed in your Supabase project yet. Setup steps are in the README under “Email & follow-ups”. Reload this page once it is installed.</p><p class="muted">${esc(EM.err)}</p></div>` : `<div class="card"><div class="banner bad">${esc(EM.err)}</div><button class="btn" data-act="emRefresh">Try again</button></div>`)
    : !st ? `<div class="card">${empty('Checking the email sender…')}</div>`
      : st.configured ? `<div class="banner ok">Email is ready. Sending as ${esc(st.from)}${st.replyTo ? ` · replies go to ${esc(st.replyTo)}` : ''}</div>` : '<div class="banner bad">The email sender is installed but its secrets (RESEND_API_KEY, EMAIL_FROM) are not set yet.</div>';
  const ta = (k, label, rows) => `<label class="wide"><span>${label}</span><textarea data-em="${k}" rows="${rows}">${esc(t[k])}</textarea></label>`, tx = (k, label) => `<label class="wide"><span>${label}</span><input data-em="${k}" value="${esc(t[k])}"></label>`;
  return {
    title: 'Email & Follow-ups', html: `${head}
    <div class="cols"><div class="card"><h3>Automatic follow-ups</h3>
      <label class="check"><span class="switch"><input type="checkbox" data-fu="enabled" ${f.enabled ? 'checked' : ''}><i></i></span> <span><b>Send follow-ups automatically</b><br><small>Every weekday morning, without anyone needing to be in the app.</small></span></label>
      <div class="grid2"><label><span>Proposal follow-ups — days after sending</span><input data-fu="days" value="${esc(f.days)}"></label><label><span>Stop after this many days</span><input type="number" data-fu="maxAge" value="${esc(f.maxAge)}"></label>
      <label><span>Invoice reminders — days past due</span><input data-fu="invoiceDays" value="${esc(f.invoiceDays)}"></label><label class="check" style="align-self:end"><input type="checkbox" data-fu="invoices" ${f.invoices !== false ? 'checked' : ''}> Remind on overdue invoices</label></div>
      <p class="hint">Only proposals and invoices you emailed from this app (with “automatic follow-ups” ticked) are included. Follow-ups stop as soon as a proposal is signed or declined, or an invoice is paid. Imported proposals are never emailed unless you send them yourself.</p></div>
    <div class="card"><h3>Coming up <span class="btns"><button class="btn sm" data-act="emRunNow" ${dueNow.length && f.enabled ? '' : 'disabled'}>Send the ${dueNow.length} due now</button></span></h3>
      ${sched.length ? `<table>${sched.slice(0, 12).map(r => `<tr><td><a href="${r.href}">${esc(r.label)}</a><br><small>${esc(r.to)}</small></td><td>${esc(r.step)}</td><td>${r.due ? '<b class="neg">due</b>' : fmtD(r.on)}</td></tr>`).join('')}</table>${sched.length > 12 ? `<p class="muted">…and ${sched.length - 12} more</p>` : ''}` : empty('Nothing scheduled', 'Email a proposal or invoice and it will appear here')}</div></div>
    <div class="card"><h3>Wording</h3><p class="hint" style="margin:0 0 10px">You can use: {{contact}} first name · {{customer}} · {{company}} · {{project}} · {{total}} · {{date}} · {{number}} · {{balance}} · {{due}}</p>
      <div class="cols"><div class="grid2">${tx('proposalSubject', 'Proposal — subject')}${ta('proposalBody', 'Proposal — message', 8)}${tx('followSubject', 'Proposal follow-up — subject')}${ta('followBody', 'Proposal follow-up — message', 8)}</div>
      <div class="grid2">${tx('invoiceSubject', 'Invoice — subject')}${ta('invoiceBody', 'Invoice — message', 8)}${tx('reminderSubject', 'Overdue reminder — subject')}${ta('reminderBody', 'Overdue reminder — message', 8)}</div></div></div>
    <div class="card"><h3>Recently sent</h3>${recent.length ? `<ul class="timeline">${recent.map(m => `<li><em>${fmtD(m.date)}</em> <b>${esc(m.kind)}</b>${m.auto ? ' (automatic)' : ''} · ${esc(m.what)} → ${esc(m.to)}</li>`).join('')}</ul>` : '<p class="muted">Nothing sent yet.</p>'}</div>`,
    mount() { if (!st && !EM.err) emRefresh(); }
  };
};
async function emRefresh() { EM.err = ''; EM.missing = false; try { EM.status = await emailCall('status'); } catch (x) { EM.err = x.message; EM.missing = !!x.missing; } if (route().name === 'email') render(); }
ACT.emRefresh = () => { EM.status = null; EM.err = ''; render(); };
ACT.emRunNow = async el => { el.disabled = true; try { const r = await emailCall('runFollowups'); toast(`Sent ${r.sent} follow-up${r.sent === 1 ? '' : 's'}${r.errors.length ? ` — ${r.errors.length} failed: ${r.errors[0]}` : ''}`, r.errors.length ? 'err' : ''); await cloudPoll(); render(); } catch (x) { toast(x.message, 'err'); el.disabled = false; } };
CHG.em = el => { DB.settings.email = { ...(DB.settings.email || {}), [el.dataset.em]: el.value }; save(); };
CHG.fu = el => { DB.settings.followups = { ...(DB.settings.followups || {}), [el.dataset.fu]: el.type === 'checkbox' ? el.checked : el.value }; save(); render(); };
