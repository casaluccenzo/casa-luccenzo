// Reporte PDF de ventas de un día (hora Caracas): una hoja de resumen y un
// comprobante por cada cuenta cobrada, con productos, forma de pago e IVA
// desglosado. Lo genera api/cierre-pdf.js al hacer el Cierre de Jornada (y el
// cron de medianoche si ese día nadie cerró), y queda guardado en Storage.
//
// Todo sale de la base, no del dispositivo que cerró: si la caja estaba
// offline o se cerró desde otro equipo, el reporte igual cuadra con lo que
// quedó registrado.
//
// Cómo se leen las ventas (mismo formato que arma la caja en js/app.js):
//   - una fila de `sales` por unidad vendida;
//   - las filas con el mismo `timestamp` son una misma cuenta;
//   - cliente, C.I./RIF y forma de pago van dentro de `name`:
//     "Pollo [Carlos Carbo - V-16254175] (Pagado - Pago Móvil)".

const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const Combos = require('../js/combos.js');

const IVA = 0.16;
const CARACAS_OFFSET_H = 4; // Venezuela es UTC-4 todo el año, sin horario de verano.
// Leído acá (no por ruta dentro de pdfkit) para que Vercel lo incluya en la función.
let LOGO = null;
try { LOGO = fs.readFileSync(path.join(__dirname, '..', 'img', 'logo-factura.png')); } catch (e) { LOGO = null; }

const NAVY = '#0f2a52';
const SOFT = '#5b6377';
const RULE = '#c9d2e3';
const RED = '#c0392b';
const GREEN = '#1e7d4f';

// Secciones del reporte, en este orden. La clave es products.category; lo que
// no tenga categoría conocida (abonos, productos borrados) cae en "otros".
const CATEGORIES = [
    { key: 'pastelitos', label: 'Pastelitos' },
    { key: 'minis', label: 'Minis y tostones' },
    { key: 'empanadas', label: 'Empanadas' },
    { key: 'bebidas', label: 'Bebidas' },
    { key: 'dulces', label: 'Dulces y cajas' },
    { key: 'otros', label: 'Otros' },
    { key: 'delivery', label: 'Delivery (fuera de IVA)' },
    { key: 'personal', label: 'Consumo del personal (al costo)' }
];

// Turnos del local: mañana 6:00 a.m. – 1:00 p.m. y tarde 6:00 p.m. – 9:30 p.m.
// La raya va a las 3:30 p.m., en medio del descanso, así una venta que se cobre
// un poco antes o después de la hora igual cae en su turno.
const SHIFT_SPLIT_MIN = 15 * 60 + 30;
const SHIFTS = {
    manana: { key: 'manana', label: 'Turno mañana', title: 'CORTE DE TURNO · MAÑANA', hours: '6:00 a.m. a 1:00 p.m.' },
    tarde: { key: 'tarde', label: 'Turno tarde', title: 'CORTE DE TURNO · TARDE', hours: '6:00 p.m. a 9:30 p.m.' }
};

// ---------- Fechas (Caracas) ----------

/** "2026-10-29" del día en Caracas para un instante dado. */
function caracasDate(date = new Date()) {
    return new Date(date.getTime() - CARACAS_OFFSET_H * 3600 * 1000).toISOString().slice(0, 10);
}

/** Rango UTC [desde, hasta) que cubre el día de Caracas `dateStr`. */
function dayRangeUtc(dateStr) {
    const from = new Date(`${dateStr}T00:00:00.000Z`);
    from.setUTCHours(CARACAS_OFFSET_H);
    const to = new Date(from.getTime() + 24 * 3600 * 1000);
    return { from: from.toISOString(), to: to.toISOString() };
}

/** 'manana' o 'tarde' según la hora de Caracas del instante (ver SHIFT_SPLIT_MIN). */
function shiftOf(iso) {
    const d = new Date(new Date(iso).getTime() - CARACAS_OFFSET_H * 3600 * 1000);
    return d.getUTCHours() * 60 + d.getUTCMinutes() < SHIFT_SPLIT_MIN ? 'manana' : 'tarde';
}

/** Rango UTC [desde, hasta) de un turno del día de Caracas `dateStr`. */
function shiftRangeUtc(dateStr, shift) {
    const day = dayRangeUtc(dateStr);
    const split = new Date(new Date(day.from).getTime() + SHIFT_SPLIT_MIN * 60 * 1000).toISOString();
    return shift === 'manana' ? { from: day.from, to: split } : { from: split, to: day.to };
}

