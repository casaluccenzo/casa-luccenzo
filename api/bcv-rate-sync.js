const { SupabaseRest } = require('../lib/bot-shared');

// Sub-centavo drift between the two rate providers is noise, not a rate
// move -- same 0.01 threshold js/app.js's bcvRateChangedEnough() uses, so a
// day with no real change doesn't fan out a write + realtime update for
// nothing.
function bcvRateChangedEnough(prevRate, newRate) {
    if (!(newRate > 0)) return false;
    if (!(prevRate > 0)) return true;
    return Math.abs(newRate - prevRate) > 0.01;
}

/**
 * Daily server-side BCV rate refresh.
 *
 * js/app.js only ever fetches the live BCV rate from a browser tab (on app
 * load, every 6h while open, on tab-focus if stale, or day close) -- there
 * was no path that didn't depend on someone having the POS open. A day with
 * no device open before BCV publishes (or where the last check was under 6h
 * old) left `app_config.bcv_rate` frozen on yesterday's value, so sales
 * during that window got invoiced at the wrong dollar rate with nothing
 * flagging it.
 *
 * This cron (Vercel, see vercel.json) closes that gap the same way
 * `api/keepalive.js` already does for DB inactivity: it runs once a day,
 * independent of any browser being open, and writes straight to
 * `app_config`. The existing `record_bcv_rate_history` trigger (migration
 * 017) picks up the write automatically, so bcv_rate_history stays accurate
 * with no changes needed there.
 */
module.exports = async (req, res) => {
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = req.headers['authorization'] || '';
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    // `app_config` UPDATE is restricted to authenticated admin/venta profiles
    // (migration 001) -- this cron has no user session, so it needs the
    // service role key to bypass RLS, same as the WhatsApp/Telegram bots'
    // update_bcv intent (lib/bot-shared.js).
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
        return res.status(500).json({ error: 'Supabase no configurado (falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY)' });
    }

    let rate1 = 0;
    let rate2 = 0;

    // Same two providers and fallback order as js/app.js's fetchBcvRate().
    try {
        const resp1 = await fetch('https://rates.dolarvzla.com/bcv/current.json');
        if (resp1.ok) {
            const data1 = await resp1.json();
            if (data1?.current?.usd) rate1 = parseFloat(data1.current.usd);
        }
    } catch (e1) {
        console.warn('bcv-rate-sync: DolarVZLA fetch failed:', e1.message);
    }

    try {
        const resp2 = await fetch('https://ve.dolarapi.com/v1/dolares/oficial');
        if (resp2.ok) {
            const data2 = await resp2.json();
            const val = data2?.promedio || data2?.monto || data2?.precio;
            if (val) rate2 = parseFloat(val);
        }
    } catch (e2) {
        console.warn('bcv-rate-sync: DolarAPI fetch failed:', e2.message);
    }

    const newRate = Math.max(rate1 || 0, rate2 || 0);
    if (!(newRate > 0)) {
        return res.status(502).json({ ok: false, error: 'Ambos proveedores de tasa BCV fallaron' });
    }

    const db = new SupabaseRest(supabaseUrl, serviceKey);
    const rows = await db.get('app_config', 'id,bcv_rate,use_auto_bcv');
    const current = Array.isArray(rows) ? rows[0] : rows;
    if (!current) {
        return res.status(502).json({ ok: false, error: 'No se pudo leer app_config' });
    }

    // Don't clobber a rate an admin deliberately fixed by hand (useAutoBcv
    // off) -- same rule fetchBcvRate() applies client-side.
    if (current.use_auto_bcv === false) {
        return res.status(200).json({ ok: true, skipped: true, reason: 'use_auto_bcv está desactivado (tasa fijada a mano)' });
    }

    const prevRate = parseFloat(current.bcv_rate) || 0;
    if (!bcvRateChangedEnough(prevRate, newRate)) {
        return res.status(200).json({ ok: true, skipped: true, reason: 'La tasa no cambió', rate: newRate });
    }

    const patched = await db.patch('app_config', 'id', 1, {
        bcv_rate: newRate,
        updated_at: new Date().toISOString()
    });
    if (!patched) {
        return res.status(502).json({ ok: false, error: 'No se pudo escribir la nueva tasa en app_config' });
    }

    // Visibility the client-side path never had: which change happened, when,
    // without depending on any device being open to log it.
    await db.post('activity_logs', {
        role: 'sistema',
        actor_name: 'Cron BCV (automático)',
        action: 'Actualización automática de tasa BCV',
        details: `Tasa actualizada de ${prevRate.toFixed(4)} a ${newRate.toFixed(4)} Bs/USD vía sync diario (sin depender de un dispositivo abierto).`,
        timestamp: new Date().toISOString()
    });

    return res.status(200).json({ ok: true, previousRate: prevRate, newRate, ran_at: new Date().toISOString() });
};
