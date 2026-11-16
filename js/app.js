/* Router + global event wiring */
const NAV = [
  ['WIN WORK', [['crm', 'CRM', '👥'], ['estimates', 'Estimates & Proposals', '📐'], ['bids', 'Bids', '🎯'], ['design', 'Proposal Design', '🎨']]],
  ['MANAGE JOBS', [['schedule', 'Scheduling & Dispatch', '🗓'], ['jobs', 'Job Sites', '🚧'], ['crew', 'Crew View', '👷'], ['time', 'Timesheets', '⏱'], ['costing', 'Job Costing', '💲'], ['portal', 'Customer Portal', '🔗']]],
  ['RUN BUSINESS', [['dashboard', 'Analytics', '📊'], ['invoices', 'Invoicing & Payments', '🧾'], ['email', 'Email & Follow-ups', '✉️'], ['quickbooks', 'QuickBooks', '📒'], ['automation', 'Automation & Inbox', '⚡'], ['team', 'Team & Roles', '🧑‍🤝‍🧑'], ['settings', 'Settings', '⚙️']]],
];
function route() { const [, name = homePage(), ...args] = location.hash.split('/'); return { name, args }; }
VIEWS.p = () => VIEWS.portal([DB.customers[0].id]);

function render() {
  let { name, args } = route();
  if (PORTAL && name !== 'p') { location.hash = '#/p/' + PORTAL; return; }
  if (!PORTAL && (!VIEWS[name] || !canSee(name))) { location.hash = '#/' + homePage(); return; }      // pages this role may not open
  const v = VIEWS[name];
  const out = v(args);
  document.body.classList.toggle('portal-mode', !!out.portal);
  const unread = DB.notifications.filter(n => !n.read).length;
  const nav = NAV.map(([g, items]) => [g, items.filter(([k]) => canSee(k))]).filter(([, items]) => items.length).map(([g, items]) => `<div class="grp">${g}</div>` + items.map(([k, l, i]) => `<a href="#/${k}" class="${k === name ? 'on' : ''}"><span>${i}</span>${l}${k === 'automation' && unread ? `<b class="pill">${unread}</b>` : ''}</a>`).join('')).join('');
  $('#nav').innerHTML = nav;
  $('#title').textContent = out.title;
  $('#bell').innerHTML = `🔔${unread ? `<b class="pill">${unread}</b>` : ''}`;
  $('#main').innerHTML = out.html;
  document.title = out.title + ' · AsphaltPro';
  pbDatalist();
  if (out.mount) out.mount();
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) { if (e.target.id === 'modal') closeModal(); return; }
  const fn = ACT[el.dataset.act]; if (fn) { if (el.tagName === 'TR' && e.target.closest('a,button,input')) return; fn(el, e); }
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.matches('[data-e],[data-r],[data-l]')) CHG.estimate(el);
  else if (el.dataset.bud) CHG.budget(el);
  else if (el.dataset.sov) CHG.sov(el);            // must come before the generic job-field handler below
  else if (el.dataset.j !== undefined && (el.dataset.f || el.dataset.chk !== undefined)) CHG.job(el);
  else if (el.dataset.rule) CHG.rule(el);
  else if (el.dataset.set) CHG.set(el);
  else if (el.dataset.svc) CHG.svc(el);
  else if (el.dataset.pb) CHG.pb(el);
  else if (el.dataset.priv) CHG.priv(el);
  else if (el.dataset.em) CHG.em(el);
  else if (el.dataset.cemail) CHG.cemail(el);
  else if (el.dataset.ret) CHG.ret(el);
  else if (el.dataset.rate) CHG.rate(el);
  else if (el.dataset.team) CHG.team(el);
  else if (el.dataset.fu) CHG.fu(el);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
window.addEventListener('hashchange', () => { if (CLOUD && isPortalHash() !== !!PORTAL) return location.reload(); closeModal(); if (DB) render(); window.scrollTo(0, 0); });
$('#menu').onclick = () => document.body.classList.toggle('navopen');
$('#nav').onclick = () => document.body.classList.remove('navopen');
$('#bell').onclick = () => location.hash = '#/automation';

function bootCrew() {      // crew logins: nothing from the office is loaded; the crew view talks to the crew_* database functions
  CREWMODE = true; DB = { v: 1, settings: { company: '' }, notifications: [], customers: [], estimates: [], jobs: [], invoices: [], crews: [], rules: [], time: [], seq: {} };
  if (route().name !== 'crew') location.hash = '#/crew'; render();
  setInterval(() => { if (!document.hidden && !CR.busy && !$('#modal.open') && !/TEXTAREA|INPUT/.test((document.activeElement || {}).tagName || '')) crewLoad(); }, 60000);
}
async function boot() {
  if (isPortalHash()) {
    if (!CLOUD) return showGate('<h1>Portal unavailable</h1><p class="muted">The shared backend is not configured, so portal links cannot be opened.</p>');
    return bootPortal(portalTokenFromHash());
  }
  if (!CLOUD) { loadDB(); runChecks(); return render(); }
  try {
    if (!(await cloudSession())) return showLogin();
    const staff = (await SB.rpc('am_i_staff')).data;
    if (!staff) return showGate('<h1>No access</h1><p class="muted">Your account is not on the staff list. Ask the owner to add your email.</p><button class="btn" data-act="signOut">Sign out</button>');
    const sess = await cloudSession(), role = (await SB.rpc('my_role')).data || 'owner';     // no roles set up yet = everyone is an owner, as before
    ME = { email: sess.user.email, name: '', role, crewId: null };
    if (role === 'crew') return bootCrew();
    if (!(await cloudPull())) return firstRun();
    await processPortalEvents(); runChecks(); render(); setSync('ok');
    $('.side-foot').innerHTML = `<span id="sync">● Synced</span><br><small>${esc(ME.email)} · ${ROLE_LABEL[ME.role] || ME.role}</small><br><button class="btn sm" data-act="signOut">Sign out</button>`;
    pollTimer = setInterval(cloudPoll, 20000); document.addEventListener('visibilitychange', () => { if (!document.hidden) cloudPoll(); });
  } catch (e) { showGate(`<h1>Can’t reach the database</h1><p class="muted">${esc(e.message || e)}</p><button class="btn" onclick="location.reload()">Retry</button>`); }
}
boot();