function caracasTime(iso) {
    const d = new Date(new Date(iso).getTime() - CARACAS_OFFSET_H * 3600 * 1000);
    let h = d.getUTCHours();
    const m = String(d.getUTCMinutes()).padStart(2, '0');
    const ampm = h < 12 ? 'a.m.' : 'p.m.';
    h = h % 12 || 12;
    return `${String(h).padStart(2, '0')}:${m} ${ampm}`;
}

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function longDate(dateStr) {
    const d = new Date(`${dateStr}T12:00:00Z`);
    return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
}

function shortDate(dateStr) {
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
}

// ---------- Formato ----------

function bs(x) {
    const s = Math.abs(x).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, 'X');
    return (x < 0 ? '-' : '') + 'Bs ' + s.replace('.', ',').replace(/X/g, '.');
}

function usd(x) {
    return (x < 0 ? '-$' : '$') + Math.abs(x).toFixed(2);
}

const round2 = x => Math.round((x + Number.EPSILON) * 100) / 100;

// ---------- Datos ----------

/** Separa "Pollo [Ana - V-1] (Pagado - Punto)" en sus partes. */
function parseSaleName(name) {
    const raw = String(name || 'Producto');
    const bracket = raw.match(/\[(.*?)\]/);
    const paid = raw.match(/\(Pagado(?: - (.*?))?\)/);
    let client = '';
    let rif = '';
    if (bracket) {
        const tag = bracket[1].trim();
        const parts = tag.split(/\s+-\s+/);
        client = parts[0].trim();
        rif = parts.length > 1 ? parts.slice(1).join(' - ').trim() : '';
    }
    const product = raw
        .replace(/\s*\[.*?\]/g, '')
        .replace(/\s*\((?:Pagado|Punto|Pago|Efectivo|Biopago).*?\)/gi, '')
        .trim() || 'Producto';
    return { product, client, rif, paid: !!paid, method: paid ? (paid[1] || 'Sin especificar').trim() : null };
}

/**
 * Agrupa las filas de `sales` en cuentas y saca los totales del día.
 * @param {object} data { date, sales, expenses, invoices, logins, bcvRate }
 */
