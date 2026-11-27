// Historial diario para la planilla de socios (Google Sheets).
// Pura: recibe filas de la base y devuelve una fila por día de Caracas. No escribe nada.
// Caracas = UTC-4 todo el año. Se repite aquí (en vez de importar lib/day-report) para
// no cargar pdfkit en esta función, que solo arma un CSV.
const caracasDate = (d = new Date()) => new Date(d.getTime() - 4 * 3600 * 1000).toISOString().slice(0, 10);
/** Método de pago del final del nombre: "... (Pagado - Pago Móvil)" → "pago móvil". */
const methodOf = name => { const m = /\(Pagado - ([^)]+)\)\s*$/.exec(name || ''); return m ? m[1].trim().toLowerCase() : ''; };

const NUM = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

/**
 * @param {Array} sales    sales activas: { product_id, name, price, timestamp, bcv_rate, cost_at_sale }
 * @param {Object} products { [id]: { category, cost } }
 * @param {Object} opts     { hoy: 'AAAA-MM-DD' (día en curso, se deja fuera) }
 * @returns {Array} filas ordenadas por fecha: { fecha, punto, pagoMovil, otros, dolar, pastelitos, ventasPast, costoPast }
 */
function buildHistorial(sales, products, opts = {}) {
    const days = new Map();
    for (const s of sales) {
        if (!s.timestamp || s.product_id === 'delivery') continue;
        const fecha = caracasDate(new Date(s.timestamp));
        if (opts.hoy && fecha >= opts.hoy) continue;
        let d = days.get(fecha);
        if (!d) { d = { fecha, punto: 0, pagoMovil: 0, otros: 0, rates: [], pastelitos: 0, ventasPast: 0, costoPast: 0 }; days.set(fecha, d); }
        const rate = NUM(s.bcv_rate);
        const bs = NUM(s.price) * rate;
        if (rate > 0) d.rates.push(rate);
        const method = methodOf(s.name);
        if (method === 'punto de venta') d.punto += bs;
        else if (method === 'pago móvil' || method === 'pago movil') d.pagoMovil += bs;
        else d.otros += bs;
        const p = products[s.product_id] || {};
        if (p.category === 'pastelitos') {
            d.pastelitos += 1;
            d.ventasPast += bs;
            d.costoPast += s.cost_at_sale != null ? NUM(s.cost_at_sale) : NUM(p.cost);
        }
    }
    return [...days.values()].sort((a, b) => a.fecha.localeCompare(b.fecha)).map(d => ({
        fecha: d.fecha,
        punto: Math.round(d.punto),
        pagoMovil: Math.round(d.pagoMovil),
        otros: Math.round(d.otros),
        dolar: d.rates.length ? d.rates.reduce((a, b) => a + b, 0) / d.rates.length : 0,
        pastelitos: d.pastelitos,
        ventasPast: Math.round(d.ventasPast),
        costoPast: Math.round(d.costoPast)
    }));
}

/**
 * CSV para IMPORTDATA. El dólar va como entero (×100) para que Sheets no lo
 * confunda con texto según el idioma de la hoja; la planilla lo divide entre 100.
 */
function toCsv(rows) {
    const head = 'fecha,punto,pago_movil,otros,dolar_x100,pastelitos,ventas_pastelitos,costo_pastelitos';
    return [head, ...rows.map(r => [r.fecha, r.punto, r.pagoMovil, r.otros, Math.round(r.dolar * 100), r.pastelitos, r.ventasPast, r.costoPast].join(','))].join('\n') + '\n';
}

module.exports = { buildHistorial, toCsv, caracasDate };
