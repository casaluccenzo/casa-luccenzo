// Historial para la planilla de socios (lib/historial-socios.js)
const assert = require('assert');
const { buildHistorial, toCsv } = require('../lib/historial-socios');

const products = { pollo: { category: 'pastelitos', cost: 1000 }, malta: { category: 'bebidas', cost: 0 } };
const R = 900;
const s = (product_id, name, price, ts, extra = {}) => ({ product_id, name, price, timestamp: ts, bcv_rate: R, ...extra });
const sales = [
    s('pollo', 'Pollo [Ana] (Pagado - Punto de Venta)', 2, '2026-11-25T14:00:00Z', { cost_at_sale: 1000 }),
    s('pollo', 'Pollo [Ana] (Pagado - Pago Móvil)', 2, '2026-11-25T15:00:00Z'),
    s('malta', 'Malta [Luis] (Pagado - Efectivo)', 1, '2026-11-25T16:00:00Z'),
    s('delivery', 'Delivery (Pagado - Pago Móvil)', 3, '2026-11-25T16:00:00Z'),
    s('pollo', 'Pollo [Eva] (Pagado - Pago Móvil)', 2, '2026-11-26T03:30:00Z'),   // 11:30 pm del 25 en Caracas
    s('pollo', 'Pollo [Eva] (Pagado - Pago Móvil)', 2, '2026-11-27T15:00:00Z')    // hoy: fuera
];
const rows = buildHistorial(sales, products, { hoy: '2026-11-27' });
assert.strictEqual(rows.length, 1, 'solo el 25 (hoy fuera, delivery fuera)');
const d = rows[0];
assert.strictEqual(d.fecha, '2026-11-25');
assert.strictEqual(d.punto, 1800);
assert.strictEqual(d.pagoMovil, 3600);
assert.strictEqual(d.otros, 900);
assert.strictEqual(d.pastelitos, 3);
assert.strictEqual(d.ventasPast, 5400);
assert.strictEqual(d.costoPast, 3000);
assert.strictEqual(toCsv(rows).split('\n')[1], '2026-11-25,1800,3600,900,90000,3,5400,3000');
console.log('historial-socios OK');
