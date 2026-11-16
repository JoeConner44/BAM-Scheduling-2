/* Satellite take-off: draw areas, lengths and counts on aerial imagery; quantities flow into the proposal.
   Saved on the estimate as e.takeoff = { center, zoom, shapes: [{ id, type, item, unit, price, pts, mult }] } */
const TK_COLORS = ['#f59e0b', '#3b82f6', '#10b981', '#ef4444', '#a855f7', '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#eab308'];
const KIND_UNIT = { area: 'SQ FT', line: 'FT', count: 'EA' };
const KIND_ICON = { area: '▱', line: '╱', count: '●' };
const pbKind = unit => /sq|s\.?f\b|yd/i.test(unit || '') ? 'area' : /ft|l\.?f\b|lin/i.test(unit || '') ? 'line' : 'count';
const priceBook = () => DB.settings.priceBook || (DB.settings.priceBook = []);
const pbFind = name => priceBook().find(p => normName(p.name) === normName(name));
const shapeQty = s => (s.type === 'area' ? toSqFt(s.pts) : s.type === 'line' ? toFeet(s.pts) : s.pts.length) * (+s.mult || 1);
const qtyText = (q, unit) => `${num(q, q < 100 ? 1 : 0)} ${unit}`;
let TK = null;

ACT.takeoff = el => openTakeoff(byId('estimates', el.dataset.id));

