// Verifica que js/intl-cache.js NO cambia ni un carácter de lo que devuelven
// toLocaleString / toLocaleDateString / toLocaleTimeString: primero calcula
// las salidas con los métodos originales, luego carga el caché y compara.
// Las opciones de abajo son todas las que usa el código (grep "toLocale" js/).
const assert = require('assert');
const path = require('path');

const TZ = 'America/Caracas';
const numberCalls = [
    [undefined, undefined], ['es-VE', undefined], ['en-US', undefined],
    ['es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }],
    ['es-VE', { minimumFractionDigits: 2 }],
    ['en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }],
    ['en-US', { minimumFractionDigits: 2 }],
    ['es-VE', { maximumFractionDigits: 1 }],
    ['es-VE', { maximumFractionDigits: 2 }],
    ['es-VE', { minimumFractionDigits: 0, maximumFractionDigits: 0 }],
    ['es-VE', { style: 'currency', currency: 'USD' }]
];
const dateCalls = {
    toLocaleString: [[undefined, undefined], ['es-VE', undefined], ['es-VE', { timeZone: TZ }],
        ['es-VE', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }], ['es-VE', { dateStyle: 'short', timeStyle: 'short' }]],
    toLocaleDateString: [[undefined, undefined], ['es-VE', undefined], [[], { day: '2-digit', month: '2-digit' }],
        ['es-VE', { day: '2-digit', month: 'short', year: 'numeric' }], ['es-VE', { weekday: 'short', day: 'numeric', month: 'short' }],
        ['es-VE', { weekday: 'long', day: 'numeric', month: 'short' }], ['es-VE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }],
        ['es-VE', { day: 'numeric', month: 'short' }], ['es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }],
        [[], { weekday: 'short', day: 'numeric' }], ['es-VE', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }],
        ['es-VE', { month: 'long', year: 'numeric' }], ['es-VE', { day: '2-digit', month: 'short' }], ['es-VE', { timeZone: TZ }],
        ['es-VE', { hour: '2-digit' }], ['es-VE', { dateStyle: 'medium' }]],
    toLocaleTimeString: [[undefined, undefined], [[], { hour: '2-digit', minute: '2-digit' }], [[], { hour: '2-digit', minute: '2-digit', second: '2-digit' }],
        ['es-VE', { hour: '2-digit', minute: '2-digit' }], ['es-VE', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: true }],
        ['es-VE', { timeZone: TZ }], ['es-VE', { day: 'numeric' }], ['es-VE', { timeStyle: 'short' }]]
};
const numbers = [0, -0, 1, -1, 0.005, 1.005, 2.5, 2200, 1234567.891, -98765.4321, 915.7476, 1e21, NaN, Infinity, -Infinity];
const dates = [new Date(0), new Date('2026-11-16T19:56:13.449Z'), new Date('2026-12-31T23:59:59.999Z'), new Date('2025-02-28T04:00:00Z'), new Date('invalid')];

function run() {
    const out = [];
    for (const n of numbers) for (const [l, o] of numberCalls) {
        out.push(n.toLocaleString(l, o));
        out.push(new Number(n).toLocaleString(l, o));
    }
    for (const [fn, calls] of Object.entries(dateCalls)) for (const d of dates) for (const [l, o] of calls) {
        try { out.push(d[fn](l, o)); } catch (e) { out.push('THROW ' + e.name); }
    }
    // a second pass with the same args must hit the cache and still match
    for (const n of numbers) out.push(n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    // odd inputs must fall through to the native behaviour (including throws)
    for (const bad of [['xx-invalid-@@', undefined], ['es-VE', { minimumFractionDigits: 50 }], ['es-VE', { style: 'currency' }]]) {
        try { out.push((12.5).toLocaleString(bad[0], bad[1])); } catch (e) { out.push('THROW ' + e.name); }
    }
    try { out.push(new Date().toLocaleDateString('es-VE', { timeStyle: 'short' })); } catch (e) { out.push('THROW ' + e.name); }
    return out;
}

const before = run();
require(path.join(__dirname, '..', 'js', 'intl-cache.js'));
const after = run();
assert.strictEqual(after.length, before.length);
for (let i = 0; i < before.length; i++) {
    assert.strictEqual(after[i], before[i], `salida #${i} cambió: "${before[i]}" -> "${after[i]}"`);
}
assert.ok(!/\[native code\]/.test(Number.prototype.toLocaleString.toString()), 'el caché no se instaló');
console.log(`✅ intl-cache: ${before.length} formatos idénticos al original`);
