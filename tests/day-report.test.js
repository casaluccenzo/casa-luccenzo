// Reporte PDF del día (lib/day-report.js): agrupación de cuentas, IVA y fechas de Caracas.
const assert = require('assert');
const { buildReport, renderPdf, dayRangeUtc, caracasDate, parseSaleName } = require('../lib/day-report');

const P = 2.477147, R = 888.1183;
const sale = (name, price, ts) => ({ product_id: 'x', name, price, timestamp: ts, bcv_rate: R });
const sales = [
    sale('Pollo [Ana - V-123] (Pagado - Pago Móvil)', P, '2026-10-28T11:00:00.000+00:00'),
    sale('Pollo [Ana - V-123] (Pagado - Pago Móvil)', P, '2026-10-28T11:00:00.000+00:00'),
    sale('Malta Retornable [Ana - V-123] (Pagado - Pago Móvil)', 1.1, '2026-10-28T11:00:00.000+00:00'),
    sale('Pollo · Consumo personal [Personal] (Pagado - Efectivo)', 1160 / R, '2026-10-28T12:00:00.000+00:00'),
    sale('Carne Mechada [Luis]', P, '2026-10-28T13:00:00.000+00:00')
];

assert.deepStrictEqual(dayRangeUtc('2026-10-28'), { from: '2026-10-28T04:00:00.000Z', to: '2026-10-29T04:00:00.000Z' });
assert.strictEqual(caracasDate(new Date('2026-10-29T03:30:00Z')), '2026-10-28');
assert.deepStrictEqual(parseSaleName('Pollo [Ana - V-123] (Pagado - Punto de Venta)'),
    { product: 'Pollo', client: 'Ana', rif: 'V-123', paid: true, method: 'Punto de Venta' });

const rep = buildReport({
    date: '2026-10-28', sales, bcvRate: R,
    invoices: [{ number: 55, sale_timestamp: '2026-10-28T11:00:00Z', status: 'emitida' }],
    expenses: [{ description: 'Hielo', amount: 500, currency: 'VES', timestamp: '2026-10-28T14:00:00Z' }]
});
assert.strictEqual(rep.accounts.length, 3);
const [ana, staff, luis] = rep.accounts;
assert.strictEqual(ana.items.find(i => i.name === 'Pollo').qty, 2);
assert.strictEqual(ana.totalBs, 5376.93);
assert.strictEqual(Math.round((ana.baseBs + ana.ivaBs) * 100), Math.round(ana.totalBs * 100));
assert.strictEqual(ana.invoice.number, 55);
assert.strictEqual(ana.time, '07:00 a.m.');
assert.ok(staff.staff && staff.ivaBs === 0, 'el consumo del personal no lleva IVA');
assert.ok(!luis.paid && luis.method === 'Sin cobrar');
assert.strictEqual(rep.totals.expensesBs, 500);
assert.strictEqual(rep.totals.invoicesIssued, 1);

renderPdf(rep).then(buf => {
    assert.ok(buf.slice(0, 5).toString() === '%PDF-' && buf.length > 5000);
    console.log('day-report.test.js: OK');
}).catch(e => { console.error(e); process.exit(1); });
