// js/analytics.js buckets sales into calendar days using the JS runtime's
// *local* timezone (same convention the admin's browser already relies on,
// since that's genuinely Venezuela-local). Vercel serverless functions run
// in UTC by default, which would silently shift "today" by several hours
// and misfile late-evening sales into the wrong day. Setting TZ before any
// Date is touched makes every local getter in this process -- including
// the ones inside js/analytics.js -- resolve to Venezuela wall-clock time.
process.env.TZ = 'America/Caracas';

const { SupabaseRest, sendWhatsAppMessage, normalizePhone } = require('../lib/bot-shared');
const {
    parseTimestamp,
    aggregateSalesByDay,
    getWeekdayPattern,
    compareVsWeekdayAverage,
    getFlavorRanking,
    getRecentTrend,
    buildPerformanceInsights
} = require('../js/analytics');

// How far back to look for weekday/trend patterns. Wider than the UI's
// default (60 days) since this runs unattended and there's no toggle to
// widen it if a given day's sample turns out thin.
const LOOKBACK_DAYS = 120;

function todayDateKey(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function buildMonitorMessage({ todayTotal, todayComparison, topFlavorToday, insights }) {
    const lines = ['📊 *Resumen de Ventas - Casa Lucenzo*', ''];
    lines.push(`Hoy vendiste *$${todayTotal.toFixed(2)}*.`);
    if (todayComparison.pctChange !== null) {
        lines.push(todayComparison.label.charAt(0).toUpperCase() + todayComparison.label.slice(1) + '.');
    }
    if (topFlavorToday) {
        lines.push(`🏆 Sabor top de hoy: ${topFlavorToday.name} (${topFlavorToday.quantity} uds.)`);
    }
    if (insights.length > 0) {
        lines.push('', '_Reseña:_');
        insights.slice(0, 2).forEach(text => lines.push(`• ${text}`));
    }
    return lines.join('\n');
}

/**
 * Daily proactive sales-performance check: pulls the last LOOKBACK_DAYS of
 * `sales`, computes the same weekday-pattern/trend/insights math the
 * "Análisis" tab and its PDF report use (js/analytics.js), and pushes a
 * short WhatsApp summary to WHATSAPP_ADMIN_PHONE -- so Gustavo gets a
 * daily read on performance without opening the system. Vercel invokes
 * this once a day via the "crons" entry in vercel.json.
 */
module.exports = async (req, res) => {
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = req.headers['authorization'] || '';
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    // Same kill-switch convention as the other bot endpoints: this can be
    // turned off without removing the cron entry or the code.
    if (process.env.SALES_MONITOR_ENABLED !== 'true') {
        return res.status(503).json({ error: 'Sales monitor disabled (SALES_MONITOR_ENABLED !== true)' });
    }

    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    // `sales` is readable only by an authenticated admin/venta/cocina profile --
    // there is deliberately no anon SELECT policy on it (migration 010). This
    // cron has no user session, so it reads with the service role. Same
    // precedence the WhatsApp/Telegram webhooks already use.
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabaseKey = serviceKey || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) {
        return res.status(500).json({ error: 'Supabase not configured' });
    }

    const adminPhones = (process.env.WHATSAPP_ADMIN_PHONE || '').split(',').map(p => normalizePhone(p)).filter(Boolean);
    if (adminPhones.length === 0) {
        // Nothing to notify -- not an error, just nothing configured yet.
        return res.status(200).json({ ok: true, notified: 0, reason: 'no admin phones configured' });
    }

    try {
        const db = new SupabaseRest(supabaseUrl, supabaseKey);
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - LOOKBACK_DAYS);
        startDate.setHours(0, 0, 0, 0);

        const [sales, products] = await Promise.all([
            db.rawGetAll(`sales?select=product_id,price,timestamp&timestamp=gte.${encodeURIComponent(startDate.toISOString())}&order=timestamp.asc`),
            db.rawGet('products?select=id,name,category')
        ]);

        if (!sales) {
            return res.status(502).json({ ok: false, error: 'Could not fetch sales from Supabase' });
        }

        // Without the service role, RLS filters `sales` down to nothing and
        // PostgREST answers 200 with `[]` -- indistinguishable from a genuinely
        // quiet day. Sending "$0.00" on a misconfiguration is exactly the kind
        // of confidently-wrong report this endpoint exists to avoid, so bail
        // out loudly instead and leave a diagnosable error in the cron log.
        if (!serviceKey && sales.length === 0) {
            return res.status(500).json({
                ok: false,
                error: 'SUPABASE_SERVICE_ROLE_KEY no está configurada y `sales` no es legible con la anon key (RLS, migración 010). Se aborta el reporte en vez de enviar $0.00.'
            });
        }

        const salesHistory = sales.map(s => ({ ...s, productId: s.product_id }));
        const productList = products || [];

        const todayKey = todayDateKey();
        const dailyTotals = aggregateSalesByDay(salesHistory);
        const todayEntry = dailyTotals.find(d => d.dateStr === todayKey);
        const todayTotal = todayEntry ? todayEntry.total : 0;

        const weekdayPattern = getWeekdayPattern(salesHistory);
        const todayComparison = compareVsWeekdayAverage(todayTotal, weekdayPattern, new Date().getDay());
        const flavorRankingFull = getFlavorRanking(salesHistory, productList, { limit: null });
        const todaysSales = salesHistory.filter(s => s.timestamp && todayDateKey(parseTimestamp(s.timestamp)) === todayKey);
        const topFlavorToday = getFlavorRanking(todaysSales, productList, { limit: 1 })[0] || null;
        const trend = getRecentTrend(salesHistory, 2);
        const insights = buildPerformanceInsights({ weekdayPattern, flavorRanking: flavorRankingFull, trend, todayComparison });

        const message = buildMonitorMessage({ todayTotal, todayComparison, topFlavorToday, insights });

        await Promise.all(adminPhones.map(phone => sendWhatsAppMessage(phone, message)));
        return res.status(200).json({ ok: true, notified: adminPhones.length, todayTotal, ran_at: new Date().toISOString() });
    } catch (e) {
        console.error('❌ Error running sales monitor:', e.message);
        return res.status(500).json({ ok: false, error: e.message });
    }
};
