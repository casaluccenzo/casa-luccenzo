// Fiados y pedidos en línea.
//
// Antes formaba parte de js/ui.js. Script clásico (no módulo ES): comparte el
// ámbito global con los demás archivos de js/app/ y js/ui/, así que el orden de
// carga importa. Ese orden vive en sistema/index.html (y se repite en sw.js y
// js/app/index.js; tests/script-order.test.js comprueba que coincidan).

/**
 * Render the clients lists and balances in the Debts tab
 * @param {Array} debts List of customer debts
 * @param {Function} onRecordPayment Callback when a payment is processed (uuid)
 */
function renderDebts(debts, onRecordPayment) {
    const container = document.getElementById('debts-list');
    if (!container) return;

    container.innerHTML = '';

    if (debts.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; color: var(--color-text-muted); font-size: 0.875rem; padding: 3rem 0;">
                <i class="fa-solid fa-handshake-slash" style="font-size: 2rem; color: var(--color-text-muted); display: block; margin-bottom: 0.5rem;"></i>
                No hay créditos pendientes registrados en el sistema.
            </div>
        `;
        return;
    }

    debts.forEach(debt => {
        const isDebtor = debt.amount > 0;
        const card = document.createElement('div');
        card.className = `client-card${isDebtor ? ' debtor' : ''}`;
        card.style.cssText = "display: flex; flex-direction: column; gap: 0.75rem; padding: 1rem; border-radius: var(--radius-lg); background: rgba(10, 20, 38, 0.6); border: 1px solid rgba(255, 255, 255, 0.08); margin-bottom: 0.75rem;";
        
        let dateDisplay;
        let timeDisplay = '';
        try {
            const d = parseUTCTimestamp(debt.timestamp);
            dateDisplay = d.toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' });
            timeDisplay = d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
        } catch(e) {
            dateDisplay = 'Reciente';
        }

        const itemsDetail = debt.description ? debt.description : 'Sin productos especificados';

        card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 0.5rem;">
                <div>
                    <span class="client-name" style="font-size: 1.05rem; font-weight: 800; color: var(--color-white);">${escapeHtml(debt.clientName)}</span>
                    <div style="font-size: 11px; color: var(--color-text-muted); margin-top: 0.15rem; display: flex; align-items: center; gap: 0.35rem;">
                        <i class="fa-regular fa-clock" style="color: var(--color-gold);"></i>
                        <span>${dateDisplay} ${timeDisplay ? `&bull; ${timeDisplay}` : ''}</span>
                    </div>
                </div>
                <div style="text-align: right;">
                    <span class="client-balance" style="font-size: 1.25rem; font-weight: 900; color: ${isDebtor ? '#F87171' : 'var(--color-success)'}; font-family: monospace;">
                        ${isDebtor ? `$${debt.amount.toFixed(2)}` : '$0.00'}
                    </span>
                    ${isDebtor ? `<div style="font-size: 10px; color: var(--color-text-muted); font-family: monospace;">Bs. ${(debt.amount * (window.bcvRate || 1)).toFixed(2)}</div>` : ''}
                </div>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem;">
                <div style="font-size: 0.78rem; color: var(--color-white); flex: 1; min-width: 0;">
                    <i class="fa-solid fa-cookie-bite" style="color: var(--color-gold); margin-right: 0.3rem;"></i>
                    <strong style="color: var(--color-gold);">Productos:</strong> ${escapeHtml(itemsDetail)}
                </div>
                <div>
                    ${isDebtor 
                        ? `<button class="btn-pay" style="height: 32px; padding: 0 0.85rem; font-size: 0.75rem; font-weight: 800; border-radius: var(--radius-md); border: none; background: linear-gradient(135deg, #10B981 0%, #059669 100%); color: #ffffff; cursor: pointer; display: flex; align-items: center; gap: 0.35rem; box-shadow: 0 2px 6px rgba(16, 185, 129, 0.2);">
                             <i class="fa-solid fa-handshake"></i> Abonar / Pagar
                           </button>` 
                        : '<span style="color: var(--color-success); font-size: 11px; font-weight: 800; background: rgba(52,211,153,0.1); padding: 0.2rem 0.5rem; border-radius: 4px; border: 1px solid rgba(52,211,153,0.2);">Al Día</span>'
                    }
                </div>
            </div>
        `;

        if (isDebtor) {
            card.querySelector('.btn-pay').addEventListener('click', () => {
                onRecordPayment(debt.uuid);
            });
        }

        container.appendChild(card);
    });
}

/**
 * Normalizes a Venezuelan local phone number (e.g. "0412-1234567") into the
 * digits-only, country-code-prefixed format WhatsApp's click-to-chat expects.
 */