function buildReport(data) {
    const sales = (data.sales || []).slice().sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
    const invoices = data.invoices || [];
    const categoryOf = data.productCategories || {};
    const byTs = new Map();

    for (const s of sales) {
        const key = new Date(s.timestamp).getTime();
        const info = parseSaleName(s.name);
        const rate = parseFloat(s.bcv_rate) || parseFloat(data.bcvRate) || 0;
        const price = parseFloat(s.price) || 0;
        if (!byTs.has(key)) {
            byTs.set(key, {
                timestamp: s.timestamp, time: caracasTime(s.timestamp), rate,
                client: '', rif: '', method: null, paid: false,
                staff: false, abono: false, items: new Map()
            });
        }
        const acc = byTs.get(key);
        if (info.client && !acc.client) acc.client = info.client;
        if (info.rif && !acc.rif) acc.rif = info.rif;
        if (info.paid) { acc.paid = true; acc.method = acc.method || info.method; }
        if (Combos.isStaffSale(s)) acc.staff = true;
        if (s.product_id === 'abono') acc.abono = true;
        if (!acc.rate && rate) acc.rate = rate;

        const unitBs = round2(price * (rate || acc.rate));
        const itemKey = `${info.product}|${price.toFixed(6)}`;
        const known = CATEGORIES.some(c => c.key === categoryOf[s.product_id]);
        const category = Combos.isDeliverySale(s) ? 'delivery'
            : Combos.isStaffSale(s) ? 'personal' : (known ? categoryOf[s.product_id] : 'otros');
        if (!acc.items.has(itemKey)) acc.items.set(itemKey, { name: info.product, category, qty: 0, unitUsd: price, unitBs, totalUsd: 0, totalBs: 0 });
        const it = acc.items.get(itemKey);
        it.qty += 1;
        it.totalUsd += price;
        it.totalBs = round2(it.totalBs + unitBs);
    }

    const accounts = [];
    let n = 0;
    for (const acc of byTs.values()) {
        n += 1;
        const items = Array.from(acc.items.values()).sort((a, b) => a.name.localeCompare(b.name, 'es'));
        const totalUsd = items.reduce((t, i) => t + i.totalUsd, 0);
        const totalBs = round2(items.reduce((t, i) => t + i.totalBs, 0));
        // El delivery va fuera de IVA (ver Combos.DELIVERY): no entra en la base.
        const deliveryItems = items.filter(i => i.category === 'delivery');
        const deliveryBs = round2(deliveryItems.reduce((t, i) => t + i.totalBs, 0));
        const deliveryUsd = deliveryItems.reduce((t, i) => t + i.totalUsd, 0);
        const taxedBs = round2(totalBs - deliveryBs);
        // El consumo del personal se cobra al costo, sin IVA (ver Combos.STAFF).
        const base = acc.staff ? taxedBs : round2(taxedBs / (1 + IVA));
        const ts = new Date(acc.timestamp).getTime();
        const inv = invoices
            .filter(i => Math.abs(new Date(i.sale_timestamp).getTime() - ts) < 1000)
            .sort((a, b) => (a.status === 'emitida' ? -1 : 1) - (b.status === 'emitida' ? -1 : 1))[0] || null;
        accounts.push({
            n, timestamp: acc.timestamp, time: acc.time, rate: acc.rate,
            client: acc.client || (acc.abono ? 'Abono de deuda' : `Cliente ${n}`),
            rif: acc.rif, method: acc.method || 'Sin cobrar', paid: acc.paid,
            staff: acc.staff, abono: acc.abono, items, totalUsd, totalBs,
            baseBs: base, ivaBs: round2(taxedBs - base), deliveryBs, deliveryUsd,
            units: items.filter(i => i.category !== 'delivery').reduce((u, i) => u + i.qty, 0),
            invoice: inv ? { number: inv.number, status: inv.status } : null
        });
    }

    const sum = (list, f) => round2(list.reduce((t, a) => t + f(a), 0));
    const publicAccounts = accounts.filter(a => !a.staff);
    const methods = {};
    for (const a of accounts) {
        const k = a.paid ? a.method : 'Sin cobrar';
        methods[k] = methods[k] || { count: 0, totalBs: 0, totalUsd: 0 };
        methods[k].count += 1;
        methods[k].totalBs = round2(methods[k].totalBs + a.totalBs);
        methods[k].totalUsd += a.totalUsd;
    }

    // Ventas por categoría, cada una con sus productos y su total en $ y Bs.
    // Bs = $ x la tasa BCV con la que se cobró cada venta (sales.bcv_rate).
    const byCat = new Map(CATEGORIES.map(c => [c.key, { ...c, qty: 0, totalUsd: 0, totalBs: 0, items: new Map() }]));
    for (const a of accounts) {
        for (const it of a.items) {
            const cat = byCat.get(it.category);
            const p = cat.items.get(it.name) || { name: it.name, qty: 0, totalUsd: 0, totalBs: 0 };
            p.qty += it.qty;
            p.totalUsd += it.totalUsd;
            p.totalBs = round2(p.totalBs + it.totalBs);
            cat.items.set(it.name, p);
            cat.qty += it.qty;
            cat.totalUsd += it.totalUsd;
            cat.totalBs = round2(cat.totalBs + it.totalBs);
        }
    }
    const categories = Array.from(byCat.values())
        .filter(c => c.qty > 0)
        .map(c => ({ ...c, items: Array.from(c.items.values()).sort((x, y) => y.qty - x.qty || x.name.localeCompare(y.name, 'es')) }));
    const rates = Array.from(new Set(accounts.map(a => a.rate).filter(Boolean)));

    const dayRate = parseFloat(data.bcvRate) || (accounts.find(a => a.rate) || {}).rate || 0;
    const expenses = (data.expenses || []).map(e => {
        const amount = parseFloat(e.amount) || 0;
        const ves = String(e.currency || 'USD').toUpperCase() === 'VES';
        const rate = parseFloat(e.bcv_rate) || dayRate;
        return {
            description: e.description || 'Gasto',
            time: caracasTime(e.timestamp),
            shift: shiftOf(e.timestamp),
            amountBs: round2(ves ? amount : amount * rate),
            amountUsd: ves ? (rate ? amount / rate : 0) : amount
        };
    });

    const users = [];
    for (const l of data.logins || []) {
        const label = `${l.actor_name || l.role}${l.role ? ` (${l.role === 'admin' ? 'administrador' : 'caja'})` : ''}`;
        if (!users.includes(label)) users.push(label);
    }

    const totalBs = sum(accounts, a => a.totalBs);
    const expensesBs = round2(expenses.reduce((t, e) => t + e.amountBs, 0));

    // Lo vendido en cada turno, para la tabla "Ventas por turno" del cierre.
    const shifts = Object.values(SHIFTS).map(sh => {
        const accs = accounts.filter(a => shiftOf(a.timestamp) === sh.key);
        const exp = round2(expenses.filter(e => e.shift === sh.key).reduce((t, e) => t + e.amountBs, 0));
        const tBs = sum(accs, a => a.totalBs);
        return {
            key: sh.key, label: sh.label, hours: sh.hours,
            count: accs.length,
            units: accs.reduce((t, a) => t + a.units, 0),
            totalUsd: accs.reduce((t, a) => t + a.totalUsd, 0),
            totalBs: tBs, expensesBs: exp, netBs: round2(tBs - exp)
        };
    });

    return {
        date: data.date,
        shift: SHIFTS[data.shift] ? data.shift : null,
        shifts,
        generatedAt: data.generatedAt || new Date().toISOString(),
        trigger: data.trigger || 'cierre',
        rate: dayRate,
        accounts,
        totals: {
            count: accounts.length,
            units: accounts.reduce((t, a) => t + a.units, 0),
            totalUsd: accounts.reduce((t, a) => t + a.totalUsd, 0),
            totalBs,
            publicBs: sum(publicAccounts, a => a.totalBs),
            staffBs: sum(accounts.filter(a => a.staff), a => a.totalBs),
            deliveryBs: sum(accounts, a => a.deliveryBs),
            deliveryUsd: accounts.reduce((t, a) => t + a.deliveryUsd, 0),
            deliveryCount: accounts.filter(a => a.deliveryBs > 0).length,
            baseBs: sum(accounts, a => a.baseBs),
            ivaBs: sum(accounts, a => a.ivaBs),
            expensesBs,
            netBs: round2(totalBs - expensesBs),
            invoicesIssued: accounts.filter(a => a.invoice && a.invoice.status === 'emitida').length
        },
        methods,
        categories,
        rates,
        expenses,
        users,
        invoicesAnnulled: invoices.filter(i => i.status === 'anulada').map(i => i.number)
    };
}

