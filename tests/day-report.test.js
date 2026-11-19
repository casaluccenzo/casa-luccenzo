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
// Cada turno trae sus categorías, y mañana + tarde = el día, categoría por categoría.
assert.strictEqual(pm.categories.find(c => c.key === 'pastelitos').qty, 1);
for (const c of day.categories) {
    const inShifts = day.shifts.map(s => (s.categories.find(x => x.key === c.key) || { qty: 0, totalBs: 0 }));
    assert.strictEqual(inShifts.reduce((t, x) => t + x.qty, 0), c.qty, `unidades de ${c.key} por turno`);
    assert.strictEqual(Math.round(inShifts.reduce((t, x) => t + x.totalBs, 0) * 100), Math.round(c.totalBs * 100), `Bs de ${c.key} por turno`);
    for (const p of c.items) assert.strictEqual(p.qtyByShift.manana + p.qtyByShift.tarde, p.qty, `${p.name} mañana + tarde`);
}
assert.strictEqual(day.categories.find(c => c.key === 'pastelitos').items.find(p => p.name === 'Queso').qtyByShift.tarde, 1);
const amOnly = buildReport({ date: '2026-10-28', sales, bcvRate: R, shift: 'manana' });
assert.strictEqual(amOnly.shift, 'manana');

// Delivery: suma al total cobrado pero fuera de IVA, de la base y de las unidades.
const delTs = '2026-10-28T15:00:00.000+00:00';
const withDel = buildReport({
    date: '2026-10-28', bcvRate: R, productCategories: { pollo: 'pastelitos' },
    sales: [
        sale('Pollo [Rosa] (Pagado - Pago Móvil)', P, delTs, 'pollo'),
        sale('Delivery [Rosa] (Pagado - Pago Móvil)', 3, delTs, 'delivery')
    ]
});
const [rosa] = withDel.accounts;
assert.strictEqual(rosa.deliveryBs, Math.round(3 * R * 100) / 100);
assert.strictEqual(rosa.baseBs, Math.round((P * R / 1.16) * 100) / 100, 'la base imponible no incluye el delivery');
assert.strictEqual(Math.round((rosa.baseBs + rosa.ivaBs + rosa.deliveryBs) * 100), Math.round(rosa.totalBs * 100), 'base + IVA + delivery = total');
assert.strictEqual(withDel.totals.units, 1, 'el delivery no cuenta como producto vendido');
assert.strictEqual(withDel.totals.deliveryCount, 1);
assert.strictEqual(withDel.categories.find(c => c.key === 'delivery').totalBs, rosa.deliveryBs);

// Producto extra: venta del local con IVA, en su propia categoría.
const withExtra = buildReport({
    date: '2026-10-28', bcvRate: R, productCategories: { pollo: 'pastelitos' },
    sales: [
        sale('Pollo [Rosa] (Pagado - Pago Móvil)', P, delTs, 'pollo'),
        sale('Jugo de naranja [Rosa] (Pagado - Pago Móvil)', 1.5, delTs, 'extra'),
        sale('Jugo de naranja [Rosa] (Pagado - Pago Móvil)', 1.5, delTs, 'extra')
    ]
});
const extraCat = withExtra.categories.find(c => c.key === 'extra');
assert.strictEqual(extraCat.qty, 2, 'productos extra: 2 jugos');
assert.strictEqual(withExtra.totals.units, 3, 'el producto extra cuenta como producto vendido');
const [rosaX] = withExtra.accounts;
assert.strictEqual(Math.round((rosaX.baseBs + rosaX.ivaBs) * 100), Math.round(rosaX.totalBs * 100), 'el extra lleva IVA incluido');

Promise.all([renderPdf(rep), renderPdf(day), renderPdf(amOnly), renderPdf(withDel), renderPdf(withExtra)]).then(bufs => {
    for (const buf of bufs) assert.ok(buf.slice(0, 5).toString() === '%PDF-' && buf.length > 5000);
    console.log('day-report.test.js: OK');
}).catch(e => { console.error(e); process.exit(1); });