function openTakeoff(e) {
  if (typeof L === 'undefined') return toast('The map could not load — check your internet connection', 'err');
  const saved = e.takeoff || {};
  TK = { e, shapes: JSON.parse(JSON.stringify(saved.shapes || [])), cur: { type: 'area', item: '', pts: [] }, dirty: false, labels: true };
  const d = document.createElement('div'); d.id = 'tk';
  d.innerHTML = `<aside class="tkside">
    <div class="tkhead"><div><b>Satellite take-off</b><small>${esc(e.title)}</small></div><button class="btn sm" id="tkClose">Close</button></div>
    <form id="tkFind" class="inline"><input id="tkQ" placeholder="Search an address or place…" value="${esc(e.address || '')}"><button class="btn sm">Find</button></form>
    <div class="tkstep"><span>1 · What are you measuring?</span>
      <input id="tkItem" list="pb" placeholder="Pick or type an item — e.g. Sealcoat, 4&quot; line, Arrow" autocomplete="off">
      <div class="tabs" id="tkType">${Object.keys(KIND_UNIT).map(t => `<button type="button" data-t="${t}">${KIND_ICON[t]} ${{ area: 'Area', line: 'Length', count: 'Count' }[t]}</button>`).join('')}</div></div>
    <div class="tkstep"><span>2 · Click on the map</span><p class="hint" id="tkHelp"></p>
      <div class="btns"><button class="btn sm primary" id="tkFinish">Finish shape ⏎</button><button class="btn sm" id="tkUndo">Undo</button><label class="check sm"><input type="checkbox" id="tkLabels" checked> Street labels</label></div></div>
    <div class="tklist" id="tkList"></div>
    <div class="tkfoot"><button class="btn primary" id="tkSave">Save to proposal</button></div>
  </aside><div id="tkmap"></div><div class="tklive" id="tkLive"></div>`;
  document.body.appendChild(d); document.body.classList.add('tk-open');
  const map = TK.map = L.map('tkmap', { doubleClickZoom: false, zoomSnap: 0.5, maxZoom: 22 }).setView(saved.center || [33.95, -83.38], saved.zoom || (saved.center ? 19 : 11));
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 19, maxZoom: 22, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' }).addTo(map);
  TK.labelLayer = L.layerGroup([
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 19, maxZoom: 22, opacity: .8 }),
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 19, maxZoom: 22 })]).addTo(map);
  L.control.scale({ metric: false }).addTo(map);
  TK.layer = L.layerGroup().addTo(map);
  map.on('click', ev => tkClick(ev)); map.on('dblclick', () => tkFinish()); map.on('mousemove', ev => tkLive(ev.latlng));
  $('#tkFind').onsubmit = ev => { ev.preventDefault(); tkGeocode($('#tkQ').value); };
  $('#tkItem').oninput = ev => { const it = pbFind(ev.target.value); TK.cur.item = ev.target.value.trim(); if (it) tkSetType(pbKind(it.unit)); };
  $('#tkType').onclick = ev => { const b = ev.target.closest('[data-t]'); if (b) tkSetType(b.dataset.t); };
  $('#tkFinish').onclick = () => tkFinish(); $('#tkUndo').onclick = tkUndo; $('#tkSave').onclick = tkSave; $('#tkClose').onclick = () => tkClose(false);
  $('#tkLabels').onchange = ev => { ev.target.checked ? TK.labelLayer.addTo(map) : map.removeLayer(TK.labelLayer); };
  $('#tkList').onclick = tkListClick; $('#tkList').onchange = tkListChange;
  document.addEventListener('keydown', tkKey, true);
  tkSetType('area'); tkDraw();
  if (TK.shapes.length) { try { map.fitBounds(L.latLngBounds(TK.shapes.flatMap(s => s.pts)).pad(0.3), { maxZoom: 20 }); } catch (x) { /* keep saved view */ } }
  else if (!saved.center && (e.address || e.title)) tkGeocode(e.address || e.title, true);
  setTimeout(() => map.invalidateSize(), 50);
}
function tkSetType(t) {
  if (TK.cur.pts.length && TK.cur.type !== t) TK.cur.pts = [];
  TK.cur.type = t; $$('#tkType button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
  $('#tkHelp').textContent = { area: 'Click each corner of the area. Click the first point again, double-click, or press Enter to finish.', line: 'Click along the line. Double-click or press Enter to finish. Use × to repeat one line many times (e.g. parking stalls).', count: 'Click once for each one (arrows, signs, wheel stops, symbols).' }[t];
  tkDraw();
}
const tkItemName = () => TK.cur.item || { area: 'Area', line: 'Line', count: 'Count' }[TK.cur.type];
function tkClick(ev) {
  const c = TK.cur, p = [ev.latlng.lat, ev.latlng.lng];
  if (c.type === 'count') {
    let s = TK.shapes.find(x => x.type === 'count' && x.item === tkItemName());
    if (!s) TK.shapes.push(s = tkNewShape('count', []));
    s.pts.push(p); TK.dirty = true; return tkDraw();
  }
  if (c.type === 'area' && c.pts.length >= 3 && TK.map.latLngToContainerPoint(c.pts[0]).distanceTo(ev.containerPoint) < 14) return tkFinish();
  const last = c.pts[c.pts.length - 1];
  if (last && TK.map.latLngToContainerPoint(last).distanceTo(ev.containerPoint) < 3) return;   // second click of a double-click
  c.pts.push(p); tkDraw();
}
function tkNewShape(type, pts) {
  const it = pbFind(tkItemName());
  return { id: uid('s'), type, item: it ? it.name : tkItemName(), unit: it && pbKind(it.unit) === type ? it.unit : KIND_UNIT[type], price: it ? it.price : '', pts, mult: 1 };
}
function tkFinish() {
  const c = TK.cur; if (c.type === 'count') return;
  if (c.pts.length < (c.type === 'area' ? 3 : 2)) { if (c.pts.length) toast(c.type === 'area' ? 'An area needs at least 3 points' : 'A line needs at least 2 points', 'err'); return; }
  TK.shapes.push(tkNewShape(c.type, c.pts)); c.pts = []; TK.dirty = true; tkDraw();
}
function tkUndo() {
  if (TK.cur.pts.length) TK.cur.pts.pop();
  else { const s = TK.shapes[TK.shapes.length - 1]; if (!s) return; if (s.type === 'count' && s.pts.length > 1) s.pts.pop(); else TK.shapes.pop(); TK.dirty = true; }
  tkDraw();
}
function tkKey(ev) {
  if (!TK) return; const typing = /INPUT|TEXTAREA|SELECT/.test(ev.target.tagName);
  if (ev.key === 'Enter' && !typing) { ev.preventDefault(); tkFinish(); }
  else if (ev.key === 'Escape') { ev.stopPropagation(); if (TK.cur.pts.length) { TK.cur.pts = []; tkDraw(); } }
  else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z' && !typing) { ev.preventDefault(); tkUndo(); }
}
const tkItems = () => { const m = new Map(); TK.shapes.forEach(s => { if (!m.has(s.item)) m.set(s.item, []); m.get(s.item).push(s); }); return m; };
function tkLive(ll) {
  const c = TK.cur, el = $('#tkLive'); if (!el) return;
  if (!c.pts.length || c.type === 'count') { el.style.display = 'none'; if (TK.rubber) { TK.map.removeLayer(TK.rubber); TK.rubber = null; } return; }
  const pts = [...c.pts, [ll.lat, ll.lng]];
  el.style.display = 'block'; el.textContent = c.type === 'area' ? (pts.length > 2 ? qtyText(toSqFt(pts), 'SQ FT') + ' · ' : '') + 'side ' + qtyText(toFeet(pts.slice(-2)), 'FT') : qtyText(toFeet(pts), 'FT');
  if (TK.rubber) TK.map.removeLayer(TK.rubber);
  TK.rubber = L.polyline(c.type === 'area' && pts.length > 2 ? [...pts, pts[0]] : pts, { color: '#fff', weight: 2, dashArray: '6 6', interactive: false }).addTo(TK.map);
}
function tkDraw() {
  const { layer, cur } = TK; layer.clearLayers(); if (TK.rubber) { TK.map.removeLayer(TK.rubber); TK.rubber = null; }
  const items = tkItems(), names = [...items.keys()], color = n => TK_COLORS[names.indexOf(n) % TK_COLORS.length];
  TK.shapes.forEach(s => {
    const col = color(s.item), label = `${esc(s.item)}<br><b>${qtyText(shapeQty(s), s.unit)}</b>`;
    if (s.type === 'area') L.polygon(s.pts, { color: col, weight: 2, fillOpacity: .3 }).bindTooltip(label, { permanent: true, direction: 'center', className: 'tklabel' }).addTo(layer);
    else if (s.type === 'line') L.polyline(s.pts, { color: col, weight: 5 }).bindTooltip(label, { permanent: true, direction: 'top', className: 'tklabel' }).addTo(layer);
    else s.pts.forEach((p, i) => L.circleMarker(p, { radius: 8, color: '#fff', weight: 2, fillColor: col, fillOpacity: 1 }).bindTooltip(String(i + 1), { permanent: true, direction: 'center', className: 'tknum' }).addTo(layer));
  });
  cur.pts.forEach((p, i) => L.circleMarker(p, { radius: i ? 5 : 7, color: '#fff', weight: 2, fillColor: '#111', fillOpacity: 1, interactive: false }).addTo(layer));
  if (cur.pts.length > 1) L.polyline(cur.pts, { color: '#fff', weight: 3, interactive: false }).addTo(layer);
  $('#tkList').innerHTML = names.length ? names.map(n => {
    const ss = items.get(n), q = ss.reduce((a, s) => a + shapeQty(s), 0);
    return `<div class="tkitem"><div class="tkrow head"><i style="background:${color(n)}"></i><b>${esc(n)}</b><span>${qtyText(q, ss[0].unit)}</span></div>${ss.map(s => `<div class="tkrow" data-s="${s.id}"><span class="go">${KIND_ICON[s.type]} ${s.type === 'count' ? s.pts.length + ' placed' : qtyText(shapeQty(s) / (+s.mult || 1), s.unit)}</span>${s.type === 'count' ? '' : `<label>× <input type="number" min="1" value="${+s.mult || 1}" data-mult="${s.id}"></label>`}<button class="ico" data-del="${s.id}" title="Delete">×</button></div>`).join('')}</div>`;
  }).join('') : '<p class="hint">Nothing measured yet. Pick an item, then click on the map.</p>';
  $('#tkSave').textContent = names.length ? `Save ${names.length} item${names.length > 1 ? 's' : ''} to proposal` : 'Save to proposal';
}
function tkListClick(ev) {
  const del = ev.target.closest('[data-del]'), row = ev.target.closest('[data-s]');
  if (del) { TK.shapes = TK.shapes.filter(s => s.id !== del.dataset.del); TK.dirty = true; return tkDraw(); }
  if (row && ev.target.closest('.go')) { const s = TK.shapes.find(x => x.id === row.dataset.s); if (s) TK.map.fitBounds(L.latLngBounds(s.pts).pad(0.5), { maxZoom: 21 }); }
}
function tkListChange(ev) { const id = ev.target.dataset.mult; if (!id) return; TK.shapes.find(s => s.id === id).mult = Math.max(1, +ev.target.value || 1); TK.dirty = true; tkDraw(); }
async function tkGeocode(q, quiet) {
  if (!q) return;
  try {
    const r = await (await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=' + encodeURIComponent(q))).json();
    if (r[0]) TK.map.setView([+r[0].lat, +r[0].lon], 19); else if (!quiet) toast('Could not find that place — try a street address, or pan the map', 'err');
  } catch (x) { if (!quiet) toast('Search is unavailable — pan and zoom the map instead', 'err'); }
}
function tkSave() {
  const e = TK.e; if (TK.cur.pts.length) tkFinish();
  const c = TK.map.getCenter();
  e.takeoff = { center: [c.lat, c.lng], zoom: TK.map.getZoom(), shapes: TK.shapes };
  const items = tkItems();
  e.lines = e.lines.filter(l => !l.tk || items.has(l.tk));                 // items removed from the take-off leave the proposal
  items.forEach((ss, name) => {
    const qty = Math.round(ss.reduce((a, s) => a + shapeQty(s), 0) * (ss[0].type === 'count' ? 1 : 1)), it = pbFind(name);
    let l = e.lines.find(x => x.tk === name) || e.lines.find(x => !x.tk && normName(x.desc) === normName(name));
    if (!l) { l = e.lines.find(x => !String(x.desc || '').trim() && blank(x.qty) && blank(x.price)); if (!l) e.lines.push(l = blankLine()); l.desc = name; l.price = it ? it.price : (ss[0].price ?? ''); }
    l.tk = name; l.qty = qty; l.unit = ss[0].unit;
  });
  save(); tkClose(true); render(); toast(items.size ? `Take-off saved — ${items.size} item${items.size > 1 ? 's' : ''} updated on the proposal` : 'Take-off cleared');
}
function tkClose(force) {
  if (!force && (TK.dirty || TK.cur.pts.length) && !confirm('Close without saving this take-off?')) return;
  document.removeEventListener('keydown', tkKey, true); TK.map.remove(); $('#tk').remove(); document.body.classList.remove('tk-open'); TK = null;
}
