// PDF de la pestaña Rentabilidad (ventas, costo y ganancia en Bs por categoría y
// por día, más el reparto). Usa el mismo estilo del reporte del cierre
// (lib/day-report.js). Los números llegan YA calculados desde el teléfono, que es
// quien tiene el reparto guardado; acá solo se dibujan. No lee ni escribe la base.

const PDFDocument = require('pdfkit');
const { PDF_STYLE: S } = require('./day-report');
const { PAGE, H, L, R, NAVY, SOFT, RED, GREEN } = S;

const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
const txt = (v, max = 60) => String(v == null ? '' : v).replace(/\s+/g, ' ').slice(0, max);
const bs = x => {
    const v = num(x);
    const s = Math.abs(v).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (v < 0 ? '-' : '') + 'Bs ' + s;
};
const usd = x => (num(x) < 0 ? '-$' : '$') + Math.abs(num(x)).toFixed(2);
const pct = x => num(x).toFixed(1).replace('.', ',') + '%';
const BOTTOM = H - 70;

/** Deja solo lo que el PDF necesita, con tipos y largos seguros. */
function normalize(d = {}) {
    const t = d.totals || {};
    return {
        label: txt(d.label, 60) || 'Período',
        mode: txt(d.mode, 20),
        rate: num(d.rate),
        totals: {
            ventasBs: num(t.ventasBs), ventasUsd: num(t.ventasUsd), costoBs: num(t.costoBs), costoUsd: num(t.costoUsd),
            gananciaBs: num(t.gananciaBs), gananciaUsd: num(t.gananciaUsd), margenPct: num(t.margenPct),
            gastosBs: num(t.gastosBs), baseNetaBs: num(t.baseNetaBs), unidades: num(t.unidades)
        },
        categorias: (Array.isArray(d.categorias) ? d.categorias : []).slice(0, 20).map(c => ({
            label: txt(c.label), unidades: num(c.unidades), ventasBs: num(c.ventasBs), costoBs: num(c.costoBs),
            gananciaBs: num(c.gananciaBs), margenPct: num(c.margenPct),
            productos: (Array.isArray(c.productos) ? c.productos : []).slice(0, 80).map(p => ({
                name: txt(p.name, 40), unidades: num(p.unidades), ventasBs: num(p.ventasBs),
                costoBs: num(p.costoBs), gananciaBs: num(p.gananciaBs)
            }))
        })),
        dias: (Array.isArray(d.dias) ? d.dias : []).slice(0, 400).map(x => ({
            fecha: /^\d{4}-\d{2}-\d{2}$/.test(x.fecha) ? x.fecha : '',
            ventasBs: num(x.ventasBs), costoBs: num(x.costoBs), gananciaBs: num(x.gananciaBs)
        })),
        reparto: {
            baseBs: num(d.reparto && d.reparto.baseBs),
            filas: (d.reparto && Array.isArray(d.reparto.filas) ? d.reparto.filas : []).slice(0, 30).map(f => ({
                nombre: txt(f.nombre, 30), pct: num(f.pct), bs: num(f.bs)
            })),
            quedaPct: num(d.reparto && d.reparto.quedaPct),
            quedaBs: num(d.reparto && d.reparto.quedaBs)
        },
        excluidas: { unidades: num(d.excluidas && d.excluidas.unidades), ventasBs: num(d.excluidas && d.excluidas.ventasBs) },
        delivery: { count: num(d.delivery && d.delivery.count), bs: num(d.delivery && d.delivery.bs) }
    };
}

function dayLabel(fecha) {
    if (!fecha) return '—';
    const dt = new Date(fecha + 'T12:00:00Z');
    const dias = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
    return `${dias[dt.getUTCDay()]} ${S.shortDate(fecha)}`;
}

