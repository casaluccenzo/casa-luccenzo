// Factura formato carta estilo talonario (las mismas casillas de la
// libreta de la imprenta, con el logo): un solo dibujo para la caja
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
.inv-a { --navy:#0f2a52; --navy-2:#1d3d6e; --ink:#1b2233; --ink-soft:#5b6377; --soft-rule:#c9d2e3; --red:#c0392b;
  width:816px; min-height:1056px; background:#fff; color:var(--navy); position:relative; overflow:hidden; box-sizing:border-box;
  padding:30px 36px 20px; display:flex; flex-direction:column; font-family:"IBM Plex Sans","Segoe UI",Roboto,Arial,sans-serif;
  font-size:11px; line-height:1.35; font-variant-numeric:tabular-nums; text-align:left;
  -webkit-print-color-adjust:exact; print-color-adjust:exact; box-shadow:0 10px 30px rgba(10,20,40,.18); }
.inv-a * { box-sizing:border-box; }
.inv-a .num { text-align:right; white-space:nowrap; }
.inv-a .ctr { text-align:center; }
.inv-a table { border-collapse:collapse; width:100%; }
.inv-a .disp { font-family:"Cinzel","Trajan Pro",Georgia,serif; }
.inv-a .cond, .inv-a .lbl { font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif; }
.inv-a .lbl { font-weight:700; text-transform:uppercase; }
.inv-a .box { border:1.5px solid var(--navy); border-radius:10px; overflow:hidden; }
.inv-a .head { display:grid; grid-template-columns:1fr 250px; gap:14px; }
.inv-a .co { display:grid; grid-template-columns:84px 1fr; gap:14px; align-items:center; }
.inv-a .co img { width:84px; height:84px; }
.inv-a .co .brand { font-weight:700; font-size:24px; letter-spacing:.08em; line-height:1; }
.inv-a .co .razon { font-weight:700; font-size:12px; margin-top:4px; }
.inv-a .co .addr { font-size:10px; margin-top:3px; line-height:1.4; color:var(--navy-2); }
.inv-a .date { display:grid; grid-template-columns:1.6fr repeat(3,1fr); text-align:center; font-size:9px; }
.inv-a .date > div { border-left:1px solid var(--navy); }
.inv-a .date > div:first-child { border-left:0; }
.inv-a .date .h { border-bottom:1px solid var(--navy); padding:3px 2px; }
.inv-a .date .v { padding:4px 2px; font-size:11px; font-weight:600; color:var(--ink); }
.inv-a .fac { margin-top:8px; text-align:center; padding:6px 8px 8px; }
.inv-a .fac .t { font-weight:700; letter-spacing:.5em; font-size:18px; padding-left:.5em; }
.inv-a .fac .n { font-size:24px; font-weight:700; color:var(--red); letter-spacing:.08em; }
.inv-a .fac .n small { color:var(--navy); font-size:18px; margin-right:10px; }
.inv-a .fac .hr { font-size:9.5px; color:var(--ink-soft); }
.inv-a .cli { margin-top:12px; }
.inv-a .cli .r { border-top:1px solid var(--navy); padding:5px 10px; display:flex; gap:10px; align-items:baseline; }
.inv-a .cli .r:first-child { border-top:0; }
.inv-a .cli .r b { font-size:10px; white-space:nowrap; }
.inv-a .cli .r span { color:var(--ink); font-size:11.5px; font-weight:500; }
.inv-a .cli .r.three { display:grid; grid-template-columns:1.1fr 1fr 1.3fr; padding:0; align-items:stretch; }
.inv-a .cli .three > div { padding:5px 10px; border-left:1px solid var(--navy); text-align:center; }
.inv-a .cli .three > div:first-child { border-left:0; }
.inv-a .cli .three b { display:block; margin-bottom:2px; }
.inv-a .cli .three span { display:block; }
.inv-a .chk { display:inline-flex; gap:4px; align-items:center; margin:0 5px; font-size:10px; color:var(--navy); }
.inv-a .chk i { width:11px; height:11px; border:1.3px solid var(--navy); display:inline-grid; place-items:center; font-style:normal; font-size:9px; font-weight:700; color:var(--ink); }
.inv-a .items { margin-top:12px; }
.inv-a .items th { font-size:10px; padding:6px; border-bottom:1.5px solid var(--navy); border-left:1px solid var(--navy); text-align:center; }
.inv-a .items th:first-child, .inv-a .items td:first-child { border-left:0; }
.inv-a .items td { padding:5px 6px; border-left:1px solid var(--navy); border-bottom:1px solid var(--soft-rule); color:var(--ink); height:27px; }
.inv-a .items tr:last-child td { border-bottom:0; }
.inv-a .items .ref { color:var(--ink-soft); font-size:9px; display:block; }
.inv-a .spacer { flex:1 1 auto; min-height:8px; }
.inv-a .low { margin-top:12px; display:grid; grid-template-columns:1fr 1fr; }
.inv-a .ctlbox { padding:12px 14px; border-right:1.5px solid var(--navy); display:flex; flex-direction:column; justify-content:space-between; gap:8px; }
.inv-a .ctlbox .h { font-weight:700; font-size:17px; letter-spacing:.03em; }
.inv-a .ctlbox .v { font-size:22px; font-weight:700; margin-top:2px; }
.inv-a .ctlbox .v em { font-style:normal; color:var(--red); }
.inv-a .ctlbox .mid { display:flex; gap:10px; align-items:flex-start; }
.inv-a .ctlbox .pay { font-size:10px; color:var(--ink); line-height:1.5; }
.inv-a .ctlbox .pay b { color:var(--navy); }
.inv-a .qr { width:78px; flex:0 0 78px; text-align:center; font-size:7.5px; color:var(--ink-soft); }
.inv-a .qr svg, .inv-a .qr img { width:78px; height:78px; display:block; }
.inv-a .ctlbox .sin { font-weight:700; font-size:10.5px; }
.inv-a .tt { display:flex; flex-direction:column; }
.inv-a .tt .grand { flex:1 1 auto; }
.inv-a .tt .r { display:grid; grid-template-columns:1fr 106px 92px; border-top:1px solid var(--navy); }
.inv-a .tt .r:first-child { border-top:0; }
.inv-a .tt .r > * { padding:6px 8px; }
.inv-a .tt .r > b { text-align:right; font-size:11px; }
.inv-a .tt .r > span { border-left:1px solid var(--navy); text-align:right; color:var(--ink); }
.inv-a .tt .hd > span { color:var(--navy); font-size:9.5px; text-align:center; font-weight:700; }
.inv-a .tt .grand > * { font-size:13px; font-weight:700; }
.inv-a .tt .grand > span { color:var(--navy); }
.inv-a .imp { margin-top:10px; font-size:8.5px; }
.inv-a .imp .t { padding:4px 10px; border-bottom:1px solid var(--navy); text-align:center; font-weight:600; }
.inv-a .imp .g { display:grid; grid-template-columns:1fr 1.3fr 1.3fr 1.2fr; }
.inv-a .imp .g > div { padding:4px 8px; border-left:1px solid var(--navy); font-weight:600; }
.inv-a .imp .g > div:first-child { border-left:0; }
.inv-a .imp .g span { color:var(--ink); font-family:"IBM Plex Sans",Arial,sans-serif; font-weight:500; }
.inv-a .orig { text-align:center; color:var(--red); letter-spacing:.4em; font-size:12px; margin-top:8px; }
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

    // Filas mínimas de la tabla de productos, como las líneas del talonario
    // en papel: con pocas compras la hoja se ve igual que la libreta.
    const MIN_ROWS = 14;

    function render(inv, opts = {}) {
        const logo = opts.logoUrl || '/img/logo-factura.png';
        const { fecha, hora } = dateParts(inv.issued_at);
        const [dd, mm, aaaa] = fecha.split('-');
        const rate = Number(inv.bcv_rate) || 0;
        const items = Array.isArray(inv.items) ? inv.items : [];
        const url = opts.verifyUrl || verifyUrl(inv, opts.origin);
        const qr = qrSvg(url);
        const control = String(inv.control_number || '');
        const controlTail = control.includes('-') ? control.split('-').slice(1).join('-') : control;
        const isCredit = /cr[eé]dito/i.test(inv.payment_condition || '');

        const rows = items.map(it => {
            const total = Number(it.total != null ? it.total : it.qty * it.price) || 0;
            return `<tr>
                <td class="ctr">${esc(it.qty)}</td>
                <td>${esc(it.desc)}</td>
                <td class="ctr">G</td>
                <td class="num">Bs ${fmt(it.price * rate)}<span class="ref">$ ${fmt(it.price)}</span></td>
                <td class="num">Bs ${fmt(total * rate)}<span class="ref">$ ${fmt(total)}</span></td>
            </tr>`;
        }).join('') + '<tr><td></td><td></td><td></td><td></td><td></td></tr>'.repeat(Math.max(0, MIN_ROWS - items.length));

        return `<div class="inv-a">
            ${inv.status === 'anulada' ? '<div class="void">ANULADA</div>' : ''}
            <div class="head">
                <div class="co">
                    <img src="${esc(logo)}" alt="Logo Casa Lucenzo">
                    <div>
                        <div class="brand disp">${COMPANY.brand}</div>
                        <div class="razon">${COMPANY.razon}</div>
                        <div class="addr">${COMPANY.addr}<br><b>RIF: ${COMPANY.rif}</b> / Teléfono: ${COMPANY.tel}</div>
                    </div>
                </div>
                <div>
                    <div class="box date lbl">
                        <div><div class="h">Lugar de emisión</div><div class="v">${COMPANY.lugar}</div></div>
                        <div><div class="h">DD</div><div class="v">${dd || ''}</div></div>
                        <div><div class="h">MM</div><div class="v">${mm || ''}</div></div>
                        <div><div class="h">AAAA</div><div class="v">${aaaa || ''}</div></div>
                    </div>
                    <div class="box fac">
                        <div class="t lbl">FACTURA</div>
                        <div class="n"><small>N°</small>${pad5(inv.number)}</div>
                        <div class="hr">Hora de emisión: ${hora}</div>
                    </div>
                </div>
            </div>
            <div class="box cli">
                <div class="r"><b class="lbl">Nombre y apellido o razón social:</b><span>${esc(inv.client_name)}</span></div>
                <div class="r"><b class="lbl">Domicilio fiscal:</b><span>${esc(inv.client_address || '')}</span></div>
                <div class="r three">
                    <div><b class="lbl">RIF / C.I. o Pasaporte</b><span>${esc(inv.client_rif)}</span></div>
                    <div><b class="lbl">Teléfono</b><span>${esc(inv.client_phone || '')}</span></div>
                    <div><b class="lbl">Condiciones de pago</b><span><span class="chk"><i>${isCredit ? '' : '✓'}</i>Contado</span><span class="chk"><i>${isCredit ? '✓' : ''}</i>Crédito ___ días</span></span></div>
                </div>
            </div>
            <div class="box items">
                <table>
                    <thead class="lbl"><tr><th style="width:52px">Cant.</th><th>Concepto o descripción</th><th style="width:34px">(E)</th><th style="width:132px">Precio venta unitario</th><th style="width:142px">Total Bs.</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
            <div class="spacer"></div>
            <div class="box low">
                <div class="ctlbox">
                    <div>
                        <div class="h lbl">Número de control</div>
                        <div class="v">00 — <em>${esc(controlTail)}</em></div>
                    </div>
                    <div class="mid">
                        ${qr ? `<div class="qr">${qr}<div>Verificar factura</div></div>` : ''}
                        <div class="pay">
                            Forma de pago: <b>${esc(inv.payment_method || '—')}</b>${inv.client_email ? ` · ${esc(inv.client_email)}` : ''}<br>
                            Tasa BCV: 1 $ = Bs ${fmt(rate)} · Total ref.: <b>$ ${fmt(inv.total_usd)}</b><br>
                            Precios con IVA 16% incluido. (E) = Exento · G = Alícuota general. En pagos en divisas se causa 3% de IGTF.<br>
                            Verifique en <b>${COMPANY.web}/factura</b> · Código <b>${esc(inv.verify_code || '')}</b>
                        </div>
                    </div>
                    <div class="sin lbl">Esta factura va sin enmendadura ni tachadura</div>
                </div>
                <div class="tt">
                    <div class="r hd"><b></b><span class="lbl">Bs.</span><span class="lbl">USD (ref.)</span></div>
                    <div class="r"><b class="lbl">Exento</b><span>0,00</span><span>0,00</span></div>
                    <div class="r"><b class="lbl">Base imponible</b><span>${fmt(inv.base_bs)}</span><span>${fmt(inv.base_usd)}</span></div>
                    <div class="r"><b class="lbl">I.V.A. 16% sobre Bs. ${fmt(inv.base_bs)}</b><span>${fmt(inv.iva_bs)}</span><span>${fmt(inv.iva_usd)}</span></div>
                    <div class="r"><b class="lbl">IGTF 3%</b><span>0,00</span><span>0,00</span></div>
                    <div class="r grand"><b class="lbl">Total a pagar Bs.</b><span>${fmt(inv.total_bs)}</span><span>${fmt(inv.total_usd)}</span></div>
                </div>
            </div>
            <div class="box imp lbl">
                <div class="t">Impreso por: <i style="font-weight:500">datos de la imprenta autorizada · Resolución SENIAT N° ____ de fecha __/__/____</i></div>
                <div class="g">
                    <div>N° de control</div>
                    <div>Desde: <span>00-________</span></div>
                    <div>Hasta: <span>00-________</span></div>
                    <div>Región Nor-Oriental</div>
                </div>
            </div>
            <div class="orig disp">ORIGINAL</div>
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
