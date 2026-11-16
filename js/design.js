/* Proposal design (template settings + live preview), proposal renderer, and price-book helpers */
const PT_DEFAULT = {
  logo: '', logoH: 70, accent: '#f59e0b', font: 'sans', size: 'm', header: 'split', docTitle: 'Proposal', headerLines: '',
  showNumber: true, showPreparedFor: true, intro: '',
  colItem: 'Proposed Item', colDesc: 'Description', colQty: 'Qty', colUnit: 'Units', showDesc: true,
  section: 'shaded', table: 'lines', totalLabel: 'Total of proposed items listed above:',
  notesTitle: 'Contract Notes and Disclaimers',
  accept: 'To accept this proposal, reply to the email that contained it stating your acceptance of the proposal by title and date, or sign below and return a copy.',
  validity: 'Prices on this proposal are valid for 60 days from the date shown above.', showSignature: true,
};
const PT = () => ({ ...PT_DEFAULT, ...(DB.settings.proposal || {}) });
const nl2 = s => esc(s).replace(/\n/g, '<br>');
function termsHTML(text) {
  return String(text || '').split(/\n+/).map(l => l.trim()).filter(Boolean).map(l => {
    const m = l.match(/^([A-Z][^:.]{2,60}):\s*(.*)$/);
    if (/^[•\-–]\s*/.test(l)) return `<p class="bul">${esc(l.replace(/^[•\-–]\s*/, ''))}</p>`;
    return m ? `<p><b>${esc(m[1])}:</b> ${esc(m[2])}</p>` : `<p>${esc(l)}</p>`;
  }).join('');
}
function proposalHTML(e, tpl) {
  const t = tpl || PT(), c = byId('customers', e.customerId) || {}, tot = estTotals(e), s = DB.settings, hide = e.hidePrices !== false;
  const cols = 2 + (t.showDesc ? 1 : 0) + 1 + (hide ? 0 : 2);
  const px = (a, b) => hide ? '' : `<td class="num">${a}</td><td class="num">${b}</td>`, dsc = v => t.showDesc ? `<td>${v}</td>` : '';
  const legacy = e.rows.map(r => ({ r, c: rowCalc(r) })).filter(x => x.c.amt || x.r.label);
  const lines = e.lines.filter(l => String(l.desc || '').trim() || String(l.note || '').trim());
  const head = (t.headerLines || [s.address, s.phone, s.email].filter(Boolean).join('\n')).split('\n').filter(x => x.trim());
  const who = c.name && c.name !== 'Unassigned' ? [c.name, c.contact, [c.email, c.phone].filter(Boolean).join(' · ')].filter(Boolean).join(' — ') : '';
  return `<div class="proposal pf-${t.font} pz-${t.size} ph-${t.header} pt-${t.table} ps-${t.section}" style="--pa:${esc(t.accent)}">
  <header><div class="pco">${t.logo ? `<img class="plogo" src="${t.logo}" style="height:${+t.logoH || 70}px" alt="">` : ''}<div><h2>${esc(s.company)}</h2>${head.map(l => `<div>${esc(l)}</div>`).join('')}</div></div>
    <div class="ptitle"><h1>${esc(t.docTitle)}</h1>${t.showNumber ? `<div>#${e.number}</div>` : ''}</div></header>
  <table class="pmeta"><tr><th>DATE:</th><td>${fmtD(e.createdAt)}</td></tr><tr><th>Project Title:</th><td><b>${esc(e.title)}</b></td></tr><tr><th>Location:</th><td>${esc(e.address)}</td></tr>${t.showPreparedFor && who ? `<tr><th>Prepared for:</th><td>${esc(who)}</td></tr>` : ''}</table>
  ${t.intro ? `<p class="pintro">${nl2(t.intro)}</p>` : ''}
  <table class="pitems"><tr><th>${esc(t.colItem)}</th>${t.showDesc ? `<th>${esc(t.colDesc)}</th>` : ''}<th class="num">${esc(t.colQty)}</th><th>${esc(t.colUnit)}</th>${hide ? '' : '<th class="num">Unit Price</th><th class="num">Total</th>'}</tr>
  ${legacy.map(({ r, c }) => `<tr><td>${esc(svc(r.service).name)}</td>${dsc(esc(r.label) + (c.unit === 'ton' ? ` <small>${num(c.area, 0)} sf @ ${r.depth}"</small>` : ''))}<td class="num">${num(c.qty, c.unit === 'ton' ? 1 : 0)}</td><td>${UNIT_LABEL[c.unit]}</td>${px(money2(c.price), money2(c.amt))}</tr>`).join('')}
  ${lines.map(l => isSection(l) ? `<tr class="sec"><td colspan="${cols}">${esc(l.desc)}</td></tr>` : `<tr><td>${esc(l.desc)}${!t.showDesc && l.note ? ` <small>${esc(l.note)}</small>` : ''}</td>${dsc(esc(l.note))}<td class="num">${blank(l.qty) ? '' : num(l.qty, 2)}</td><td>${esc(l.unit)}</td>${px(blank(l.price) ? '' : money2(l.price), money2(lineAmt(l)))}</tr>`).join('')}
  ${tot.tax ? `<tr class="ptax"><td colspan="${cols - 1}" class="num">Tax (${e.taxRate}%)</td><td class="num">${money2(tot.tax)}</td></tr>` : ''}
  <tr class="grand"><td colspan="${cols - 1}" class="num">${esc(t.totalLabel)}</td><td class="num">${money2(tot.total)}</td></tr></table>
  ${(e.terms || s.terms) ? `<h4>${esc(t.notesTitle)}</h4><div class="terms-text">${termsHTML(e.terms || s.terms)}</div>` : ''}
  ${t.accept ? `<p class="paccept">${nl2(t.accept)}</p>` : ''}
  ${t.showSignature ? `<div class="psign"><div><span>Client / Company Name:</span><b>${e.signature ? esc(c.name && c.name !== 'Unassigned' ? c.name : e.signature.name) : ''}</b></div>
    <div class="two"><div><span>Signature:</span>${e.signature ? (e.signature.img ? `<img src="${e.signature.img}" alt="signature">` : `<b class="typed">${esc(e.signature.name)}</b>`) : '<b></b>'}</div><div><span>Date:</span><b>${e.signature ? fmtD(e.signature.date) : ''}</b></div></div></div>` : ''}
  ${t.validity ? `<p class="pvalid">${nl2(t.validity)}</p>` : ''}</div>`;
}

/* ---------- designer page ---------- */
const PT_SAMPLE = () => ({ number: 1234, customerId: null, title: 'Sample Shopping Center — Athens, GA', address: '100 Main Street, Athens, GA', createdAt: today(), taxRate: 0, terms: '', rows: [], hidePrices: true, signature: null, lines: [
  { desc: 'Line removal' }, { desc: 'Eradicate parking lines', note: 'by scarifier', qty: 400, unit: 'FT', price: 1 },
  { desc: 'Paint striping' }, { desc: 'Paint parking stall 20\' solid', note: '', qty: 2400, unit: 'FT', price: 0.5 }, { desc: 'Paint arrow', note: 'white', qty: 12, unit: 'EA', price: 25 }, { desc: 'Paint handicap symbol', note: 'blue box, white symbol', qty: 6, unit: 'EA', price: 100 },
  { desc: 'Signs & wheel stops' }, { desc: 'Stop sign 30"', note: 'on galvanized post', qty: 4, unit: 'EA', price: 400 }, { desc: 'Concrete wheel stop', note: '', qty: 20, unit: 'EA', price: 165 }] });
const ptPreviewEst = id => byId('estimates', id) || [...DB.estimates].reverse().find(e => e.lines.some(l => !isSection(l) && String(l.desc || '').trim())) || PT_SAMPLE();
VIEWS.design = args => {
  const t = PT(), e = ptPreviewEst(args[0]);
  const txt = (k, label, ph = '') => `<label><span>${label}</span><input data-pt="${k}" value="${esc(t[k])}" placeholder="${esc(ph)}"></label>`;
  const area = (k, label, rows, ph = '') => `<label class="wide"><span>${label}</span><textarea data-pt="${k}" rows="${rows}" placeholder="${esc(ph)}">${esc(t[k])}</textarea></label>`;
  const sel = (k, label, opts) => `<label><span>${label}</span><select data-pt="${k}">${opts.map(([v, l]) => `<option value="${v}" ${t[k] === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
  const chk = (k, label) => `<label class="check"><input type="checkbox" data-pt="${k}" ${t[k] ? 'checked' : ''}> ${label}</label>`;
  return {
    title: 'Proposal Design', html: `<div class="designer"><div class="dctl" id="ptForm">
      <div class="card"><h3>Look</h3><div class="grid2">
        <label class="wide"><span>Logo</span><span class="btns"><label class="btn sm">Upload logo<input type="file" id="ptLogo" accept="image/*" hidden></label>${t.logo ? '<button class="btn sm ghost" data-act="ptLogoDel">Remove</button>' : ''}</span></label>
        <label><span>Logo size</span><input type="range" min="30" max="160" data-pt="logoH" value="${t.logoH}"></label>
        <label><span>Accent color</span><input type="color" data-pt="accent" value="${esc(t.accent)}"></label>
        ${sel('header', 'Header layout', [['split', 'Company left, title right'], ['center', 'Centered'], ['banner', 'Color banner']])}
        ${sel('font', 'Font', [['sans', 'Modern (Arial / Helvetica)'], ['serif', 'Classic (Georgia)'], ['times', 'Formal (Times)']])}
        ${sel('size', 'Text size', [['s', 'Small'], ['m', 'Medium'], ['l', 'Large']])}
        ${sel('table', 'Table style', [['lines', 'Row lines'], ['striped', 'Striped rows'], ['boxed', 'Full grid']])}
        ${sel('section', 'Section headings', [['shaded', 'Shaded bar'], ['accent', 'Accent color bar'], ['plain', 'Bold text only']])}</div></div>
      <div class="card"><h3>Header</h3><div class="grid2">${txt('docTitle', 'Document title')}
        <label><span>Company name</span><input data-set="company" value="${esc(DB.settings.company)}"></label>
        ${area('headerLines', 'Lines under the company name (one per line)', 4, [DB.settings.address, DB.settings.phone, DB.settings.email].filter(Boolean).join('\n'))}
        ${chk('showNumber', 'Show proposal number')}${chk('showPreparedFor', 'Show “Prepared for” customer')}</div></div>
      <div class="card"><h3>Items table</h3><div class="grid2">${txt('colItem', 'Item column heading')}${txt('colDesc', 'Description column heading')}${txt('colQty', 'Quantity heading')}${txt('colUnit', 'Units heading')}
        ${chk('showDesc', 'Show the description column')}${area('totalLabel', 'Total line wording', 1)}${area('intro', 'Opening note above the table (optional)', 2)}</div></div>
      <div class="card"><h3>Notes, acceptance &amp; signature</h3><div class="grid2">${area('notesTitle', 'Heading above your contract notes', 1)}
        <label class="wide"><span>Contract notes / terms (default for new proposals)</span><textarea data-set="terms" rows="6">${esc(DB.settings.terms)}</textarea></label>
        ${area('accept', 'How to accept (optional)', 3)}${area('validity', 'Price validity line (optional)', 1)}${chk('showSignature', 'Show the signature block')}</div></div>
      <div class="btns"><button class="btn ghost" data-act="ptReset">Reset design to default</button></div></div>
    <div class="dpv"><div class="dpvbar"><b>Live preview</b><small>${e.id ? `#${e.number} · ${esc(e.title)}` : 'sample proposal'}</small><span class="grow"></span><label class="check sm"><input type="checkbox" id="ptPrices"> show prices</label><button class="btn sm" onclick="window.print()">Print test</button></div><div id="pvw">${proposalHTML(e)}</div></div></div>`,
    mount() {
      const paint = () => { const show = $('#ptPrices').checked; $('#pvw').innerHTML = proposalHTML({ ...e, hidePrices: !show }); };
      const onEdit = ev => { const el = ev.target; if (!el.dataset.pt && !el.dataset.set) return; if (el.dataset.pt) { DB.settings.proposal = { ...(DB.settings.proposal || {}), [el.dataset.pt]: el.type === 'checkbox' ? el.checked : el.type === 'range' ? +el.value : el.value }; } else DB.settings[el.dataset.set] = el.value; save(); paint(); };
      $('#ptForm').addEventListener('input', onEdit); $('#ptForm').addEventListener('change', onEdit); $('#ptPrices').onchange = paint;
      $('#ptLogo').onchange = async ev => { if (!ev.target.files[0]) return; DB.settings.proposal = { ...(DB.settings.proposal || {}), logo: await shrinkLogo(ev.target.files[0]) }; save(); render(); };
    }
  };
};
ACT.ptLogoDel = () => { DB.settings.proposal = { ...(DB.settings.proposal || {}), logo: '' }; save(); render(); };
ACT.ptReset = () => confirmBox('Reset the proposal design to the default look? Your logo and wording changes are cleared.', () => { delete DB.settings.proposal; save(); render(); });
function shrinkLogo(file, max = 500) {   // keeps transparency (PNG), unlike the photo shrinker
  return new Promise(res => { const r = new FileReader(); r.onload = () => { const img = new Image(); img.onload = () => { const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL('image/png')); }; img.src = r.result; }; r.readAsDataURL(file); });
}

/* ---------- price book ---------- */
function pbLearn(lines) {   // add items we have not seen before (name + unit + price); returns how many were added
  let n = 0;
  lines.forEach(l => { const name = String(l.desc || '').trim(); if (!name || isSection(l) || blank(l.price) || pbFind(name)) return; priceBook().push({ id: uid('pb'), name, unit: String(l.unit || '').trim() || 'EA', price: +l.price }); n++; });
  return n;
}
function pbDatalist() { const d = $('#pb'); if (d) d.innerHTML = priceBook().map(p => `<option value="${esc(p.name)}">${esc(p.unit)} · ${money2(p.price)}</option>`).join(''); }
const pbCardHTML = () => `<div class="card"><h3>Price book <span class="btns"><button class="btn sm" data-act="pbExcel">⬆ Learn from an Excel proposal</button><button class="btn sm primary" data-act="pbAdd">+ Item</button></span></h3>
  <p class="hint" style="margin:0 0 8px">Your standard items. They auto-fill units and prices when you type an item on a proposal, and they are the pick-list in the satellite take-off. Unit decides how it is measured on the map: SQ FT = area, FT = length, anything else = count.</p>
  ${priceBook().length ? `<div class="scroll" style="max-height:420px;overflow:auto"><table class="edit"><tr><th>Item</th><th>Unit</th><th>Price / unit</th><th></th></tr>${[...priceBook()].sort((a, b) => a.name.localeCompare(b.name)).map(p => `<tr><td><input data-pb="${p.id}" data-f="name" value="${esc(p.name)}"></td><td><input class="s" data-pb="${p.id}" data-f="unit" value="${esc(p.unit)}" list="pbUnits"></td><td><input class="n" type="number" step="0.01" data-pb="${p.id}" data-f="price" value="${p.price}"></td><td><button class="ico" data-act="pbDel" data-id="${p.id}">×</button></td></tr>`).join('')}</table></div>` : empty('No items yet', 'Add items, or upload one of your Excel proposals to load its items and prices')}
  <datalist id="pbUnits"><option>FT</option><option>SQ FT</option><option>EA</option><option>LS</option><option>SQ YD</option><option>TON</option></datalist></div>`;
CHG.pb = el => { const p = priceBook().find(x => x.id === el.dataset.pb); if (!p) return; p[el.dataset.f] = el.dataset.f === 'price' ? +el.value : el.value.trim(); save(); pbDatalist(); };
ACT.pbAdd = () => { priceBook().push({ id: uid('pb'), name: 'New item', unit: 'EA', price: 0 }); save(); render(); };
ACT.pbDel = el => { DB.settings.priceBook = priceBook().filter(p => p.id !== el.dataset.id); save(); render(); };
ACT.pbExcel = () => {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.xlsx,.xls,.csv'; inp.multiple = true;
  inp.onchange = async () => {
    try { await loadXLSX(); let n = 0; for (const f of inp.files) { const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: true }); n += pbLearn(parseProposalSheet(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' })).lines); } save(); render(); toast(n ? `Added ${n} new item${n > 1 ? 's' : ''} to the price book` : 'No new priced items found in that file'); }
    catch (x) { toast(x.message || 'Could not read that file', 'err'); }
  };
  inp.click();
};
