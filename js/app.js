/* Router + global event wiring */
const NAV = [
  ['WIN WORK', [['crm', 'CRM', '👥'], ['estimates', 'Estimates & Proposals', '📐']]],
  ['MANAGE JOBS', [['schedule', 'Scheduling & Dispatch', '🗓'], ['jobs', 'Job Sites', '🚧'], ['costing', 'Job Costing', '💲'], ['portal', 'Customer Portal', '🔗']]],
  ['RUN BUSINESS', [['dashboard', 'Analytics', '📊'], ['invoices', 'Invoicing & Payments', '🧾'], ['automation', 'Automation & Inbox', '⚡'], ['settings', 'Settings', '⚙️']]],
];
function route() { const [, name = 'dashboard', ...args] = location.hash.split('/'); return { name, args }; }
VIEWS.p = () => VIEWS.portal([DB.customers[0].id]);

function render() {
  let { name, args } = route();
  if (PORTAL && name !== 'p') { location.hash = '#/p/' + PORTAL; return; }
  const v = VIEWS[name] || VIEWS.dashboard;
  const out = v(args);
  document.body.classList.toggle('portal-mode', !!out.portal);
  const unread = DB.notifications.filter(n => !n.read).length;
  const nav = NAV.map(([g, items]) => `<div class="grp">${g}</div>` + items.map(([k, l, i]) => `<a href="#/${k}" class="${k === name ? 'on' : ''}"><span>${i}</span>${l}${k === 'automation' && unread ? `<b class="pill">${unread}</b>` : ''}</a>`).join('')).join('');
  $('#nav').innerHTML = nav;
  $('#title').textContent = out.title;
  $('#bell').innerHTML = `🔔${unread ? `<b class="pill">${unread}</b>` : ''}`;
  $('#main').innerHTML = out.html;
  document.title = out.title + ' · AsphaltPro';
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
  else if (el.dataset.j !== undefined && (el.dataset.f || el.dataset.chk !== undefined)) CHG.job(el);
  else if (el.dataset.rule) CHG.rule(el);
  else if (el.dataset.set) CHG.set(el);
  else if (el.dataset.svc) CHG.svc(el);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
window.addEventListener('hashchange', () => { if (CLOUD && isPortalHash() !== !!PORTAL) return location.reload(); closeModal(); if (DB) render(); window.scrollTo(0, 0); });
$('#menu').onclick = () => document.body.classList.toggle('navopen');
$('#nav').onclick = () => document.body.classList.remove('navopen');
$('#bell').onclick = () => location.hash = '#/automation';

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
    if (!(await cloudPull())) return firstRun();
    await processPortalEvents(); runChecks(); render(); setSync('ok');
    $('.side-foot').innerHTML = '<span id="sync">● Synced</span><br><button class="btn sm" data-act="signOut">Sign out</button>';
    pollTimer = setInterval(cloudPoll, 20000); document.addEventListener('visibilitychange', () => { if (!document.hidden) cloudPoll(); });
  } catch (e) { showGate(`<h1>Can’t reach the database</h1><p class="muted">${esc(e.message || e)}</p><button class="btn" onclick="location.reload()">Retry</button>`); }
}
boot();