// PDF de Rentabilidad: dibuja datos ya calculados y tolera basura sin romperse.
(async () => {
    const { renderRentPdf } = require('../lib/rent-report');
    const pdf = await renderRentPdf({
        label: '2 nov – 8 nov', totals: { ventasBs: 1000, costoBs: 400, gananciaBs: 600, unidades: 3 },
        categorias: [{ label: 'Pastelitos', unidades: 3, ventasBs: 1000, costoBs: 400, gananciaBs: 600, margenPct: 60, productos: [{ name: 'Pollo', unidades: 3 }] }],
        dias: [{ fecha: '2026-11-02', ventasBs: 500 }, { fecha: 'mal', ventasBs: 'x' }],
        reparto: { baseBs: 600, filas: [{ nombre: 'Ana', pct: 50, bs: 300 }], quedaPct: 50, quedaBs: 300 }
    });
    assert.ok(pdf.slice(0, 4).toString() === '%PDF');
    const pdf2 = await renderRentPdf({
        label: 'Hoy', totals: { ventasBs: 1000, costoBs: 400, gananciaBs: 600, gastosBs: 100, baseNetaBs: 500, unidades: 3 },
        categorias: [], dias: [],
        repartos: [
            { titulo: 'Reparto de los pastelitos', baseBs: 400, gananciaBs: 500, gastosBs: 100, filas: [{ nombre: 'Ana', pct: 50, bs: 200 }], quedaPct: 50, quedaBs: 200 },
            { titulo: 'Reparto de lo demás', baseBs: 100, filas: [{ nombre: 'Ana', pct: 10, bs: 10 }], quedaPct: 90, quedaBs: 90 },
            'basura'
        ]
    });
    assert.ok(pdf2.slice(0, 4).toString() === '%PDF');
    console.log('rent-report tests passed');
})().catch(e => { console.error(e); process.exit(1); });

// Papelón (Combos.IVA_EXEMPT): bebida normal (cuenta como unidad y en "bebidas")
// pero fuera de IVA y de la base, solo desde el 20/11/2026.
{
    const Combos = require('../js/combos.js');
    const ts = '2026-11-20T15:00:00.000+00:00';
    const pap = 1200 / R;
    const withPap = buildReport({
        date: '2026-11-20', bcvRate: R, productCategories: { pollo: 'pastelitos', papelon_con_limon: 'bebidas' },
        sales: [
            sale('Pollo [Rosa] (Pagado - Pago Móvil)', P, ts, 'pollo'),
            sale('Papelon con Limon [Rosa] (Pagado - Pago Móvil)', pap, ts, 'papelon_con_limon')
        ]
    });
    const [acc] = withPap.accounts;
    assert.strictEqual(acc.exemptBs, 1200);
    assert.strictEqual(acc.baseBs, Math.round((P * R / 1.16) * 100) / 100, 'la base imponible no incluye el papelón');
    assert.strictEqual(Math.round((acc.baseBs + acc.ivaBs + acc.exemptBs) * 100), Math.round(acc.totalBs * 100), 'base + IVA + papelón = total');
    assert.strictEqual(withPap.totals.units, 2, 'el papelón sí cuenta como producto vendido');
    assert.strictEqual(withPap.categories.find(c => c.key === 'bebidas').totalBs, 1200);
    assert.strictEqual(withPap.totals.exemptBs, 1200);
    assert.ok(renderPdf, 'renderPdf existe');

    // Ventas viejas del papelón (antes del 20/11) siguen con IVA incluido.
    const old = buildReport({
        date: '2026-11-19', bcvRate: R, productCategories: { papelon_con_limon: 'bebidas' },
        sales: [sale('Papelon con Limon [Ana] (Pagado - Efectivo)', 1.35, '2026-11-19T15:00:00.000+00:00', 'papelon_con_limon')]
    });
    assert.strictEqual(old.accounts[0].exemptBs, 0, 'un día viejo no cambia');
    assert.ok(old.accounts[0].ivaBs > 0);

    // Orden de la caja: el papelón de primero, el resto como venía.
    const ordered = Combos.posOrder([{ id: 'agua_de_manzana' }, { id: 'malta' }, { id: 'papelon_con_limon' }]).map(p => p.id);
    assert.deepStrictEqual(ordered, ['papelon_con_limon', 'agua_de_manzana', 'malta']);
    assert.strictEqual(Combos.isIvaExemptSale({ productId: 'papelon_con_limon', price: 1 }), true, 'línea de cuenta sin fecha: fuera de IVA');
    assert.strictEqual(Combos.isIvaExemptSale({ productId: 'malta' }), false);
    assert.strictEqual(Combos.ivaExemptUsdOf([{ productId: 'papelon_con_limon', price: 1.5, quantity: 2 }, { productId: 'malta', price: 1, quantity: 1 }]), 3);
}
