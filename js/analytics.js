/**
 * Casa Lucenzo - Sales Analytics Domain Module
 * Pure calculation functions for the "Análisis" admin tab: day-over-day
 * comparisons, weekday sales patterns, flavor/product ranking, and a
 * daily-prep recommendation (how many units of each flavor to have ready).
 *
 * Kept dependency-free (no window.* lookups at call time) so it can run
 * both in the browser and under `node tests/unit.test.js`.
 */

const WEEKDAY_LABELS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

// Local re-implementation of js/ui.js's parseUTCTimestamp: Supabase returns
// "YYYY-MM-DD HH:mm:ss" (no zone) for some rows and ISO-with-Z for others;
// treat the zone-less form as UTC so this matches how the rest of the app
// interprets the same column.
function parseTimestamp(timestampStr) {
    if (!timestampStr) return new Date();
    let cleanStr = timestampStr;
    if (typeof cleanStr === 'string') {
        cleanStr = cleanStr.replace(' ', 'T');
        if (!cleanStr.includes('Z') && !cleanStr.includes('+') && !/-\d{2}:\d{2}$/.test(cleanStr)) {
            cleanStr += 'Z';
        }
    }
    return new Date(cleanStr);
}

function dateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/**
 * Groups sales into per-calendar-day totals (local time, same convention
 * used elsewhere in the app for "today"/"this week" boundaries).
 * @returns {Array} Sorted (ascending) [{ dateStr, weekday, total, count }]
 */
function aggregateSalesByDay(sales = []) {
    const days = {};
    (sales || []).forEach(s => {
        if (!s || !s.timestamp) return;
        const d = parseTimestamp(s.timestamp);
        const key = dateKey(d);
        if (!days[key]) {
            days[key] = { dateStr: key, weekday: d.getDay(), total: 0, count: 0 };
        }
        days[key].total += parseFloat(s.price) || 0;
        days[key].count += 1;
    });
    return Object.values(days).sort((a, b) => a.dateStr.localeCompare(b.dateStr));
}

/**
 * Average sales total/count per day-of-week across the whole history given.
 * @returns {Array} 7 entries indexed by JS Date.getDay() (0=Domingo..6=Sábado)
 */
function getWeekdayPattern(sales = []) {
    const days = aggregateSalesByDay(sales);
    const buckets = Array.from({ length: 7 }, () => ({ totalSum: 0, countSum: 0, days: 0 }));
    days.forEach(d => {
        const b = buckets[d.weekday];
        b.totalSum += d.total;
        b.countSum += d.count;
        b.days += 1;
    });
    return buckets.map((b, weekday) => ({
        weekday,
        label: WEEKDAY_LABELS[weekday],
        avgTotal: b.days > 0 ? Number((b.totalSum / b.days).toFixed(2)) : 0,
        avgCount: b.days > 0 ? Number((b.countSum / b.days).toFixed(1)) : 0,
        sampleSize: b.days
    }));
}

/**
 * Compares a day's total against the historical average for that same
 * weekday (generalizes compareSalesVsPreviousWeek in js/sales.js, which
 * only compares against "last week").
 */
function compareVsWeekdayAverage(todayTotal, weekdayPattern = [], weekday) {
    const bucket = weekdayPattern.find(w => w.weekday === weekday);
    if (!bucket || bucket.sampleSize === 0 || bucket.avgTotal <= 0) {
        return { pctChange: null, label: 'sin datos históricos de este día' };
    }
    const diff = todayTotal - bucket.avgTotal;
    const pct = (diff / bucket.avgTotal) * 100;
    const symbol = pct >= 0 ? '↑' : '↓';
    return {
        pctChange: Number(pct.toFixed(1)),
        avgTotal: bucket.avgTotal,
        sampleSize: bucket.sampleSize,
        label: `${symbol} ${Math.abs(pct).toFixed(1)}% vs. promedio de ${bucket.label.toLowerCase()} (${bucket.sampleSize} muestras)`
    };
}

/**
 * Ranks products/flavors by units sold across the given sales history.
 */
function getFlavorRanking(sales = [], products = [], { limit = 10 } = {}) {
    const counts = {};
    (sales || []).forEach(s => {
        const pid = s.productId || s.product_id;
        if (!pid || pid === 'abono') return;
        if (!counts[pid]) counts[pid] = { productId: pid, quantity: 0, amount: 0 };
        counts[pid].quantity += 1;
        counts[pid].amount += parseFloat(s.price) || 0;
    });
    const ranked = Object.values(counts)
        .map(c => {
            const product = products.find(p => p.id === c.productId);
            return {
                ...c,
                amount: Number(c.amount.toFixed(2)),
                name: product ? product.name : c.productId,
                category: product ? (product.category || 'otros') : 'otros'
            };
        })
        .sort((a, b) => b.quantity - a.quantity);
    return limit ? ranked.slice(0, limit) : ranked;
}

