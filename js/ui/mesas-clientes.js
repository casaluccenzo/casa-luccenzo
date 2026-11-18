// Mesas y cuentas de clientes.
//
// Antes formaba parte de js/ui.js. Script clásico (no módulo ES): comparte el
// ámbito global con los demás archivos de js/app/ y js/ui/, así que el orden de
// carga importa. Ese orden vive en sistema/index.html (y se repite en sw.js y
// js/app/index.js; tests/script-order.test.js comprueba que coincidan).

/**
 * Create and show a modal dialog with options for a specific table
 */
function showTableOptionsModal(tableName, salesLog, onUndo, onEdit, onPay, products) {
    // Find active sales for this table
    const tableSales = salesLog.filter(s => {
        const match = s.name.match(/^(.*)\s+\[(.*)\](\s*\(Pagado(?: - .*?)?\))?$/);
        if (match) {
            const client = match[2];
            const isPaid = !!match[3];
            return client === tableName && !isPaid;
        }
        return false;
    });

    const isOccupied = tableSales.length > 0;
    const totalConsumed = tableSales.reduce((sum, s) => sum + (s.price || 0), 0);
    const timestamp = isOccupied ? tableSales[0].timestamp : null;

    // Create modal backdrop overlay
    const overlay = document.createElement('div');
    overlay.className = 'modal-backdrop';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.background = 'rgba(10, 15, 30, 0.8)';
    overlay.style.backdropFilter = 'blur(6px)';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '3000';
    overlay.style.padding = '1rem';
    overlay.style.boxSizing = 'border-box';
    
    // Group active items for display
    let itemsListHtml;
    const grouped = {};
    if (isOccupied) {
        tableSales.forEach(s => {
            const cleanName = s.name.replace(/\s*\[.*\](\s*\(Pagado(?: - .*?)?\))?$/, '');
            if (!grouped[cleanName]) {
                grouped[cleanName] = { count: 0, total: 0 };
            }
            grouped[cleanName].count++;
            grouped[cleanName].total += s.price;
        });
        
        itemsListHtml = `
            <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); padding: 0.875rem; border-radius: 8px; margin: 1rem 0; font-size: 0.8rem; text-align: left; max-height: 150px; overflow-y: auto;">
                <strong style="color: var(--color-gold); display: block; margin-bottom: 0.5rem; font-size: 0.85rem; border-bottom: 1px solid rgba(212,175,55,0.2); padding-bottom: 0.25rem;">
                    <i class="fa-solid fa-receipt"></i> Consumo de la Mesa:
                </strong>
                <div style="display: flex; flex-direction: column; gap: 0.35rem; line-height: 1.4;">
                    ${Object.entries(grouped).map(([name, data]) => `
                        <div style="display: flex; justify-content: space-between;">
                            <span style="color: var(--color-white); opacity: 0.9;">${data.count}x ${name}</span>
                            <span style="font-weight: 700; color: var(--color-gold);">$${data.total.toFixed(2)}</span>
                        </div>
                    `).join('')}
                </div>
                <div style="margin-top: 0.75rem; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 0.5rem;">
                    <div style="display: flex; justify-content: space-between; font-weight: 800; font-size: 0.85rem; color: var(--color-white);">
                        <span>Total USD:</span>
                        <span style="color: var(--color-success); font-size: 0.95rem;">$${totalConsumed.toFixed(2)}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; font-weight: 700; font-size: 0.75rem; color: var(--color-text-muted); margin-top: 0.15rem;">
                        <span>Total Bs:</span>
                        <span>Bs. ${(totalConsumed * (window.bcvRate || 1)).toFixed(2)}</span>
                    </div>
                </div>
            </div>
        `;
    } else {
        itemsListHtml = `
            <div style="background: rgba(255,255,255,0.01); border: 1px dashed rgba(255,255,255,0.08); padding: 1.25rem; border-radius: 8px; margin: 1rem 0; font-size: 0.8rem; color: var(--color-text-muted);">
                <i class="fa-solid fa-circle-info" style="font-size: 1.25rem; color: var(--color-gold); display: block; margin-bottom: 0.5rem;"></i>
                Esta mesa no tiene consumos activos registrados.
            </div>
        `;
    }

    const modalBody = document.createElement('div');
    modalBody.className = 'card-pantry';
    modalBody.style.width = '100%';
    modalBody.style.maxWidth = '360px';
    modalBody.style.padding = '1.5rem';
    modalBody.style.borderRadius = '12px';
    modalBody.style.boxSizing = 'border-box';
    modalBody.style.border = '1px solid var(--color-gold)';
    modalBody.style.boxShadow = '0 10px 30px rgba(0,0,0,0.5), 0 0 20px rgba(212,175,55,0.15)';

    modalBody.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 0.75rem; margin-bottom: 0.5rem;">
            <h3 style="font-family: var(--font-serif); font-weight: 900; color: var(--color-gold); font-size: 1.25rem; margin: 0; display: flex; align-items: center; gap: 0.5rem;">
                <i class="fa-solid fa-utensils"></i> ${escapeHtml(tableName)}
            </h3>
            <span style="font-size: 9px; font-weight: 800; text-transform: uppercase; padding: 0.25rem 0.5rem; border-radius: 4px; ${isOccupied ? 'background: rgba(212,175,55,0.15); border: 1px solid var(--color-gold); color: var(--color-gold);' : 'background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: var(--color-text-muted);'}">
                ${isOccupied ? 'Ocupada' : 'Libre'}
            </span>
        </div>
        
        ${itemsListHtml}
        
        <div style="display: flex; flex-direction: column; gap: 0.6rem; margin-top: 1.25rem;">
            ${isOccupied ? `
                <button class="btn-modify-modal" style="height: 42px; display: flex; align-items: center; justify-content: center; gap: 0.5rem; font-size: 0.8rem; font-weight: 800; border-radius: 6px; border: none; cursor: pointer; transition: all 0.2s; background-color: var(--color-gold); color: #000000; width: 100%;">
                    <i class="fa-solid fa-cart-plus"></i> Comprar Más Cosas
                </button>
                <button class="btn-pay-modal" style="height: 42px; display: flex; align-items: center; justify-content: center; gap: 0.5rem; font-size: 0.8rem; font-weight: 800; border-radius: 6px; border: none; cursor: pointer; transition: all 0.2s; background-color: var(--color-success); color: #000000; width: 100%;">
                    <i class="fa-solid fa-circle-check"></i> Cerrar Venta (Pagar)
                </button>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; width: 100%;">
                    <button class="btn-share-modal" style="height: 38px; display: flex; align-items: center; justify-content: center; gap: 0.35rem; font-size: 0.75rem; font-weight: 700; border-radius: 6px; border: 1px solid rgba(16,185,129,0.3); cursor: pointer; transition: all 0.2s; background-color: rgba(16,185,129,0.05); color: var(--color-success);">
                        <i class="fa-brands fa-whatsapp"></i> Compartir
                    </button>
                    <button class="btn-detail-modal" style="height: 38px; display: flex; align-items: center; justify-content: center; gap: 0.35rem; font-size: 0.75rem; font-weight: 700; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1); cursor: pointer; transition: all 0.2s; background-color: rgba(255,255,255,0.02); color: var(--color-white);">
                        <i class="fa-solid fa-eye"></i> Ver Detalle
                    </button>
                </div>
            ` : `
                <button class="btn-open-modal" style="height: 42px; display: flex; align-items: center; justify-content: center; gap: 0.5rem; font-size: 0.8rem; font-weight: 800; border-radius: 6px; border: none; cursor: pointer; transition: all 0.2s; background-color: var(--color-gold); color: #000000; width: 100%;">
                    <i class="fa-solid fa-cart-plus"></i> Abrir Mesa (Consumir)
                </button>
            `}
            <button class="btn-close-modal" style="height: 38px; display: flex; align-items: center; justify-content: center; gap: 0.35rem; font-size: 0.75rem; font-weight: 700; border-radius: 6px; border: 1px solid rgba(255,255,255,0.08); cursor: pointer; transition: all 0.2s; background-color: transparent; color: var(--color-text-muted); width: 100%;">
                Cancelar
            </button>
        </div>
    `;

    overlay.appendChild(modalBody);
    document.body.appendChild(overlay);

    // Event listener setup
    const closeModal = () => {
        if (document.body.contains(overlay)) {
            document.body.removeChild(overlay);
        }
    };

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
    });

    modalBody.querySelector('.btn-close-modal').addEventListener('click', closeModal);

    if (isOccupied) {
        modalBody.querySelector('.btn-modify-modal').addEventListener('click', () => {
            closeModal();
            if (onEdit) onEdit(timestamp);
        });
        modalBody.querySelector('.btn-pay-modal').addEventListener('click', () => {
            closeModal();
            if (onPay) onPay(timestamp);
        });
        modalBody.querySelector('.btn-share-modal').addEventListener('click', () => {
            closeModal();
            let msg = `*CASA LUCCENZO* 🥖\n`;
            msg += `*Ticket de Consumo* 🧾\n`;
            msg += `--------------------------------------\n`;
            msg += `👤 *Cliente/Mesa:* ${tableName}\n`;
            msg += `📅 *Fecha/Hora:* ${parseUTCTimestamp(timestamp).toLocaleString()}\n`;
            msg += `--------------------------------------\n`;
            Object.entries(grouped).forEach(([name, data]) => {
                msg += `• ${data.count}x ${name} - $${data.total.toFixed(2)}\n`;
            });
            msg += `--------------------------------------\n`;
            msg += `💵 *Total a Pagar:* *$${totalConsumed.toFixed(2)} USD*\n`;
            msg += `💵 *Tasa BCV:* ${(window.bcvRate || 1).toFixed(2)} Bs.\n`;
            msg += `🇻🇪 *Total en Bolívares:* *Bs. ${(totalConsumed * (window.bcvRate || 1)).toFixed(2)} VES*\n`;
            msg += `--------------------------------------\n`;
            msg += `¡Muchas gracias por su compra! 🌟`;

            const encoded = encodeURIComponent(msg);
            window.open(`https://api.whatsapp.com/send?text=${encoded}`, '_blank');
        });
        modalBody.querySelector('.btn-detail-modal').addEventListener('click', () => {
            closeModal();
            // Switch to Cuentas tab and scroll
            const btnSubCuentas = document.getElementById('btn-sub-cuentas');
            if (btnSubCuentas) btnSubCuentas.click();
            
            setTimeout(() => {
                const element = document.querySelector(`[data-client-timestamp="${timestamp}"]`);
                if (element) {
                    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    element.style.background = 'rgba(212,175,55,0.12)';
                    setTimeout(() => {
                        element.style.background = '';
                    }, 1500);
                }
            }, 100);
        });
    } else {
        modalBody.querySelector('.btn-open-modal').addEventListener('click', () => {
            closeModal();
            sessionStorage.setItem('casa_lucenzo_editing_client_name', tableName);
            switchView('local');
            showToast(`📝 Cuenta iniciada para ${tableName}. ¡Agrega pastelitos!`, 'fa-solid fa-pen-to-square');
        });
    }
}