function normalizeVePhoneForWhatsapp(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (digits.startsWith('58')) return digits;
    if (digits.startsWith('0')) return `58${digits.slice(1)}`;
    return `58${digits}`;
}

/**
 * Renders the staff-facing "Pedidos Online" queue: orders customers submitted
 * from the public landing page, awaiting manual payment confirmation.
 * @param {Array} pedidos Rows from the pedidos_online table
 * @param {Function} onConfirm Callback(id) when staff confirms an order
 * @param {Function} onRechazar Callback(id) when staff rejects an order
 */
function renderPedidosOnline(pedidos, onConfirm, onRechazar) {
    const container = document.getElementById('pedidos-online-list');
    if (!container) return;

    container.innerHTML = '';

    if (!pedidos || pedidos.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; color: var(--color-text-muted); font-size: 0.875rem; padding: 3rem 0;">
                <i class="fa-solid fa-bag-shopping" style="font-size: 2rem; color: var(--color-text-muted); display: block; margin-bottom: 0.5rem;"></i>
                No hay pedidos online todavía.
            </div>
        `;
        return;
    }

    const sorted = [...pedidos].sort((a, b) => {
        if (a.status === 'pendiente' && b.status !== 'pendiente') return -1;
        if (a.status !== 'pendiente' && b.status === 'pendiente') return 1;
        return new Date(b.created_at) - new Date(a.created_at);
    });

    const statusMeta = {
        pendiente: { label: 'Pendiente', bg: 'rgba(201, 162, 74, 0.14)', border: 'rgba(201, 162, 74, 0.35)', color: 'var(--color-gold)' },
        confirmado: { label: 'Confirmado', bg: 'rgba(52, 211, 153, 0.12)', border: 'rgba(52, 211, 153, 0.3)', color: 'var(--color-success)' },
        rechazado: { label: 'Rechazado', bg: 'rgba(248, 113, 113, 0.12)', border: 'rgba(248, 113, 113, 0.3)', color: '#F87171' }
    };

    sorted.forEach(pedido => {
        const meta = statusMeta[pedido.status] || statusMeta.pendiente;
        const isPending = pedido.status === 'pendiente';

        let dateDisplay;
        let timeDisplay = '';
        try {
            const d = parseUTCTimestamp(pedido.created_at);
            dateDisplay = d.toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' });
            timeDisplay = d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
        } catch (e) {
            dateDisplay = 'Reciente';
        }

        const items = Array.isArray(pedido.items) ? pedido.items : [];
        const itemsHtml = items.map(it => `
            <div style="display: flex; justify-content: space-between; font-size: 0.8rem; color: var(--color-white); padding: 0.2rem 0;">
                <span>${it.qty}&times; ${escapeHtml(it.name)}</span>
                <span style="font-family: monospace; color: var(--color-text-muted);">$${(it.qty * it.price).toFixed(2)}</span>
            </div>
        `).join('');

        // Entrega (migración 042). Pedidos de antes de correrla traen la
        // dirección en notes, así que también se muestra.
        let entregaHtml = '';
        if (pedido.delivery_method === 'retiro') {
            entregaHtml = `<div style="font-size: 0.8rem; color: var(--color-white);"><i class="fa-solid fa-store" style="color: var(--color-gold); margin-right: 0.35rem;"></i>Retiro en el local</div>`;
        } else if (pedido.delivery_method === 'delivery') {
            entregaHtml = `
                <div style="font-size: 0.8rem; color: var(--color-white); line-height: 1.5;">
                    <div><i class="fa-solid fa-motorcycle" style="color: var(--color-gold); margin-right: 0.35rem;"></i><strong>Delivery:</strong> ${escapeHtml(pedido.delivery_address || '')}</div>
                    ${pedido.delivery_reference ? `<div><i class="fa-solid fa-location-dot" style="color: var(--color-gold); margin-right: 0.35rem;"></i><strong>Referencia:</strong> ${escapeHtml(pedido.delivery_reference)}</div>` : ''}
                    <div style="font-size: 11px; color: var(--color-text-muted); margin-top: 0.15rem;">El delivery se cobra aparte.</div>
                </div>`;
        }
        if (pedido.notes) {
            entregaHtml += `<div style="font-size: 0.8rem; color: var(--color-white);"><i class="fa-regular fa-note-sticky" style="color: var(--color-gold); margin-right: 0.35rem;"></i>${escapeHtml(pedido.notes)}</div>`;
        }
        if (entregaHtml) {
            entregaHtml = `<div style="display: flex; flex-direction: column; gap: 0.25rem; padding: 0.5rem 0.6rem; border-radius: var(--radius-md); background: rgba(201, 162, 74, 0.06); border: 1px solid rgba(201, 162, 74, 0.2);">${entregaHtml}</div>`;
        }

        const waPhone = normalizeVePhoneForWhatsapp(pedido.customer_phone);
        const waMsg = encodeURIComponent(`¡Hola ${pedido.customer_name}! Te escribimos de Casa Lucenzo sobre tu pedido por $${Number(pedido.total).toFixed(2)} (${pedido.payment_method}).`);

        const card = document.createElement('div');
        card.style.cssText = "display: flex; flex-direction: column; gap: 0.75rem; padding: 1rem; border-radius: var(--radius-lg); background: rgba(10, 20, 38, 0.6); border: 1px solid rgba(255, 255, 255, 0.08); margin-bottom: 0.75rem;";

        card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 0.5rem;">
                <div>
                    <span style="font-size: 1.05rem; font-weight: 800; color: var(--color-white);">${escapeHtml(pedido.customer_name)}</span>
                    <div style="font-size: 11px; color: var(--color-text-muted); margin-top: 0.15rem; display: flex; align-items: center; gap: 0.35rem;">
                        <i class="fa-regular fa-clock" style="color: var(--color-gold);"></i>
                        <span>${dateDisplay} &bull; ${timeDisplay}</span>
                    </div>
                    <div style="font-size: 11px; color: var(--color-text-muted); margin-top: 0.1rem;">
                        <i class="fa-solid fa-phone" style="color: var(--color-gold);"></i> ${escapeHtml(pedido.customer_phone)}
                    </div>
                </div>
                <span style="font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; padding: 0.25rem 0.55rem; border-radius: 999px; background: ${meta.bg}; border: 1px solid ${meta.border}; color: ${meta.color}; white-space: nowrap;">${meta.label}</span>
            </div>

            ${entregaHtml}

            <div>${itemsHtml}</div>

            <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 0.5rem;">
                <span style="font-size: 11px; color: var(--color-text-muted);"><i class="fa-solid fa-money-check-dollar" style="color: var(--color-gold); margin-right: 0.25rem;"></i>${escapeHtml(pedido.payment_method)}</span>
                <span style="font-size: 1.05rem; font-weight: 900; color: var(--color-gold); font-family: monospace;">$${Number(pedido.total).toFixed(2)}</span>
            </div>

            <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                <a href="https://api.whatsapp.com/send?phone=${waPhone}&text=${waMsg}" target="_blank" rel="noopener" style="flex: 1; min-width: 120px; height: 34px; padding: 0 0.75rem; border-radius: var(--radius-md); border: 1px solid rgba(37, 211, 102, 0.3); background: rgba(37, 211, 102, 0.1); color: #25D366; font-weight: 700; font-size: 0.75rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 0.35rem; text-decoration: none;">
                    <i class="fa-brands fa-whatsapp"></i> Contactar
                </a>
                ${isPending ? `
                    <button class="btn-rechazar-pedido" style="flex: 1; min-width: 120px; height: 34px; padding: 0 0.75rem; border-radius: var(--radius-md); border: 1px solid rgba(248, 113, 113, 0.3); background: rgba(248, 113, 113, 0.1); color: var(--color-danger); font-weight: 700; font-size: 0.75rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 0.35rem;">
                        <i class="fa-solid fa-xmark"></i> Rechazar
                    </button>
                    <button class="btn-confirmar-pedido" style="flex: 1; min-width: 120px; height: 34px; padding: 0 0.75rem; border-radius: var(--radius-md); border: none; background: linear-gradient(135deg, #10B981 0%, #059669 100%); color: #ffffff; font-weight: 800; font-size: 0.75rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 0.35rem; box-shadow: 0 2px 6px rgba(16, 185, 129, 0.2);">
                        <i class="fa-solid fa-check"></i> Confirmar
                    </button>
                ` : ''}
            </div>
        `;

        if (isPending) {
            card.querySelector('.btn-confirmar-pedido').addEventListener('click', () => onConfirm(pedido.id));
            card.querySelector('.btn-rechazar-pedido').addEventListener('click', () => onRechazar(pedido.id));
        }

        container.appendChild(card);
    });
}

/**
 * Updates the pending-order count badge on the Pedidos nav tab
 * @param {Array} pedidos Rows from the pedidos_online table
 */
function updatePedidosBadge(pedidos) {
    const badge = document.getElementById('pedidos-badge');
    if (!badge) return;
    const pendingCount = (pedidos || []).filter(p => p.status === 'pendiente').length;
    if (pendingCount > 0) {
        badge.innerText = pendingCount;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}
