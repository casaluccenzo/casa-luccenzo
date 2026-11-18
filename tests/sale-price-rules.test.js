// La migración 050 copia en SQL las reglas de precio de js/combos.js (combos,
// promo, consumo del personal, delivery, extras). Si alguien cambia un precio
// en combos.js y no en el SQL, el servidor empezaría a marcar ventas buenas
// como sospechosas. Este test falla en ese caso.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Combos = require('../js/combos');

const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/050_sale_price_checks.sql'), 'utf8')
    .replace(/\r/g, '')
    .split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
const has = (re, msg) => assert.ok(re.test(sql), msg);

has(new RegExp(`p_product_id = '${Combos.DELIVERY.productId}'`), 'id de delivery');
has(new RegExp(`p_price <= ${Combos.DELIVERY.maxUsd}\\b`), `tope de delivery $${Combos.DELIVERY.maxUsd}`);
has(new RegExp(`p_product_id = '${Combos.EXTRA.productId}'`), 'id de extra');
has(new RegExp(`p_price <= ${Combos.EXTRA.maxUsd}\\.01`), `tope de extra $${Combos.EXTRA.maxUsd}`);
has(new RegExp(`'% · ${Combos.STAFF.label}%'`), 'etiqueta de consumo personal');
has(new RegExp(`prod.category = '${Combos.STAFF.category}' AND prod.cost > 0`), 'categoría de consumo personal');

assert.deepStrictEqual(Combos.PROMO.days, [2, 3], 'la promo cambió de días: actualizar isodow IN (2, 3) en la 050');
has(/isodow .* IN \(2, 3\)/, 'días de promo');
has(new RegExp(`prod.category = '${Combos.PROMO.category}' AND promo THEN ${Combos.PROMO.priceBs} END`), `promo Bs ${Combos.PROMO.priceBs}`);

for (const c of Combos.COMBOS) {
    if (c.pastelBs) has(new RegExp(`p_product_id = '${c.productId}' THEN ${c.pastelBs} END`), `pastel de ${c.name} Bs ${c.pastelBs}`);
}
const drinks = [...new Set(Combos.COMBOS.map(c => c.drinkBs))].sort((a, b) => a - b);
const sqlDrinks = sql.match(/END,\s*\n\s*([\d, ]+)\n\s*\] LOOP/)[1].split(',').map(Number).sort((a, b) => a - b);
assert.deepStrictEqual(sqlDrinks, drinks, 'precios de bebidas de combo (drinkBs)');
has(/'% · Combo %'/, 'marca de línea de combo');

console.log('sale-price-rules.test.js: OK');
