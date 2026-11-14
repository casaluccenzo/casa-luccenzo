const { renderRentPdf } = require('../lib/rent-report');

/**
 * PDF de la pestaña Rentabilidad (lib/rent-report.js).
 *
 *   POST /api/rentabilidad-pdf  { label, totals, categorias, dias, reparto, ... }
 *     El teléfono manda los números que ya está mostrando (incluido el reparto
 *     guardado ahí) y el servidor devuelve el PDF. No lee ni escribe la base y no
 *     guarda nada: es solo dibujar lo que llega.
 */
module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

    let body = req.body || {};
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    if (!body || typeof body !== 'object' || !body.totals) return res.status(400).json({ error: 'Faltan los datos de rentabilidad' });

    try {
        const pdf = await renderRentPdf(body);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename="rentabilidad-casa-lucenzo.pdf"');
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).send(pdf);
    } catch (e) {
        console.error('rentabilidad-pdf:', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
};