/**
 * Suggests how many units of each product/flavor to prepare for the given
 * weekday, based on the historical average sold on that weekday (rounded
 * up, plus a small safety margin, capped at the product's configured max).
 * Days with zero sales of a product still count as a valid sample (it's
 * legitimate signal that the flavor doesn't move that day).
 */
function getDailyPrepRecommendation(sales = [], products = [], targetWeekday, opts = {}) {
    const { safetyMargin = 0.10, minSamples = 3 } = opts;

    const dayKeys = aggregateSalesByDay(sales)
        .filter(d => d.weekday === targetWeekday)
        .map(d => d.dateStr);
    const sampleSize = dayKeys.length;

    const perProductPerDay = {};
    (sales || []).forEach(s => {
        const pid = s.productId || s.product_id;
        if (!pid || pid === 'abono' || !s.timestamp) return;
        const d = parseTimestamp(s.timestamp);
        if (d.getDay() !== targetWeekday) return;
        const key = dateKey(d);
        if (!perProductPerDay[pid]) perProductPerDay[pid] = {};
        perProductPerDay[pid][key] = (perProductPerDay[pid][key] || 0) + 1;
    });

    return products
        .map(product => {
            const dayCounts = perProductPerDay[product.id] || {};
            const values = dayKeys.map(k => dayCounts[k] || 0);
            const avg = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
            const rawSuggested = avg > 0 ? Math.ceil(avg * (1 + safetyMargin)) : 0;
            const suggested = product.max ? Math.min(rawSuggested, product.max) : rawSuggested;
            return {
                productId: product.id,
                name: product.name,
                category: product.category || 'otros',
                avg: Number(avg.toFixed(2)),
                suggested,
                sampleSize,
                lowConfidence: sampleSize < minSamples
            };
        })
        .filter(r => r.avg > 0)
        .sort((a, b) => b.suggested - a.suggested);
}

/**
 * Compares the average daily total of the most recent `weeksToCompare`
 * weeks against the equivalent period right before it, to catch whether
 * the business is trending up or down (not just "today vs. this weekday").
 * Anchored on the real current date, not the latest sale, so it always
 * answers "how are the last N weeks going" from today's point of view.
 */
function getRecentTrend(sales = [], weeksToCompare = 2) {
    const days = aggregateSalesByDay(sales);
    const spanDays = weeksToCompare * 7;

    const now = new Date();
    const recentStart = new Date(now);
    recentStart.setDate(now.getDate() - spanDays + 1);
    const priorStart = new Date(now);
    priorStart.setDate(now.getDate() - (spanDays * 2) + 1);
    const priorEnd = new Date(now);
    priorEnd.setDate(now.getDate() - spanDays);

    const recentStartKey = dateKey(recentStart);
    const priorStartKey = dateKey(priorStart);
    const priorEndKey = dateKey(priorEnd);

    const recentDays = days.filter(d => d.dateStr >= recentStartKey);
    const priorDays = days.filter(d => d.dateStr >= priorStartKey && d.dateStr <= priorEndKey);

    const avg = arr => (arr.length > 0 ? arr.reduce((sum, d) => sum + d.total, 0) / arr.length : 0);
    const recentAvg = Number(avg(recentDays).toFixed(2));
    const priorAvg = Number(avg(priorDays).toFixed(2));

    const pctChange = (recentDays.length > 0 && priorDays.length > 0 && priorAvg > 0)
        ? Number((((recentAvg - priorAvg) / priorAvg) * 100).toFixed(1))
        : null;

    return {
        recentAvg,
        priorAvg,
        pctChange,
        recentSampleDays: recentDays.length,
        priorSampleDays: priorDays.length
    };
}

/**
 * Projects the next `daysAhead` calendar days using the historical average
 * for whatever weekday each one falls on (from getWeekdayPattern) -- a
 * simple, transparent forecast rather than a black-box model.
 */
