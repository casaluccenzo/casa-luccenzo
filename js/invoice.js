// Factura formato carta "Tipo A" (corporativa): un solo dibujo para la caja
// (sistema/) y para la página pública de verificación (factura/), así lo que
// el cliente descarga es exactamente lo que la caja imprimió.
//
// `inv` es el JSON que devuelven issue_invoice / verify_invoice
// (supabase/migrations/039_invoices.sql). Los montos ya vienen calculados por
// la base: aquí solo se dibujan.
(function () {
    const COMPANY = {
        brand: 'CASA LUCENZO',
        razon: 'EMPRENDIMIENTO KAIRA BLANCO',
        rif: 'J-50818313-4',
        addr: 'Av. Winston Churchill entre 3ra y 4ta Carrera Sur, Local S/N, Sector Pueblo Nuevo Sur, El Tigre, Edo. Anzoátegui',
        tel: '(0412) 083.9311',
        web: 'casalucenzo.com',
        lugar: 'El Tigre'
    };

    // Las facturas se ven en la caja y en el teléfono del cliente, que pueden
    // estar en otra zona horaria: la fecha y hora fiscales son las de Venezuela.
    const TZ = 'America/Caracas';

    const STYLE_ID = 'inv-a-style';
    const CSS = `
.inv-a { --navy:#0f2a52; --gold:#b8913a; --gold-dark:#8a6a22; --gold-tint:#f6efdf; --ink:#1b2233; --ink-soft:#5b6377; --rule:#d9dde6; --red:#c0392b;
  width:816px; min-height:1056px; background:#fff; color:var(--ink); position:relative; overflow:hidden; box-sizing:border-box;
  padding:34px 40px 26px; display:flex; flex-direction:column; font-family:"IBM Plex Sans","Segoe UI",Roboto,Arial,sans-serif;
  font-size:11px; line-height:1.35; font-variant-numeric:tabular-nums; text-align:left;
  -webkit-print-color-adjust:exact; print-color-adjust:exact; box-shadow:0 10px 30px rgba(10,20,40,.18); }
.inv-a * { box-sizing:border-box; }
.inv-a .num { text-align:right; white-space:nowrap; }
.inv-a .ctr { text-align:center; }
.inv-a table { border-collapse:collapse; width:100%; }
.inv-a .disp { font-family:"Cinzel","Trajan Pro",Georgia,serif; }
.inv-a .cond { font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif; }
.inv-a .head { display:grid; grid-template-columns:104px 1fr 220px; gap:18px; align-items:start; }
.inv-a .head .logo { width:104px; height:104px; }
.inv-a .co { text-align:center; padding-top:4px; }
.inv-a .co .brand { font-size:26px; font-weight:700; color:var(--navy); letter-spacing:.08em; line-height:1.05; }
.inv-a .co .razon { font-weight:700; color:var(--gold-dark); margin-top:4px; font-size:11.5px; letter-spacing:.03em; }
.inv-a .co .addr { color:var(--ink-soft); margin-top:4px; font-size:10px; }
.inv-a .co .rif { margin-top:3px; font-weight:600; }
.inv-a .fbox { border-left:3px solid var(--gold); padding:2px 0 2px 12px; }
.inv-a .fbox .t { font-weight:700; font-size:20px; color:var(--navy); letter-spacing:.12em; }
.inv-a .fbox dl { display:grid; grid-template-columns:auto 1fr; gap:2px 8px; margin:6px 0 0; }
.inv-a .fbox dt { font-weight:700; color:var(--gold-dark); }
.inv-a .fbox dd { margin:0; text-align:right; font-weight:500; }
.inv-a .fbox .big { font-size:13px; font-weight:700; color:var(--navy); }
.inv-a .fbox .ctl { color:var(--red); font-weight:700; }
.inv-a .client { margin-top:22px; display:grid; grid-template-columns:1fr 190px; gap:16px; }
.inv-a .client .f { display:grid; grid-template-columns:auto 1fr auto 1fr; gap:5px 8px; align-items:baseline; }
.inv-a .client .f b { color:var(--gold-dark); text-transform:uppercase; letter-spacing:.04em; white-space:nowrap; font-weight:700; }
.inv-a .client .f .wide { grid-column:span 3; }
.inv-a .pay { background:var(--gold-tint); padding:8px 10px; }
.inv-a .pay .h { font-weight:700; color:var(--navy); text-align:center; margin-bottom:4px; }
.inv-a .items { margin-top:18px; position:relative; z-index:1; }
.inv-a .items th { background:var(--gold-tint); color:var(--gold-dark); text-transform:uppercase; letter-spacing:.04em; font-weight:700; padding:7px 8px; text-align:left; }
.inv-a .items th.num { text-align:right; } .inv-a .items th.ctr { text-align:center; }
.inv-a .items td { padding:6px 8px; border-bottom:1px solid #eef0f4; }
.inv-a .items tr.sum td { border-bottom:0; font-weight:700; padding-top:8px; }
.inv-a .wm { position:absolute; left:50%; top:560px; width:340px; height:340px; transform:translate(-50%,-50%); opacity:.06; pointer-events:none; }
.inv-a .spacer { flex:1 1 auto; min-height:24px; }
.inv-a .bottom { display:grid; grid-template-columns:1fr 330px; gap:24px; align-items:end; position:relative; z-index:1; }
.inv-a .left { display:flex; gap:12px; align-items:flex-end; }
.inv-a .qr { width:92px; flex:0 0 92px; text-align:center; font-size:8px; color:var(--ink-soft); }
.inv-a .qr svg, .inv-a .qr img { width:92px; height:92px; display:block; }
.inv-a .rate { font-size:10.5px; line-height:1.5; border-left:2px solid var(--rule); padding-left:10px; }
.inv-a .rate .code { margin-top:4px; font-size:10px; color:var(--ink-soft); }
.inv-a .rate .code b { color:var(--navy); letter-spacing:.06em; }
.inv-a .tot th { font-weight:700; color:var(--gold-dark); text-transform:uppercase; letter-spacing:.03em; text-align:left; padding:2px 0; }
.inv-a .tot td { padding:2px 0 2px 10px; }
.inv-a .tot thead th { color:var(--ink-soft); font-size:9.5px; text-align:right; }
.inv-a .tot tr.grand th, .inv-a .tot tr.grand td { font-size:13px; color:var(--navy); font-weight:700; border-top:1px solid var(--navy); padding-top:5px; }
.inv-a .legal { margin-top:22px; font-size:8.5px; color:var(--ink-soft); text-align:center; line-height:1.45; }
.inv-a .legal .bar { height:4px; background:linear-gradient(90deg,var(--navy) 0 62%,var(--gold) 62% 100%); margin-bottom:10px; }
.inv-a .legal strong { color:var(--ink); }
.inv-a .void { position:absolute; left:50%; top:45%; transform:translate(-50%,-50%) rotate(-24deg); border:6px solid var(--red); color:var(--red);
  font-size:72px; font-weight:800; letter-spacing:.12em; padding:6px 28px; opacity:.55; z-index:2; }
.inv-scaler { transform-origin:top left; }
@media print {
  @page { size:letter; margin:0; }
  body.inv-printing > *:not(.inv-print-root) { display:none !important; }
  body.inv-printing .inv-print-root { position:static !important; inset:auto !important; background:none !important; padding:0 !important;
    display:block !important; overflow:visible !important; backdrop-filter:none !important; }
  body.inv-printing { background:#fff !important; margin:0 !important; padding:0 !important; }
  body.inv-printing .inv-print-root > * { background:none !important; border:0 !important; padding:0 !important; margin:0 !important;
    max-width:none !important; width:auto !important; box-shadow:none !important; border-radius:0 !important; }
  body.inv-printing .inv-print-root .inv-noprint { display:none !important; }
  body.inv-printing .inv-print-root .inv-stage { height:auto !important; width:auto !important; overflow:visible !important; max-width:none !important; }
  body.inv-printing .inv-print-root .inv-scaler { transform:none !important; }
  body.inv-printing .inv-a { box-shadow:none; min-height:10.9in; }
}`;

    function ensureStyle() {
        if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
        if (!document.getElementById('inv-a-fonts')) {
            const link = document.createElement('link');
            link.id = 'inv-a-fonts';
            link.rel = 'stylesheet';
            link.href = 'https://fonts.googleapis.com/css2?family=Cinzel:wght@700&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Sans+Condensed:wght@500;700&display=swap';
            document.head.appendChild(link);
        }
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

    function pad5(n) {
        return String(n).padStart(5, '0');
    }

    function dateParts(iso) {
        const d = new Date(iso);
        if (isNaN(d)) return { fecha: '', hora: '' };
        const fecha = d.toLocaleDateString('es-VE', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
        const hora = d.toLocaleTimeString('es-VE', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: true });
        return { fecha, hora };
    }

    function verifyUrl(inv, origin) {
        const here = typeof window !== 'undefined' && window.location ? window.location.origin : '';
        const base = (origin || here || 'https://www.casalucenzo.com').replace(/\/$/, '');
        return `${base}/factura/?n=${encodeURIComponent(inv.number)}&c=${encodeURIComponent(inv.verify_code || '')}`;
    }

    // QR con la librería qrcode-generator si ya está cargada (window.qrcode);
    // sin ella la factura sale igual, solo sin el cuadrito.
    function qrSvg(text) {
        try {
            if (typeof window === 'undefined' || typeof window.qrcode !== 'function') return '';
            const q = window.qrcode(0, 'M');
            q.addData(text);
            q.make();
            return q.createSvgTag({ cellSize: 3, margin: 0, scalable: true });
        } catch {
            return '';
        }
    }

    function render(inv, opts = {}) {
        const logo = opts.logoUrl || '/img/logo-factura.png';
        const { fecha, hora } = dateParts(inv.issued_at);
        const rate = Number(inv.bcv_rate) || 0;
        const items = Array.isArray(inv.items) ? inv.items : [];
        const qtyTotal = items.reduce((s, i) => s + (Number(i.qty) || 0), 0);
        const url = opts.verifyUrl || verifyUrl(inv, opts.origin);
        const qr = qrSvg(url);

        const rows = items.map((it, idx) => {
            const total = Number(it.total != null ? it.total : it.qty * it.price) || 0;
            return `<tr>
                <td>${String(idx + 1).padStart(2, '0')}</td>
                <td>${esc(it.desc)}</td>
                <td class="num">$ ${fmt(it.price)}</td>
                <td class="ctr">${esc(it.qty)}</td>
                <td class="num">$ ${fmt(total)}</td>
                <td class="num">Bs ${fmt(total * rate)}</td>
                <td class="ctr">G 16%</td>
            </tr>`;
        }).join('');

        return `<div class="inv-a">
            <img class="wm" src="${esc(logo)}" alt="">
            ${inv.status === 'anulada' ? '<div class="void">ANULADA</div>' : ''}
            <div class="head">
                <img class="logo" src="${esc(logo)}" alt="Logo Casa Lucenzo">
                <div class="co">
                    <div class="brand disp">${COMPANY.brand}</div>
                    <div class="razon">${COMPANY.razon}</div>
                    <div class="addr">${COMPANY.addr}</div>
                    <div class="rif">RIF: ${COMPANY.rif} · Telf: ${COMPANY.tel}</div>
                </div>
                <div class="fbox">
                    <div class="t disp">FACTURA</div>
                    <dl>
                        <dt>N°:</dt><dd class="big">${pad5(inv.number)}</dd>
                        <dt>N° de Control:</dt><dd class="ctl">${esc(inv.control_number)}</dd>
                        <dt>Fecha de Emisión:</dt><dd>${fecha}</dd>
                        <dt>Hora de Emisión:</dt><dd>${hora}</dd>
                        <dt>Lugar:</dt><dd>${COMPANY.lugar}</dd>
                    </dl>
                </div>
            </div>
            <div class="client">
                <div class="f cond">
                    <b>Nombre o Razón Social:</b><span class="wide">${esc(inv.client_name)}</span>
                    <b>RIF / C.I.:</b><span>${esc(inv.client_rif)}</span>
                    <b>Teléfono:</b><span>${esc(inv.client_phone || '—')}</span>
                    <b>Domicilio Fiscal:</b><span class="wide">${esc(inv.client_address || '—')}</span>
                    ${inv.client_email ? `<b>Correo:</b><span class="wide">${esc(inv.client_email)}</span>` : ''}
                </div>
                <div class="pay">
                    <div class="h">Forma de Pago</div>
                    <div><b>Condición:</b> ${esc(inv.payment_condition || 'Contado')}</div>
                    <div><b>Método:</b> ${esc(inv.payment_method || '—')}</div>
                    <div><b>Monto USD:</b> <b>${fmt(inv.total_usd)}</b></div>
                </div>
            </div>
            <table class="items">
                <thead><tr class="cond"><th style="width:44px">N°</th><th>Descripción</th><th class="num">Precio / U</th><th class="ctr" style="width:46px">Cant.</th><th class="num">Total USD</th><th class="num">Total Bs</th><th class="ctr" style="width:56px">% IVA</th></tr></thead>
                <tbody>${rows}
                    <tr class="sum"><td></td><td>Total artículos</td><td></td><td class="ctr">${qtyTotal}</td><td class="num">$ ${fmt(inv.total_usd)}</td><td class="num">Bs ${fmt(inv.total_bs)}</td><td></td></tr>
                </tbody>
            </table>
            <div class="spacer"></div>
            <div class="bottom">
                <div class="left">
                    ${qr ? `<div class="qr">${qr}<div>Verificar factura</div></div>` : ''}
                    <div class="rate">
                        Precios con IVA incluido. A los efectos de la Ley del IVA, la tasa de cambio BCV utilizada en esta factura es de <b>1 $ por Bs ${fmt(rate)}</b>.
                        Al momento del pago deberá utilizarse la tasa vigente del día. En caso de pagos en moneda extranjera se causará el 3% por IGTF.
                        <div class="code">Verifique esta factura en <b>${COMPANY.web}/factura</b> con su cédula/RIF o el código <b>${esc(inv.verify_code || '')}</b></div>
                    </div>
                </div>
                <table class="tot">
                    <thead><tr><th></th><th>DÓLARES</th><th>BOLÍVARES</th></tr></thead>
                    <tbody class="cond">
                        <tr><th>Sub total</th><td class="num">${fmt(inv.total_usd)}</td><td class="num">${fmt(inv.total_bs)}</td></tr>
                        <tr><th>Exento</th><td class="num">0,00</td><td class="num">0,00</td></tr>
                        <tr><th>Base imponible</th><td class="num">${fmt(inv.base_usd)}</td><td class="num">${fmt(inv.base_bs)}</td></tr>
                        <tr><th>IVA 16,00%</th><td class="num">${fmt(inv.iva_usd)}</td><td class="num">${fmt(inv.iva_bs)}</td></tr>
                        <tr><th>IGTF 3%</th><td class="num">0,00</td><td class="num">0,00</td></tr>
                        <tr class="grand"><th>Total a pagar</th><td class="num">${fmt(inv.total_usd)}</td><td class="num">${fmt(inv.total_bs)}</td></tr>
                    </tbody>
                </table>
            </div>
            <div class="legal">
                <div class="bar"></div>
                <strong>${COMPANY.brand} · ${COMPANY.razon} · RIF ${COMPANY.rif}</strong><br>
                Esta factura va sin enmendadura ni tachadura. ¡Gracias por su preferencia! · ${COMPANY.web}<br>
                Datos de imprenta autorizada / Providencia SENIAT y rango de N° de Control: <i>pendiente de completar con los de la imprenta</i>
            </div>
        </div>`;
    }

    // Monta la factura dentro de `stage`, escalada al ancho disponible (la
    // hoja mide 816px como una carta a 96 dpi). Devuelve una función para
    // volver a ajustar si cambia el ancho.
    function mount(stage, inv, opts = {}) {
        ensureStyle();
        stage.classList.add('inv-stage');
        stage.style.overflow = 'hidden';
        stage.innerHTML = `<div class="inv-scaler">${render(inv, opts)}</div>`;
        const scaler = stage.firstElementChild;
        const paper = scaler.firstElementChild;
        const fit = () => {
            const k = Math.min(1, stage.clientWidth / 816 || 1);
            scaler.style.transform = `scale(${k})`;
            scaler.style.width = '816px';
            scaler.style.margin = k === 1 ? '0 auto' : '0';
            stage.style.height = (paper.offsetHeight * k) + 'px';
        };
        fit();
        return fit;
    }

    // Imprime solo la factura (o "Guardar como PDF" desde el mismo diálogo).
    // `root` es el contenedor de la factura que cuelga directo de <body>.
    function print(root) {
        ensureStyle();
        root.classList.add('inv-print-root');
        document.body.classList.add('inv-printing');
        const done = () => {
            document.body.classList.remove('inv-printing');
            window.removeEventListener('afterprint', done);
        };
        window.addEventListener('afterprint', done);
        window.print();
        setTimeout(done, 1500);
    }

    // Texto para WhatsApp / correo con el enlace de verificación y descarga.
    function shareText(inv, origin) {
        return `*${COMPANY.brand}* 🥖\n` +
            `Factura N° ${pad5(inv.number)} · Control ${inv.control_number}\n` +
            `Total: $${fmt(inv.total_usd)} (Bs ${fmt(inv.total_bs)})\n\n` +
            `Vea y descargue su factura aquí:\n${verifyUrl(inv, origin)}`;
    }

    const api = { COMPANY, render, mount, print, verifyUrl, shareText, pad5, fmt, dateParts };
    if (typeof window !== 'undefined') window.InvoiceRenderer = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