/**
 * Shows the full detail + actions modal for a single active (unpaid) client
 * account, opened by tapping its compact tile in Cuentas Activas. Mirrors
 * showTableOptionsModal's look and close-before-act pattern.
 * @param {Object} group Grouped sale {timestamp, clientName, clientRif, items, total}
 * @param {Function} onUndo Undo sale callback
 * @param {Function} onEdit Edit sale callback
 * @param {Function} onPay Pay/Close sale callback
 */
function showClientAccountModal(group, onUndo, onEdit, onPay) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-backdrop';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.background = 'rgba(10, 15, 30, 0.8)';
    overlay.style.backdropFilter = 'blur(6px)';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '3000';
    overlay.style.padding = '1rem';
    overlay.style.boxSizing = 'border-box';

    const rate = window.bcvRate || 1;

    const itemsListHtml = `
        <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); padding: 0.875rem; border-radius: 8px; margin: 1rem 0; font-size: 0.8rem; text-align: left; max-height: 150px; overflow-y: auto;">
            <strong style="color: var(--color-gold); display: block; margin-bottom: 0.5rem; font-size: 0.85rem; border-bottom: 1px solid rgba(212,175,55,0.2); padding-bottom: 0.25rem;">
                <i class="fa-solid fa-receipt"></i> Consumo:
            </strong>
            <div style="display: flex; flex-direction: column; gap: 0.35rem; line-height: 1.4;">
                ${group.items.map(it => `
                    <div style="display: flex; justify-content: space-between;">
                        <span style="color: var(--color-white); opacity: 0.9;">${it.quantity}x ${escapeHtml(it.name)}</span>
                        <span style="font-weight: 700; color: var(--color-gold);">$${getItemTotalUSD(it).toFixed(2)}</span>
                    </div>
                `).join('')}
            </div>
            <div style="margin-top: 0.75rem; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 0.5rem;">
                <div style="display: flex; justify-content: space-between; font-weight: 800; font-size: 0.85rem; color: var(--color-white);">
                    <span>Total USD:</span>
                    <span style="color: var(--color-success); font-size: 0.95rem;">$${group.total.toFixed(2)}</span>
                </div>
                <div style="display: flex; justify-content: space-between; font-weight: 700; font-size: 0.75rem; color: var(--color-text-muted); margin-top: 0.15rem;">
                    <span>Total Bs:</span>
                    <span>Bs. ${(group.total * rate).toFixed(2)}</span>
                </div>
            </div>
        </div>
    `;

    const modalBody = document.createElement('div');
    modalBody.className = 'card-pantry';
    modalBody.style.width = '100%';
    modalBody.style.maxWidth = '360px';
    modalBody.style.padding = '1.5rem';
    modalBody.style.borderRadius = '12px';
    modalBody.style.boxSizing = 'border-box';
    modalBody.style.border = '1px solid var(--color-gold)';
    modalBody.style.boxShadow = '0 10px 30px rgba(0,0,0,0.5), 0 0 20px rgba(212,175,55,0.15)';

    modalBody.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 0.75rem; margin-bottom: 0.5rem;">
            <h3 style="font-family: var(--font-serif); font-weight: 900; color: var(--color-gold); font-size: 1.15rem; margin: 0; display: flex; align-items: center; gap: 0.5rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                <i class="fa-solid fa-user-tag"></i> ${escapeHtml(group.clientName)}
            </h3>
            <span style="font-size: 9px; font-weight: 800; text-transform: uppercase; padding: 0.25rem 0.5rem; border-radius: 4px; background: rgba(212,175,55,0.15); border: 1px solid var(--color-gold); color: var(--color-gold); flex-shrink: 0;">
                Consumiendo
            </span>
        </div>
        ${group.clientRif ? `<div style="font-size: 11px; color: var(--color-text-muted); margin-top: -0.25rem;">Cédula/RIF: ${escapeHtml(group.clientRif)}</div>` : ''}

        ${itemsListHtml}

        <div style="display: flex; flex-direction: column; gap: 0.6rem;">
            <button class="btn-modal-pos" style="height: 40px; display: flex; align-items: center; justify-content: center; gap: 0.5rem; font-size: 0.78rem; font-weight: 800; border-radius: 6px; border: 1px solid rgba(212,175,55,0.4); cursor: pointer; background-color: rgba(212,175,55,0.15); color: var(--color-gold); width: 100%;">
                <i class="fa-solid fa-receipt"></i> Factura POS
            </button>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
                <button class="btn-modal-modify" style="height: 40px; display: flex; align-items: center; justify-content: center; gap: 0.4rem; font-size: 0.78rem; font-weight: 800; border-radius: 6px; border: none; cursor: pointer; background-color: var(--color-gold); color: var(--color-bg-navy);">
                    <i class="fa-solid fa-pen-to-square"></i> Modificar
                </button>
                <button class="btn-modal-pay" style="height: 40px; display: flex; align-items: center; justify-content: center; gap: 0.4rem; font-size: 0.78rem; font-weight: 800; border-radius: 6px; border: none; cursor: pointer; background-color: var(--color-success); color: var(--color-bg-navy);">
                    <i class="fa-solid fa-circle-check"></i> Registrar Pago
                </button>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
                <button class="btn-modal-share" style="height: 36px; display: flex; align-items: center; justify-content: center; gap: 0.4rem; font-size: 0.72rem; font-weight: 700; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1); cursor: pointer; background-color: transparent; color: var(--color-text-muted);">
                    <i class="fa-brands fa-whatsapp"></i> Compartir
                </button>
                <button class="btn-modal-undo" style="height: 36px; display: flex; align-items: center; justify-content: center; gap: 0.4rem; font-size: 0.72rem; font-weight: 700; border-radius: 6px; border: none; cursor: pointer; background-color: var(--color-danger); color: var(--color-white);">
                    <i class="fa-solid fa-rotate-left"></i> Deshacer
                </button>
            </div>
            <button class="btn-modal-close" style="height: 36px; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 700; border-radius: 6px; border: 1px solid rgba(255,255,255,0.08); cursor: pointer; background-color: transparent; color: var(--color-text-muted); width: 100%;">
                Cerrar
            </button>
        </div>
    `;

    overlay.appendChild(modalBody);
    document.body.appendChild(overlay);

    const closeModal = () => {
        if (document.body.contains(overlay)) {
            document.body.removeChild(overlay);
        }
    };

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
    });

    modalBody.querySelector('.btn-modal-close').addEventListener('click', closeModal);

    modalBody.querySelector('.btn-modal-pos').addEventListener('click', () => {
        closeModal();
        showPaymentMethodModal(group.clientName, group.clientRif, group.items, group.timestamp, (method, name, rif) => {
            if (onPay) onPay(group.timestamp, method, name, rif);
        });
    });

    modalBody.querySelector('.btn-modal-modify').addEventListener('click', () => {
        closeModal();
        if (onEdit) onEdit(group.timestamp);
    });

    modalBody.querySelector('.btn-modal-pay').addEventListener('click', () => {
        closeModal();
        showPaymentMethodModal(group.clientName, group.clientRif, group.items, group.timestamp, (method, name, rif) => {
            if (onPay) onPay(group.timestamp, method, name, rif);
        });
    });

    modalBody.querySelector('.btn-modal-share').addEventListener('click', () => {
        closeModal();
        let msg = `*CASA LUCCENZO* 🥖\n`;
        msg += `*Ticket de Consumo* 🧾\n`;
        msg += group.clientRif ? `👤 *Cliente:* ${group.clientName} (${group.clientRif})\n` : `👤 *Cliente:* ${group.clientName}\n`;
        msg += `--------------------------------------\n`;
        group.items.forEach(it => {
            msg += `• ${it.quantity}x ${it.name} - $${(it.price * it.quantity).toFixed(2)}\n`;
        });
        msg += `--------------------------------------\n`;
        msg += `💵 *Total a Pagar:* *$${group.total.toFixed(2)} USD*\n`;
        msg += `💵 *Tasa BCV:* ${rate.toFixed(2)} Bs.\n`;
        msg += `🇻🇪 *Total en Bolívares:* *Bs. ${(group.total * rate).toFixed(2)} VES*\n`;
        msg += `--------------------------------------\n`;
        msg += `¡Muchas gracias por su compra! 🌟`;

        const encoded = encodeURIComponent(msg);
        window.open(`https://api.whatsapp.com/send?text=${encoded}`, '_blank');
    });

    modalBody.querySelector('.btn-modal-undo').addEventListener('click', () => {
        closeModal();
        if (onUndo) onUndo(group.timestamp);
    });
}