function getUpcomingProjection(weekdayPattern = [], daysAhead = 7, fromDate = new Date(), opts = {}) {
    const { minSamples = 3 } = opts;
    const projections = [];
    for (let i = 1; i <= daysAhead; i++) {
        const d = new Date(fromDate);
        d.setDate(fromDate.getDate() + i);
        const weekday = d.getDay();
        const bucket = weekdayPattern.find(w => w.weekday === weekday);
        projections.push({
            dateStr: dateKey(d),
            weekday,
            label: (bucket && bucket.label) || WEEKDAY_LABELS[weekday],
            projectedTotal: bucket ? bucket.avgTotal : 0,
            projectedCount: bucket ? bucket.avgCount : 0,
            sampleSize: bucket ? bucket.sampleSize : 0,
            lowConfidence: !bucket || bucket.sampleSize < minSamples
        });
    }
    return projections;
}

/**
 * Turns the numbers above into a handful of short Spanish sentences --
 * the "reseñas" shown in the PDF report and sent by the WhatsApp monitor.
 * Every sentence is derived from real computed values, not canned copy
 * picked by a lookup table (unlike the old getConsultantInsights in
 * js/ui.js, which chose from fixed paragraphs based on peak hour).
 * @param {Object} params
 * @param {Array} params.weekdayPattern From getWeekdayPattern(sales)
 * @param {Array} params.flavorRanking The FULL ranking (call
 *   getFlavorRanking with { limit: null }) so the "% share" math isn't
 *   skewed by an already-truncated top-N list
 * @param {Object|null} params.trend From getRecentTrend(sales)
 * @param {Object|null} params.todayComparison From compareVsWeekdayAverage(...)
 * @returns {Array<string>}
 */
function buildPerformanceInsights({ weekdayPattern = [], flavorRanking = [], trend = null, todayComparison = null } = {}) {
    const insights = [];

    const activeBuckets = weekdayPattern.filter(w => w.sampleSize > 0 && w.avgTotal > 0);
    if (activeBuckets.length >= 2) {
        const best = activeBuckets.reduce((a, b) => (b.avgTotal > a.avgTotal ? b : a));
        const worst = activeBuckets.reduce((a, b) => (b.avgTotal < a.avgTotal ? b : a));
        if (best.weekday !== worst.weekday) {
            insights.push(`📅 Tu día más fuerte es ${best.label} (promedio $${best.avgTotal.toFixed(2)}), y el más flojo es ${worst.label} (promedio $${worst.avgTotal.toFixed(2)}).`);
        }
    }

    if (flavorRanking.length > 0) {
        const totalQty = flavorRanking.reduce((sum, f) => sum + f.quantity, 0);
        const top = flavorRanking[0];
        const pct = totalQty > 0 ? (top.quantity / totalQty) * 100 : 0;
        insights.push(`🏆 ${top.name} es tu sabor estrella: representa el ${pct.toFixed(0)}% de las unidades vendidas en este período (${top.quantity} unidades).`);
    }

    if (trend && trend.pctChange !== null) {
        const arrow = trend.pctChange >= 0 ? '📈' : '📉';
        const direction = trend.pctChange >= 0 ? 'más' : 'menos';
        insights.push(`${arrow} En los últimos días vendiste en promedio ${Math.abs(trend.pctChange).toFixed(1)}% ${direction} que en el período previo comparable.`);
    }

    if (todayComparison && todayComparison.pctChange !== null) {
        const arrow = todayComparison.pctChange >= 0 ? '✅' : '⚠️';
        const direction = todayComparison.pctChange >= 0 ? 'por encima' : 'por debajo';
        insights.push(`${arrow} Hoy vas ${direction} de lo habitual: ${todayComparison.label}.`);
    }

    if (insights.length === 0) {
        insights.push('Todavía no hay suficiente historial de ventas para generar reseñas útiles. Volvé a mirar esto en unas semanas.');
    }

    return insights;
}

const AnalyticsManager = {
    WEEKDAY_LABELS,
    parseTimestamp,
    aggregateSalesByDay,
    getWeekdayPattern,
    compareVsWeekdayAverage,
    getFlavorRanking,
    getDailyPrepRecommendation,
    getRecentTrend,
    getUpcomingProjection,
    buildPerformanceInsights
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        WEEKDAY_LABELS,
        parseTimestamp,
        aggregateSalesByDay,
        getWeekdayPattern,
        compareVsWeekdayAverage,
        getFlavorRanking,
        getDailyPrepRecommendation,
        getRecentTrend,
        getUpcomingProjection,
        buildPerformanceInsights,
        AnalyticsManager
    };
}
if (typeof window !== 'undefined') {
    window.AnalyticsManager = AnalyticsManager;
}
