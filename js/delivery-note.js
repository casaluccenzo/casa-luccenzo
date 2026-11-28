// Nota de entrega (despacho a cliente): hoja carta con ORIGINAL (cliente)
// arriba y COPIA (Casa Lucenzo) abajo, para firmar al recibir. Ver
// docs/NOTA-DE-ENTREGA.md y supabase/migrations/054_delivery_notes.sql.
//
// `note` es el JSON que devuelve issue_delivery_note (o una fila de
// delivery_notes). Los montos ya vienen de la base: aquí solo se dibujan.
// No es factura: lleva "Documento sin valor fiscal".
(function () {
    const FALLBACK_COMPANY = {
        brand: 'CASA LUCENZO',
        razon: 'EMPRENDIMIENTO KAIRA BLANCO',
        rif: 'J-50818313-4',
        addr: 'Av. Winston Churchill entre 3ra y 4ta Carrera Sur, Local S/N, Sector Pueblo Nuevo Sur, El Tigre, Edo. Anzoátegui',
        tel: '(0412) 083.9311'
    };
    function company() {
        const inv = typeof window !== 'undefined' && window.InvoiceRenderer;
        return (inv && inv.COMPANY) || FALLBACK_COMPANY;
    }

    const TZ = 'America/Caracas';
    // Hasta este número de renglones, original y copia caben en media hoja
    // cada una. Con más, cada una va en su hoja (no se achica la letra).
    const HALF_PAGE_MAX_ITEMS = 10;

    const STYLE_ID = 'dn-style';
    const CSS = `
.dn-sheet { width:816px; background:#fff; color:#0f2a52; font-family:"IBM Plex Sans","Segoe UI",Roboto,Arial,sans-serif;
  font-size:11px; line-height:1.35; font-variant-numeric:tabular-nums; text-align:left; box-shadow:0 10px 30px rgba(10,20,40,.18);
  -webkit-print-color-adjust:exact; print-color-adjust:exact; }
.dn-sheet * { box-sizing:border-box; }
.dn-copy { position:relative; overflow:hidden; height:524px; padding:22px 32px 16px; display:flex; flex-direction:column; }
.dn-sheet.dn-full .dn-copy { height:1046px; }
.dn-sheet.dn-full .dn-copy + .dn-copy { break-before:page; page-break-before:always; }
.dn-cut { border-top:1.5px dashed #8a95ab; position:relative; height:0; }
.dn-cut span { position:absolute; left:50%; top:-8px; transform:translateX(-50%); background:#fff; padding:0 8px; font-size:9px; color:#8a95ab; letter-spacing:.2em; }
.dn-sheet.dn-full .dn-cut { display:none; }
.dn-head { display:flex; justify-content:space-between; gap:16px; align-items:flex-start; }
.dn-co { display:flex; gap:12px; align-items:center; }
.dn-co img { width:58px; height:58px; }
.dn-brand { font-family:"Cinzel","Trajan Pro",Georgia,serif; font-weight:700; font-size:19px; letter-spacing:.08em; line-height:1; }
.dn-razon { font-weight:700; font-size:10.5px; margin-top:3px; }
.dn-addr { font-size:9px; margin-top:2px; color:#1d3d6e; max-width:390px; }
.dn-box { border:1.5px solid #0f2a52; border-radius:8px; }
.dn-title { text-align:center; padding:6px 14px; min-width:210px; }
.dn-title .t { font-weight:800; letter-spacing:.25em; font-size:14px; }
.dn-title .n { font-size:20px; font-weight:800; color:#c0392b; letter-spacing:.06em; }
.dn-title .d { font-size:9.5px; color:#5b6377; }
.dn-tag { font-size:9.5px; font-weight:800; letter-spacing:.3em; color:#c0392b; text-align:right; margin-top:4px; }
.dn-cli { margin-top:10px; display:grid; grid-template-columns:2fr 1fr 1fr; }
.dn-cli > div { padding:4px 9px; border-left:1px solid #0f2a52; }
.dn-cli > div:first-child { border-left:0; }
.dn-cli .full { grid-column:1 / -1; border-left:0; border-top:1px solid #0f2a52; }
.dn-lbl { display:block; font-size:8.5px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; color:#1d3d6e; }
.dn-val { color:#1b2233; font-size:11px; font-weight:500; }
.dn-items { margin-top:8px; overflow:hidden; }
.dn-items table { width:100%; border-collapse:collapse; }
.dn-items th { font-size:9px; text-transform:uppercase; padding:4px 6px; border-bottom:1.5px solid #0f2a52; border-left:1px solid #0f2a52; }
.dn-items td { padding:3px 6px; border-left:1px solid #0f2a52; border-bottom:1px solid #c9d2e3; color:#1b2233; height:20px; }
.dn-items th:first-child, .dn-items td:first-child { border-left:0; }
.dn-items tr:last-child td { border-bottom:0; }
.dn-items .c { text-align:center; width:48px; }
.dn-items .r { text-align:right; white-space:nowrap; width:96px; }
.dn-tot { display:flex; justify-content:flex-end; gap:18px; margin-top:5px; font-size:11px; }
.dn-tot b { font-size:12.5px; }
.dn-obs { margin-top:5px; font-size:10px; color:#1b2233; }
.dn-spacer { flex:1 1 auto; min-height:6px; }
.dn-sign { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
.dn-sign > div { padding:6px 10px 7px; }
.dn-sign .h { font-weight:800; font-size:9.5px; text-transform:uppercase; letter-spacing:.06em; }
.dn-sign .l { display:flex; gap:6px; margin-top:9px; font-size:9.5px; align-items:flex-end; }
.dn-sign .l span { flex:1; border-bottom:1px solid #0f2a52; min-height:13px; color:#1b2233; font-weight:600; padding-left:3px; }
.dn-foot { margin-top:6px; text-align:center; font-size:8.5px; color:#5b6377; }
.dn-void { position:absolute; left:50%; top:46%; transform:translate(-50%,-50%) rotate(-20deg); border:5px solid #c0392b; color:#c0392b;
  font-size:54px; font-weight:800; letter-spacing:.12em; padding:4px 22px; opacity:.5; z-index:2; }
.dn-scaler { transform-origin:top left; }
@media print {
  @page { size:letter; margin:0; }
  body.dn-printing > *:not(.dn-print-root) { display:none !important; }
  body.dn-printing { background:#fff !important; margin:0 !important; padding:0 !important; }
  body.dn-printing .dn-print-root { position:static !important; inset:auto !important; background:none !important; padding:0 !important;
    display:block !important; overflow:visible !important; backdrop-filter:none !important; }
  body.dn-printing .dn-print-root > * { background:none !important; border:0 !important; padding:0 !important; margin:0 !important;
    max-width:none !important; width:auto !important; box-shadow:none !important; border-radius:0 !important; }
  body.dn-printing .dn-print-root .dn-noprint { display:none !important; }
  body.dn-printing .dn-print-root .dn-stage { height:auto !important; width:auto !important; overflow:visible !important; max-width:none !important; }
  body.dn-printing .dn-print-root .dn-scaler { transform:none !important; }
  body.dn-printing .dn-sheet { box-shadow:none; }
  body.dn-printing .dn-sheet:not(.dn-full) { height:10.9in; overflow:hidden; }
}`;

    function ensureStyle() {
        if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = CSS;
        document.head.appendChild(style);
    }

    function esc(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function fmt(n) {
        return (Number(n) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    /** "NE-000001" */
    function fmtNumber(n) {
        return `NE-${String(n == null ? '' : n).padStart(6, '0')}`;
    }

    /** Fecha y hora en Venezuela, aunque el equipo esté en otra zona. */
    function dateTime(iso) {
        const d = new Date(iso);
        if (!iso || isNaN(d)) return '';
        const fecha = d.toLocaleDateString('es-VE', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
        const hora = d.toLocaleTimeString('es-VE', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: true });
        return `${fecha} ${hora}`;
    }

    const STATUS_LABEL = { emitida: 'Por entregar', entregada: 'Entregada', anulada: 'Anulada' };

    function copyHtml(note, label, opts) {
        const co = company();
        const logo = opts.logoUrl || '/img/logo-factura.png';
        const items = Array.isArray(note.items) ? note.items : [];
        const prices = note.show_prices !== false;
        const minRows = opts.full ? 24 : 0;
        const head = prices
            ? '<tr><th class="c">Cant.</th><th>Descripción</th><th class="r">P. unit. $</th><th class="r">Total $</th></tr>'
            : '<tr><th class="c">Cant.</th><th>Descripción</th></tr>';
        const blank = prices ? '<tr><td></td><td></td><td></td><td></td></tr>' : '<tr><td></td><td></td></tr>';
        const rows = items.map(it => prices
            ? `<tr><td class="c">${esc(it.qty)}</td><td>${esc(it.desc)}</td><td class="r">${fmt(it.price)}</td><td class="r">${fmt(it.total != null ? it.total : it.qty * it.price)}</td></tr>`
            : `<tr><td class="c">${esc(it.qty)}</td><td>${esc(it.desc)}</td></tr>`
        ).join('') + blank.repeat(Math.max(0, minRows - items.length));

        const rate = Number(note.bcv_rate) || 0;
        const totals = prices
            ? `<div class="dn-tot"><span>Total: <b>$ ${fmt(note.total_usd)}</b></span>${note.total_bs != null && rate > 0
                ? `<span>Bs <b>${fmt(note.total_bs)}</b> <small>(tasa ${fmt(rate)})</small></span>` : ''}</div>`
            : '';
        const address = [note.delivery_address, note.delivery_reference ? `Ref.: ${note.delivery_reference}` : '']
            .filter(Boolean).join(' · ');
        const delivered = note.status === 'entregada';

        return `<div class="dn-copy">
            ${note.status === 'anulada' ? '<div class="dn-void">ANULADA</div>' : ''}
            <div class="dn-head">
                <div class="dn-co">
                    <img src="${esc(logo)}" alt="Logo">
                    <div>
                        <div class="dn-brand">${esc(co.brand)}</div>
                        <div class="dn-razon">${esc(co.razon)}</div>
                        <div class="dn-addr">${esc(co.addr)}<br><b>RIF: ${esc(co.rif)}</b> / Teléfono: ${esc(co.tel)}</div>
                    </div>
                </div>
                <div>
                    <div class="dn-box dn-title">
                        <div class="t">NOTA DE ENTREGA</div>
                        <div class="n">N° ${fmtNumber(note.number)}</div>
                        <div class="d">Emitida: ${dateTime(note.issued_at)}</div>
                    </div>
                    <div class="dn-tag">${label}</div>
                </div>
            </div>
            <div class="dn-box dn-cli">
                <div><span class="dn-lbl">Cliente</span><span class="dn-val">${esc(note.client_name)}</span></div>
                <div><span class="dn-lbl">C.I. / RIF</span><span class="dn-val">${esc(note.client_rif || '')}</span></div>
                <div><span class="dn-lbl">Teléfono</span><span class="dn-val">${esc(note.client_phone || '')}</span></div>
                ${address ? `<div class="full"><span class="dn-lbl">Dirección de entrega</span><span class="dn-val">${esc(address)}</span></div>` : ''}
            </div>
            <div class="dn-box dn-items"><table><thead>${head}</thead><tbody>${rows}</tbody></table></div>
            ${totals}
            ${note.notes ? `<div class="dn-obs"><b>Observaciones:</b> ${esc(note.notes)}</div>` : ''}
            ${note.status === 'anulada' && note.void_reason ? `<div class="dn-obs"><b>Motivo de anulación:</b> ${esc(note.void_reason)}</div>` : ''}
            <div class="dn-spacer"></div>
            <div class="dn-sign">
                <div class="dn-box">
                    <div class="h">Entregado por</div>
                    <div class="l">Nombre: <span></span></div>
                    <div class="l">Firma: <span></span></div>
                </div>
                <div class="dn-box">
                    <div class="h">Recibido conforme</div>
                    <div class="l">Nombre: <span>${delivered ? esc(note.received_by_name || '') : ''}</span> C.I.: <span>${delivered ? esc(note.received_by_rif || '') : ''}</span></div>
                    <div class="l">Firma: <span></span> Fecha: <span>${delivered ? dateTime(note.delivered_at) : ''}</span></div>
                </div>
            </div>
            <div class="dn-foot">Documento sin valor fiscal. La factura, si corresponde, se emite por separado.</div>
        </div>`;
    }

    function render(note, opts = {}) {
        const items = Array.isArray(note.items) ? note.items : [];
        const full = items.length > HALF_PAGE_MAX_ITEMS;
        const o = Object.assign({}, opts, { full });
        return `<div class="dn-sheet${full ? ' dn-full' : ''}">
            ${copyHtml(note, 'ORIGINAL · CLIENTE', o)}
            <div class="dn-cut"><span>✂ CORTAR AQUÍ</span></div>
            ${copyHtml(note, 'COPIA · CASA LUCENZO', o)}
        </div>`;
    }

    // Monta la nota en `stage`, escalada al ancho disponible (816px = carta a 96 dpi).
    function mount(stage, note, opts = {}) {
        ensureStyle();
        stage.classList.add('dn-stage');
        stage.style.overflow = 'hidden';
        stage.innerHTML = `<div class="dn-scaler">${render(note, opts)}</div>`;
        const scaler = stage.firstElementChild;
        const paper = scaler.firstElementChild;
        const fit = () => {
            const k = Math.min(1, stage.clientWidth / 816 || 1);
            scaler.style.transform = `scale(${k})`;
            scaler.style.width = '816px';
            stage.style.height = (paper.offsetHeight * k) + 'px';
        };
        fit();
        return fit;
    }

    // Imprime solo la nota ("Guardar como PDF" sale del mismo diálogo).
    // `root` es el contenedor que cuelga directo de <body>.
    function print(root) {
        ensureStyle();
        root.classList.add('dn-print-root');
        document.body.classList.add('dn-printing');
        const done = () => {
            document.body.classList.remove('dn-printing');
            window.removeEventListener('afterprint', done);
        };
        window.addEventListener('afterprint', done);
        window.print();
        setTimeout(done, 1500);
    }

    const api = { render, mount, print, fmtNumber, dateTime, STATUS_LABEL, HALF_PAGE_MAX_ITEMS };
    if (typeof window !== 'undefined') window.DeliveryNote = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