/**
 * Groups a raw sales log into per-account (per-client) transactions by
 * parsing the "[ClientName]" / "(Pagado - Method)" tags baked into the sale
 * name at checkout (see handleCheckoutCart / markTransactionAsPaid in
 * app.js -- there is no client_id column, this string tag is the only link
 * between a sale row and the account it belongs to). Shared by the live
 * Clientes historial and the day-close report's "Ventas por Cliente" view
 * so both read the same account boundaries from any day's raw sales.
 * @param {Array} salesLog Raw sale rows (any day, not just today)
 * @returns {Array} Account groups sorted newest-first
 */
function groupSalesByClientAccounts(salesLog) {
    const groups = {};
    salesLog.forEach(sale => {
        let productName = sale.name;
        let clientName;
        let isPaid = false;
        let paymentMethod = '';

        const match = sale.name.match(/^(.*)\s+\[(.*)\](\s*\(Pagado(?: - .*?)?\))?$/);
        if (match) {
            productName = match[1];
            clientName = match[2];
            isPaid = !!match[3];
            if (isPaid && match[3]) {
                const methodMatch = match[3].match(/\(Pagado\s*-\s*(.*?)\)/);
                paymentMethod = methodMatch ? methodMatch[1] : 'Efectivo';
            }
        } else {
            productName = sale.name;
            clientName = sale.productId === 'abono' ? 'Abono Deuda' : 'Cliente';
        }

        let clientRif = '';
        let rawClientStr = clientName;
        if (clientName.includes(' - ')) {
            const parts = clientName.split(/\s+-\s+/);
            rawClientStr = parts[0].trim();
            clientRif = parts[1].trim();
        }

        const key = sale.timestamp;
        if (!groups[key]) {
            groups[key] = {
                timestamp: sale.timestamp,
                clientName: rawClientStr,
                clientRif: clientRif,
                isPaid: isPaid,
                paymentMethod: paymentMethod,
                // The rate this account was actually charged at, so reprinting
                // its invoice later (any day) shows that rate, not today's --
                // see showPosReceiptModal.
                bcvRate: sale.bcvRate || null,
                items: [],
                total: 0
            };
        } else {
            if (isPaid) {
                groups[key].isPaid = true;
            }
            if (paymentMethod && !groups[key].paymentMethod) {
                groups[key].paymentMethod = paymentMethod;
            }
        }

        const existingItem = groups[key].items.find(item => item.name === productName);
        if (existingItem) {
            existingItem.quantity += 1;
            existingItem.totalPrice += sale.price;
        } else {
            groups[key].items.push({
                productId: sale.productId,
                name: productName,
                price: sale.price,
                quantity: 1,
                totalPrice: sale.price
            });
        }
        groups[key].total += sale.price;
    });

    return Object.values(groups).sort((a, b) => parseUTCTimestamp(b.timestamp) - parseUTCTimestamp(a.timestamp));
}