function renderRentPdf(input, now = new Date()) {
    const r = normalize(input);
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ ...PAGE, autoFirstPage: true, info: { Title: `Rentabilidad ${r.label} - Casa Lucenzo`, Author: 'Casa Lucenzo' } });
        const chunks = [];
        doc.on('data', c => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const gen = `${S.shortDate(S.caracasDate(now))} ${S.caracasTime(now.toISOString())}`;
        let page = 1;
        const newPage = () => {
            S.footer(doc, `Rentabilidad · ${r.label} · página ${page}`);
            doc.addPage(PAGE); page += 1;
            return S.header(doc, 'RENTABILIDAD', r.label, [`Generado ${gen}`]);
        };
        const need = (y, h) => (y + h > BOTTOM ? newPage() : y);
        const title = (y, t) => {
            y = need(y, 60);
            doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(11).text(t, L, y, { lineBreak: false });
            return y + 18;
        };

        let y = S.header(doc, 'RENTABILIDAD', r.label, [
            r.rate ? `Montos en Bs con la tasa de cada venta` : null, `Generado ${gen}`
        ]);

        // Tarjetas
        const t = r.totals;
        const cards = [
            { label: 'VENTAS', val: bs(t.ventasBs), sub: `${usd(t.ventasUsd)} · ${t.unidades} u`, color: NAVY },
            { label: 'COSTO PROVEEDORES', val: bs(t.costoBs), sub: usd(t.costoUsd), color: RED },
            { label: 'GANANCIA', val: bs(t.gananciaBs), sub: usd(t.gananciaUsd), color: t.gananciaBs < 0 ? RED : GREEN },
            { label: 'MARGEN', val: pct(t.margenPct), sub: 'de lo vendido', color: NAVY }
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

        // Por categoría
        y = title(y, 'Por categoría');
        const cc = [
            { t: 'CATEGORÍA', x: L + 8, w: 150 }, { t: 'UNID.', x: 210, w: 40, align: 'right' },
            { t: 'VENTAS', x: 255, w: 78, align: 'right' }, { t: 'COSTO', x: 338, w: 72, align: 'right' },
            { t: 'GANANCIA', x: 415, w: 70, align: 'right' }, { t: 'MARGEN', x: 490, w: R - 498, align: 'right' }
        ];
        y = S.tableHead(doc, y, cc);
        const line = (yy, c, bold) => S.row(doc, yy, [
            { t: c.label, x: L + 8, w: 150 }, { t: String(c.unidades), x: 210, w: 40, align: 'right' },
            { t: bs(c.ventasBs), x: 255, w: 78, align: 'right' }, { t: c.costoBs ? '-' + bs(c.costoBs) : '—', x: 338, w: 72, align: 'right', color: RED },
            { t: bs(c.gananciaBs), x: 415, w: 70, align: 'right', color: c.gananciaBs < 0 ? RED : GREEN },
            { t: pct(c.margenPct), x: 490, w: R - 498, align: 'right' }
        ], { bold });
        for (const c of r.categorias) { y = need(y, 20); y = line(y, c, false); }
        y = need(y, 20);
        y = line(y, { label: 'TOTAL', unidades: t.unidades, ventasBs: t.ventasBs, costoBs: t.costoBs, gananciaBs: t.gananciaBs, margenPct: t.margenPct }, true);
        y += 6;

        // Gastos y base neta
        if (t.gastosBs > 0) {
            y = need(y, 70);
            y = S.row(doc, y, [{ t: 'Ganancia', x: L + 8, w: 300 }, { t: bs(t.gananciaBs), x: 350, w: R - 358, align: 'right' }]);
            y = S.row(doc, y, [{ t: '(-) Gastos del local', x: L + 8, w: 300 }, { t: '-' + bs(t.gastosBs), x: 350, w: R - 358, align: 'right', color: RED }]);
            y = S.row(doc, y, [{ t: 'Base neta para el reparto', x: L + 8, w: 300 }, { t: bs(t.baseNetaBs), x: 350, w: R - 358, align: 'right' }], { bold: true });
            y += 6;
        }

        // Reparto
        if (r.reparto.filas.length) {
            y = title(y + 4, `Reparto de la ganancia (sobre ${bs(r.reparto.baseBs)})`);
            y = need(y, 40);
            y = S.tableHead(doc, y, [
                { t: 'NOMBRE', x: L + 8, w: 220 }, { t: '%', x: 300, w: 60, align: 'right' }, { t: 'MONTO Bs', x: 380, w: R - 388, align: 'right' }
            ]);
            for (const f of r.reparto.filas) {
                y = need(y, 20);
                y = S.row(doc, y, [{ t: f.nombre, x: L + 8, w: 220 }, { t: pct(f.pct), x: 300, w: 60, align: 'right' }, { t: bs(f.bs), x: 380, w: R - 388, align: 'right' }]);
            }
            y = need(y, 20);
            y = S.row(doc, y, [
                { t: 'Queda (sin asignar)', x: L + 8, w: 220 }, { t: pct(r.reparto.quedaPct), x: 300, w: 60, align: 'right' },
                { t: bs(r.reparto.quedaBs), x: 380, w: R - 388, align: 'right', color: r.reparto.quedaBs < 0 ? RED : GREEN }
            ], { bold: true });
            y += 6;
        }

        // Por día
        if (r.dias.length > 1) {
            y = title(y + 4, 'Por día');
            y = need(y, 40);
            const dc = [
                { t: 'DÍA', x: L + 8, w: 130 }, { t: 'VENTAS', x: 200, w: 90, align: 'right' },
                { t: 'COSTO', x: 300, w: 90, align: 'right' }, { t: 'GANANCIA', x: 400, w: R - 408, align: 'right' }
            ];
            y = S.tableHead(doc, y, dc);
            for (const d of r.dias) {
                if (y + 20 > BOTTOM) { y = newPage(); y = title(y, 'Por día (continúa)'); y = S.tableHead(doc, y, dc); }
                y = S.row(doc, y, [
                    { t: dayLabel(d.fecha), x: L + 8, w: 130 }, { t: bs(d.ventasBs), x: 200, w: 90, align: 'right' },
                    { t: '-' + bs(d.costoBs), x: 300, w: 90, align: 'right', color: RED },
                    { t: bs(d.gananciaBs), x: 400, w: R - 408, align: 'right', color: d.gananciaBs < 0 ? RED : GREEN }
                ]);
            }
            y += 6;
        }

        // Detalle por producto
        if (r.categorias.some(c => c.productos.length)) {
            y = title(y + 4, 'Detalle por producto');
            const pc = [
                { t: 'PRODUCTO', x: L + 8, w: 170 }, { t: 'UNID.', x: 230, w: 40, align: 'right' },
                { t: 'VENTAS', x: 280, w: 75, align: 'right' }, { t: 'COSTO', x: 360, w: 70, align: 'right' }, { t: 'GANANCIA', x: 435, w: R - 443, align: 'right' }
            ];
            y = need(y, 40);
            y = S.tableHead(doc, y, pc);
            for (const c of r.categorias) {
                if (!c.productos.length) continue;
                if (y + 40 > BOTTOM) { y = newPage(); y = S.tableHead(doc, y, pc); }
                doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9).text(c.label, L + 8, y, { lineBreak: false });
                y += 14;
                for (const p of c.productos) {
                    if (y + 20 > BOTTOM) { y = newPage(); y = S.tableHead(doc, y, pc); }
                    y = S.row(doc, y, [
                        { t: p.name, x: L + 16, w: 162 }, { t: String(p.unidades), x: 230, w: 40, align: 'right' },
                        { t: bs(p.ventasBs), x: 280, w: 75, align: 'right' }, { t: p.costoBs ? '-' + bs(p.costoBs) : '—', x: 360, w: 70, align: 'right', color: RED },
                        { t: bs(p.gananciaBs), x: 435, w: R - 443, align: 'right', color: p.gananciaBs < 0 ? RED : GREEN }
                    ], { size: 8.5 });
                }
            }
            y += 6;
        }

        // Notas
        const notes = ['Precios con IVA incluido (el 16% del Seniat va en el reparto). Ventas anuladas no cuentan.'];
        if (r.excluidas.unidades) notes.unshift(`Solo cuenta pasteles y productos con costo cargado. Quedaron fuera ${r.excluidas.unidades} venta(s) por ${bs(r.excluidas.ventasBs)} de productos sin costo.`);
        if (r.delivery.count) notes.push(`Delivery cobrado: ${r.delivery.count} envío(s) · ${bs(r.delivery.bs)} (es del motorizado, fuera de ventas y ganancia).`);
        y = need(y, 20 + notes.length * 22);
        doc.fillColor(SOFT).font('Helvetica-Oblique').fontSize(8);
        for (const n of notes) { doc.text(n, L, y, { width: R - L }); y = doc.y + 4; }

        S.footer(doc, `Rentabilidad · ${r.label} · página ${page}`);
        doc.end();
    });
}

module.exports = { renderRentPdf, normalize };
