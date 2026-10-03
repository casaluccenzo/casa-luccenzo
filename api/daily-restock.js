process.env.TZ = 'America/Caracas';

const { SupabaseRest } = require('../lib/bot-shared');

/**
 * Pastelitos sell out or get zeroed by "Cierre de Jornada" (js/app.js,
 * closeDayAndResetLogs -- stock/initial_stock/max all go to 0 for that
 * category), and until now someone had to open `sistema` every morning and
 * retype the day's count into each pastelito before the vitrina was ready.
 * This cron does that reload automatically, once a day, before the shop
 * opens -- Vercel triggers it via the "crons" entry in vercel.json.
 *
 * Bebidas/dulces are untouched: unlike pastelitos, those categories carry
 * real leftover inventory across days (same distinction the day-close button
 * itself makes).
 *
 * Plan B (migration 033, applied to production 2026-09-27): products.stock/
 * initial_stock/max are no longer writable directly -- recompute_product_stock()
 * (migrations 030/033) owns them, recalculating off stock_movements + the
 * day_closes boundary every time a row lands in either table. This used to
 * also PATCH products directly ("to keep the shadow columns truthful" back
 * when stock_computed was dormant) -- now that those are the REAL columns,
 * that direct PATCH fights the trigger instead: if the stock_movements
 * insert below ever failed, the PATCH's value would sit un-verified until
 * the next real sale silently recomputed a different number out from under
 * it, with no visible error anywhere. Insert the movement only and let the
 * trigger be the only writer, same as every other stock change in the app
 * since Task 6 -- and surface a real error if the insert fails, instead of
 * swallowing it the way the old shadow-sync attempt did (SupabaseRest.post
 * only ever returned true/false, never the actual HTTP body).
 *
 * Inserting a +15 movement is only "reload to 15" if yesterday ended at 0,
 * i.e. if someone did the Cierre de Jornada. The original PATCH set the
 * vitrina to exactly 15 regardless; the movement-only version ADDS 15 on top
 * of whatever was left, so every day without a close stacked another 15 per
 * flavor (production, Sep 28 - Oct 1 2026: no closes, 90 per flavor by Oct 2).
 * To keep the old "always starts the day at 15" behavior, when the vitrina
 * still holds stock from a day nobody closed, the cron first files an
 * automatic day_closes row: that's the boundary recompute_product_stock()
 * counts pastelitos from, so it zeroes them the same way a manual close does.
 * It touches nothing else -- the cash register runs off
 * app_config.last_close_time, and day_closes only feeds pastelitos stock.
 * `max` is reset to 0 alongside it (same as the manual close's
 * resetPastelitoCapacity) since the trigger can only grow that ceiling.
 */
const DAILY_VITRINA_STOCK = 15;

// Unlike SupabaseRest.post/patch (true/false only), these surface the actual
// HTTP status + body so a failed write shows up in the cron's logs.
async function writeOrThrow(supabaseUrl, serviceKey, method, path, body, prefer) {
    const resp = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/${path}`, {
        method,
        headers: {
            'apikey': serviceKey,
            'Authorization': `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
            'Prefer': prefer
        },
        body: JSON.stringify(body)
    });
    if (!resp.ok) {
        const detail = await resp.text().catch(() => '');
        const table = path.split('?')[0];
        console.error(`daily-restock: ${method} ${table} failed (HTTP ${resp.status}): ${detail}`);
        const err = new Error(`Supabase ${method} ${table} failed (HTTP ${resp.status})`);
        err.status = resp.status;
        err.detail = detail;
        throw err;
    }
}

const postOrThrow = (url, key, table, rows) =>
    writeOrThrow(url, key, 'POST', table, rows, 'resolution=ignore-duplicates,return=minimal');
const patchOrThrow = (url, key, path, data) =>
    writeOrThrow(url, key, 'PATCH', path, data, 'return=minimal');

module.exports = async (req, res) => {
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = req.headers['authorization'] || '';
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    // stock_movements has no anon INSERT policy (migration 025) -- this needs
    // the service role, same precedence the other crons use for privileged
    // reads/writes.
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
        return res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no configuradas' });
    }

    try {
        const db = new SupabaseRest(supabaseUrl, serviceKey);
        const pastelitos = await db.rawGet('products?select=id,stock,initial_stock,max&category=eq.pastelitos');
        if (!Array.isArray(pastelitos)) {
            return res.status(502).json({ ok: false, error: 'No se pudieron leer los pastelitos' });
        }
        if (pastelitos.length === 0) {
            return res.status(200).json({ ok: true, restocked: 0, ran_at: new Date().toISOString() });
        }

        // Dedup id makes a duplicate cron invocation on the same Caracas day
        // a no-op via Postgrest's ignore-duplicates instead of double-counting
        // -- `id` is stock_movements' primary key, so PostgREST needs no
        // explicit on_conflict target to resolve against it.
        const dayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Caracas' });

        // Already reloaded today: stop before the auto-close below, which
        // would otherwise zero a vitrina that's mid-sale.
        const doneToday = await db.rawGet(`stock_movements?select=id&id=eq.${encodeURIComponent(`daily-restock-${pastelitos[0].id}-${dayStr}`)}`);
        if (!Array.isArray(doneToday)) {
            return res.status(502).json({ ok: false, error: 'No se pudo verificar la recarga de hoy' });
        }
        if (doneToday.length > 0) {
            return res.status(200).json({ ok: true, restocked: 0, already_done: true, ran_at: new Date().toISOString() });
        }

        let autoClosed = false;
        const leftover = pastelitos.some(p => Number(p.stock) !== 0 || Number(p.initial_stock) !== 0 || Number(p.max) !== 0);
        if (leftover) {
            await postOrThrow(supabaseUrl, serviceKey, 'day_closes', {
                id: `daily-restock-close-${dayStr}`,
                device_id: 'cron-daily-restock'
            });
            await patchOrThrow(supabaseUrl, serviceKey, 'products?category=eq.pastelitos', { max: 0 });
            autoClosed = true;
        }

        const movements = pastelitos.map(p => ({
            id: `daily-restock-${p.id}-${dayStr}`,
            product_id: p.id,
            delta: DAILY_VITRINA_STOCK,
            type: 'load',
            device_id: 'cron-daily-restock',
            note: 'Repuesto automático diario de vitrina'
        }));

        await postOrThrow(supabaseUrl, serviceKey, 'stock_movements', movements);

        return res.status(200).json({ ok: true, restocked: pastelitos.length, restocked_to: DAILY_VITRINA_STOCK, auto_closed: autoClosed, ran_at: new Date().toISOString() });
    } catch (e) {
        if (e.status) {
            return res.status(502).json({ ok: false, error: e.message, detail: e.detail });
        }
        console.error('daily-restock failed:', e.message);
        return res.status(500).json({ ok: false, error: e.message });
    }
};