/**
 * Render the dedicated Clientes view
 * @param {Array} salesLog Today's sales log
 * @param {Function} onUndo Undo sale callback
 * @param {Function} onEdit Edit sale callback
 * @param {Function} onPay Pay/Close sale callback
 * @param {Array} products All products list
 */
function renderClientesView(salesLog, onUndo, onEdit, onPay, products) {
    // 1. Update Live Statistics Card
    const liveVitrinaEl = document.getElementById('live-stat-vitrina');
    const liveVendidosEl = document.getElementById('live-stat-vendidos');
    const liveVentasEl = document.getElementById('live-stat-ventas');

    // Total in vitrina: sum of all product stock (only savory pastelitos)
    const pastelitoProducts = products.filter(p => p.category === 'pastelitos');
    const totalInVitrina = pastelitoProducts.reduce((sum, p) => sum + (p.stock || 0), 0);
    const totalMaxVitrina = pastelitoProducts.reduce((sum, p) => sum + (p.max || 0), 0);
    if (liveVitrinaEl) {
        liveVitrinaEl.textContent = `${totalInVitrina} / ${totalMaxVitrina}`;
    }

    // Filter salesLog for TODAY ONLY (current day starting at 00:00:00)
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

    const todaySalesLog = salesLog.filter(s => {
        if (!s.timestamp) return false;
        try {
            const d = parseUTCTimestamp(s.timestamp);
            return d >= startOfToday;
        } catch (e) {
            return false;
        }
    });

    // Total sold today: count of all checked out sales today (except debt payments 'abono')
    const totalPiecesSold = todaySalesLog.filter(s => s.productId !== 'abono' && !(window.Combos && window.Combos.isDeliverySale(s))).length;
    if (liveVendidosEl) {
        liveVendidosEl.textContent = totalPiecesSold;
    }

    const rate = window.bcvRate || 1;

    // Total sales money today
    const totalSalesMoney = todaySalesLog.reduce((sum, s) => sum + (s.price || 0), 0);
    const totalSalesVES = totalSalesMoney * rate;
    if (liveVentasEl) {
        liveVentasEl.innerHTML = `
            <div style="font-size: 1.125rem; font-weight: 900; color: var(--color-success);">$${totalSalesMoney.toFixed(2)}</div>
            <div style="font-size: 9px; font-weight: 700; color: var(--color-text-muted); margin-top: 1px;">Bs. ${totalSalesVES.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        `;
    }

    // Total Real Sold (based on physical difference in vitrina: initial_stock - stock)
    const expectedSalesValue = products.reduce((sum, p) => {
        if (p.id === 'abono') return sum;
        const initial = (p.initial_stock !== undefined && p.initial_stock !== null) ? p.initial_stock : (p.max || 0);
        const stock = p.stock || 0;
        const expectedQty = Math.max(0, initial - stock);
        return sum + (expectedQty * (p.price || 0));
    }, 0);

    // Add any manual abonos/other non-inventory transactions recorded today
    // (and the delivery charges, which don't come out of the vitrina either)
    // and the productos extra bought next door)
    const abonosValue = todaySalesLog.filter(s => s.productId === 'abono' || (window.Combos && (window.Combos.isDeliverySale(s) || window.Combos.isExtraSale(s)))).reduce((sum, s) => sum + (s.price || 0), 0);

    const totalRealMoney = expectedSalesValue + abonosValue;
    const totalRealVES = totalRealMoney * rate;
    const activeRole = sessionStorage.getItem('casa_lucenzo_active_role');
    const liveTotalRealCard = document.getElementById('live-stat-total-real-card');
    if (liveTotalRealCard) {
        if (activeRole === 'admin') {
            liveTotalRealCard.style.display = 'block';
        } else {
            liveTotalRealCard.style.display = 'none';
        }
    }

    const liveTotalRealEl = document.getElementById('live-stat-total-real');
    if (liveTotalRealEl) {
        liveTotalRealEl.innerHTML = `
            <div style="font-size: 1.125rem; font-weight: 900; color: var(--color-success);">$${totalRealMoney.toFixed(2)}</div>
            <div style="font-size: 9px; font-weight: 700; color: var(--color-success); margin-top: 1px;">Bs. ${totalRealVES.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        `;
    }

    // Group categories dynamically for TODAY's sales
    const activeProducts = (products && products.length > 0) ? products : (window.products || window.StorageManager.loadProducts() || []);
    const categoryStatsMap = {};

    todaySalesLog.forEach(s => {
        let catKey;
        let catLabel;
        let icon;
        let color;
        let unitLabel;
        let sortOrder;

        if (s.productId === 'abono') {
            catKey = 'otros';
            catLabel = 'Abonos / Créditos';
            icon = 'fa-money-bill-wave';
            color = '#D4A373';
            unitLabel = 'op.';
            sortOrder = 99;
        } else {
            const product = activeProducts.find(p => p.id === s.productId);
            let rawCat = product ? product.category : '';
            
            if (!rawCat || rawCat === 'otros') {
                const nameLower = (s.name || '').toLowerCase();
                if (nameLower.includes('malta') || nameLower.includes('refresco') || nameLower.includes('agua') || nameLower.includes('jugo')) {
                    rawCat = 'bebidas';
                } else {
                    rawCat = 'pastelitos';
                }
            }

            if (window.Combos && window.Combos.isDeliverySale(s)) {
                catKey = 'delivery';
                catLabel = 'Delivery (fuera de IVA)';
                icon = 'fa-motorcycle';
                color = '#D4AF37';
                unitLabel = 'envíos';
                sortOrder = 85;
            } else if (window.Combos && window.Combos.isExtraSale(s)) {
                catKey = 'extra';
                catLabel = 'Productos extra (comprados afuera)';
                icon = 'fa-bag-shopping';
                color = '#38BDF8';
                unitLabel = 'unid.';
                sortOrder = 75;
            } else if (window.Combos && window.Combos.isStaffSale(s)) {
                catKey = 'personal';
                catLabel = 'Consumo del personal (al costo)';
                icon = 'fa-user-group';
                color = '#94A3B8';
                unitLabel = 'piezas';
                sortOrder = 80;
            } else if (rawCat === 'pastelitos') {
                const unitPrice = s.price || (product ? product.price : 0);
                catKey = `pastelitos_${unitPrice.toFixed(2)}`;
                catLabel = `Pastelitos ($${unitPrice.toFixed(2)})`;
                icon = 'fa-cookie';
                color = '#FFB085';
                unitLabel = 'piezas';
                sortOrder = 10 + unitPrice;
            } else if (rawCat === 'empanadas') {
                catKey = 'empanadas';
                catLabel = 'Empanadas';
                icon = 'fa-cookie';
                color = '#F4C27A';
                unitLabel = 'piezas';
                sortOrder = 40;
            } else if (rawCat === 'minis') {
                catKey = 'minis';
                catLabel = 'Pastelitos mini';
                icon = 'fa-cookie';
                color = '#FFCBA4';
                unitLabel = 'piezas';
                sortOrder = 45;
            } else if (rawCat === 'bebidas') {
                catKey = 'bebidas';
                catLabel = 'Bebidas';
                icon = 'fa-bottle-water';
                color = '#8BE8CB';
                unitLabel = 'unid.';
                sortOrder = 50;
            } else if (rawCat === 'dulces') {
                catKey = 'dulces';
                catLabel = 'Dulces';
                icon = 'fa-candy-cane';
                color = '#C084FC';
                unitLabel = 'unid.';
                sortOrder = 60;
            } else {
                catKey = 'otros';
                catLabel = 'Otros / Varios';
                icon = 'fa-box';
                color = '#D4A373';
                unitLabel = 'op.';
                sortOrder = 90;
            }
        }

        if (!categoryStatsMap[catKey]) {
            categoryStatsMap[catKey] = {
                id: catKey,
                label: catLabel,
                icon: icon,
                color: color,
                unitLabel: unitLabel,
                sortOrder: sortOrder,
                qty: 0,
                usd: 0,
                flavors: {}
            };
        }

        const group = categoryStatsMap[catKey];
        group.qty++;
        group.usd += s.price || 0;

        const flavorId = s.productId === 'abono' ? 'abono' : (s.productId || s.name);
        let flavorName = s.name;
        if (s.productId !== 'abono') {
            flavorName = s.name.replace(/\s*\[.*\](\s*\(Pagado(?: - .*?)?\))?$/, '');
        }

        if (!group.flavors[flavorId]) {
            group.flavors[flavorId] = { name: flavorName, qty: 0, usd: 0 };
        }
        group.flavors[flavorId].qty++;
        group.flavors[flavorId].usd += s.price || 0;
    });

    const categoriesContainer = document.getElementById('live-stat-categories');
    if (categoriesContainer) {
        const rate = window.bcvRate || 1;
        const formatUSD = (val) => '$' + (val || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const formatVES = (val) => 'Bs. ' + (val || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        const sortedStats = Object.values(categoryStatsMap).sort((a, b) => a.sortOrder - b.sortOrder);

        let html = '';
        sortedStats.forEach(cat => {
            const flavorsList = Object.values(cat.flavors).sort((a, b) => b.qty - a.qty);
            const badgeClass = cat.id.startsWith('pastelitos') ? 'pastelitos' : cat.id;

            html += `
                <div class="category-stat-wrapper">
                    <div class="category-stat-row" id="${cat.id}-stat-row" style="cursor: pointer; user-select: none;">
                        <div class="category-label">
                            <i class="fa-solid fa-chevron-down" style="color: var(--color-text-muted);"></i>
                            <i class="fa-solid ${cat.icon}" style="color: ${cat.color};"></i>
                            <span>${cat.label}</span>
                        </div>
                        <div class="category-values">
                            <span class="category-qty-badge ${badgeClass}">${cat.qty} ${cat.unitLabel}</span>
                            <span class="category-price-usd">${formatUSD(cat.usd)}</span>
                            <span class="category-price-ves">(${formatVES(cat.usd * rate)})</span>
                        </div>
                    </div>
                    <div class="category-stat-dropdown" id="${cat.id}-stat-dropdown">
                        ${flavorsList.length > 0
                            ? flavorsList.map(f => `
                                <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--color-white); padding: 0.35rem 0; border-bottom: 1px dashed rgba(255,255,255,0.03);">
                                    <span style="font-weight: 700; color: var(--color-white);">${f.name}</span>
                                    <div style="display: flex; gap: 0.5rem; align-items: center; font-family: monospace;">
                                        <span style="color: var(--color-gold); font-weight: 800;">${f.qty} ${cat.unitLabel}</span>
                                        <span style="color: var(--color-success); font-weight: 800;">${formatUSD(f.usd)}</span>
                                        <span style="color: var(--color-text-muted); font-size: 0.7rem;">(${formatVES(f.usd * rate)})</span>
                                    </div>
                                </div>
                            `).join('')
                            : `<div style="text-align: center; color: var(--color-text-muted); font-size: 11px; padding: 0.5rem 0;">No hay ventas registradas.</div>`
                        }
                    </div>
                </div>
            `;
        });

        if (sortedStats.length === 0) {
            html = `<div style="text-align: center; color: var(--color-text-muted); font-size: 0.8125rem; padding: 1rem 0;">No hay ventas registradas hoy.</div>`;
        }

        categoriesContainer.innerHTML = html;

        // Bind toggle click handlers for each dynamic category card
        sortedStats.forEach(cat => {
            const row = document.getElementById(`${cat.id}-stat-row`);
            const dropdown = document.getElementById(`${cat.id}-stat-dropdown`);
            if (row && dropdown) {
                row.addEventListener('click', () => {
                    row.classList.toggle('open');
                    dropdown.classList.toggle('open');
                });
            }
        });

        // 1b. Render Inventory Reconciliation (Match)
        const matchSection = document.getElementById('inventory-match-section');
        if (matchSection) {
            const activeRole = sessionStorage.getItem('casa_lucenzo_active_role');
            if (activeRole !== 'admin') {
                matchSection.classList.add('hidden');
                matchSection.innerHTML = '';
            } else {
                const auditedProducts = [];
            products.forEach(p => {
                if (p.id === 'abono') return;
                const initial = (p.initial_stock !== undefined && p.initial_stock !== null) ? p.initial_stock : (p.max || 0);
                if (initial === 0) return; // Ignore products that have no loaded capacity today
                
                const stock = p.stock || 0;
                const expectedSales = Math.max(0, initial - stock);
                const loggedSales = salesLog.filter(s => s.productId === p.id).length;
                const discrepancy = expectedSales - loggedSales;
                
                if (discrepancy !== 0) {
                    auditedProducts.push({
                        product: p,
                        max: initial,
                        stock: stock,
                        expected: expectedSales,
                        logged: loggedSales,
                        discrepancy: discrepancy,
                        value: discrepancy * (p.price || 0)
                    });
                }
            });

            if (auditedProducts.length === 0) {
                matchSection.classList.add('hidden');
                matchSection.innerHTML = '';
            } else {
                matchSection.classList.remove('hidden');
                
                const totalMissingQty = auditedProducts.reduce((sum, p) => sum + (p.discrepancy > 0 ? p.discrepancy : 0), 0);
                const totalMissingVal = auditedProducts.reduce((sum, p) => sum + (p.discrepancy > 0 ? p.value : 0), 0);
                
                let matchHtml = `
                    <h4 style="font-size: 11px; font-weight: 900; color: var(--color-success); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem; display: flex; align-items: center; justify-content: space-between;">
                        <span><i class="fa-solid fa-scale-balanced"></i> Conciliación de Vitrina y Caja</span>
                        ${totalMissingQty > 0 ? `
                        <span style="font-size: 9px; padding: 2px 6px; border-radius: 4px; background: rgba(248, 113, 113, 0.15); color: var(--color-danger); border: 1px solid rgba(248, 113, 113, 0.2); font-weight: 800;">
                            ${totalMissingQty} unids. sin registrar
                        </span>` : ''}
                    </h4>
                    <p style="font-size: 11px; color: var(--color-text-muted); margin-bottom: 0.75rem;">
                        Hay diferencias entre las piezas vendidas físicas y los registros del sistema.
                    </p>
                    
                    <div style="display: flex; flex-direction: column; gap: 0.4rem; margin-bottom: 1rem;">
                `;
                
                auditedProducts.forEach(item => {
                    const color = item.discrepancy > 0 ? '#F87171' : '#60A5FA';
                    const label = item.discrepancy > 0 ? `Faltan ${item.discrepancy} por registrar` : `Sobran ${Math.abs(item.discrepancy)} registradas`;
                    const pricePrefix = item.discrepancy > 0 ? '+' : '';
                    
                    matchHtml += `
                        <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); padding: 0.5rem 0.75rem; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem;">
                            <div>
                                <div style="font-weight: bold; color: var(--color-white);">${item.product.name}</div>
                                <div style="font-size: 10px; color: var(--color-text-muted); margin-top: 2px;">
                                    Inicial: ${item.max} | Quedan: ${item.stock} | Registrado: ${item.logged}
                                </div>
                            </div>
                            <div style="text-align: right; font-family: monospace;">
                                <div style="color: ${color}; font-weight: 800; font-size: 10px;">${label}</div>
                                <div style="color: ${item.discrepancy > 0 ? 'var(--color-success)' : 'var(--color-danger)'}; font-weight: 800; font-size: 10px; margin-top: 1px;">
                                    ${pricePrefix}$${Math.abs(item.value).toFixed(2)}
                                </div>
                            </div>
                        </div>
                    `;
                });
                
                matchHtml += `
                    </div>
                    
                    <div style="display: flex; gap: 0.5rem; align-items: center; justify-content: space-between; background: rgba(16, 185, 129, 0.04); border: 1px solid rgba(16, 185, 129, 0.1); padding: 0.625rem; border-radius: 6px;">
                        <div>
                            <div style="font-size: 9px; color: var(--color-text-muted); text-transform: uppercase;">Caja por registrar:</div>
                            <div style="font-size: 1rem; font-weight: 900; color: var(--color-success); font-family: monospace; margin-top: 2px;">
                                +$${totalMissingVal.toFixed(2)}
                            </div>
                        </div>
                        ${totalMissingQty > 0 ? `
                        <button id="btn-reconcile-inventory" class="btn-action-small" style="background-color: var(--color-success); border-color: var(--color-success-border); color: #000000; font-weight: 900; padding: 0.4rem 0.75rem; font-size: 10px; height: auto;">
                            <i class="fa-solid fa-bolt"></i> Autocorregir Caja
                        </button>` : `
                        <span style="font-size: 10px; font-weight: 700; color: var(--color-gold);">Exceso de registros</span>`}
                    </div>
                `;
                
                matchSection.innerHTML = matchHtml;
                
                const btnReconcile = document.getElementById('btn-reconcile-inventory');
                if (btnReconcile) {
                    btnReconcile.addEventListener('click', () => {
                        if (confirm(`¿Estás seguro de registrar las ${totalMissingQty} ventas faltantes en la caja de hoy ($${totalMissingVal.toFixed(2)})?`)) {
                            if (typeof window.handleAutocorrectSales === 'function') {
                                window.handleAutocorrectSales(auditedProducts);
                            }
                        }
                    });
                }
            }
        }
    }
}

    // 2. Render 6 Tables Grid
    const tablesContainer = document.getElementById('tables-grid-container');
    if (tablesContainer) {
        let tablesHtml = `
            <h4 style="font-size: 11px; font-weight: 900; color: var(--color-gold); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.75rem; display: flex; align-items: center; gap: 0.35rem;">
                <i class="fa-solid fa-table-cells-large"></i> Mesas en el Local
            </h4>
            <div class="tables-grid" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem;">
        `;

        for (let t = 1; t <= 6; t++) {
            const tableName = `Mesa ${t}`;
            
            // Find if this table has any active (unpaid) entries
            const tableSales = salesLog.filter(s => {
                const match = s.name.match(/^(.*)\s+\[(.*)\](\s*\(Pagado(?: - .*?)?\))?$/);
                if (match) {
                    const client = match[2];
                    const isPaid = !!match[3];
                    return client === tableName && !isPaid;
                }
                return false;
            });

            const isOccupied = tableSales.length > 0;
            const totalConsumed = tableSales.reduce((sum, s) => sum + (s.price || 0), 0);
            
            let statusText = 'Libre';
            let statusClass = 'status-free';
            let cardStyle = 'background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); padding: 0.75rem; border-radius: 6px; text-align: center; cursor: pointer; transition: all 0.2s;';
            
            if (isOccupied) {
                statusText = `Ocupada ($${totalConsumed.toFixed(2)})`;
                statusClass = 'status-occupied';
                cardStyle = 'background: rgba(212,175,55,0.05); border: 1px solid var(--color-gold); padding: 0.75rem; border-radius: 6px; text-align: center; cursor: pointer; transition: all 0.2s; box-shadow: 0 0 10px rgba(212,175,55,0.1);';
            }

            tablesHtml += `
                <div class="table-card" style="${cardStyle}" data-table="${tableName}">
                    <div style="font-size: 0.75rem; font-weight: 800; color: ${isOccupied ? 'var(--color-gold)' : 'var(--color-text-muted)'};">${tableName}</div>
                    <div style="font-size: 9px; margin-top: 0.25rem; font-weight: 700;" class="${statusClass}">${statusText}</div>
                </div>
            `;
        }

        tablesHtml += `</div>`;
        tablesContainer.innerHTML = tablesHtml;

        // Add event listeners to table cards to open options modal
        tablesContainer.querySelectorAll('.table-card').forEach(card => {
            card.addEventListener('click', () => {
                const tableName = card.getAttribute('data-table');
                showTableOptionsModal(tableName, salesLog, onUndo, onEdit, onPay, products);
            });
        });
    }

    // 3. Render Clients Lists (Active vs Closed)
    const activosContainer = document.getElementById('clientes-activos-container');
    const pagadosContainer = document.getElementById('clientes-pagados-container');
    if (!activosContainer || !pagadosContainer) return;

    activosContainer.innerHTML = '';
    // Si se está mirando un día pasado en el Historial, el repintado de hoy
    // (que pasa a cada venta o sincronización) no lo toca.
    const showToday = !historialDay;
    initHistorialDayBar();
    if (showToday) {
        pagadosContainer.innerHTML = '';
        historialGroups.clear();
    }
    activosContainer.style.display = 'grid';
    activosContainer.style.gridTemplateColumns = 'repeat(auto-fill, minmax(135px, 1fr))';
    activosContainer.style.gap = '0.5rem';




    // Group salesLog by client account (shared with the day-close report's
    // "Ventas por Cliente" view -- see groupSalesByClientAccounts).
    const groupedList = groupSalesByClientAccounts(salesLog);

    let activeCount = 0;
    let paidCount = 0;

    // Historial separado por turno (mañana / tarde), con la misma raya de las
    // 3:30 p.m. de Caracas que usa el Corte de turno.
    const shiftOf = window.shiftOfTimestamp || (() => 'manana');
    const shiftBuckets = { manana: { cards: [], total: 0, totalBs: 0 }, tarde: { cards: [], total: 0, totalBs: 0 } };

    groupedList.forEach(group => {
        let timeStr;
        try {
            const date = parseUTCTimestamp(group.timestamp);
            timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch(e) {
            timeStr = 'Ahora';
        }

        // Active (unpaid) accounts: compact tile -- tap to open the full detail
        // + actions in showClientAccountModal, so several accounts fit on
        // screen at once instead of one full card each.
        if (!group.isPaid) {
            const tile = document.createElement('div');
            tile.className = 'client-tile';
            tile.setAttribute('data-client-timestamp', group.timestamp);
            tile.style.background = 'rgba(212,175,55,0.06)';
            tile.style.border = '1px solid var(--color-gold)';
            tile.style.borderRadius = '10px';
            tile.style.padding = '0.9rem 0.65rem';
            tile.style.textAlign = 'center';
            tile.style.cursor = 'pointer';

            const totalVES = group.total * (window.bcvRate || 1);
            tile.innerHTML = `
                <div style="font-size: 12px; font-weight: 800; color: var(--color-gold); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(group.clientName)}</div>
                <div style="font-size: 15px; font-weight: 900; color: var(--color-white); margin-top: 0.3rem;">$${group.total.toFixed(2)}</div>
                <div style="font-size: 10px; font-weight: 700; color: var(--color-text-muted); margin-top: 0.1rem;">Bs. ${totalVES.toFixed(2)}</div>
                <div style="font-size: 9px; color: var(--color-gold); margin-top: 0.25rem; font-weight: 800;">${timeStr}</div>
            `;

            tile.addEventListener('click', () => {
                showClientAccountModal(group, onUndo, onEdit, onPay);
            });

            activosContainer.appendChild(tile);
            activeCount++;
            return;
        }

        // Paid/closed accounts (Historial): unchanged full card
        if (!showToday) return;
        const isTodayPaid = parseUTCTimestamp(group.timestamp) >= startOfToday;
        if (!isTodayPaid) return;

        const card = document.createElement('div');
        card.className = 'history-item';
        card.setAttribute('data-client-timestamp', group.timestamp);
        card.style.flexDirection = 'column';
        card.style.alignItems = 'stretch';
        card.style.gap = '0.5rem';
        card.style.padding = '0.75rem';

        const itemsSummary = group.items.map(it => `${it.quantity}x ${it.name}`).join(', ');

        const statusBadge = `<span class="client-status-badge paid">Pagado (${group.paymentMethod || 'Efectivo'})</span>`;

        card.innerHTML = `
            <!-- Header: Name, Status -->
            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                <h4 style="font-size: 13px; font-weight: 800; color: var(--color-gold); margin: 0; display: flex; align-items: center; gap: 0.3rem;">
                    <i class="fa-solid fa-user-tag" style="font-size: 11px; opacity: 0.8;"></i> ${group.clientName}
                    ${group.clientRif ? `<span style="font-size: 10px; color: var(--color-text-muted); font-weight: bold;">(${group.clientRif})</span>` : ''}
                </h4>
                ${statusBadge}
            </div>
            
            <!-- Subtitle: Time and Total -->
            <div style="font-size: 11px; color: var(--color-text-muted); margin-top: -0.15rem; display: flex; justify-content: space-between; align-items: center; width: 100%;">
                <span>${timeStr}</span>
                <span style="font-weight: 700; color: var(--color-white);">Total: $${group.total.toFixed(2)} <span style="font-weight: 500; font-size: 10px; color: var(--color-text-muted);">(Bs. ${(group.total * (window.bcvRate || 1)).toFixed(2)})</span></span>
            </div>
            
            <!-- Items list -->
            <div style="font-size: 11px; color: var(--color-white); opacity: 0.85; padding-top: 0.35rem; border-top: 1px solid rgba(255,255,255,0.04); margin-bottom: 0.25rem;">
                <strong>Lleva:</strong> ${itemsSummary}
            </div>
            
            <!-- Factura talonario (se emite sola al cobrar) -->
            <div class="hist-inv-badge" data-ts="${escapeHtml(group.timestamp)}" style="font-size: 11px; color: var(--color-text-muted); display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;"></div>

            <!-- Action Buttons Row -->
            <div style="display: flex; gap: 0.4rem; width: 100%; border-top: 1px solid rgba(255,255,255,0.04); padding-top: 0.5rem; justify-content: flex-end; flex-wrap: wrap;">
                <button class="btn-action-small btn-pos-ticket-client" title="Ver / Imprimir Factura POS SENIAT" style="flex: 1.5; height: 36px; justify-content: center; font-size: 0.75rem; background-color: rgba(212,175,55,0.18); color: var(--color-gold); border: 1px solid rgba(212,175,55,0.4); font-weight: 800;">
                    <i class="fa-solid fa-receipt"></i> Factura POS
                </button>
                <button class="btn-action-small btn-share-client" title="Compartir Ticket" style="height: 36px; width: 38px; justify-content: center; font-size: 0.75rem;">
                    <i class="fa-brands fa-whatsapp"></i>
                </button>
                <button class="btn-action-small btn-modify-client" style="flex: 1.5; height: 36px; justify-content: center; background-color: ${group.isPaid ? 'var(--color-warning)' : 'var(--color-gold)'}; color: var(--color-bg-navy); font-size: 0.75rem;" title="${group.isPaid ? 'Corregir una venta ya cobrada (la cuenta vuelve a quedar pendiente de pago para registrar el cobro correcto)' : 'Agregar más cosas'}">
                    <i class="fa-solid fa-pen-to-square"></i> ${group.isPaid ? 'Corregir' : 'Modificar'}
                </button>
                ${!group.isPaid ? `
                    <button class="btn-action-small btn-pay-client" style="flex: 1.5; height: 36px; justify-content: center; background-color: var(--color-success); color: var(--color-bg-navy); font-size: 0.75rem; font-weight: 800;" title="Marcar como pagada y registrar cobro">
                        <i class="fa-solid fa-circle-check"></i> Registrar Pago
                    </button>
                ` : ''}
                <button class="btn-action-small btn-undo-client" style="height: 36px; justify-content: center; width: 38px; background-color: var(--color-danger); color: var(--color-white);" title="Deshacer y devolver stock">
                    <i class="fa-solid fa-rotate-left"></i>
                </button>
            </div>
        `;

        // Bind event listeners
        card.querySelector('.btn-pos-ticket-client').addEventListener('click', () => {
            if (group.isPaid) {
                // Already collected: just reprint the ticket, read-only. Routing this
                // through showPaymentMethodModal (below) would surface its "CONFIRMAR Y
                // REGISTRAR PAGO" button, which silently overwrites the recorded
                // payment method if a cashier taps it out of habit while just trying
                // to view/reprint a closed sale's receipt.
                showPosReceiptModal({
                    cart: group.items,
                    clientName: group.clientName,
                    clientRif: group.clientRif,
                    timestamp: group.timestamp,
                    facNo: (group.timestamp.replace(/\D/g, '') + '0000').substring(0, 16),
                    isAlreadyPaid: true,
                    payMethod: group.paymentMethod || 'Efectivo',
                    rate: group.bcvRate
                });
            } else {
                showPaymentMethodModal(group.clientName, group.clientRif, group.items, group.timestamp, (method, name, rif) => {
                    if (onPay) onPay(group.timestamp, method, name, rif);
                });
            }
        });

        card.querySelector('.btn-share-client').addEventListener('click', () => {
            let msg = `*CASA LUCCENZO* 🥖\n`;
            msg += `*Ticket de Consumo* 🧾\n`;
            msg += group.clientRif ? `👤 *Cliente:* ${group.clientName} (${group.clientRif})\n` : `👤 *Cliente:* ${group.clientName}\n`;
            msg += `--------------------------------------\n`;
            group.items.forEach(it => {
                msg += `• ${it.quantity}x ${it.name} - $${(it.price * it.quantity).toFixed(2)}\n`;
            });
            msg += `--------------------------------------\n`;
            msg += `💵 *Total a Pagar:* *$${group.total.toFixed(2)} USD*\n`;
            msg += `💵 *Tasa BCV:* ${(window.bcvRate || 1).toFixed(2)} Bs.\n`;
            msg += `🇻🇪 *Total en Bolívares:* *Bs. ${(group.total * (window.bcvRate || 1)).toFixed(2)} VES*\n`;
            msg += `--------------------------------------\n`;
            msg += `¡Muchas gracias por su compra! 🌟`;

            const encoded = encodeURIComponent(msg);
            window.open(`https://api.whatsapp.com/send?text=${encoded}`, '_blank');
        });

        card.querySelector('.btn-modify-client').addEventListener('click', () => {
            if (onEdit) onEdit(group.timestamp);
        });

        card.querySelector('.btn-undo-client').addEventListener('click', () => {
            if (onUndo) onUndo(group.timestamp);
        });

        historialGroups.set(group.timestamp, group);
        const bucket = shiftBuckets[shiftOf(group.timestamp)] || shiftBuckets.manana;
        bucket.cards.push(card);
        bucket.total += group.total;
        bucket.totalBs += group.total * (window.bcvRate || 1);
        paidCount++;
    });
    if (!showToday) {
        if (activeCount === 0) activosContainer.innerHTML = '<div style="font-size: 11px; color: var(--color-text-muted); padding: 0.5rem; text-align: center;">No hay cuentas activas abiertas consumiendo.</div>';
        return;
    }
    if (paidCount > 0) renderHistorialShifts(pagadosContainer, shiftBuckets);
    refreshHistorialInvoices();

    if (activeCount === 0) {
        activosContainer.innerHTML = '<div style="font-size: 11px; color: var(--color-text-muted); padding: 0.5rem; text-align: center;">No hay cuentas activas abiertas consumiendo.</div>';
    }
    if (paidCount === 0) {
        pagadosContainer.innerHTML = '<div style="font-size: 11px; color: var(--color-text-muted); padding: 0.5rem; text-align: center;">No hay historial de cuentas pagadas hoy.</div>';
    }
}
