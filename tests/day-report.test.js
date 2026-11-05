// Reporte PDF del día (lib/day-report.js): agrupación de cuentas, IVA y fechas de Caracas.
const assert = require('assert');
const { buildReport, renderPdf, dayRangeUtc, caracasDate, parseSaleName, shiftOf, shiftRangeUtc } = require('../lib/day-report');

const P = 2.477147, R = 888.1183;
const sale = (name, price, ts, product_id = 'x') => ({ product_id, name, price, timestamp: ts, bcv_rate: R });
const sales = [
    sale('Pollo [Ana - V-123] (Pagado - Pago Móvil)', P, '2026-10-28T11:00:00.000+00:00', 'pollo'),
    sale('Pollo [Ana - V-123] (Pagado - Pago Móvil)', P, '2026-10-28T11:00:00.000+00:00', 'pollo'),
    sale('Malta Retornable [Ana - V-123] (Pagado - Pago Móvil)', 1.1, '2026-10-28T11:00:00.000+00:00', 'malta'),
    sale('Pollo · Consumo personal [Personal] (Pagado - Efectivo)', 1160 / R, '2026-10-28T12:00:00.000+00:00', 'pollo'),
    sale('Carne Mechada [Luis]', P, '2026-10-28T13:00:00.000+00:00')
];

assert.deepStrictEqual(dayRangeUtc('2026-10-28'), { from: '2026-10-28T04:00:00.000Z', to: '2026-10-29T04:00:00.000Z' });
assert.strictEqual(caracasDate(new Date('2026-10-29T03:30:00Z')), '2026-10-28');
assert.deepStrictEqual(parseSaleName('Pollo [Ana - V-123] (Pagado - Punto de Venta)'),
    { product: 'Pollo', client: 'Ana', rif: 'V-123', paid: true, method: 'Punto de Venta' });

const rep = buildReport({
    date: '2026-10-28', sales, bcvRate: R,
    productCategories: { pollo: 'pastelitos', malta: 'bebidas' },
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
const cat = k => rep.categories.find(c => c.key === k);
assert.strictEqual(cat('pastelitos').qty, 2);
assert.strictEqual(cat('bebidas').totalBs, 976.93);
assert.strictEqual(cat('personal').qty, 1, 'el consumo del personal va en su propia sección');
assert.strictEqual(cat('otros').qty, 1, 'producto sin categoría conocida cae en "otros"');
assert.strictEqual(Math.round(rep.categories.reduce((t, c) => t + c.totalBs, 0) * 100), Math.round(rep.totals.totalBs * 100));

// Turnos: mañana hasta las 3:30 p.m. de Caracas, tarde desde ahí.
assert.strictEqual(shiftOf('2026-10-28T09:30:00Z'), 'manana'); // 5:30 a.m.
assert.strictEqual(shiftOf('2026-10-28T17:00:00Z'), 'manana'); // 1:00 p.m.
assert.strictEqual(shiftOf('2026-10-28T19:29:00Z'), 'manana'); // 3:29 p.m.
assert.strictEqual(shiftOf('2026-10-28T19:30:00Z'), 'tarde');  // 3:30 p.m.
assert.strictEqual(shiftOf('2026-10-29T01:00:00Z'), 'tarde');  // 9:00 p.m. del 28
assert.deepStrictEqual(shiftRangeUtc('2026-10-28', 'manana'), { from: '2026-10-28T04:00:00.000Z', to: '2026-10-28T19:30:00.000Z' });
assert.deepStrictEqual(shiftRangeUtc('2026-10-28', 'tarde'), { from: '2026-10-28T19:30:00.000Z', to: '2026-10-29T04:00:00.000Z' });

// Día con venta en la tarde: los turnos suman el total del día.
const nightSale = sale('Queso [Rosa] (Pagado - Efectivo)', P, '2026-10-28T23:15:00.000+00:00', 'queso');
const day = buildReport({ date: '2026-10-28', sales: [...sales, nightSale], bcvRate: R, productCategories: { pollo: 'pastelitos', queso: 'pastelitos' } });
const [am, pm] = day.shifts;
assert.strictEqual(am.count, 3);
assert.strictEqual(pm.count, 1);
assert.strictEqual(Math.round((am.totalBs + pm.totalBs) * 100), Math.round(day.totals.totalBs * 100));
assert.strictEqual(day.shift, null);
const amOnly = buildReport({ date: '2026-10-28', sales, bcvRate: R, shift: 'manana' });
assert.strictEqual(amOnly.shift, 'manana');

Promise.all([renderPdf(rep), renderPdf(day), renderPdf(amOnly)]).then(bufs => {
    for (const buf of bufs) assert.ok(buf.slice(0, 5).toString() === '%PDF-' && buf.length > 5000);
    console.log('day-report.test.js: OK');
}).catch(e => { console.error(e); process.exit(1); });