// ---------- PDF ----------

const PAGE = { size: 'LETTER', margin: 50 };
const W = 612;
const H = 792;
const L = 50;
const R = W - 50;

function header(doc, title, subtitle, right) {
    if (LOGO) doc.image(LOGO, L, 40, { width: 64, height: 64 });
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(17).text('CASA LUCENZO', L + 76, 46, { lineBreak: false });
    doc.fillColor(SOFT).font('Helvetica').fontSize(8.5);
    doc.text('EMPRENDIMIENTO KAIRA BLANCO · RIF J-50818313-4', L + 76, 66, { lineBreak: false });
    doc.text('Av. Winston Churchill, El Tigre, Anzoátegui', L + 76, 77, { lineBreak: false });
    doc.text('Tel. (0412) 083.9311 · casalucenzo.com', L + 76, 88, { lineBreak: false });
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(12).text(title, L, 46, { width: R - L, align: 'right' });
    doc.fillColor(SOFT).font('Helvetica').fontSize(8.5);
    let y = 64;
    for (const line of [subtitle, ...(right || [])].filter(Boolean)) {
        if (typeof line === 'object') {
            doc.fillColor(line.color || SOFT).font(line.bold ? 'Helvetica-Bold' : 'Helvetica');
            doc.text(line.text, L, y, { width: R - L, align: 'right' });
            doc.fillColor(SOFT).font('Helvetica');
        } else {
            doc.text(line, L, y, { width: R - L, align: 'right' });
        }
        y += 11;
    }
    doc.strokeColor(RULE).lineWidth(0.8).moveTo(L, 118).lineTo(R, 118).stroke();
    return 132;
}

function tableHead(doc, y, cols) {
    doc.rect(L, y - 4, R - L, 17).fill(NAVY);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8.5);
    for (const c of cols) {
        doc.text(c.t, c.x, y, { width: c.w, align: c.align || 'left', lineBreak: false });
    }
    return y + 19;
}

function row(doc, y, cols, opts = {}) {
    doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.size || 9.5);
    for (const c of cols) {
        doc.fillColor(c.color || '#000000');
        doc.text(c.t, c.x, y, { width: c.w, align: c.align || 'left', lineBreak: false, ellipsis: true });
    }
    if (!opts.noRule) doc.strokeColor(RULE).lineWidth(0.5).moveTo(L, y + 12).lineTo(R, y + 12).stroke();
    return y + 17;
}

function footer(doc, text) {
    // Va debajo del margen inferior: sin bajar el margen, pdfkit abre otra página.
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.fillColor(SOFT).font('Helvetica-Oblique').fontSize(7.5);
    doc.text(text, L, H - 42, { width: R - L, align: 'center', lineBreak: false });
    doc.page.margins.bottom = bottom;
}

