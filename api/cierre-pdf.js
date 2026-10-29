process.env.TZ = 'America/Caracas';

const { SupabaseRest } = require('../lib/bot-shared');
const { caracasDate, dayRangeUtc, buildReport, renderPdf } = require('../lib/day-report');

/**
 * Reporte PDF de ventas del día (lib/day-report.js), guardado en Storage.
 *
 *   POST /api/cierre-pdf  { fecha?: "AAAA-MM-DD" }
 *     Lo llama la caja justo después del Cierre de Jornada (js/app.js). Genera
 *     el PDF del día con lo que hay en la base y lo guarda; si ya existía (un
 *     segundo cierre el mismo día) lo reemplaza. Solo hoy o ayer: un pedido
 *     suelto no puede reescribir el registro de días viejos.
 *
 *   GET /api/cierre-pdf?fecha=AAAA-MM-DD
 *     Redirige a una URL firmada de 5 minutos para ver/bajar el PDF guardado.
 *
 *   GET /api/cierre-pdf  (cron de Vercel, con CRON_SECRET)
 *     A medianoche de Caracas: si el día que terminó tuvo ventas y nadie
 *     cerró, genera su reporte igual. Nunca pisa uno ya guardado.
 */
const BUCKET = 'cierres';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function storagePath(date) {
    return `${date.slice(0, 4)}/${date.slice(5, 7)}/${date}.pdf`;
}

async function fetchDayData(db, date) {
    const { from, to } = dayRangeUtc(date);
    const range = col => `${col}=gte.${encodeURIComponent(from)}&${col}=lt.${encodeURIComponent(to)}`;
    const [sales, expenses, invoices, logins, rate] = await Promise.all([
        db.rawGetAll(`sales?select=uuid,product_id,name,price,timestamp,bcv_rate&${range('timestamp')}&voided_at=is.null&order=timestamp.asc,uuid.asc`),
        db.rawGetAll(`expenses?select=description,amount,currency,bcv_rate,timestamp&${range('timestamp')}&order=timestamp.asc`),
        db.rawGet(`invoices?select=number,sale_timestamp,status&${range('sale_timestamp')}&order=number.asc`),
        db.rawGet(`activity_logs?select=role,actor_name,timestamp&action=eq.${encodeURIComponent('Inicio de Sesión')}&${range('timestamp')}&order=timestamp.asc`),
        db.rawGet(`bcv_rate_history?select=bcv_rate&rate_date=eq.${date}`)
    ]);
    if (sales === null) throw new Error('No se pudieron leer las ventas');
    const saleRate = (sales.find(s => parseFloat(s.bcv_rate) > 0) || {}).bcv_rate;
    return {
        date,
        sales,
        expenses: expenses || [],
        invoices: invoices || [],
        logins: logins || [],
        bcvRate: parseFloat(saleRate) || (Array.isArray(rate) && rate[0] ? parseFloat(rate[0].bcv_rate) : null)
    };
}

async function storageFetch(url, key, path, init = {}) {
    return fetch(`${url}/storage/v1/${path}`, {
        ...init,
        headers: { apikey: key, Authorization: `Bearer ${key}`, ...(init.headers || {}) }
    });
}

async function generate(url, key, date, trigger) {
    const db = new SupabaseRest(url, key);
    const data = await fetchDayData(db, date);
    const report = buildReport({ ...data, trigger });
    const pdf = await renderPdf(report);
    const objPath = storagePath(date);

    const up = await storageFetch(url, key, `object/${BUCKET}/${objPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/pdf', 'x-upsert': 'true', 'Cache-Control': 'no-cache' },
        body: pdf
    });
    if (!up.ok) throw new Error(`Storage upload failed (HTTP ${up.status}): ${await up.text().catch(() => '')}`);

    const row = {
        report_date: date,
        storage_path: objPath,
        generated_at: report.generatedAt,
        trigger,
        accounts: report.totals.count,
        total_bs: report.totals.totalBs,
        iva_bs: report.totals.ivaBs,
        expenses_bs: report.totals.expensesBs,
        bcv_rate: report.rate || null,
        size_bytes: pdf.length
    };
    const resp = await fetch(`${url}/rest/v1/day_reports?on_conflict=report_date`, {
        method: 'POST',
        headers: {
            apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates,return=minimal'
        },
        body: JSON.stringify(row)
    });
    if (!resp.ok) throw new Error(`day_reports upsert failed (HTTP ${resp.status}): ${await resp.text().catch(() => '')}`);
    return row;
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(204).end();

    const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no configuradas' });

    const today = caracasDate();
    const yesterday = caracasDate(new Date(Date.now() - 24 * 3600 * 1000));

    try {
        if (req.method === 'POST') {
            let body = req.body || {};
            if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
            const date = body.fecha || today;
            if (!DATE_RE.test(date) || (date !== today && date !== yesterday)) {
                return res.status(400).json({ error: 'Solo se puede generar el reporte de hoy o de ayer.' });
            }
            const row = await generate(url, key, date, body.manual ? 'manual' : 'cierre');
            return res.status(200).json({ ok: true, ...row });
        }

        if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' });

        const fecha = req.query && req.query.fecha;
        if (fecha) {
            if (!DATE_RE.test(fecha)) return res.status(400).json({ error: 'Fecha inválida' });
            const sign = await storageFetch(url, key, `object/sign/${BUCKET}/${storagePath(fecha)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ expiresIn: 300 })
            });
            if (!sign.ok) return res.status(404).json({ error: 'No hay reporte guardado para ese día.' });
            const { signedURL } = await sign.json();
            res.setHeader('Cache-Control', 'no-store');
            return res.redirect(302, `${url}/storage/v1${signedURL}`);
        }

        // Cron de medianoche: el día que acaba de terminar.
        const cronSecret = process.env.CRON_SECRET;
        if (!cronSecret || (req.headers['authorization'] || '') !== `Bearer ${cronSecret}`) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const db = new SupabaseRest(url, key);
        const existing = await db.rawGet(`day_reports?select=report_date&report_date=eq.${yesterday}`);
        if (Array.isArray(existing) && existing.length) {
            return res.status(200).json({ ok: true, date: yesterday, already_done: true });
        }
        const { from, to } = dayRangeUtc(yesterday);
        const anySale = await db.rawGet(`sales?select=uuid&timestamp=gte.${encodeURIComponent(from)}&timestamp=lt.${encodeURIComponent(to)}&voided_at=is.null&limit=1`);
        if (!Array.isArray(anySale) || anySale.length === 0) {
            return res.status(200).json({ ok: true, date: yesterday, skipped: 'sin ventas' });
        }
        const row = await generate(url, key, yesterday, 'cron');
        return res.status(200).json({ ok: true, ...row });
    } catch (e) {
        console.error('cierre-pdf:', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
};
