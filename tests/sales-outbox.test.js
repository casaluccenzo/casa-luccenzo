// Cola de ventas sin internet (js/sales-outbox.js): se guarda antes de salir a
// la red, se reenvía en orden al volver la señal y no duplica.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeEnv() {
    const store = {};
    const timers = [];
    const listeners = {};
    const ctx = {
        console: { log() {}, error() {}, warn() {} },
        localStorage: {
            getItem: k => (k in store ? store[k] : null),
            setItem: (k, v) => { store[k] = String(v); },
            removeItem: k => { delete store[k]; }
        },
        navigator: { onLine: true },
        crypto: { randomUUID: (() => { let i = 0; return () => `id-${++i}`; })() },
        setInterval: (fn) => { timers.push(fn); return timers.length; },
        Date, JSON, Set, Promise, Array, Object, String
    };
    ctx.window = ctx;
    ctx.addEventListener = (evt, fn) => { (listeners[evt] = listeners[evt] || []).push(fn); };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'sales-outbox.js'), 'utf8'), ctx);
    return { ctx, store, timers, listeners };
}

// Cliente Supabase falso: guarda filas por uuid; "offline" responde status 0.
function fakeClient(state) {
    const result = (error, status) => Promise.resolve({ error, status });
    return {
        from: () => ({
            insert(payload) {
                if (state.offline) return result({ message: 'TypeError: Failed to fetch', code: '' }, 0);
                const rows = Array.isArray(payload) ? payload : [payload];
                if (rows.some(r => state.rows[r.uuid])) return result({ code: '23505', message: 'duplicate' }, 409);
                rows.forEach(r => { state.rows[r.uuid] = { ...r }; });
                state.calls.push('insert');
                return result(null, 201);
            },
            upsert(payload) {
                if (state.offline) return result({ message: 'Failed to fetch', code: '' }, 0);
                (Array.isArray(payload) ? payload : [payload]).forEach(r => { state.rows[r.uuid] = { ...(state.rows[r.uuid] || {}), ...r }; });
                state.calls.push('upsert');
                return result(null, 201);
            },
            update(fields) {
                return {
                    eq: (_col, uuid) => {
                        if (state.offline) return result({ message: 'Failed to fetch', code: '' }, 0);
                        if (state.rows[uuid]) Object.assign(state.rows[uuid], fields);
                        state.calls.push('void');
                        return result(null, 204);
                    }
                };
            }
        })
    };
}

(async () => {
    // 1. Con internet: sale al momento y la cola queda vacía.
    {
        const { ctx } = makeEnv();
        const state = { offline: false, rows: {}, calls: [] };
        ctx.SupabaseManager = { getClient: () => fakeClient(state) };
        const ok = await ctx.SalesOutbox.send([{ kind: 'insert', uuid: 'a', payload: { uuid: 'a', name: 'Pastel' } }]);
        assert.strictEqual(ok, true);
        assert.strictEqual(ctx.SalesOutbox.count(), 0);
        assert.ok(state.rows.a);
    }

    // 2. Sin internet: queda guardada (sobrevive a "cerrar la app") y sale
    //    en orden al volver la señal: insertar, marcar pagado, anular.
    {
        const env = makeEnv();
        const state = { offline: true, rows: {}, calls: [] };
        env.ctx.SupabaseManager = { getClient: () => fakeClient(state) };
        env.ctx.navigator.onLine = false;
        assert.strictEqual(await env.ctx.SalesOutbox.send([{ kind: 'insert', payload: [{ uuid: 'b', name: 'Pastel' }, { uuid: 'c', name: 'Malta' }] }]), false);
        await env.ctx.SalesOutbox.send([{ kind: 'upsert', payload: [{ uuid: 'b', name: 'Pastel (Pagado - Efectivo)' }] }]);
        await env.ctx.SalesOutbox.send([{ kind: 'void', uuid: 'c', voidedAt: '2026-11-22T10:00:00Z', reason: 'x' }]);
        assert.strictEqual(env.ctx.SalesOutbox.count(), 3);
        assert.ok(env.ctx.SalesOutbox.pendingSaleUuids().has('b'));
        assert.ok(env.ctx.SalesOutbox.pendingVoidUuids().has('c'));

        // La app se cierra y se vuelve a abrir: misma cola desde localStorage.
        const saved = env.store.casa_lucenzo_sales_outbox;
        const env2 = makeEnv();
        env2.store.casa_lucenzo_sales_outbox = saved;
        env2.ctx.SupabaseManager = { getClient: () => fakeClient(state) };
        assert.strictEqual(env2.ctx.SalesOutbox.count(), 3);

        state.offline = false;
        let retried = 0;
        env2.ctx.retryPendingInvoices = () => { retried++; return Promise.resolve(); };
        env2.listeners.online.forEach(fn => fn());
        await env2.ctx.SalesOutbox.flush();
        assert.deepStrictEqual(state.calls, ['insert', 'upsert', 'void']);
        assert.strictEqual(state.rows.b.name, 'Pastel (Pagado - Efectivo)');
        assert.strictEqual(state.rows.c.voided_at, '2026-11-22T10:00:00Z');
        assert.strictEqual(env2.ctx.SalesOutbox.count(), 0);
        assert.ok(retried >= 1, 'después de subir ventas se reintentan las facturas en cola');
    }

    // 3. Reintento de algo que sí había llegado: no duplica ni se traba.
    {
        const { ctx } = makeEnv();
        const state = { offline: false, rows: { d: { uuid: 'd' } }, calls: [] };
        ctx.SupabaseManager = { getClient: () => fakeClient(state) };
        assert.strictEqual(await ctx.SalesOutbox.send([{ kind: 'insert', uuid: 'd', payload: { uuid: 'd' } }]), true);
        assert.strictEqual(ctx.SalesOutbox.count(), 0);
    }

    // 4. Qué se reintenta y qué no.
    {
        const { ctx } = makeEnv();
        const r = ctx.SalesOutbox._isRetryable;
        assert.strictEqual(r({}, 0), true);
        assert.strictEqual(r({}, 503), true);
        assert.strictEqual(r({}, 401), true);
        assert.strictEqual(r({ code: 'PGRST301' }, 400), true);
        assert.strictEqual(r({ code: '42703' }, 400), false);
    }

    console.log('sales-outbox.test.js: OK');
})().catch(e => { console.error(e); process.exit(1); });
