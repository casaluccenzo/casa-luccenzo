// Nota de entrega (js/delivery-note.js): número, precios, hora de Venezuela, HTML escapado.
const assert = require('assert');
const DN = require('../js/delivery-note');

const base = {
    id: 'x', number: 7, status: 'emitida', source: 'venta',
    client_name: 'Juan <b>Pérez</b>', client_rif: 'V-12345678', client_phone: '0412-0000000',
    items: [
        { desc: 'Pastelito de Carne', qty: 3, price: 2.5, total: 7.5 },
        { desc: 'Queso & <script>', qty: 1, price: 2, total: 2 }
    ],
    total_usd: 9.5, bcv_rate: 100, total_bs: 950, show_prices: true,
    notes: 'Llamar al llegar', issued_at: '2026-11-28T03:30:00Z'
};

assert.strictEqual(DN.fmtNumber(1), 'NE-000001');
assert.strictEqual(DN.fmtNumber(123456), 'NE-123456');

// 03:30 UTC del 28 = 11:30 pm del 27 en Caracas.
assert.ok(DN.dateTime('2026-11-28T03:30:00Z').startsWith('27/11/2026'), DN.dateTime('2026-11-28T03:30:00Z'));
assert.strictEqual(DN.dateTime(null), '');

const html = DN.render(base);
assert.ok(html.includes('NE-000007'), 'lleva el número');
assert.strictEqual((html.match(/NOTA DE ENTREGA/g) || []).length, 2, 'original y copia');
assert.ok(html.includes('ORIGINAL · CLIENTE') && html.includes('COPIA · CASA LUCENZO'));
assert.ok(html.includes('9,50') && html.includes('950,00'), 'totales en $ y Bs con formato es-VE');
assert.ok(html.includes('P. unit. $'), 'con precios muestra la columna');
assert.ok(!html.includes('<b>Pérez</b>') && html.includes('&lt;b&gt;Pérez'), 'escapa el nombre');
assert.ok(!html.includes('<script>') && html.includes('Queso &amp; &lt;script&gt;'), 'escapa la descripción');
assert.ok(html.includes('Documento sin valor fiscal'));
assert.ok(!html.includes('ANULADA'));
assert.ok(!html.includes('dn-full'), 'pocos renglones: media hoja');

const noPrices = DN.render(Object.assign({}, base, { show_prices: false }));
assert.ok(!noPrices.includes('P. unit. $') && !noPrices.includes('950,00'), 'sin precios no muestra montos');

const voided = DN.render(Object.assign({}, base, { status: 'anulada', void_reason: 'Error' }));
assert.ok(voided.includes('ANULADA') && voided.includes('Motivo de anulación'));

const delivered = DN.render(Object.assign({}, base, {
    status: 'entregada', received_by_name: 'María', received_by_rif: 'V-9999999', delivered_at: '2026-11-28T15:00:00Z'
}));
assert.ok(delivered.includes('María') && delivered.includes('V-9999999'), 'imprime quién recibió');

const many = Array.from({ length: DN.HALF_PAGE_MAX_ITEMS + 1 }, (_, i) => ({ desc: `P${i}`, qty: 1, price: 1, total: 1 }));
assert.ok(DN.render(Object.assign({}, base, { items: many })).includes('dn-full'), 'muchos renglones: hoja completa');

const pedido = DN.render(Object.assign({}, base, { delivery_address: 'Calle 5', delivery_reference: 'Casa azul' }));
assert.ok(pedido.includes('Dirección de entrega') && pedido.includes('Calle 5 · Ref.: Casa azul'));

console.log('delivery-note.test.js: OK');
