process.env.TZ = 'America/Caracas';

const crypto = require('crypto');
const { SupabaseRest } = require('../lib/bot-shared');
const { buildHistorial, toCsv, caracasDate } = require('../lib/historial-socios');

/**
 * Historial diario para la planilla de socios (Google Sheets), en CSV.
 *
 *   GET /api/historial-socios?key=CLAVE
 *     Solo LEE la base (no escribe nada, no toca el cierre de jornada). Devuelve una
 *     fila por día cerrado (el día en curso queda fuera): punto de venta, pago
 *     móvil, otros, dólar del día, pastelitos y ganancia. La hoja "Datos" de la
 *     planilla lo trae con =IMPORTDATA(...) y se actualiza sola.
 *     La clave es la variable HISTORIAL_SOCIOS_KEY (solo da estos totales, nada más).
 */
const FROM = '2026-08-20T04:00:00.000Z';   // desde que hay precios guardados

function sameKey(a, b) {
    const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
}

module.exports = async (req, res) => {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' });
    const expected = process.env.HISTORIAL_SOCIOS_KEY;
    if (!expected) return res.status(500).json({ error: 'HISTORIAL_SOCIOS_KEY no configurada' });
    if (!sameKey(req.query && req.query.key, expected)) return res.status(401).json({ error: 'No autorizado' });

    const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no configuradas' });

    try {
        const db = new SupabaseRest(url, key);
        const [sales, products] = await Promise.all([
            db.rawGetAll(`sales?select=product_id,name,price,timestamp,bcv_rate,cost_at_sale&voided_at=is.null&timestamp=gte.${encodeURIComponent(FROM)}&order=timestamp.asc,uuid.asc`),
            db.rawGetAll('products?select=id,category,cost&order=id.asc')
        ]);
        if (sales === null || products === null) return res.status(502).json({ error: 'No se pudo leer la base' });
        const byId = Object.fromEntries(products.map(p => [p.id, { category: p.category, cost: p.cost }]));
        const rows = buildHistorial(sales, byId, { hoy: caracasDate() });
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).send(toCsv(rows));
    } catch (e) {
        console.error('historial-socios:', e);
        return res.status(500).json({ error: 'Error al armar el historial' });
    }
};
