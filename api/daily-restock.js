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
 */
const DAILY_VITRINA_STOCK = 15;

module.exports = async (req, res) => {
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = req.headers['authorization'] || '';
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    // products has no anon UPDATE policy (migrations 010/011 closed public
    // writes) -- this needs the service role, same precedence the other
    // crons use for privileged reads/writes.
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
        return res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no configuradas' });
    }

    try {
        const db = new SupabaseRest(supabaseUrl, serviceKey);
        const ok = await db.patch('products', 'category', 'pastelitos', {
            stock: DAILY_VITRINA_STOCK,
            initial_stock: DAILY_VITRINA_STOCK,
            max: DAILY_VITRINA_STOCK,
            updated_at: new Date().toISOString()
        });

        if (!ok) {
            return res.status(502).json({ ok: false, error: 'Supabase PATCH failed' });
        }
        return res.status(200).json({ ok: true, restocked_to: DAILY_VITRINA_STOCK, ran_at: new Date().toISOString() });
    } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
    }
};
