/* Roles, crew view (clock in/out, checklists, notes, photos), timesheets, and the team list.
   Time entries live in DB.time: { id, jobId, email, name, date, start, end, hours, note, source, approved, costId } */
let ME = { email: 'you@this-device', name: 'You', role: 'owner', crewId: null };
let CREWMODE = false;            // signed in with the "crew" role: no office data is loaded at all
const ROLE_LABEL = { owner: 'Owner', office: 'Office', bookkeeper: 'Bookkeeper', estimator: 'Estimator', crew: 'Crew' };
const ROLE_HELP = { owner: 'Everything, including the team list', office: 'Everything except the team list', bookkeeper: 'Invoices, QuickBooks, costing, timesheets, reports', estimator: 'Customers, estimates, bids, schedule and jobs — no invoices or pay rates', crew: 'Phone view only: their jobs, clock in/out, checklists, notes and photos — no prices' };
const ROLE_PAGES = {
  office: ['crm', 'estimates', 'bids', 'design', 'schedule', 'jobs', 'crew', 'time', 'costing', 'portal', 'dashboard', 'invoices', 'email', 'quickbooks', 'automation', 'settings'],
  bookkeeper: ['dashboard', 'invoices', 'quickbooks', 'costing', 'time', 'jobs', 'crm', 'email'],
  estimator: ['crm', 'estimates', 'bids', 'design', 'schedule', 'jobs', 'crew', 'portal', 'email'],
  crew: ['crew'],
};
const canSee = page => ME.role === 'owner' || (ROLE_PAGES[ME.role] || []).includes(page);
const homePage = () => ME.role === 'owner' || ME.role === 'office' || ME.role === 'bookkeeper' ? 'dashboard' : ME.role === 'crew' ? 'crew' : 'estimates';
const times = () => DB.time || (DB.time = []);
const hrs = n => (Math.round((+n || 0) * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
const clockT = iso => iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
const liveHours = t => t.end ? +t.hours || 0 : Math.max(0, (Date.now() - Date.parse(t.start)) / 36e5);
const jobHours = id => times().filter(t => t.jobId === id).reduce((a, t) => a + liveHours(t), 0);

/* ---------- crew data: through locked-down database functions for crew logins, straight from the data for office users ---------- */
const crewSan = j => ({ id: j.id, name: j.name, address: j.address, status: j.status, date: j.date, days: j.days, crewId: j.crewId, notes: j.notes, checklist: j.checklist || [], customer: custName(j.customerId), logs: (j.logs || []).slice(-5), photoCount: (j.photos || []).length });
const rpc = async (fn, args) => { const { data, error } = await SB.rpc(fn, args); if (error) throw new Error(error.message); return data; };
const crewApi = {
  async get() {
    if (CREWMODE) return rpc('crew_get');
    return { me: ME, company: DB.settings.company, crews: DB.crews, jobs: DB.jobs.filter(j => j.status === 'scheduled' || j.status === 'in-progress').map(crewSan), time: times().filter(t => t.email === ME.email && (!t.end || t.date >= addDays(today(), -21))).sort((a, b) => b.start.localeCompare(a.start)) };
  },
  async clockIn(jobId) {
    if (CREWMODE) return rpc('crew_clock_in', { p_job: jobId, p_date: today() });
    if (times().some(t => t.email === ME.email && !t.end)) throw new Error('You are already clocked in. Clock out first.');
    const j = byId('jobs', jobId); times().push({ id: uid('t'), jobId, email: ME.email, name: ME.name || ME.email, date: today(), start: new Date().toISOString(), end: null, hours: 0, note: '', source: 'crew' });
    if (j.status === 'scheduled') j.status = 'in-progress'; save();
  },
  async clockOut(note) {
    if (CREWMODE) return rpc('crew_clock_out', { p_note: note || '' });
    const t = times().find(x => x.email === ME.email && !x.end); if (!t) throw new Error('You are not clocked in.');
    t.end = new Date().toISOString(); t.hours = Math.round((Date.parse(t.end) - Date.parse(t.start)) / 36e3) / 100; t.note = note || ''; save();
  },
  async check(jobId, i, done) { if (CREWMODE) return rpc('crew_check', { p_job: jobId, p_index: i, p_done: done }); byId('jobs', jobId).checklist[i].done = done; save(); },
  async log(jobId, text, weather) {
    if (CREWMODE) return rpc('crew_log', { p_job: jobId, p_date: today(), p_text: text, p_weather: weather || '', p_tons: 0 });
    const j = byId('jobs', jobId); j.logs.push({ id: uid('g'), date: today(), weather: weather || '', crew: 0, tons: 0, text, by: ME.name || ME.email }); if (j.status === 'scheduled') j.status = 'in-progress'; save();
  },
  async photo(jobId, src) { if (CREWMODE) return rpc('crew_photo', { p_job: jobId, p_date: today(), p_src: src }); byId('jobs', jobId).photos.push({ id: uid('p'), date: today(), src }); save(); },
};

/* ---------- crew view (built for a phone) ---------- */
let CR = { data: null, err: '', busy: false, openJob: null, timer: null };
async function crewLoad() { try { CR.data = await crewApi.get(); CR.err = ''; } catch (x) { CR.err = x.message; } if (route().name === 'crew') render(); }
async function crewDo(fn, okMsg) { if (CR.busy) return; CR.busy = true; try { await fn(); if (okMsg) toast(okMsg); await crewLoad(); } catch (x) { toast(x.message, 'err'); } CR.busy = false; }
VIEWS.crew = () => {
  const d = CR.data;
  if (!d) return { title: 'Crew', portal: CREWMODE, html: `<div class="crew"><div class="card">${CR.err ? `<div class="banner bad">${esc(CR.err)}</div><button class="btn" data-act="crewReload">Try again</button>` : empty('Loading your jobs…')}</div></div>`, mount() { if (!CR.err) crewLoad(); } };
  const t = today(), open = d.time.find(x => !x.end), mine = j => !d.me.crewId || !j.crewId || j.crewId === d.me.crewId;
  const covers = (j, day) => j.date && j.date <= day && addDays(j.date, (+j.days || 1) - 1) >= day;
  const jobs = d.jobs.filter(mine), todayJobs = jobs.filter(j => covers(j, t) || (open && open.jobId === j.id)), soon = jobs.filter(j => !todayJobs.includes(j) && j.date && j.date > t && j.date <= addDays(t, 7)).sort((a, b) => a.date.localeCompare(b.date)), rest = d.jobs.filter(j => !todayJobs.includes(j) && !soon.includes(j));
  const wk = weekStart(t), weekHours = d.time.filter(x => x.date >= wk).reduce((a, x) => a + liveHours(x), 0), onJob = open && d.jobs.find(j => j.id === open.jobId);
  const card = j => {
    const isOpen = CR.openJob === j.id, on = open && open.jobId === j.id, done = j.checklist.filter(c => c.done).length;
    return `<div class="cjob ${on ? 'on' : ''}"><div class="chead" data-act="crewToggle" data-id="${j.id}"><div><b>${esc(j.name)}</b><small>${esc(j.customer || '')}${j.date ? ' · ' + fmtShort(j.date) : ''}</small></div><span>${on ? '<em class="live">ON THE CLOCK</em>' : ''}${isOpen ? '▾' : '▸'}</span></div>
      ${isOpen ? `<div class="cbody">${j.address ? `<a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(j.address)}">📍 ${esc(j.address)}</a>` : ''}
        ${j.notes ? `<p class="cnote"><b>Notes from the office</b><br>${esc(j.notes)}</p>` : ''}
        ${on ? `<button class="btn big danger" data-act="crewOut">■ Clock out</button>` : `<button class="btn big primary" data-act="crewIn" data-id="${j.id}" ${open ? 'disabled' : ''}>▶ Clock in${open ? ' (clock out of the other job first)' : ' to this job'}</button>`}
        <h4>Checklist ${done}/${j.checklist.length}</h4>${j.checklist.map((c, i) => `<label class="check big"><input type="checkbox" data-crewchk="${i}" data-id="${j.id}" ${c.done ? 'checked' : ''}> ${esc(c.t)}</label>`).join('') || '<p class="muted">No checklist</p>'}
        <h4>Site note</h4><form class="clog" data-id="${j.id}"><textarea name="text" rows="2" placeholder="What got done, problems, anything the office should know…" required></textarea><div class="btns"><input name="weather" placeholder="Weather (optional)"><button class="btn primary">Save note</button></div></form>
        ${j.logs.length ? `<div class="clogs">${[...j.logs].reverse().map(g => `<p><small>${fmtD(g.date)}${g.by ? ' · ' + esc(g.by) : ''}</small><br>${esc(g.text)}</p>`).join('')}</div>` : ''}
        <label class="btn">📷 Add photo${j.photoCount ? ` (${j.photoCount} so far)` : ''}<input type="file" accept="image/*" capture="environment" hidden data-crewphoto="${j.id}"></label></div>` : ''}</div>`;
  };
  return {
    title: 'Crew', portal: CREWMODE, html: `<div class="crew">
    <header><div><b>${esc(d.company || 'Crew')}</b><span>Hi ${esc(String(d.me.name || d.me.email).split(/[ @]/)[0])}</span></div>${CREWMODE ? '<button class="btn sm" data-act="signOut">Sign out</button>' : '<span class="muted">Crew view</span>'}</header>
    <div class="cclock ${open ? 'on' : ''}">${open ? `<div><small>On the clock since ${clockT(open.start)}</small><b>${esc(onJob ? onJob.name : 'a job')}</b><span id="crewTick">${hrs(liveHours(open))} h</span></div><button class="btn danger" data-act="crewOut">■ Clock out</button>` : `<div><small>Not clocked in</small><b>Open a job below and tap Clock in</b></div>`}</div>
    <h3>Today</h3>${todayJobs.map(card).join('') || '<p class="muted">Nothing scheduled for you today.</p>'}
    ${soon.length ? `<h3>Coming up</h3>${soon.map(card).join('')}` : ''}
    ${rest.length ? `<details><summary>Other active jobs (${rest.length})</summary>${rest.map(card).join('')}</details>` : ''}
    <h3>My hours <small>this week: ${hrs(weekHours)} h</small></h3><div class="card flush"><table>${d.time.slice(0, 14).map(x => { const j = d.jobs.find(y => y.id === x.jobId); return `<tr><td>${fmtShort(x.date)}</td><td>${esc(j ? j.name : 'Job')}</td><td>${clockT(x.start)}–${x.end ? clockT(x.end) : 'now'}</td><td class="num"><b>${hrs(liveHours(x))} h</b></td></tr>`; }).join('') || `<tr><td>${empty('No time recorded yet')}</td></tr>`}</table></div></div>`,
    mount() {
      $$('[data-crewchk]').forEach(c => c.onchange = () => crewDo(() => crewApi.check(c.dataset.id, +c.dataset.crewchk, c.checked)));
      $$('form.clog').forEach(f => f.onsubmit = ev => { ev.preventDefault(); const v = new FormData(f); crewDo(() => crewApi.log(f.dataset.id, v.get('text'), v.get('weather')), 'Note saved'); });
      $$('[data-crewphoto]').forEach(inp => inp.onchange = () => { const file = inp.files[0]; if (file) crewDo(async () => crewApi.photo(inp.dataset.crewphoto, await shrinkImage(file, 800)), 'Photo saved'); });
      clearInterval(CR.timer); if (open) CR.timer = setInterval(() => { const el = $('#crewTick'); if (el) el.textContent = hrs(liveHours(open)) + ' h'; else clearInterval(CR.timer); }, 30000);
    }
  };
};
ACT.crewReload = () => { CR.err = ''; CR.data = null; render(); };
ACT.crewToggle = el => { CR.openJob = CR.openJob === el.dataset.id ? null : el.dataset.id; render(); };
ACT.crewIn = el => crewDo(() => crewApi.clockIn(el.dataset.id), 'Clocked in');
ACT.crewOut = () => openForm({ title: 'Clock out', submit: 'Clock out', fields: [{ name: 'note', label: 'Anything to note? (optional)', type: 'textarea', wide: 1 }], onSubmit(v) { crewDo(() => crewApi.clockOut(v.note), 'Clocked out'); } });

/* ---------- timesheets (office) ---------- */
let timeWeek = weekStart(today());
const rateFor = email => { const r = (priv().rates || {})[String(email).toLowerCase()]; return r === undefined || r === '' ? +priv().defaultRate || 0 : +r; };
VIEWS.time = () => {
  const days = [...Array(7)].map((_, i) => addDays(timeWeek, i)), list = times().filter(t => t.date >= days[0] && t.date <= days[6]).sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
  const people = [...new Map(list.map(t => [t.email, t.name])).entries()], tot = list.reduce((a, t) => a + liveHours(t), 0);
  const ready = list.filter(t => t.end && t.approved && !t.costId), pending = list.filter(t => t.end && !t.approved);
  const st = t => !t.end ? badge('in-progress').replace('in-progress<', 'on the clock<') : t.costId ? badge('paid').replace('paid<', 'posted<') : t.approved ? badge('signed').replace('signed<', 'approved<') : badge('draft').replace('draft<', 'to review<');
  return {
    title: 'Timesheets', html: `<div class="toolbar"><div class="btns"><button class="btn" data-act="timeWk" data-v="-7">‹</button><button class="btn" data-act="timeWk" data-v="0">This week</button><button class="btn" data-act="timeWk" data-v="7">›</button></div><b class="grow">${fmtD(days[0])} – ${fmtD(days[6])} · ${hrs(tot)} hours</b>
      <button class="btn" data-act="timeAdd">+ Add time</button><button class="btn" data-act="timeApproveAll" ${pending.length ? '' : 'disabled'}>Approve ${pending.length} to review</button><button class="btn primary" data-act="timePost" ${ready.length ? '' : 'disabled'}>Post ${ready.length} approved to job costing</button></div>
    <div class="card flush scroll"><table><tr><th>Person</th>${days.map(d => `<th class="num ${d === today() ? 'today' : ''}">${fmtShort(d).split(',')[0]}<br><small>${fmtD(d).split(',')[0]}</small></th>`).join('')}<th class="num">Total</th><th class="num">Rate</th></tr>
      ${people.map(([email, name]) => { const mine = list.filter(t => t.email === email); return `<tr><td><b>${esc(name || email)}</b><br><small>${esc(email)}</small></td>${days.map(d => { const h = mine.filter(t => t.date === d).reduce((a, t) => a + liveHours(t), 0); return `<td class="num">${h ? hrs(h) : ''}</td>`; }).join('')}<td class="num"><b>${hrs(mine.reduce((a, t) => a + liveHours(t), 0))}</b></td><td class="num"><input class="n" style="width:84px" type="number" step="0.01" data-rate="${esc(email)}" value="${(priv().rates || {})[email.toLowerCase()] ?? ''}" placeholder="${rateFor(email) || '$/hr'}"></td></tr>`; }).join('') || `<tr><td colspan="10">${empty('No time this week', 'Crew clock in from the Crew view on their phones, or add time by hand')}</td></tr>`}</table></div>
    <div class="card flush scroll"><table class="hover"><tr><th>Date</th><th>Person</th><th>Job</th><th>Time</th><th class="num">Hours</th><th>Note</th><th>Status</th><th></th></tr>
      ${list.map(t => `<tr><td>${fmtShort(t.date)}</td><td>${esc(t.name || t.email)}</td><td>${t.jobId && byId('jobs', t.jobId) ? `<a href="#/jobs/${t.jobId}">${esc(byId('jobs', t.jobId).name)}</a>` : '—'}</td><td>${t.start && t.source !== 'manual' ? `${clockT(t.start)}–${t.end ? clockT(t.end) : 'now'}` : 'entered by hand'}</td><td class="num"><b>${hrs(liveHours(t))}</b></td><td><small>${esc(t.note || '')}</small></td><td>${st(t)}</td>
        <td class="num"><span class="btns" style="justify-content:flex-end">${t.end && !t.costId ? `<button class="btn sm" data-act="timeApprove" data-id="${t.id}">${t.approved ? 'Un-approve' : 'Approve'}</button>` : ''}${t.costId ? '' : `<button class="btn sm" data-act="timeEdit" data-id="${t.id}">Edit</button>`}</span></td></tr>`).join('')}</table></div>
    <p class="hint">Posting adds each approved entry to its job’s costs as labor (hours × that person’s rate) and marks it posted so it can never be counted twice. Rates are stored with your private settings — crew and estimators cannot see them. Default rate when a person has none: <input class="n" style="width:84px;display:inline-block" type="number" step="0.01" data-priv="defaultRate" value="${esc(priv().defaultRate ?? '')}" placeholder="$/hr"></p>`
  };
};
ACT.timeWk = el => { const v = +el.dataset.v; timeWeek = v === 0 ? weekStart(today()) : addDays(timeWeek, v); render(); };
CHG.rate = el => { const p = priv(); p.rates = { ...(p.rates || {}) }; if (el.value === '') delete p.rates[el.dataset.rate.toLowerCase()]; else p.rates[el.dataset.rate.toLowerCase()] = +el.value; save(); };
ACT.timeApprove = el => { const t = times().find(x => x.id === el.dataset.id); t.approved = !t.approved; save(); render(); };
ACT.timeApproveAll = () => { times().filter(t => t.date >= timeWeek && t.date <= addDays(timeWeek, 6) && t.end && !t.approved).forEach(t => t.approved = true); save(); render(); };
const timeFields = () => { const known = [...new Map(times().map(t => [t.email, t.name])).entries()]; return [{ name: 'name', label: 'Person', req: 1, wide: 1, ph: 'Name' }, { name: 'email', label: 'Their login email (if they have one)', wide: 1, ph: known[0] ? known[0][0] : '' }, { name: 'jobId', label: 'Job', type: 'select', options: [['', '— no job —'], ...DB.jobs.filter(j => j.status !== 'complete').map(j => [j.id, j.name])], wide: 1 }, { name: 'date', label: 'Date', type: 'date' }, { name: 'hours', label: 'Hours', type: 'number', step: '0.25' }, { name: 'note', label: 'Note', wide: 1 }]; };
ACT.timeAdd = () => openForm({ title: 'Add time', fields: timeFields(), values: { date: today(), hours: 8 }, onSubmit(v) { if (!(v.hours > 0)) { toast('Enter the hours', 'err'); return false; } times().push({ id: uid('t'), jobId: v.jobId || null, email: (v.email || v.name).trim().toLowerCase(), name: v.name.trim(), date: v.date, start: v.date + 'T12:00:00.000Z', end: v.date + 'T12:00:00.000Z', hours: v.hours, note: v.note, source: 'manual', approved: false }); if (v.date < timeWeek || v.date > addDays(timeWeek, 6)) timeWeek = weekStart(v.date); save(); render(); } });
ACT.timeEdit = el => { const t = times().find(x => x.id === el.dataset.id); openForm({ title: 'Edit time entry', fields: timeFields(), values: { ...t, hours: Math.round(liveHours(t) * 100) / 100 }, extra: `<button type="button" class="btn danger ghost" data-act="timeDel" data-id="${t.id}">Delete</button>`, onSubmit(v) { Object.assign(t, { name: v.name.trim(), email: (v.email || v.name).trim().toLowerCase(), jobId: v.jobId || null, date: v.date, hours: v.hours, note: v.note }); if (!t.end) t.end = new Date().toISOString(); save(); render(); } }); };
ACT.timeDel = el => { DB.time = times().filter(t => t.id !== el.dataset.id); save(); closeModal(); render(); };
ACT.timePost = () => {
  const list = times().filter(t => t.date >= timeWeek && t.date <= addDays(timeWeek, 6) && t.end && t.approved && !t.costId), noJob = list.filter(t => !byId('jobs', t.jobId)), noRate = [...new Set(list.filter(t => !rateFor(t.email)).map(t => t.name || t.email))];
  if (noRate.length) return toast(`Set an hourly rate for ${noRate.join(', ')} first (or a default rate)`, 'err');
  let n = 0, amt = 0; list.forEach(t => { const j = byId('jobs', t.jobId); if (!j) return; const c = { id: uid('k'), date: t.date, cat: 'labor', desc: `${t.name || t.email} — ${hrs(t.hours)} h @ ${money2(rateFor(t.email))}`, amount: Math.round(t.hours * rateFor(t.email) * 100) / 100, timeId: t.id }; j.costs.push(c); t.costId = c.id; n++; amt += c.amount; });
  save(); runChecks(); render(); toast(`Posted ${n} entries (${money2(amt)}) to job costing${noJob.length ? ` — ${noJob.length} with no job were skipped` : ''}`);
};

/* ---------- team & roles (owner only) ---------- */
let TEAM = { rows: null, err: '', setup: false };
async function teamLoad() {
  try { const { data, error } = await SB.from('staff').select('*').order('email'); if (error) throw new Error(error.message); TEAM.rows = data; TEAM.setup = !data.length || !('role' in data[0]); TEAM.err = ''; }
  catch (x) { TEAM.err = x.message; }
  if (route().name === 'team') render();
}
VIEWS.team = () => {
  if (!CLOUD) return { title: 'Team & Roles', html: `<div class="card">${empty('Team logins need the shared backend', 'On this device you are the only user. Connect Supabase (see README) to add people.')}</div>` };
  const rows = TEAM.rows, sel = (r) => `<select data-team="${esc(r.email)}" data-f="role">${Object.keys(ROLE_LABEL).map(k => `<option value="${k}" ${r.role === k ? 'selected' : ''}>${ROLE_LABEL[k]}</option>`).join('')}</select>`;
  const body = TEAM.err ? `<div class="banner bad">${esc(TEAM.err)}</div><button class="btn" data-act="teamReload">Try again</button>` : !rows ? empty('Loading the team…')
    : TEAM.setup ? `<h3>One-time setup needed</h3><p>Roles are not switched on in your database yet. Run the file <b>supabase/roles.sql</b> in the Supabase SQL Editor, then reload this page. Until then every login has full access.</p>`
      : `<h3>Team <button class="btn sm primary" data-act="teamAdd">+ Person</button></h3><table class="edit"><tr><th>Email (their login)</th><th>Name</th><th>Role</th><th>Crew</th><th></th></tr>
        ${rows.map(r => `<tr><td><b>${esc(r.email)}</b>${r.email.toLowerCase() === ME.email.toLowerCase() ? ' <small>(you)</small>' : ''}</td><td><input data-team="${esc(r.email)}" data-f="name" value="${esc(r.name || '')}"></td><td>${sel(r)}</td><td><select data-team="${esc(r.email)}" data-f="crew_id"><option value="">—</option>${DB.crews.map(c => `<option value="${c.id}" ${r.crew_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></td><td><button class="ico" data-act="teamDel" data-id="${esc(r.email)}" title="Remove">×</button></td></tr>`).join('')}</table>
        <p class="hint">Each person also needs a login: in Supabase go to Authentication → Users → Add user, with the same email. Removing someone here cuts off their access immediately, even if their login still exists.</p>`;
  return { title: 'Team & Roles', html: `<div class="card">${body}</div><div class="card"><h3>What each role can do</h3><table>${Object.keys(ROLE_LABEL).map(k => `<tr><td><b>${ROLE_LABEL[k]}</b></td><td>${ROLE_HELP[k]}</td></tr>`).join('')}</table><p class="hint">Crew and estimator limits are enforced by the database itself. Office and bookkeeper have the same data access; the app just shows the bookkeeper fewer pages.</p></div>`, mount() { if (!rows && !TEAM.err) teamLoad(); } };
};
ACT.teamReload = () => { TEAM = { rows: null, err: '', setup: false }; render(); };
const ownersLeft = except => TEAM.rows.filter(r => r.role === 'owner' && r.email !== except).length;
CHG.team = async el => {
  const email = el.dataset.team, f = el.dataset.f, row = TEAM.rows.find(r => r.email === email), val = el.value || null;
  if (f === 'role' && row.role === 'owner' && val !== 'owner' && !ownersLeft(email)) { toast('There must always be at least one owner', 'err'); return render(); }
  const { error } = await SB.from('staff').update({ [f]: val }).eq('email', email); if (error) { toast(error.message, 'err'); return teamLoad(); }
  row[f] = val; toast('Saved'); if (f === 'role') render();
};
ACT.teamAdd = () => openForm({ title: 'Add a person', submit: 'Add', fields: [{ name: 'email', label: 'Email (must match their login)', type: 'email', req: 1, wide: 1 }, { name: 'name', label: 'Name', wide: 1 }, { name: 'role', label: 'Role', type: 'select', options: Object.entries(ROLE_LABEL) }, { name: 'crew_id', label: 'Crew (for crew members)', type: 'select', options: [['', '—'], ...DB.crews.map(c => [c.id, c.name])] }], values: { role: 'crew' },
  onSubmit(v) { (async () => { const { error } = await SB.from('staff').insert({ email: v.email.trim().toLowerCase(), name: v.name, role: v.role, crew_id: v.crew_id || null }); if (error) return toast(/duplicate/i.test(error.message) ? 'That email is already on the team' : error.message, 'err'); toast('Added — now create their login in Supabase'); teamLoad(); })(); } });
ACT.teamDel = el => { const email = el.dataset.id, row = TEAM.rows.find(r => r.email === email); if (row.role === 'owner' && !ownersLeft(email)) return toast('There must always be at least one owner', 'err'); confirmBox(`Remove ${email} from the team? They lose access immediately.`, async () => { const { error } = await SB.from('staff').delete().eq('email', email); if (error) toast(error.message, 'err'); teamLoad(); }); };
