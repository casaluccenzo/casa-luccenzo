// Cola de ventas sin internet (modo sin internet propio, 2026-11-22).
//
// Cada venta que el POS manda a Supabase pasa primero por esta cola, guardada
// en el propio equipo (localStorage). Si el envío sale bien se borra de la
// cola; si no hay internet (o el servidor no responde) se queda y se reenvía
// sola, en el mismo orden, cuando vuelve la conexión. Antes, una venta hecha
// sin señal solo quedaba en la pantalla de ese equipo y, al volver internet,
// terminaba en "cuarentena" sin llegar nunca a la base.
//
// Tipos de operación (se aplican en orden, una por una):
//   insert -> INSERT en sales (un 23505 "ya existe" cuenta como hecho, así un
//             reintento de algo que sí había llegado no duplica nada)
//   upsert -> UPSERT parcial en sales (renombrar al marcar pagado)
//   void   -> UPDATE voided_at/void_reason de una venta por uuid
//
// Script clásico: se carga después de js/supabase.js y antes de js/app/.
(function () {
    'use strict';

    const KEY = 'casa_lucenzo_sales_outbox';
    const FLUSH_EVERY_MS = 30 * 1000;

    function read() {
        try {
            const list = JSON.parse(localStorage.getItem(KEY) || '[]');
            return Array.isArray(list) ? list : [];
        } catch {
            return [];
        }
    }

    function write(list) {
        try {
            localStorage.setItem(KEY, JSON.stringify(list));
            return true;
        } catch (e) {
            console.error('SalesOutbox: no se pudo guardar la cola', e);
            return false;
        }
    }

    const online = () => typeof navigator === 'undefined' || navigator.onLine !== false;

    function newId() {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
        return Date.now().toString(36) + Math.random().toString(36).slice(2);
    }

    /** Guarda operaciones en la cola y devuelve sus ids. */
    function enqueue(ops) {
        const list = read();
        const ids = ops.map(op => {
            const id = newId();
            list.push({ id, at: new Date().toISOString(), ...op });
            return id;
        });
        write(list);
        notify();
        return ids;
    }

    function remove(ids) {
        if (!ids || ids.length === 0) return;
        const drop = new Set(ids);
        write(read().filter(op => !drop.has(op.id)));
        notify();
    }

    /**
     * ¿Vale la pena reintentar? Sin respuesta (status 0: sin internet, DNS,
     * corte), sesión vencida (401 / PGRST301, se renueva sola al volver la
     * señal), demasiadas peticiones o fallas del servidor. Un 4xx de datos
     * (columna mala, permiso) no se arregla reintentando.
     */
    function isRetryable(error, status) {
        if (!status) return true;
        if (status >= 500 || status === 401 || status === 408 || status === 429) return true;
        if (error && error.code === 'PGRST301') return true;
        return false;
    }

    function isDuplicate(error) {
        return !!(error && error.code === '23505');
    }

    /** Ejecuta una operación contra Supabase. Devuelve { ok, retry }. */
    async function run(client, op) {
        let res;
        try {
            if (op.kind === 'insert') {
                res = await client.from('sales').insert(op.payload);
            } else if (op.kind === 'upsert') {
                res = await client.from('sales').upsert(op.payload);
            } else if (op.kind === 'void') {
                res = await client.from('sales')
                    .update({ voided_at: op.voidedAt, void_reason: op.reason || null })
                    .eq('uuid', op.uuid);
            } else {
                return { ok: true };
            }
        } catch (e) {
            // supabase-js normalmente no lanza, pero un fetch roto sí puede.
            return { ok: false, retry: true, error: e };
        }
        const { error, status } = res || {};
        if (!error) return { ok: true };
        if (op.kind === 'insert' && isDuplicate(error)) return { ok: true };
        return { ok: false, retry: isRetryable(error, status), error };
    }

    let flushing = null;

    /**
     * Manda todo lo pendiente, en orden. Se detiene en la primera falla que
     * se pueda reintentar (para no adelantar un "anular" a su "insertar").
     * Una falla definitiva se saca de la cola y queda en la consola/Sentry.
     * @returns {Promise<number>} cuántas operaciones se enviaron
     */
    function flush() {
        if (flushing) return flushing;
        flushing = (async () => {
            const client = window.SupabaseManager && window.SupabaseManager.getClient
                ? window.SupabaseManager.getClient() : null;
            if (!client) return 0;
            let sent = 0;
            for (const op of read()) {
                const r = await run(client, op);
                if (r.ok) {
                    remove([op.id]);
                    sent++;
                    continue;
                }
                if (r.retry) break;
                console.error('SalesOutbox: operación descartada (error definitivo)', op, r.error);
                remove([op.id]);
            }
            if (sent > 0) {
                console.log(`SalesOutbox: ${sent} operación(es) de ventas enviadas.`);
                // Las facturas talonario de esas cuentas esperaban a que las
                // ventas estuvieran en el servidor.
                if (typeof window.retryPendingInvoices === 'function') {
                    window.retryPendingInvoices().catch(() => {});
                }
            }
            return sent;
        })().finally(() => { flushing = null; });
        return flushing;
    }

    /**
     * Intenta una operación al momento y, si no sale, la deja en cola.
     * Siempre queda guardada ANTES de salir a la red: si se cierra la app a
     * mitad del envío, no se pierde.
     * @returns {Promise<boolean>} true si llegó al servidor ahora mismo
     */
    async function send(ops) {
        if (!ops || ops.length === 0) return true;
        const ids = enqueue(ops);
        // Si ya había cosas en cola antes, se respeta el orden: todo sale por flush.
        if (read().length > ops.length || !online()) {
            if (online()) flush();
            return false;
        }
        const client = window.SupabaseManager && window.SupabaseManager.getClient
            ? window.SupabaseManager.getClient() : null;
        if (!client) return false;
        let allOk = true;
        for (let i = 0; i < ops.length; i++) {
            const r = await run(client, { ...ops[i], id: ids[i] });
            if (r.ok) {
                remove([ids[i]]);
                continue;
            }
            if (r.retry) {
                allOk = false;
                break;
            }
            console.error('SalesOutbox: operación descartada (error definitivo)', ops[i], r.error);
            remove([ids[i]]);
            allOk = false;
        }
        return allOk;
    }

    function pendingUuids(kind) {
        return new Set(read().filter(op => !kind || op.kind === kind).flatMap(op => {
            if (op.uuid) return [op.uuid];
            const p = Array.isArray(op.payload) ? op.payload : [op.payload];
            return p.filter(Boolean).map(x => x.uuid).filter(Boolean);
        }));
    }

    const listeners = [];
    function notify() {
        const n = read().length;
        listeners.forEach(fn => { try { fn(n); } catch { /* listener roto no frena la cola */ } });
    }

    window.SalesOutbox = {
        send,
        flush,
        count: () => read().length,
        list: read,
        /** uuids de ventas que todavía no llegaron al servidor (insert/upsert). */
        pendingSaleUuids: () => {
            const a = pendingUuids('insert');
            pendingUuids('upsert').forEach(u => a.add(u));
            return a;
        },
        /** uuids con una anulación pendiente de subir. */
        pendingVoidUuids: () => pendingUuids('void'),
        onChange: (fn) => { listeners.push(fn); },
        _isRetryable: isRetryable
    };

    if (typeof window.addEventListener === 'function') {
        window.addEventListener('online', () => { flush(); });
    }
    if (typeof setInterval === 'function') {
        setInterval(() => {
            if (read().length > 0 && online()) flush();
        }, FLUSH_EVERY_MS);
    }
})();