function summaryPages(doc, rep) {
    const generated = new Date(rep.generatedAt);
    const genLabel = `${shortDate(caracasDate(generated))} ${caracasTime(rep.generatedAt)}`;
    const how = rep.shift ? 'corte de turno' : rep.trigger === 'cron' ? 'automático de medianoche' : rep.trigger === 'manual' ? 'regenerado a mano' : 'al cierre';
    const sh = rep.shift ? SHIFTS[rep.shift] : null;
    // "del día" o "del turno" en los títulos y totales.
    const del = sh ? 'del turno' : 'del día';
    let y = header(doc, sh ? sh.title : 'REPORTE DIARIO DE VENTAS', longDate(rep.date), [
        sh ? `${sh.label}: ${sh.hours}` : null,
        `Tasa BCV: ${rep.rate ? bs(rep.rate) + ' / $' : '—'}`,
        `Generado ${genLabel} · ${how}`
    ]);

    // Tarjetas de totales
    const cards = [
        { label: 'VENDIDO (con IVA)', val: bs(rep.totals.totalBs), sub: usd(rep.totals.totalUsd), color: GREEN },
        { label: 'IVA 16% INCLUIDO', val: bs(rep.totals.ivaBs), sub: `Base ${bs(rep.totals.baseBs)}`, color: NAVY },
        { label: 'GASTOS DEL LOCAL', val: bs(rep.totals.expensesBs), sub: `${rep.expenses.length} registrados`, color: RED },
        { label: 'CUENTAS', val: String(rep.totals.count), sub: `${rep.totals.units} productos`, color: NAVY }
    ];
    const cw = (R - L - 18) / 4;
    cards.forEach((c, i) => {
        const x = L + i * (cw + 6);
        doc.roundedRect(x, y, cw, 54, 5).lineWidth(1).strokeColor(c.color).stroke();
        doc.fillColor(c.color).font('Helvetica-Bold').fontSize(7).text(c.label, x + 8, y + 8, { width: cw - 16, lineBreak: false });
        doc.fontSize(12.5).text(c.val, x + 8, y + 21, { width: cw - 16, lineBreak: false });
        doc.fillColor(SOFT).font('Helvetica').fontSize(7.5).text(c.sub, x + 8, y + 39, { width: cw - 16, lineBreak: false });
    });
    y += 72;

    // Ventas por turno: solo en el reporte del día completo.
    if (!sh && rep.shifts && rep.totals.count) {
        doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(11).text('Ventas por turno', L, y); y += 18;
        y = tableHead(doc, y, [
            { t: 'TURNO', x: L + 8, w: 205 }, { t: 'CUENTAS', x: 262, w: 44, align: 'right' },
            { t: 'GASTOS Bs', x: 308, w: 74, align: 'right' },
            { t: 'TOTAL $', x: 384, w: 56, align: 'right' }, { t: 'TOTAL Bs', x: 450, w: R - 458, align: 'right' }
        ]);
        for (const s of rep.shifts) {
            y = row(doc, y, [
                { t: `${s.label} (${s.hours})`, x: L + 8, w: 205 }, { t: String(s.count), x: 262, w: 44, align: 'right' },
                { t: s.expensesBs ? bs(s.expensesBs) : '—', x: 308, w: 74, align: 'right', color: s.expensesBs ? RED : SOFT },
                { t: usd(s.totalUsd), x: 384, w: 56, align: 'right' }, { t: bs(s.totalBs), x: 450, w: R - 458, align: 'right' }
            ]);
        }
        y = row(doc, y, [
            { t: 'TOTAL DEL DÍA (los dos turnos)', x: L + 8, w: 205 }, { t: String(rep.totals.count), x: 262, w: 44, align: 'right' },
            { t: rep.totals.expensesBs ? bs(rep.totals.expensesBs) : '—', x: 308, w: 74, align: 'right' },
            { t: usd(rep.totals.totalUsd), x: 384, w: 56, align: 'right' }, { t: bs(rep.totals.totalBs), x: 450, w: R - 458, align: 'right' }
        ], { bold: true, noRule: true });
        y += 12;
    }

    // Ventas por categoría (resumen)
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(11).text('Ventas por categoría', L, y); y += 18;
    y = tableHead(doc, y, [
        { t: 'CATEGORÍA', x: L + 8, w: 200 }, { t: 'UNIDADES', x: 280, w: 60, align: 'right' },
        { t: 'TOTAL $', x: 360, w: 80, align: 'right' }, { t: 'TOTAL Bs', x: 450, w: R - 458, align: 'right' }
    ]);
    if (!rep.categories.length) y = row(doc, y, [{ t: sh ? 'Sin ventas en este turno.' : 'Sin ventas este día.', x: L + 8, w: 300, color: SOFT }]);
    for (const c of rep.categories) {
        y = row(doc, y, [
            { t: c.label, x: L + 8, w: 200 }, { t: String(c.qty), x: 280, w: 60, align: 'right' },
            { t: usd(c.totalUsd), x: 360, w: 80, align: 'right' }, { t: bs(c.totalBs), x: 450, w: R - 458, align: 'right' }
        ]);
    }
    y = row(doc, y, [
        { t: `TOTAL ${del.toUpperCase()}`, x: L + 8, w: 200 }, { t: String(rep.categories.reduce((t, c) => t + c.qty, 0)), x: 280, w: 60, align: 'right' },
        { t: usd(rep.totals.totalUsd), x: 360, w: 80, align: 'right' }, { t: bs(rep.totals.totalBs), x: 450, w: R - 458, align: 'right' }
    ], { bold: true, noRule: true });
    doc.fillColor(SOFT).font('Helvetica').fontSize(8)
        .text(`Bs calculados con la tasa BCV con que se cobró cada venta: ${rep.rates.length ? rep.rates.map(r => bs(r) + ' / $').join(', ') : '—'}.`, L, y);
    y += 22;

    // Formas de pago
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(11).text('Formas de pago', L, y); y += 18;
    y = tableHead(doc, y, [
        { t: 'FORMA DE PAGO', x: L + 8, w: 200 }, { t: 'CUENTAS', x: 280, w: 60, align: 'right' },
        { t: 'TOTAL $', x: 360, w: 80, align: 'right' }, { t: 'TOTAL Bs', x: 450, w: R - 458, align: 'right' }
    ]);
    const methods = Object.entries(rep.methods).sort((a, b) => b[1].totalBs - a[1].totalBs);
    if (!methods.length) y = row(doc, y, [{ t: 'Sin ventas este día.', x: L + 8, w: 300, color: SOFT }]);
    for (const [k, m] of methods) {
        y = row(doc, y, [
            { t: k, x: L + 8, w: 200, color: k === 'Sin cobrar' ? RED : '#000000' }, { t: String(m.count), x: 280, w: 60, align: 'right' },
            { t: usd(m.totalUsd), x: 360, w: 80, align: 'right' }, { t: bs(m.totalBs), x: 450, w: R - 458, align: 'right' }
        ]);
    }
    y += 12;

    // Cuentas del día
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(11).text(`Cuentas ${del}`, L, y); y += 18;
    const accHead = [
        { t: 'N°', x: L + 6, w: 22 }, { t: 'HORA', x: 80, w: 60 }, { t: 'CLIENTE', x: 140, w: 140 },
        { t: 'PAGO', x: 282, w: 92 }, { t: 'FACTURA', x: 376, w: 62 },
        { t: 'TOTAL $', x: 438, w: 50, align: 'right' }, { t: 'TOTAL Bs', x: 490, w: R - 494, align: 'right' }
    ];
    y = tableHead(doc, y, accHead);
    for (const a of rep.accounts) {
        if (y > H - 90) {
            footer(doc, 'Continúa en la página siguiente');
            doc.addPage(PAGE);
            y = tableHead(doc, 60, accHead);
        }
        const fact = a.invoice ? (a.invoice.status === 'emitida' ? `N° ${a.invoice.number}` : `${a.invoice.number} anulada`) : 'No emitida';
        y = row(doc, y, [
            { t: String(a.n).padStart(2, '0'), x: L + 6, w: 22 }, { t: a.time, x: 80, w: 60 },
            { t: a.client + (a.staff ? ' (personal)' : ''), x: 140, w: 140 },
            { t: a.method, x: 282, w: 92, color: a.paid ? '#000000' : RED },
            { t: fact, x: 376, w: 62, color: a.invoice && a.invoice.status === 'emitida' ? GREEN : SOFT },
            { t: usd(a.totalUsd), x: 438, w: 50, align: 'right' }, { t: bs(a.totalBs), x: 490, w: R - 494, align: 'right' }
        ], { size: 8.5 });
    }
    y = row(doc, y, [
        { t: `TOTAL (${rep.totals.count} cuentas)`, x: 140, w: 200 },
        { t: usd(rep.totals.totalUsd), x: 438, w: 50, align: 'right' }, { t: bs(rep.totals.totalBs), x: 490, w: R - 494, align: 'right' }
    ], { bold: true, size: 9, noRule: true });
    y += 14;

    // Detalle por categoría: cada una en su bloque, con su total.
    const newPage = () => { footer(doc, 'Continúa en la página siguiente'); doc.addPage(PAGE); return 60; };
    if (y > H - 160) y = newPage();
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(11).text('Detalle por categoría', L, y); y += 18;
    const catHead = [
        { t: 'PRODUCTO', x: L + 8, w: 250 }, { t: 'CANT.', x: 300, w: 50, align: 'right' },
        { t: 'TOTAL $', x: 360, w: 80, align: 'right' }, { t: 'TOTAL Bs', x: 450, w: R - 458, align: 'right' }
    ];
    for (const c of rep.categories) {
        if (y > H - 130) y = newPage();
        doc.rect(L, y - 4, R - L, 19).fill('#e8edf6');
        doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(10).text(c.label.toUpperCase(), L + 8, y, { lineBreak: false });
        y += 22;
        y = tableHead(doc, y, catHead);
        for (const p of c.items) {
            if (y > H - 90) { y = newPage(); y = tableHead(doc, y, catHead); }
            y = row(doc, y, [
                { t: p.name, x: L + 8, w: 250 }, { t: String(p.qty), x: 300, w: 50, align: 'right' },
                { t: usd(p.totalUsd), x: 360, w: 80, align: 'right' }, { t: bs(p.totalBs), x: 450, w: R - 458, align: 'right' }
            ], { size: 9 });
        }
        y = row(doc, y, [
            { t: `Total ${c.label.toLowerCase().replace("iva", "IVA")}`, x: L + 8, w: 250 }, { t: String(c.qty), x: 300, w: 50, align: 'right' },
            { t: usd(c.totalUsd), x: 360, w: 80, align: 'right' }, { t: bs(c.totalBs), x: 450, w: R - 458, align: 'right' }
        ], { bold: true, size: 9.5, noRule: true });
        y += 12;
    }
    y += 4;

    // Gastos
    if (rep.expenses.length) {
        if (y > H - 140) { footer(doc, 'Continúa en la página siguiente'); doc.addPage(PAGE); y = 60; }
        doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(11).text('Gastos del local', L, y); y += 18;
        y = tableHead(doc, y, [{ t: 'HORA', x: L + 8, w: 60 }, { t: 'DESCRIPCIÓN', x: 120, w: 260 }, { t: 'MONTO $', x: 380, w: 60, align: 'right' }, { t: 'MONTO Bs', x: 450, w: R - 458, align: 'right' }]);
        for (const e of rep.expenses) {
            if (y > H - 90) { footer(doc, 'Continúa en la página siguiente'); doc.addPage(PAGE); y = 60; }
            y = row(doc, y, [{ t: e.time, x: L + 8, w: 60 }, { t: e.description, x: 120, w: 260 }, { t: usd(e.amountUsd), x: 380, w: 60, align: 'right' }, { t: bs(e.amountBs), x: 450, w: R - 458, align: 'right' }], { size: 9 });
        }
        y += 14;
    }

    // Notas
    if (y > H - 130) { footer(doc, 'Continúa en la página siguiente'); doc.addPage(PAGE); y = 60; }
    const notes = [
        `Caja neta ${del} (vendido menos gastos): ${bs(rep.totals.netBs)}.`,
        sh ? `Corte de turno: no cierra la jornada ni toca la vitrina. El reporte del Cierre de Jornada trae los dos turnos y el total del día.` : null,
        `Facturas talonario emitidas: ${rep.totals.invoicesIssued}` + (rep.invoicesAnnulled.length ? ` · anuladas: ${rep.invoicesAnnulled.join(', ')}.` : '.'),
        rep.totals.deliveryBs ? `Delivery cobrado (${rep.totals.deliveryCount} ${rep.totals.deliveryCount === 1 ? 'envío' : 'envíos'}): ${bs(rep.totals.deliveryBs)} (${usd(rep.totals.deliveryUsd)}), incluido en el total; fuera de IVA y de la factura talonario (es del motorizado).` : null,
        rep.totals.staffBs ? `Consumo del personal (al costo, sin IVA): ${bs(rep.totals.staffBs)}, incluido en el total.` : null,
        sh ? null : `Usuarios que entraron al POS este día: ${rep.users.length ? rep.users.join(', ') : 'sin registro'}.`,
        'Solo se muestran las ventas que quedaron cobradas o abiertas; las deshechas o anuladas no aparecen.'
    ].filter(Boolean);
    doc.fillColor(NAVY).font('Helvetica').fontSize(9);
    for (const n of notes) { doc.text('• ' + n, L, y, { width: R - L }); y = doc.y + 4; }
    footer(doc, 'Reporte interno generado automáticamente por el sistema Casa Lucenzo. Precios con IVA 16% incluido.');
}

