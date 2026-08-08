const { sendWhatsAppMessage, normalizePhone } = require('../lib/bot-shared');

const VALID_PAYMENT_METHODS = ['Pago Móvil', 'Transferencia'];
const MAX_ITEMS = 50;
const MAX_NAME_LEN = 200;

// This endpoint is unauthenticated by design (the customer ordering from the
// public landing page has no account), so it is throttled per client IP to stop
// anyone from turning it into a WhatsApp spam gun aimed at the admin's phone.
// Best effort only: serverless instances don't share memory, so the real ceiling
// is RATE_LIMIT_MAX x (warm instances). It cuts off trivial floods, not a
// distributed attack -- the ENABLED flag below is the actual kill switch.
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 3;
const recentRequests = new Map();

function getClientIp(req) {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.trim()) return fwd.split(',')[0].trim();
    return req.socket?.remoteAddress || 'unknown';
}

function isRateLimited(ip) {
    const now = Date.now();

    for (const [key, timestamps] of recentRequests) {
        const fresh = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
        if (fresh.length === 0) recentRequests.delete(key);
        else recentRequests.set(key, fresh);
    }

    const hits = recentRequests.get(ip) || [];
    if (hits.length >= RATE_LIMIT_MAX) return true;

    hits.push(now);
    recentRequests.set(ip, hits);
    return false;
}

function isValidOrderPayload(body) {
    if (!body || typeof body !== 'object') return false;
    if (typeof body.customer_name !== 'string' || !body.customer_name.trim() || body.customer_name.length > MAX_NAME_LEN) return false;
    if (typeof body.customer_phone !== 'string' || !body.customer_phone.trim() || body.customer_phone.length > 40) return false;
    if (!VALID_PAYMENT_METHODS.includes(body.payment_method)) return false;
    if (typeof body.total !== 'number' || !isFinite(body.total) || body.total < 0) return false;
    if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > MAX_ITEMS) return false;

    return body.items.every(it =>
        it && typeof it.name === 'string' && it.name.trim() && it.name.length <= MAX_NAME_LEN &&
        typeof it.qty === 'number' && Number.isInteger(it.qty) && it.qty > 0 && it.qty <= 9999 &&
        typeof it.price === 'number' && isFinite(it.price) && it.price >= 0
    );
}

function buildNotificationText(order) {
    const itemsText = order.items
        .map(it => `${it.qty}× ${it.name} — $${(it.qty * it.price).toFixed(2)}`)
        .join('\n');

    return `🛍️ *Nuevo pedido online*\n\n` +
        `👤 ${order.customer_name}\n` +
        `📞 ${order.customer_phone}\n\n` +
        `${itemsText}\n\n` +
        `💳 ${order.payment_method}\n` +
        `*Total: $${order.total.toFixed(2)}*\n\n` +
        `Confirmalo o rechazalo desde el panel de Pedidos en el sistema.`;
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Same kill-switch convention as the WhatsApp/Telegram webhooks: while the
    // Pedidos Online feature is hidden in the UI, the endpoint stays closed too.
    if (process.env.PEDIDOS_ONLINE_ENABLED !== 'true') {
        return res.status(503).json({ error: 'Pedidos Online is currently disabled (PEDIDOS_ONLINE_ENABLED !== true)' });
    }

    if (isRateLimited(getClientIp(req))) {
        return res.status(429).json({ error: 'Demasiados pedidos seguidos. Esperá un minuto e intentá de nuevo.' });
    }

    if (!isValidOrderPayload(req.body)) {
        return res.status(400).json({ error: 'Datos de pedido inválidos.' });
    }

    const adminPhones = (process.env.WHATSAPP_ADMIN_PHONE || '')
        .split(',')
        .map(p => normalizePhone(p))
        .filter(Boolean);

    if (adminPhones.length === 0) {
        // Nothing configured to notify -- the order itself is already saved,
        // this endpoint is a best-effort secondary alert, not the source of truth.
        return res.status(200).json({ ok: true, notified: 0 });
    }

    const text = buildNotificationText(req.body);

    try {
        await Promise.all(adminPhones.map(phone => sendWhatsAppMessage(phone, text)));
        return res.status(200).json({ ok: true, notified: adminPhones.length });
    } catch (e) {
        console.error('❌ Error notifying pedido via WhatsApp:', e.message);
        // Still 200 -- the order is safely stored regardless of notification delivery.
        return res.status(200).json({ ok: false });
    }
};
