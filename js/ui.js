/* UI helpers: modal, toast, forms, badges, charts, signature pad */
const ACT = {};   // click actions by data-act
const CHG = {};   // change handlers by data-chg

function toast(msg, kind = '') {
  const t = document.createElement('div'); t.className = 'toast ' + kind; t.textContent = msg;
  $('#toasts').appendChild(t); setTimeout(() => t.classList.add('out'), 2600); setTimeout(() => t.remove(), 3100);
}
function modal(html, opts = {}) {
  const m = $('#modal'); m.className = 'open' + (opts.wide ? ' wide' : '') + (opts.print ? ' printable' : '');
  m.innerHTML = `<div class="sheet"><button class="x" data-act="closeModal" aria-label="Close">×</button>${html}</div>`;
}
function closeModal() { const m = $('#modal'); m.className = ''; m.innerHTML = ''; if (window._map) { window._map.remove(); window._map = null; } }
ACT.closeModal = closeModal;

function fieldHTML(f, v) {
  v = v ?? f.value ?? '';
  const id = 'f_' + f.name, cls = f.wide ? 'wide' : '';
  let input;
  if (f.type === 'select') input = `<select name="${f.name}" id="${id}">${f.options.map(o => { const [ov, ol] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(ov)}" ${String(ov) === String(v) ? 'selected' : ''}>${esc(ol)}</option>`; }).join('')}</select>`;
  else if (f.type === 'textarea') input = `<textarea name="${f.name}" id="${id}" rows="3">${esc(v)}</textarea>`;
  else input = `<input name="${f.name}" id="${id}" type="${f.type || 'text'}" value="${esc(v)}" ${f.step ? `step="${f.step}"` : ''} ${f.req ? 'required' : ''} ${f.ph ? `placeholder="${esc(f.ph)}"` : ''}>`;
  return `<label class="${cls}"><span>${esc(f.label)}</span>${input}</label>`;
}
function openForm({ title, fields, values = {}, submit = 'Save', onSubmit, extra = '' }) {
  modal(`<form id="mform"><h3>${esc(title)}</h3><div class="grid2">${fields.map(f => fieldHTML(f, values[f.name])).join('')}</div>${extra}<div class="actions"><button type="button" class="btn" data-act="closeModal">Cancel</button><button class="btn primary">${esc(submit)}</button></div></form>`);
  const first = $('#mform input,#mform select'); if (first) first.focus();
  $('#mform').onsubmit = e => {
    e.preventDefault(); const fd = new FormData(e.target), v = {};
    fields.forEach(f => { v[f.name] = f.type === 'number' ? +fd.get(f.name) : fd.get(f.name); });
    if (onSubmit(v) !== false) closeModal();
  };
}
function confirmBox(msg, yes) {
  modal(`<h3>Are you sure?</h3><p>${esc(msg)}</p><div class="actions"><button class="btn" data-act="closeModal">Cancel</button><button class="btn danger" id="cYes">Yes, do it</button></div>`);
  $('#cYes').onclick = () => { closeModal(); yes(); };
}

const BADGE = { lead: 'gray', prospect: 'blue', customer: 'green', draft: 'gray', sent: 'blue', signed: 'green', declined: 'red', unscheduled: 'gray', scheduled: 'blue', 'in-progress': 'amber', complete: 'green', paid: 'green', partial: 'amber', overdue: 'red' };
const badge = s => `<span class="badge ${BADGE[s] || 'gray'}">${esc(s)}</span>`;
const bar = (pct, warn) => `<div class="bar"><i class="${pct > 100 ? 'bad' : pct >= (warn || 90) ? 'warn' : ''}" style="width:${Math.min(100, pct)}%"></i></div>`;
const empty = (t, sub) => `<div class="empty"><b>${esc(t)}</b><span>${esc(sub || '')}</span></div>`;

function barChart(data, { h = 180, fmt = money } = {}) {
  const w = 520, pad = 28, max = Math.max(1, ...data.map(d => d.value)), bw = (w - pad) / data.length;
  return `<svg viewBox="0 0 ${w} ${h + 26}" class="chart" role="img">` +
    [0, .5, 1].map(f => `<line x1="${pad}" x2="${w}" y1="${h - h * f}" y2="${h - h * f}" class="grid"/><text x="0" y="${h - h * f + 4}" class="axis">${fmt(max * f).replace(/\.0+$/, '')}</text>`).join('') +
    data.map((d, i) => { const bh = d.value / max * h, x = pad + i * bw + bw * .18; return `<rect x="${x}" y="${h - bh}" width="${bw * .64}" height="${bh}" rx="3" class="barfill"><title>${esc(d.label)}: ${fmt(d.value)}</title></rect><text x="${x + bw * .32}" y="${h + 16}" text-anchor="middle" class="axis">${esc(d.label)}</text>`; }).join('') + '</svg>';
}

/* signature pad */
function signPad(canvas) {
  const ctx = canvas.getContext('2d'); let drawing = false, dirty = false;
  ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.strokeStyle = '#111';
  const pos = e => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * canvas.width / r.width, (e.clientY - r.top) * canvas.height / r.height]; };
  canvas.addEventListener('pointerdown', e => { drawing = true; dirty = true; canvas.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.moveTo(...pos(e)); });
  canvas.addEventListener('pointermove', e => { if (!drawing) return; ctx.lineTo(...pos(e)); ctx.stroke(); });
  ['pointerup', 'pointercancel'].forEach(ev => canvas.addEventListener(ev, () => drawing = false));
  return { clear() { ctx.clearRect(0, 0, canvas.width, canvas.height); dirty = false; }, isDirty: () => dirty, data: () => canvas.toDataURL('image/png') };
}

/* shrink an image file to a small jpeg data-url for localStorage */
function shrinkImage(file, max = 900) {
  return new Promise(res => {
    const r = new FileReader();
    r.onload = () => { const img = new Image(); img.onload = () => { const k = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = img.width * k; c.height = img.height * k; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', .7)); }; img.src = r.result; };
    r.readAsDataURL(file);
  });
}
