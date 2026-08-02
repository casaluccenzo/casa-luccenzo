const { sendWhatsAppMessage, normalizePhone } = require('../lib/bot-shared');

const VALID_PAYMENT_METHODS = ['Pago Móvil', 'Transferencia'];
const MAX_ITEMS = 50;
const MAX_NAME_LEN = 200;

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
