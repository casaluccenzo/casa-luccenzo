// Entrega y pago de los pedidos web: datos del Pago Móvil y el mensaje de
// WhatsApp que el cliente manda con su pedido (y luego el comprobante).
// Lo usan index.html (popup "Hacer Pedido") y pedido.html, y lo prueba
// tests/unit.test.js, así que no depende de nada más.
(function (root) {
    // Mismo número que el botón de WhatsApp de la web: ahí llegan los comprobantes.
    const WHATSAPP = '584120839311';

    const PAGO_MOVIL = {
        banco: 'Banco Plaza',
        titular: 'Emprendimiento Kaira Blanco',
        rif: 'J-508183134',
        telefono: '0412-0839311'
    };

    const DELIVERY_NOTE = 'El costo del delivery se cobra aparte.';

    const MAX_TEXT = 300;

    function clean(s) {
        return String(s || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
    }

    /** Texto del WhatsApp que el cliente le manda a Casa Lucenzo con su pedido. */
    function buildWhatsappText(order) {
        const items = (order.items || [])
            .map(it => `• ${it.qty}× ${it.name} — $${(it.qty * it.price).toFixed(2)}`)
            .join('\n');
        const lines = [
            '🛍️ *Pedido web — Casa Lucenzo*',
            '',
            `👤 ${clean(order.customer_name)}`,
            `📞 ${clean(order.customer_phone)}`
        ];
        if (order.delivery_method === 'retiro') {
            lines.push('🏠 Retiro en el local');
        } else {
            lines.push(`🛵 Delivery: ${clean(order.delivery_address)}`);
            if (clean(order.delivery_reference)) lines.push(`📍 Referencia: ${clean(order.delivery_reference)}`);
        }
        const totalBs = order.total_bs > 0 ? ` (Bs ${Math.round(order.total_bs).toLocaleString('es-VE')})` : '';
        lines.push('', items, '', `*Total: $${Number(order.total).toFixed(2)}${totalBs}*`);
        if (order.delivery_method !== 'retiro') lines.push(`_${DELIVERY_NOTE}_`);
        lines.push('', `💳 ${order.payment_method}`);
        if (order.payment_method === 'Pago Móvil') {
            lines.push(
                `Banco: ${PAGO_MOVIL.banco}`,
                `Titular: ${PAGO_MOVIL.titular}`,
                `RIF: ${PAGO_MOVIL.rif}`,
                `Teléfono: ${PAGO_MOVIL.telefono}`,
                '',
                'Te envío el comprobante del pago por aquí 👇'
            );
        }
        return lines.join('\n');
    }

    function whatsappUrl(order) {
        return `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(buildWhatsappText(order))}`;
    }

    root.PedidoDelivery = { WHATSAPP, PAGO_MOVIL, DELIVERY_NOTE, MAX_TEXT, clean, buildWhatsappText, whatsappUrl };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.PedidoDelivery;
})(typeof window !== 'undefined' ? window : globalThis);