function receiptPage(doc, rep, a) {
    const right = [
        `Fecha: ${shortDate(rep.date)} · Hora: ${a.time}`,
        a.invoice && a.invoice.status === 'emitida'
            ? { text: `FACTURA TALONARIO N° ${a.invoice.number}`, color: GREEN, bold: true }
            : { text: 'SIN FACTURA TALONARIO EMITIDA (no fiscal)', color: RED, bold: true }
    ];
    let y = header(doc, `COMPROBANTE DE VENTA N° ${String(a.n).padStart(2, '0')}`, null, right);

    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(10).text('Cliente:', L, y, { lineBreak: false });
    doc.font('Helvetica').text(a.client, L + 50, y, { width: 210, lineBreak: false, ellipsis: true });
    doc.font('Helvetica-Bold').text('C.I./RIF:', 320, y, { lineBreak: false });
    doc.font('Helvetica').text(a.rif || '—', 375, y, { lineBreak: false });
    y += 16;
    doc.font('Helvetica-Bold').text('Pago:', L, y, { lineBreak: false });
    doc.font('Helvetica').fillColor(a.paid ? NAVY : RED).text(a.paid ? `${a.method} (pagado)` : 'Sin cobrar', L + 50, y, { lineBreak: false });
    doc.fillColor(NAVY).font('Helvetica-Bold').text('Tasa BCV:', 320, y, { lineBreak: false });
    doc.font('Helvetica').text(a.rate ? bs(a.rate) + ' / $' : '—', 375, y, { lineBreak: false });
    y += 26;

    const head = [
        { t: 'CANT', x: L + 8, w: 34 }, { t: 'DESCRIPCIÓN', x: 96, w: 210 },
        { t: 'P. UNIT $', x: 310, w: 60, align: 'right' }, { t: 'P. UNIT Bs', x: 375, w: 75, align: 'right' },
        { t: 'TOTAL Bs', x: 455, w: R - 463, align: 'right' }
    ];
    y = tableHead(doc, y, head);
    for (const it of a.items) {
        if (y > H - 170) { footer(doc, 'Continúa en la página siguiente'); doc.addPage(PAGE); y = tableHead(doc, 60, head); }
        y = row(doc, y, [
            { t: String(it.qty), x: L + 14, w: 30 }, { t: it.name, x: 96, w: 210 },
            { t: usd(it.unitUsd), x: 310, w: 60, align: 'right' }, { t: bs(it.unitBs), x: 375, w: 75, align: 'right' },
            { t: bs(it.totalBs), x: 455, w: R - 463, align: 'right' }
        ]);
    }

    y += 10;
    const x1 = 350;
    doc.fillColor(NAVY).font('Helvetica').fontSize(10);
    const lines = a.staff
        ? [['Consumo del personal', 'al costo, sin IVA']]
        : [['Base imponible', bs(a.baseBs)], ['IVA 16% (incluido)', bs(a.ivaBs)]];
    if (a.deliveryBs) lines.push(['Delivery (fuera de IVA)', bs(a.deliveryBs)]);
    for (const [k, v] of lines) {
        doc.text(k, x1, y, { lineBreak: false }); doc.text(v, x1, y, { width: R - 8 - x1, align: 'right' }); y += 15;
    }
    doc.strokeColor(NAVY).lineWidth(0.8).moveTo(x1, y).lineTo(R - 8, y).stroke(); y += 6;
    doc.font('Helvetica-Bold').fontSize(12).text('TOTAL', x1, y, { lineBreak: false });
    doc.text(bs(a.totalBs), x1, y, { width: R - 8 - x1, align: 'right' }); y += 18;
    doc.fillColor(SOFT).font('Helvetica').fontSize(9).text('Referencia en dólares', x1, y, { lineBreak: false });
    doc.text(usd(a.totalUsd), x1, y, { width: R - 8 - x1, align: 'right' });

    footer(doc, 'Precios con IVA 16% incluido. Comprobante interno del registro de ventas del POS; no sustituye la factura talonario.');
}

/** Devuelve el PDF del reporte como Buffer. */
function renderPdf(rep) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ ...PAGE, autoFirstPage: true, info: { Title: `Ventas ${rep.date} - Casa Lucenzo`, Author: 'Casa Lucenzo' } });
        const chunks = [];
        doc.on('data', c => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        summaryPages(doc, rep);
        for (const a of rep.accounts) {
            doc.addPage(PAGE);
            receiptPage(doc, rep, a);
        }
        doc.end();
    });
}

module.exports = { PDF_STYLE: { PAGE, W, H, L, R, NAVY, SOFT, RULE, RED, GREEN, header, tableHead, row, footer, shortDate, caracasTime, caracasDate }, SHIFTS, shiftOf, shiftRangeUtc, caracasDate, dayRangeUtc, caracasTime, parseSaleName, buildReport, renderPdf, bs };
