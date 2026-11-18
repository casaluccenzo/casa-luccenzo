// Cobro: RIF/datos del cliente, método de pago, recibo y factura.
//
// Antes formaba parte de js/ui.js. Script clásico (no módulo ES): comparte el
// ámbito global con los demás archivos de js/app/ y js/ui/, así que el orden de
// carga importa. Ese orden vive en sistema/index.html (y se repite en sw.js y
// js/app/index.js; tests/script-order.test.js comprueba que coincidan).

/**
 * Shows the dedicated Payment Method Selection Modal when registering payment for an open account card
 */
// Cédula / RIF con su letra: V- cédula, J- RIF de empresa, E- extranjero.
// La letra se elige aparte y el número se escribe solo, así no hace falta
// teclear el guion. G- y P- no se ofrecen pero se respetan si ya venían.
const RIF_TYPES = [
    { letter: 'V', label: 'V- Cédula' },
    { letter: 'J', label: 'J- RIF' },
    { letter: 'E', label: 'E- Extranjero' }
];

function splitRif(value = '') {
    const text = String(value || '').trim();
    const match = text.match(/^([VJEGP])\s*-?\s*(.*)$/i);
    if (match) return { letter: match[1].toUpperCase(), number: match[2].trim() };
    return { letter: 'V', number: text };
}

function joinRif(letter, number) {
    const clean = String(number || '').trim().replace(/^[VJEGP]\s*-\s*/i, '');
    return clean ? `${letter}-${clean}` : '';
}

function rifFieldHtml(id, value = '', inputStyle = '') {
    const { letter, number } = splitRif(value);
    const types = RIF_TYPES.some(t => t.letter === letter) ? RIF_TYPES : [...RIF_TYPES, { letter, label: `${letter}-` }];
    return `
        <div style="display: flex; gap: 0.4rem;">
            <select id="${id}-type" aria-label="Tipo de documento" style="${inputStyle} width: auto; flex: 0 0 auto; cursor: pointer;">
                ${types.map(t => `<option value="${t.letter}"${t.letter === letter ? ' selected' : ''}>${t.label}</option>`).join('')}
            </select>
            <input type="text" id="${id}" inputmode="numeric" maxlength="20" placeholder="Número" value="${escapeHtml(number)}" style="${inputStyle} flex: 1; min-width: 0;">
        </div>`;
}

function readRifField(root, id) {
    return joinRif(root.querySelector(`#${id}-type`).value, root.querySelector(`#${id}`).value);
}

/**
 * Pide la cédula / RIF al cobrar (con V-, J- o E- aparte).
 * Resuelve con el texto ("V-12345678", o '' si se deja vacío) o null si se cancela.
 */
function promptClientRif(initial = '') {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-backdrop';
        Object.assign(overlay.style, {
            position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
            backgroundColor: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', zIndex: '3200', padding: '1rem', boxSizing: 'border-box'
        });
        const inputStyle = 'box-sizing: border-box; background: var(--v-0-0-0-4, rgba(0, 0, 0, 0.4)); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; padding: 10px; color: var(--color-white); font-weight: 700; font-size: 1rem;';
        overlay.innerHTML = `
            <form style="width: 100%; max-width: 380px; background: #111827; border: 1px solid rgba(212,175,55,0.4); border-radius: 14px; padding: 1.1rem; color: #FFFFFF; box-sizing: border-box;">
                <div style="font-weight: 900; color: var(--color-gold); margin-bottom: 0.2rem;">Cédula / RIF del cliente</div>
                <div style="font-size: 0.75rem; color: var(--color-text-muted); margin-bottom: 0.75rem;">Opcional. Elija V-, J- o E- y escriba el número.</div>
                ${rifFieldHtml('checkout-rif', initial, inputStyle)}
                <div style="display: flex; gap: 0.5rem; margin-top: 0.9rem;">
                    <button type="button" class="btn-rif-cancel" style="flex: 1; height: 42px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); background: transparent; color: var(--color-white); font-weight: 800; cursor: pointer;">Cancelar</button>
                    <button type="submit" style="flex: 2; height: 42px; border-radius: 8px; border: none; background: var(--color-gold); color: var(--color-bg-navy); font-weight: 900; cursor: pointer;">Continuar</button>
                </div>
            </form>`;
        document.body.appendChild(overlay);
        const form = overlay.querySelector('form');
        const finish = (value) => { overlay.remove(); resolve(value); };
        overlay.querySelector('.btn-rif-cancel').addEventListener('click', () => finish(null));
        form.addEventListener('submit', (e) => { e.preventDefault(); finish(readRifField(overlay, 'checkout-rif')); });
        setTimeout(() => overlay.querySelector('#checkout-rif').focus(), 50);
    });
}

/**
 * Al cobrar: nombre y cédula del cliente en una sola ventana. El campo del nombre es un buscador
 * con menú desplegable de clientes que ya compraron (js/clientes-frecuentes.js). Elegir uno
 * llena el nombre y la cédula; se pueden corregir antes de seguir.
 * Resuelve con { name, rif } (rif '' si se deja vacío) o null si se cancela.
 */
function promptClientData(defaultName = '', localSales = [], defaultRif = '') {
    return new Promise((resolve) => {
        const CF = window.ClientesFrecuentes;
        const overlay = document.createElement('div');
        overlay.className = 'modal-backdrop';
        Object.assign(overlay.style, {
            position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
            backgroundColor: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', zIndex: '3200', padding: '1rem', boxSizing: 'border-box'
        });
        const inputStyle = 'box-sizing: border-box; background: var(--v-0-0-0-4, rgba(0, 0, 0, 0.4)); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; padding: 10px; color: var(--color-white); font-weight: 700; font-size: 1rem;';
        const labelStyle = 'display: block; font-size: 0.75rem; color: var(--color-text-muted); font-weight: 800; margin: 0.7rem 0 0.25rem; text-transform: uppercase;';
        overlay.innerHTML = `
            <form style="width: 100%; max-width: 420px; background: #111827; border: 1px solid rgba(212,175,55,0.4); border-radius: 14px; padding: 1.1rem; color: #FFFFFF; box-sizing: border-box;">
                <div style="font-weight: 900; color: var(--color-gold); font-size: 1.05rem;"><i class="fa-solid fa-user"></i> Datos del cliente</div>
                <label for="checkout-client-name" style="${labelStyle}">Nombre y apellido / Razón Social</label>
                <div style="position: relative;">
                    <input type="text" id="checkout-client-name" autocomplete="off" maxlength="80" value="${escapeHtml(defaultName)}"
                        placeholder="${CF ? 'Escriba para buscar o agregar' : 'Ej: María Pérez'}"
                        role="combobox" aria-expanded="false" aria-controls="checkout-client-list" aria-autocomplete="list"
                        style="${inputStyle} width: 100%; padding-right: 40px;">
                    ${CF ? `<button type="button" class="btn-client-toggle" aria-label="Ver clientes" tabindex="-1" style="position: absolute; right: 4px; top: 50%; transform: translateY(-50%); width: 34px; height: 34px; border: none; background: transparent; color: var(--color-gold); font-size: 0.9rem; cursor: pointer;">▼</button>
                    <div id="checkout-client-list" role="listbox" hidden style="position: absolute; left: 0; right: 0; top: calc(100% + 4px); z-index: 5; max-height: 220px; overflow-y: auto; background: #0b1220; border: 1px solid rgba(212,175,55,0.45); border-radius: 8px; box-shadow: 0 12px 30px rgba(0,0,0,0.6);"></div>` : ''}
                </div>
                <label for="checkout-rif" style="${labelStyle}">Cédula / RIF (opcional)</label>
                ${rifFieldHtml('checkout-rif', defaultRif, inputStyle)}
                <div style="display: flex; gap: 0.5rem; margin-top: 1rem;">
                    <button type="button" class="btn-client-cancel" style="flex: 1; height: 44px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); background: transparent; color: var(--color-white); font-weight: 800; cursor: pointer;">Cancelar</button>
                    <button type="submit" style="flex: 2; height: 44px; border-radius: 8px; border: none; background: var(--color-gold); color: var(--color-bg-navy); font-weight: 900; cursor: pointer;">Continuar</button>
                </div>
            </form>`;
        document.body.appendChild(overlay);
        const form = overlay.querySelector('form');
        const nameInput = overlay.querySelector('#checkout-client-name');
        const rifType = overlay.querySelector('#checkout-rif-type');
        const rifInput = overlay.querySelector('#checkout-rif');
        const list = overlay.querySelector('#checkout-client-list');
        let directory = [];
        let loaded = false;
        let found = [];
        let active = -1;

        const closeList = () => {
            if (!list) return;
            list.hidden = true;
            nameInput.setAttribute('aria-expanded', 'false');
            active = -1;
        };

        const pick = (c) => {
            const { letter, number } = splitRif(c.rif);
            nameInput.value = c.name;
            if (![...rifType.options].some(o => o.value === letter)) { const opt = document.createElement('option'); opt.value = letter; opt.textContent = `${letter}-`; rifType.appendChild(opt); }
            rifType.value = letter;
            rifInput.value = number;
            closeList();
        };

        // Menú desplegable bajo el nombre: filtra mientras se escribe (pocos a la vista, el resto con scroll).
        function openList() {
            if (!list) return;
            if (!loaded) {
                list.innerHTML = `<div style="padding: 0.6rem 0.75rem; font-size: 0.8rem; color: var(--color-text-muted);">Cargando clientes…</div>`;
            } else {
                found = CF.search(directory, nameInput.value, 30);
                if (!found.length) { closeList(); return; }
                list.innerHTML = found.map((c, i) => `
                    <div role="option" data-i="${i}" aria-selected="${i === active}" style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; padding: 0.6rem 0.75rem; cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.06); background: ${i === active ? 'rgba(212,175,55,0.2)' : 'transparent'};">
                        <span style="font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(c.name)}</span>
                        <span style="flex: 0 0 auto; font-size: 0.8rem; color: var(--color-gold); font-weight: 800;">${escapeHtml(c.rif)}</span>
                    </div>`).join('');
                // mousedown (no click) para elegir antes de que el campo pierda el foco.
                list.querySelectorAll('[data-i]').forEach(row => {
                    row.addEventListener('mousedown', (e) => { e.preventDefault(); pick(found[Number(row.dataset.i)]); });
                });
                const sel = list.querySelector(`[data-i="${active}"]`);
                if (sel) sel.scrollIntoView({ block: 'nearest' });
            }
            list.hidden = false;
            nameInput.setAttribute('aria-expanded', 'true');
        }

        if (CF && list) {
            nameInput.addEventListener('input', () => { active = -1; openList(); });
            nameInput.addEventListener('focus', openList);
            nameInput.addEventListener('blur', () => setTimeout(closeList, 120));
            nameInput.addEventListener('keydown', (e) => {
                if (list.hidden || !found.length) return;
                if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(found.length - 1, active + 1); openList(); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); openList(); }
                else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(found[active]); }
                else if (e.key === 'Escape') { e.preventDefault(); closeList(); }
            });
            overlay.querySelector('.btn-client-toggle').addEventListener('mousedown', (e) => {
                e.preventDefault();
                if (list.hidden) { nameInput.focus(); openList(); } else closeList();
            });
            CF.load(localSales).then(l => { directory = l || []; }).catch(() => { directory = []; }).finally(() => {
                loaded = true;
                if (!list.hidden) openList();
            });
        }

        const finish = (value) => { overlay.remove(); resolve(value); };
        overlay.querySelector('.btn-client-cancel').addEventListener('click', () => finish(null));
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            finish({ name: nameInput.value.trim(), rif: readRifField(overlay, 'checkout-rif') });
        });
        setTimeout(() => nameInput.focus(), 50);
    });
}

function showPaymentMethodModal(clientName, clientRif, items = [], timestamp = new Date().toISOString(), onSelect = null) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-backdrop';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.backgroundColor = 'rgba(0,0,0,0.85)';
    overlay.style.backdropFilter = 'blur(8px)';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '3000';
    overlay.style.padding = '1rem';
    overlay.style.boxSizing = 'border-box';
    overlay.style.overflowY = 'auto';

    const rate = window.bcvRate || 1;
    const totalUSD = items.reduce((sum, it) => sum + getItemTotalUSD(it), 0);
    const totalVES = totalUSD * rate;

    const modalBody = document.createElement('div');
    modalBody.style.width = '100%';
    modalBody.style.maxWidth = '400px';
    modalBody.style.maxHeight = '90vh';
    modalBody.style.overflowY = 'auto';
    modalBody.style.backgroundColor = '#111827';
    modalBody.style.border = '1px solid rgba(212,175,55,0.4)';
    modalBody.style.borderRadius = '14px';
    modalBody.style.boxShadow = '0 20px 50px rgba(0,0,0,0.8)';
    modalBody.style.color = '#FFFFFF';
    modalBody.style.padding = '1.25rem';
    modalBody.style.boxSizing = 'border-box';

    const formatVES = (val) => 'Bs. ' + (val || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const safeClientName = clientName || 'Cliente';
    const safeClientRif = clientRif || '';
    let selectedMethod = 'Punto de Venta';

    const paymentOptions = [
        { id: 'Punto de Venta', label: '💳 Punto de Venta', icon: 'fa-credit-card', color: '#3B82F6' },
        { id: 'Pago Móvil', label: '📱 Pago Móvil', icon: 'fa-mobile-screen-button', color: '#10B981' },
        { id: 'Efectivo $', label: '💵 Efectivo Divisas ($)', icon: 'fa-money-bill-wave', color: '#F59E0B' },
        { id: 'Efectivo Bs.', label: '💵 Efectivo Bs.', icon: 'fa-money-bill-1', color: '#8B5CF6' },
        { id: 'Transferencia', label: '🏦 Transferencia', icon: 'fa-building-columns', color: '#06B6D4' },
        { id: 'Biopago', label: '👆 Biopago', icon: 'fa-fingerprint', color: '#EC4899' }
    ];

    modalBody.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 0.75rem; margin-bottom: 1rem;">
            <h3 style="font-family: var(--font-serif); font-size: 1.1rem; color: var(--color-gold); font-weight: 900; margin: 0; text-transform: uppercase; display: flex; align-items: center; gap: 0.5rem;">
                <i class="fa-solid fa-wallet"></i> Seleccionar Método de Pago
            </h3>
            <button class="btn-close-pay-modal" style="background: none; border: none; color: var(--color-text-muted); font-size: 1.25rem; cursor: pointer;">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>

        <!-- Total Header Banner -->
        <div style="background: rgba(212,175,55,0.1); border: 1px solid rgba(212,175,55,0.3); border-radius: 10px; padding: 0.75rem; margin-bottom: 1rem; text-align: center;">
            <div style="font-size: 0.8rem; color: var(--color-text-muted); text-transform: uppercase; font-weight: 700;">
                Cliente: <strong style="color: var(--color-white);">${safeClientName}</strong> ${safeClientRif ? '('+safeClientRif+')' : ''}
            </div>
            <div style="font-size: 1.4rem; font-weight: 900; color: var(--color-gold); margin-top: 0.2rem;">
                $${totalUSD.toFixed(2)} USD
            </div>
            <div style="font-size: 0.85rem; color: var(--color-success); font-weight: 800; margin-top: 0.1rem;">
                ${formatVES(totalVES)} <span style="font-size: 0.7rem; color: var(--color-text-muted); font-weight: normal;">(Tasa: ${rate.toFixed(2)} Bs.)</span>
            </div>
        </div>

        <!-- Payment Method Selection Grid -->
        <div style="font-size: 0.8rem; font-weight: 800; color: var(--color-gold); margin-bottom: 0.5rem; text-transform: uppercase;">
            MÉTODO DE PAGO RECIBIDO:
        </div>

        <div id="payment-methods-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-bottom: 1rem;">
            ${paymentOptions.map(opt => `
                <button class="btn-pay-option ${opt.id === selectedMethod ? 'active-pay-option' : ''}" data-method="${opt.id}" style="
                    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.3rem;
                    padding: 0.75rem 0.5rem; border-radius: 10px; cursor: pointer; text-align: center;
                    border: 2px solid ${opt.id === selectedMethod ? 'var(--color-gold)' : 'rgba(255,255,255,0.1)'};
                    background: ${opt.id === selectedMethod ? 'rgba(212,175,55,0.18)' : 'rgba(255,255,255,0.03)'};
                    color: ${opt.id === selectedMethod ? 'var(--color-gold)' : 'var(--color-white)'};
                    transition: all 0.2s; outline: none;
                ">
                    <i class="fa-solid ${opt.icon}" style="font-size: 1.25rem; color: ${opt.color};"></i>
                    <span style="font-size: 0.75rem; font-weight: 800;">${opt.label}</span>
                </button>
            `).join('')}
        </div>

        <!-- Client Info Inputs (Editable) -->
        <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 0.75rem; margin-bottom: 1rem; font-size: 0.75rem;">
            <div style="margin-bottom: 0.5rem;">
                <label style="display: block; color: var(--color-text-muted); font-weight: 700; margin-bottom: 0.2rem;">Nombre / Razón Social:</label>
                <input type="text" id="pay-client-name-input" value="${safeClientName}" style="width: 100%; box-sizing: border-box; background: var(--v-0-0-0-4, rgba(0, 0, 0, 0.4)); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; padding: 6px 8px; color: var(--color-white); font-weight: 700; font-size: 0.8rem;">
            </div>
            <div>
                <label style="display: block; color: var(--color-text-muted); font-weight: 700; margin-bottom: 0.2rem;">Cédula / RIF (Opcional):</label>
                ${rifFieldHtml('pay-client-rif-input', safeClientRif, 'box-sizing: border-box; background: var(--v-0-0-0-4, rgba(0, 0, 0, 0.4)); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; padding: 6px 8px; color: var(--color-white); font-weight: 700; font-size: 0.8rem;')}
            </div>
        </div>

        <!-- Action Controls -->
        <div style="display: flex; flex-direction: column; gap: 0.5rem;">
            <button class="btn-confirm-final-pay" style="height: 46px; display: flex; align-items: center; justify-content: center; gap: 0.5rem; font-size: 0.95rem; font-weight: 900; border-radius: 8px; border: none; cursor: pointer; background: var(--color-success); color: var(--color-bg-navy); width: 100%;">
                <i class="fa-solid fa-circle-check"></i> CONFIRMAR Y REGISTRAR PAGO
            </button>
            <button class="btn-view-pos-receipt" style="height: 38px; display: flex; align-items: center; justify-content: center; gap: 0.4rem; font-size: 0.78rem; font-weight: 800; border-radius: 8px; border: 1px solid rgba(212,175,55,0.3); cursor: pointer; background: rgba(212,175,55,0.1); color: var(--color-gold); width: 100%;">
                <i class="fa-solid fa-receipt"></i> VER / IMPRIMIR COMPROBANTE TÉRMICO
            </button>
        </div>
    `;

    overlay.appendChild(modalBody);
    document.body.appendChild(overlay);

    const closeModal = () => {
        overlay.style.opacity = '0';
        overlay.style.transition = 'opacity 0.2s ease-out';
        setTimeout(() => overlay.remove(), 200);
    };

    modalBody.querySelector('.btn-close-pay-modal').addEventListener('click', closeModal);

    // Option selection logic
    const optionBtns = modalBody.querySelectorAll('.btn-pay-option');
    optionBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            selectedMethod = btn.dataset.method;
            optionBtns.forEach(b => {
                const isActive = b.dataset.method === selectedMethod;
                b.style.border = isActive ? '2px solid var(--color-gold)' : '2px solid rgba(255,255,255,0.1)';
                b.style.background = isActive ? 'rgba(212,175,55,0.18)' : 'rgba(255,255,255,0.03)';
                b.style.color = isActive ? 'var(--color-gold)' : 'var(--color-white)';
            });
        });
    });

    modalBody.querySelector('.btn-view-pos-receipt').addEventListener('click', () => {
        const currentName = modalBody.querySelector('#pay-client-name-input').value.trim() || safeClientName;
        const currentRif = readRifField(modalBody, 'pay-client-rif-input') || safeClientRif;
        showPosReceiptModal({
            cart: items,
            clientName: currentName,
            clientRif: currentRif,
            timestamp: timestamp,
            facNo: (timestamp.replace(/\D/g, '') + '0000').substring(0, 16),
            isAlreadyPaid: false,
            payMethod: selectedMethod
        });
    });

    modalBody.querySelector('.btn-confirm-final-pay').addEventListener('click', () => {
        const updatedName = modalBody.querySelector('#pay-client-name-input').value.trim() || 'Cliente';
        const updatedRif = readRifField(modalBody, 'pay-client-rif-input');
        closeModal();
        if (onSelect) onSelect(selectedMethod, updatedName, updatedRif);
    });
}

/**
 * Shows a POS Thermal Receipt preview modal for a client order
 */
function showPosReceiptModal({
    cart = [],
    clientName = 'Cliente',
    clientRif = '',
    timestamp = new Date().toISOString(),
    facNo = '',
    isAlreadyPaid = false,
    payMethod = '',
    rate: rateOverride = null
}) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-backdrop';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.backgroundColor = 'rgba(0,0,0,0.85)';
    overlay.style.backdropFilter = 'blur(8px)';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '3000';
    overlay.style.padding = '1rem';
    overlay.style.boxSizing = 'border-box';
    overlay.style.overflowY = 'auto';

    // A closed sale already has the BCV rate it was actually charged at
    // (see groupSalesByClientAccounts) -- an invoice for a past day must keep
    // showing that rate, not whatever the dollar happens to be worth right
    // now, or the Bs. total on a reprinted "Factura POS SENIAT" stops
    // matching what the client actually paid. Only a not-yet-charged sale
    // (no rate passed in) falls back to the live rate.
    const rate = (rateOverride && !isNaN(parseFloat(rateOverride)) && parseFloat(rateOverride) > 0)
        ? parseFloat(rateOverride)
        : (window.bcvRate || 1);
    const totalUSD = cart.reduce((sum, item) => sum + getItemTotalUSD(item), 0);
    const totalVES = totalUSD * rate;

    // Prices already include the 16% IVA. When a client asks for a factura,
    // the toggle below only breaks the same total down into base imponible
    // + IVA (SENIAT) -- the amount charged never changes.
    // The staff's pastelitos (at cost) carry no IVA and stay out of the base.
    // The delivery is outside IVA too (and outside the factura talonario).
    const exemptVES = cart.reduce((sum, item) => sum + (window.Combos && (window.Combos.isStaffSale(item) || window.Combos.isDeliverySale(item)) ? getItemTotalUSD(item) : 0), 0) * rate;
    const deliveryReceiptVES = (window.Combos ? window.Combos.deliveryUsdOf(cart.map(item => ({ ...item, price: getItemTotalUSD(item), quantity: 1 }))) : 0) * rate;
    const baseImponibleVES = (totalVES - exemptVES) / 1.16;
    const iva16VES = totalVES - exemptVES - baseImponibleVES;

    let timeStr = 'Ahora';
    let dateStr = new Date().toLocaleDateString('es-VE');
    try {
        const d = parseUTCTimestamp(timestamp);
        timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        dateStr = d.toLocaleDateString('es-VE');
    } catch { /* unparseable timestamp -- keep the 'Ahora' / today defaults above */ }

    if (!facNo) {
        facNo = (timestamp.replace(/\D/g, '') + '0000').substring(0, 16);
    }

    const modalBody = document.createElement('div');
    modalBody.style.width = '100%';
    modalBody.style.maxWidth = '360px';
    modalBody.style.maxHeight = '90vh';
    modalBody.style.overflowY = 'auto';
    modalBody.style.backgroundColor = '#111827';
    modalBody.style.border = '1px solid rgba(212,175,55,0.4)';
    modalBody.style.borderRadius = '14px';
    modalBody.style.boxShadow = '0 20px 50px rgba(0,0,0,0.8)';
    modalBody.style.color = '#FFFFFF';
    modalBody.style.padding = '1.25rem';
    modalBody.style.boxSizing = 'border-box';

    const formatVES = (val) => 'Bs. ' + (val || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    modalBody.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 0.75rem; margin-bottom: 0.75rem;">
            <h3 style="font-family: var(--font-serif); font-size: 1rem; color: var(--color-gold); font-weight: 900; margin: 0; text-transform: uppercase; display: flex; align-items: center; gap: 0.4rem;">
                <i class="fa-solid fa-receipt"></i> Comprobante POS
            </h3>
            <button class="btn-close-pos-modal" style="background: none; border: none; color: var(--color-text-muted); font-size: 1.25rem; cursor: pointer;">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>

        <!-- Optional Factura IVA Toggle Bar -->
        <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); padding: 0.4rem 0.6rem; border-radius: 8px; margin-bottom: 0.75rem; font-size: 0.75rem;">
            <span style="color: var(--color-text-muted); font-weight: 600;">¿Cliente pidió factura?</span>
            <label style="display: flex; align-items: center; gap: 0.3rem; cursor: pointer;">
                <input type="checkbox" id="toggle-pos-iva" style="cursor: pointer;">
                <span style="font-weight: 700; color: var(--color-gold);">Facturar con IVA (16% incluido)</span>
            </label>
        </div>

        <!-- Printable Receipt Paper -->
        <div id="pos-paper-container" style="background-color: #FFFFFF; color: #000000; font-family: 'Courier New', Courier, monospace; padding: 1.25rem 0.75rem; border-radius: 6px; box-shadow: 0 4px 15px rgba(0,0,0,0.3); font-size: 0.75rem; line-height: 1.35;">
            
            <!-- SENIAT Header -->
            <div style="text-align: center; font-weight: bold; margin-bottom: 0.4rem;">
                <div style="font-size: 1rem; letter-spacing: 0.05em;">SENIAT</div>
                <div style="font-size: 0.75rem;">RIF J-508183134</div>
                <div style="font-size: 0.75rem; margin-top: 0.15rem;">EMPRENDIMIENTO KAIRA BLANCO</div>
                <div style="font-size: 0.85rem; margin-top: 0.2rem; font-weight: 900;">CASA LUCENZO</div>
                <div style="font-size: 0.62rem; font-weight: normal; margin-top: 0.25rem; color: #333; line-height: 1.2;">
                    AV WINSTON CHURCHILL ENTRE 3ERA Y 4TA CARRERA SUR LOCAL NRO S/N SECTOR PUEBLO NUEVO SUR EL TIGRE ANZOATEGUI ZONA POSTAL 6050
                </div>
            </div>

            <div style="border-top: 1px dashed #000; margin: 0.35rem 0;"></div>

            <!-- Client & Order Info -->
            <div style="font-size: 0.72rem; margin-bottom: 0.35rem;">
                <div style="display: flex; justify-content: space-between;">
                    <span>RIF/C.I.:</span>
                    <span style="font-weight: bold;">${clientRif}</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-top: 0.1rem;">
                    <span>RAZON SOCIAL:</span>
                    <span style="font-weight: bold;">${clientName}</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-top: 0.1rem;">
                    <span>DIR.:</span>
                    <span>EL TIGRE, ANZOATEGUI</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-top: 0.1rem;">
                    <span>CAJA:</span>
                    <span>01 -Oper.: CAJA PRINCIPAL</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-top: 0.1rem;">
                    <span>PRODUCTOS: ${cart.filter(item => !(window.Combos && window.Combos.isDeliverySale(item))).length}</span>
                    <span>TOT. REF: $${totalUSD.toFixed(2)}</span>
                </div>
            </div>

            <div style="border-top: 1px dashed #000; margin: 0.35rem 0;"></div>

            <!-- Factura Bar & Date -->
            <div style="text-align: center; margin: 0.4rem 0 0.3rem 0;">
                <div style="font-size: 0.85rem; font-weight: 900; letter-spacing: 0.08em; text-transform: uppercase;">FACTURA</div>
                <div style="display: flex; justify-content: space-between; font-size: 0.72rem; margin-top: 0.15rem;">
                    <span>FACTURA: ${facNo}</span>
                    <span>HORA: ${timeStr}</span>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 0.72rem;">
                    <span>FECHA: ${dateStr}</span>
                </div>
            </div>

            <!-- Product Rows Table -->
            <div style="border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 0.4rem 0; margin-bottom: 0.4rem;">
                <div style="display: flex; justify-content: space-between; font-weight: bold; border-bottom: 1px solid #000; padding-bottom: 0.2rem; margin-bottom: 0.3rem;">
                    <span>Cant x Producto</span>
                    <span>Total</span>
                </div>
                ${cart.map(item => {
                    const displayName = window.Combos && window.Combos.isDeliverySale(item) ? window.Combos.DELIVERY.label : cleanProductName(item.name);
                    const qty = item.quantity || 1;
                    const itemTotalUSD = getItemTotalUSD(item);
                    const unitPrice = qty > 0 ? (itemTotalUSD / qty) : 0;
                    const itemTotalVES = itemTotalUSD * rate;
                    return `
                        <div style="margin-bottom: 0.35rem;">
                            <div style="display: flex; justify-content: space-between; font-weight: 800;">
                                <span>${qty}x ${displayName}</span>
                                <span>$${itemTotalUSD.toFixed(2)}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; font-size: 0.68rem; color: #444; margin-top: 0.05rem;">
                                <span>@ $${unitPrice.toFixed(2)} (${formatVES(unitPrice * rate)})</span>
                                <span>${formatVES(itemTotalVES)}</span>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>

            <!-- Totals Section -->
            <div style="font-size: 0.75rem;">
                <div style="display: flex; justify-content: space-between; font-weight: bold; margin-bottom: 0.15rem;">
                    <span>SUBTOTAL:</span>
                    <span id="pos-subtotal-value">${formatVES(totalVES)}</span>
                </div>
                <div id="pos-iva-rows" style="display: none;">
                    <div style="display: flex; justify-content: space-between; font-size: 0.72rem; color: #222; margin-bottom: 0.15rem; border-top: 1px dashed #aaa; padding-top: 0.2rem;">
                        <span>BASE IMPONIBLE:</span>
                        <span>${formatVES(baseImponibleVES)}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 0.72rem; color: #222; margin-bottom: 0.2rem;">
                        <span>IVA (16%):</span>
                        <span>${formatVES(iva16VES)}</span>
                    </div>
                    ${deliveryReceiptVES > 0 ? `
                    <div style="display: flex; justify-content: space-between; font-size: 0.72rem; color: #222; margin-bottom: 0.2rem;">
                        <span>DELIVERY (NO SUJETO A IVA):</span>
                        <span>${formatVES(deliveryReceiptVES)}</span>
                    </div>` : ''}
                </div>
                <div style="display: flex; justify-content: space-between; font-weight: 900; font-size: 0.95rem; margin-top: 0.25rem; margin-bottom: 0.2rem; border-top: 1px solid #000; padding-top: 0.25rem;">
                    <span>TOTAL VES:</span>
                    <span id="pos-total-ves-value">${formatVES(totalVES)}</span>
                </div>
                <div style="display: flex; justify-content: space-between; font-weight: 900; font-size: 0.88rem; margin-bottom: 0.2rem;">
                    <span>TOTAL USD:</span>
                    <span id="pos-total-usd-value">$${totalUSD.toFixed(2)}</span>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 0.7rem; color: #444; margin-bottom: 0.3rem;">
                    <span>Tasa BCV:</span>
                    <span>${formatVES(rate)}</span>
                </div>
                ${isAlreadyPaid ? `
                    <div style="display: flex; justify-content: space-between; font-size: 0.72rem; font-weight: bold; color: #000; border-top: 1px dashed #000; padding-top: 0.2rem; margin-top: 0.2rem;">
                        <span>PAGO (${payMethod || 'Efectivo'}):</span>
                        <span id="pos-pago-value">${formatVES(totalVES)}</span>
                    </div>
                ` : ''}
            </div>

            <div style="border-top: 1px dashed #000; margin: 0.4rem 0 0.3rem 0;"></div>

            <!-- Footer Message -->
            <div style="text-align: center; font-size: 0.72rem; font-weight: bold; margin-top: 0.3rem;">
                ¡Gracias por su preferencia! 🥖✨
                <div style="font-size: 0.6rem; font-weight: normal; margin-top: 0.2rem; color: #555;">MH Z7C${Math.floor(10000000 + Math.random() * 90000000)}</div>
            </div>
        </div>

        <!-- Action Controls -->
        <div style="display: flex; flex-direction: column; gap: 0.5rem; margin-top: 1rem;">
            <button class="btn-print-pos-ticket" style="height: 42px; display: flex; align-items: center; justify-content: center; gap: 0.4rem; font-size: 0.85rem; font-weight: 900; border-radius: 8px; border: none; cursor: pointer; background: var(--color-gold); color: var(--color-bg-navy); width: 100%;">
                <i class="fa-solid fa-print"></i> IMPRIMIR TICKET (80MM/58MM)
            </button>
            <button class="btn-open-invoice-a" style="height: 42px; display: flex; align-items: center; justify-content: center; gap: 0.4rem; font-size: 0.85rem; font-weight: 900; border-radius: 8px; border: 1px solid rgba(212,175,55,0.5); cursor: pointer; background: rgba(212,175,55,0.12); color: var(--color-gold); width: 100%;">
                <i class="fa-solid fa-file-invoice-dollar"></i> FACTURA (TALONARIO)
            </button>
        </div>
    `;

    overlay.appendChild(modalBody);
    document.body.appendChild(overlay);

    const closeModal = () => {
        overlay.style.opacity = '0';
        overlay.style.transition = 'opacity 0.25s ease-out';
        setTimeout(() => {
            overlay.remove();
        }, 250);
    };

    modalBody.querySelector('.btn-close-pos-modal').addEventListener('click', closeModal);

    const ivaCheckbox = modalBody.querySelector('#toggle-pos-iva');
    const ivaRows = modalBody.querySelector('#pos-iva-rows');
    if (ivaCheckbox) {
        ivaCheckbox.addEventListener('change', (e) => {
            if (ivaRows) ivaRows.style.display = e.target.checked ? 'block' : 'none';
        });
    }

    modalBody.querySelector('.btn-print-pos-ticket').addEventListener('click', () => {
        window.print();
    });

    modalBody.querySelector('.btn-open-invoice-a').addEventListener('click', () => {
        showInvoiceModal({ cart, clientName, clientRif, timestamp, payMethod, rate });
    });
}

// qrcode-generator (global `qrcode`) solo hace falta para el QR de la factura
// carta, así que se carga recién la primera vez que se abre una. Si no carga
// (sin internet) la factura sale igual, sin el QR.
let qrLibPromise = null;
function loadQrLib() {
    if (typeof window.qrcode === 'function') return Promise.resolve(true);
    if (!qrLibPromise) {
        qrLibPromise = new Promise(resolve => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
            script.onload = () => resolve(true);
            script.onerror = () => { qrLibPromise = null; resolve(false); };
            document.head.appendChild(script);
            setTimeout(() => resolve(typeof window.qrcode === 'function'), 4000);
        });
    }
    return qrLibPromise;
}

// "0414-555.1234" -> "584145551234" para wa.me; vacío si no parece un número.
function toWhatsAppNumber(phone = '') {
    let digits = String(phone).replace(/\D/g, '');
    if (digits.startsWith('0')) digits = '58' + digits.slice(1);
    else if (digits.length === 10) digits = '58' + digits;
    return digits.length >= 11 ? digits : '';
}

/**
 * Factura formato carta estilo talonario de una cuenta: si la cuenta ya tiene
 * factura la muestra para reimprimir/enviar; si no, pide los datos fiscales
 * del cliente y la emite con el siguiente correlativo (lo reparte la base,
 * ver supabase/migrations/039_invoices.sql).
 */
async function showInvoiceModal({ cart = [], clientName = '', clientRif = '', timestamp, payMethod = '', rate = null }) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-backdrop';
    Object.assign(overlay.style, {
        position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
        backgroundColor: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(8px)', display: 'flex',
        alignItems: 'flex-start', justifyContent: 'center', zIndex: '3100', padding: '1rem',
        boxSizing: 'border-box', overflowY: 'auto'
    });
    const panel = document.createElement('div');
    Object.assign(panel.style, {
        width: '100%', maxWidth: '880px', backgroundColor: '#111827', border: '1px solid rgba(212,175,55,0.4)',
        borderRadius: '14px', color: '#FFFFFF', padding: '1rem', boxSizing: 'border-box', margin: 'auto 0'
    });
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    const effectiveRate = (rate && !isNaN(parseFloat(rate)) && parseFloat(rate) > 0) ? parseFloat(rate) : (window.bcvRate || 0);
    // El delivery va fuera de la factura talonario (sin IVA ni exento).
    const items = cart.filter(item => !(window.Combos && window.Combos.isDeliverySale(item))).map(item => {
        const qty = item.quantity || 1;
        const total = getItemTotalUSD(item);
        return { desc: cleanProductName(item.name), qty, price: Math.round((total / qty) * 100) / 100 };
    });
    const totalUSD = items.reduce((s, it) => s + it.qty * it.price, 0);
    const deliveryOutUSD = cart.reduce((s, item) => s + (window.Combos && window.Combos.isDeliverySale(item) ? getItemTotalUSD(item) : 0), 0);

    const header = (title) => `
        <div class="inv-noprint" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 0.75rem; margin-bottom: 0.9rem;">
            <h3 style="font-family: var(--font-serif); font-size: 1rem; color: var(--color-gold); font-weight: 900; margin: 0; text-transform: uppercase; display: flex; align-items: center; gap: 0.4rem;">
                <i class="fa-solid fa-file-invoice-dollar"></i> ${title}
            </h3>
            <button class="btn-close-invoice" style="background: none; border: none; color: var(--color-text-muted); font-size: 1.25rem; cursor: pointer;" aria-label="Cerrar">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>`;
    const bindClose = () => panel.querySelector('.btn-close-invoice').addEventListener('click', close);
    // Para ir a la Vitrina hay que cerrar también el recibo/cobro que abrió esta factura.
    const closeAllPosModals = () => document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());

    const inputStyle = 'width: 100%; box-sizing: border-box; background: var(--v-0-0-0-4, rgba(0, 0, 0, 0.4)); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; padding: 8px 10px; color: var(--color-white); font-weight: 700; font-size: 0.85rem;';
    const labelStyle = 'display: block; color: var(--color-text-muted); font-weight: 700; margin-bottom: 0.25rem; font-size: 0.72rem; text-transform: uppercase;';
    const isAdmin = () => !!(window.getCurrentRole && window.getCurrentRole() === 'admin');

    const showInvoice = async (inv) => {
        await loadQrLib();
        const isCf = window.InvoiceRenderer.isConsumidorFinal(inv);
        const origin = window.location.origin;
        panel.innerHTML = `
            ${header(`Factura N° ${window.InvoiceRenderer.pad5(inv.number)}`)}
            ${inv.reissued ? `<div class="inv-noprint" style="font-size: 0.75rem; color: var(--color-text-muted); margin: -0.4rem 0 0.75rem;">Esta cuenta ya tenía factura: se muestra la misma para reimprimir o reenviar.</div>` : ''}
            <div class="inv-noprint" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0.5rem; margin-bottom: 0.9rem;">
                <button class="btn-inv-print" style="height: 40px; border-radius: 8px; border: none; cursor: pointer; background: var(--color-gold); color: var(--color-bg-navy); font-weight: 900; font-size: 0.8rem;">
                    <i class="fa-solid fa-print"></i> Imprimir / PDF
                </button>
                <button class="btn-inv-whatsapp" style="height: 40px; border-radius: 8px; border: none; cursor: pointer; background: #25D366; color: #06281a; font-weight: 900; font-size: 0.8rem;">
                    <i class="fa-brands fa-whatsapp"></i> Enviar por WhatsApp
                </button>
                <button class="btn-inv-email" style="height: 40px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); cursor: pointer; background: rgba(255,255,255,0.05); color: var(--color-white); font-weight: 800; font-size: 0.8rem;">
                    <i class="fa-solid fa-envelope"></i> Enviar por correo
                </button>
                <button class="btn-inv-copy" style="height: 40px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); cursor: pointer; background: rgba(255,255,255,0.05); color: var(--color-white); font-weight: 800; font-size: 0.8rem;">
                    <i class="fa-solid fa-link"></i> Copiar enlace
                </button>
            </div>
            ${inv.status !== 'anulada' && window.startExtraInvoiceAccount ? `
            <div class="inv-noprint" style="display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; background: rgba(255,255,255,0.04); border: 1px dashed rgba(212,175,55,0.45); border-radius: 10px; padding: 0.55rem 0.7rem; margin-bottom: 0.9rem; font-size: 0.75rem; color: var(--color-text-muted);">
                <span style="flex: 1; min-width: 200px;">Esta factura ya tiene número y no se modifica. Si el cliente pide algo más, se cobra en una cuenta aparte con su propia factura.</span>
                <button class="btn-inv-extra" style="height: 36px; padding: 0 0.8rem; border-radius: 8px; border: none; cursor: pointer; background: var(--color-gold); color: var(--color-bg-navy); font-weight: 900; font-size: 0.78rem;">
                    <i class="fa-solid fa-plus"></i> El cliente pide más
                </button>
            </div>` : ''}
            ${inv.status !== 'anulada' ? `
            <div class="inv-noprint" style="background: ${isCf ? 'rgba(59,130,246,0.1)' : 'rgba(255,255,255,0.03)'}; border: 1px solid ${isCf ? 'rgba(96,165,250,0.45)' : 'rgba(255,255,255,0.1)'}; border-radius: 10px; padding: 0.55rem 0.7rem; margin-bottom: 0.9rem; font-size: 0.75rem; color: var(--color-text-muted);">
                <div style="display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap;">
                    <span style="flex: 1; min-width: 200px;">${isCf
                        ? 'Esta factura salió a <strong style="color: var(--color-white);">CONSUMIDOR FINAL</strong>. Si el cliente da su cédula o RIF, complétela aquí: el número de factura no cambia.'
                        : 'Si hay un error en el nombre o la cédula/RIF del cliente, se corrige aquí sin cambiar el número de factura.'}</span>
                    <button class="btn-inv-client" style="height: 36px; padding: 0 0.8rem; border-radius: 8px; border: none; cursor: pointer; background: ${isCf ? '#60A5FA' : 'rgba(255,255,255,0.12)'}; color: ${isCf ? '#0b1a33' : 'var(--color-white)'}; font-weight: 900; font-size: 0.78rem;">
                        <i class="fa-solid fa-user-pen"></i> ${isCf ? 'Completar datos del cliente' : 'Corregir datos del cliente'}
                    </button>
                </div>
                <form class="inv-client-form" style="display: none; margin-top: 0.6rem; gap: 0.5rem;">
                    <div><label style="${labelStyle}" for="inv-edit-name">Nombre o razón social</label><input id="inv-edit-name" maxlength="200" style="${inputStyle}" placeholder="CONSUMIDOR FINAL" value="${escapeHtml(isCf ? (inv.client_name === window.InvoiceRenderer.CONSUMIDOR_FINAL.name ? '' : inv.client_name) : inv.client_name)}"></div>
                    <div><label style="${labelStyle}" for="inv-edit-rif">Cédula o RIF</label>${rifFieldHtml('inv-edit-rif', isCf ? '' : inv.client_rif, inputStyle)}</div>
                    <div><label style="${labelStyle}" for="inv-edit-address">Domicilio fiscal</label><input id="inv-edit-address" maxlength="300" style="${inputStyle}" value="${escapeHtml(inv.client_address || '')}"></div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
                        <div><label style="${labelStyle}" for="inv-edit-phone">Teléfono (WhatsApp)</label><input id="inv-edit-phone" type="tel" maxlength="30" style="${inputStyle}" value="${escapeHtml(inv.client_phone || '')}"></div>
                        <div><label style="${labelStyle}" for="inv-edit-email">Correo</label><input id="inv-edit-email" type="email" maxlength="120" style="${inputStyle}" value="${escapeHtml(inv.client_email || '')}"></div>
                    </div>
                    <div style="color: var(--color-text-muted);">Se guarda quién lo cambió, cuándo y los datos anteriores. Productos, montos y N° no cambian. Después de guardar, reimprima o reenvíe la factura.</div>
                    <div class="inv-client-error" style="display: none; color: var(--color-danger); font-weight: 700;"></div>
                    <div style="display: flex; gap: 0.5rem; justify-content: flex-end;">
                        <button type="button" class="btn-inv-client-cancel" style="height: 34px; padding: 0 0.8rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); cursor: pointer; background: transparent; color: var(--color-white); font-weight: 800;">Cancelar</button>
                        <button type="submit" class="btn-inv-client-save" style="height: 34px; padding: 0 0.9rem; border-radius: 8px; border: none; cursor: pointer; background: var(--color-gold); color: var(--color-bg-navy); font-weight: 900;">Guardar datos</button>
                    </div>
                </form>
            </div>` : ''}
            ${isAdmin() ? `
            <div class="inv-noprint" style="display: flex; justify-content: flex-end; gap: 0.5rem; flex-wrap: wrap; margin: -0.4rem 0 0.9rem;">
                <button class="btn-inv-renumber" style="height: 32px; padding: 0 0.8rem; border-radius: 8px; border: 1px solid rgba(212,175,55,0.5); cursor: pointer; background: rgba(212,175,55,0.1); color: var(--color-gold); font-weight: 800; font-size: 0.75rem;">
                    <i class="fa-solid fa-pen"></i> Corregir número (admin)
                </button>
                ${inv.status !== 'anulada' ? `
                <button class="btn-inv-void" style="height: 32px; padding: 0 0.8rem; border-radius: 8px; border: 1px solid rgba(252,165,165,0.5); cursor: pointer; background: rgba(239,68,68,0.1); color: var(--color-danger); font-weight: 800; font-size: 0.75rem;">
                    <i class="fa-solid fa-ban"></i> Anular factura (admin)
                </button>` : ''}
            </div>
            <form class="inv-noprint inv-renumber-form" style="display: none; background: rgba(212,175,55,0.08); border: 1px solid rgba(212,175,55,0.35); border-radius: 10px; padding: 0.7rem; margin-bottom: 0.9rem; font-size: 0.78rem;">
                <div style="display: grid; grid-template-columns: 1fr 1.4fr; gap: 0.5rem;">
                    <div><label style="${labelStyle}" for="inv-new-number">N° de factura</label><input id="inv-new-number" type="number" min="1" max="99999999" required style="${inputStyle}" value="${inv.number}"></div>
                    <div><label style="${labelStyle}" for="inv-new-control">N° de control</label><input id="inv-new-control" maxlength="20" required style="${inputStyle}" value="${escapeHtml(inv.control_number || '')}"></div>
                </div>
                <div style="margin-top: 0.5rem;"><label style="${labelStyle}" for="inv-renumber-reason">Motivo (queda guardado)</label><input id="inv-renumber-reason" maxlength="300" required placeholder="Ej.: no coincidía con la libreta" style="${inputStyle}"></div>
                <div style="color: var(--color-text-muted); margin-top: 0.45rem;">No se puede usar un número que ya tenga otra factura. Si cambia el N°, el QR y el enlace viejos dejan de servir: reimprima o reenvíe la factura.</div>
                <div class="inv-renumber-error" style="display: none; color: var(--color-danger); font-weight: 700; margin-top: 0.4rem;"></div>
                <div style="display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 0.55rem;">
                    <button type="button" class="btn-inv-renumber-cancel" style="height: 34px; padding: 0 0.8rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); cursor: pointer; background: transparent; color: var(--color-white); font-weight: 800;">Cancelar</button>
                    <button type="submit" class="btn-inv-renumber-save" style="height: 34px; padding: 0 0.9rem; border-radius: 8px; border: none; cursor: pointer; background: var(--color-gold); color: var(--color-bg-navy); font-weight: 900;">Guardar corrección</button>
                </div>
            </form>` : ''}
            <div class="inv-paper-stage" style="width: 100%;"></div>`;
        bindClose();
        const clientBtn = panel.querySelector('.btn-inv-client');
        if (clientBtn) {
            const cForm = panel.querySelector('.inv-client-form');
            const cError = panel.querySelector('.inv-client-error');
            clientBtn.addEventListener('click', () => { cForm.style.display = cForm.style.display === 'none' ? 'grid' : 'none'; });
            panel.querySelector('.btn-inv-client-cancel').addEventListener('click', () => { cForm.style.display = 'none'; });
            cForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const val = (id) => panel.querySelector(id).value.trim();
                const rif = readRifField(panel, 'inv-edit-rif');
                const digits = rif.replace(/\D/g, '');
                const showErr = (msg) => { cError.textContent = msg; cError.style.display = 'block'; };
                if (digits.length > 0 && digits.length < 5) return showErr('La cédula o el RIF no parece válido.');
                if (digits.length >= 5 && !val('#inv-edit-name')) return showErr('Falta el nombre o la razón social.');
                const saveBtn = panel.querySelector('.btn-inv-client-save');
                saveBtn.disabled = true;
                const { invoice, error } = await window.SupabaseManager.updateInvoiceClient(inv.number, {
                    clientName: val('#inv-edit-name'),
                    clientRif: rif,
                    clientAddress: val('#inv-edit-address'),
                    clientPhone: val('#inv-edit-phone'),
                    clientEmail: val('#inv-edit-email'),
                    reason: isCf ? 'Datos del cliente completados' : 'Datos del cliente corregidos'
                });
                if (!invoice) {
                    saveBtn.disabled = false;
                    return showErr(error);
                }
                showToast(`👤 Datos de la Factura N° ${window.InvoiceRenderer.pad5(inv.number)} guardados.`, 'fa-solid fa-user-pen');
                if (window.UIManager && window.UIManager.refreshHistorialInvoices) window.UIManager.refreshHistorialInvoices({ force: true });
                await showInvoice(invoice);
            });
        }
        const renumberBtn = panel.querySelector('.btn-inv-renumber');
        if (renumberBtn) {
            const rForm = panel.querySelector('.inv-renumber-form');
            const rError = panel.querySelector('.inv-renumber-error');
            const numInput = panel.querySelector('#inv-new-number');
            const ctrlInput = panel.querySelector('#inv-new-control');
            // Mientras el control siga el formato automático, acompaña al N°.
            const autoControl = (n) => `00-${String(n).padStart(8, '0')}`;
            numInput.addEventListener('input', () => {
                if (ctrlInput.value === autoControl(inv.number) || ctrlInput.dataset.auto === '1') {
                    ctrlInput.value = autoControl(parseInt(numInput.value, 10) || 0);
                    ctrlInput.dataset.auto = '1';
                }
            });
            ctrlInput.addEventListener('input', () => { ctrlInput.dataset.auto = '0'; });
            renumberBtn.addEventListener('click', () => { rForm.style.display = rForm.style.display === 'none' ? 'block' : 'none'; });
            panel.querySelector('.btn-inv-renumber-cancel').addEventListener('click', () => { rForm.style.display = 'none'; });
            rForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const newNumber = parseInt(numInput.value, 10);
                const newControl = ctrlInput.value.trim();
                const reason = panel.querySelector('#inv-renumber-reason').value.trim();
                const showErr = (msg) => { rError.textContent = msg; rError.style.display = 'block'; };
                if (!(newNumber > 0)) return showErr('Escriba un número de factura válido.');
                if (reason.length < 3) return showErr('Escriba el motivo de la corrección.');
                const oldLabel = window.InvoiceRenderer.pad5(inv.number);
                const newLabel = window.InvoiceRenderer.pad5(newNumber);
                if (!window.confirm(`¿Corregir la Factura N° ${oldLabel} (control ${inv.control_number}) a N° ${newLabel} (control ${newControl})?`)) return;
                const saveBtn = panel.querySelector('.btn-inv-renumber-save');
                saveBtn.disabled = true;
                const { invoice, error } = await window.SupabaseManager.renumberInvoice(inv.number, newNumber, newControl, reason);
                if (!invoice) {
                    saveBtn.disabled = false;
                    return showErr(error);
                }
                showToast(`✏️ Factura N° ${oldLabel} corregida a N° ${newLabel}.`, 'fa-solid fa-pen');
                await showInvoice(invoice);
            });
        }
        const voidBtn = panel.querySelector('.btn-inv-void');
        if (voidBtn) {
            voidBtn.addEventListener('click', async () => {
                const num = window.InvoiceRenderer.pad5(inv.number);
                const reason = window.prompt(`Motivo para anular la Factura N° ${num} (queda guardado):`, '');
                if (reason === null) return;
                if (reason.trim().length < 3) return showToast('⚠️ Escriba el motivo de la anulación.', 'fa-solid fa-triangle-exclamation');
                if (!window.confirm(`¿Anular la Factura N° ${num}? El número no se vuelve a usar y la factura queda marcada ANULADA. Esa cuenta podrá corregirse y facturarse de nuevo con otro número.`)) return;
                voidBtn.disabled = true;
                const { invoice, error } = await window.SupabaseManager.voidInvoice(inv.number, reason.trim());
                if (!invoice) {
                    voidBtn.disabled = false;
                    return showToast(`⚠️ ${error}`, 'fa-solid fa-triangle-exclamation');
                }
                showToast(`🚫 Factura N° ${num} anulada.`, 'fa-solid fa-ban');
                await showInvoice(invoice);
            });
        }
        const extraBtn = panel.querySelector('.btn-inv-extra');
        if (extraBtn) {
            extraBtn.addEventListener('click', () => {
                closeAllPosModals();
                window.startExtraInvoiceAccount(inv.client_rif ? `${inv.client_name} - ${inv.client_rif}` : inv.client_name);
            });
        }

        const stage = panel.querySelector('.inv-paper-stage');
        const fit = window.InvoiceRenderer.mount(stage, inv, { origin });
        window.addEventListener('resize', fit);
        const observer = new window.MutationObserver(() => {
            if (!document.body.contains(overlay)) {
                window.removeEventListener('resize', fit);
                observer.disconnect();
            }
        });
        observer.observe(document.body, { childList: true });

        const text = window.InvoiceRenderer.shareText(inv, origin);
        const link = window.InvoiceRenderer.verifyUrl(inv, origin);
        panel.querySelector('.btn-inv-print').addEventListener('click', () => window.InvoiceRenderer.print(overlay));
        panel.querySelector('.btn-inv-whatsapp').addEventListener('click', () => {
            const num = toWhatsAppNumber(inv.client_phone);
            window.open(`https://wa.me/${num}?text=${encodeURIComponent(text)}`, '_blank');
        });
        panel.querySelector('.btn-inv-email').addEventListener('click', () => {
            const subject = `Factura N° ${window.InvoiceRenderer.pad5(inv.number)} - Casa Lucenzo`;
            window.location.href = `mailto:${encodeURIComponent(inv.client_email || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text.replace(/\*/g, ''))}`;
        });
        panel.querySelector('.btn-inv-copy').addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(link);
                showToast('🔗 Enlace de la factura copiado.', 'fa-solid fa-link');
            } catch {
                window.prompt('Copie el enlace de la factura:', link);
            }
        });
    };

    panel.innerHTML = `${header('Factura carta')}<div style="padding: 2rem 0; text-align: center; color: var(--color-text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Buscando si esta cuenta ya tiene factura...</div>`;
    bindClose();

    if (!window.SupabaseManager || !window.SupabaseManager.isConfigured() || !navigator.onLine) {
        panel.innerHTML = `${header('Factura carta')}<div style="padding: 1.5rem 0; text-align: center; color: var(--color-text-muted); font-size: 0.85rem;">Para emitir la factura hace falta internet: el número de factura lo asigna el servidor para que no se repita entre cajas. Vuelva a intentarlo cuando haya conexión.</div>`;
        bindClose();
        return;
    }

    const existing = await window.SupabaseManager.fetchInvoiceForSale(timestamp);
    if (existing) {
        await showInvoice({ ...existing, reissued: true });
        return;
    }

    const nextNumber = await window.SupabaseManager.fetchInvoiceNextNumber();
    panel.style.maxWidth = '460px';
    panel.innerHTML = `
        ${header('Emitir factura carta')}
        <div style="background: rgba(212,175,55,0.1); border: 1px solid rgba(212,175,55,0.3); border-radius: 10px; padding: 0.6rem 0.75rem; margin-bottom: 0.9rem; font-size: 0.8rem;">
            ${items.map(it => `<div style="display: flex; justify-content: space-between; gap: 0.5rem;"><span>${it.qty}x ${escapeHtml(it.desc)}</span><span>$${(it.qty * it.price).toFixed(2)}</span></div>`).join('')}
            <div style="display: flex; justify-content: space-between; border-top: 1px solid rgba(212,175,55,0.3); margin-top: 0.4rem; padding-top: 0.4rem; font-weight: 900; color: var(--color-gold);">
                <span>Total (IVA incluido)</span><span>$${totalUSD.toFixed(2)}</span>
            </div>
            ${deliveryOutUSD > 0 ? `<div style="font-size: 0.72rem; color: var(--color-text-muted); margin-top: 0.2rem;">🛵 Delivery $${deliveryOutUSD.toFixed(2)} cobrado aparte: no va en la factura (fuera de IVA).</div>` : ''}
            <div style="font-size: 0.7rem; color: var(--color-text-muted); margin-top: 0.2rem;">Tasa BCV: Bs ${effectiveRate.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · Pago: ${escapeHtml(payMethod || '—')}</div>
        </div>
        ${window.handleEditSale ? `
        <button type="button" class="btn-inv-edit-account" style="width: 100%; height: 40px; margin-bottom: 0.9rem; border-radius: 8px; border: 1px solid rgba(212,175,55,0.5); cursor: pointer; background: rgba(212,175,55,0.12); color: var(--color-gold); font-weight: 900; font-size: 0.8rem;">
            <i class="fa-solid fa-pen-to-square"></i> MODIFICAR CUENTA ANTES DE FACTURAR
        </button>` : ''}
        <form class="inv-issue-form" style="display: grid; gap: 0.6rem;">
            <div><label style="${labelStyle}" for="inv-client-name">Nombre o razón social</label><input id="inv-client-name" maxlength="200" placeholder="CONSUMIDOR FINAL" style="${inputStyle}" value="${escapeHtml(clientName && clientName !== 'Cliente' && clientRif ? clientName : '')}"></div>
            <div><label style="${labelStyle}" for="inv-client-rif">Cédula o RIF <span style="text-transform: none; font-weight: 600;">(vacío = consumidor final V-00000000, se completa después)</span></label>${rifFieldHtml('inv-client-rif', clientRif, inputStyle)}</div>
            <div><label style="${labelStyle}" for="inv-client-address">Domicilio fiscal</label><input id="inv-client-address" maxlength="300" style="${inputStyle}"></div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem;">
                <div><label style="${labelStyle}" for="inv-client-phone">Teléfono (WhatsApp)</label><input id="inv-client-phone" type="tel" maxlength="30" placeholder="0414-1234567" style="${inputStyle}"></div>
                <div><label style="${labelStyle}" for="inv-client-email">Correo</label><input id="inv-client-email" type="email" maxlength="120" style="${inputStyle}"></div>
            </div>
            <div class="inv-issue-error" style="display: none; color: var(--color-danger); font-size: 0.78rem; font-weight: 700;"></div>
            <button type="submit" class="btn-inv-issue" style="height: 46px; border-radius: 8px; border: none; cursor: pointer; background: var(--color-gold); color: var(--color-bg-navy); font-weight: 900; font-size: 0.9rem;">
                <i class="fa-solid fa-file-circle-check"></i> EMITIR FACTURA
            </button>
            <div style="font-size: 0.7rem; color: var(--color-text-muted); text-align: center;">
                ${nextNumber ? `Esta factura saldrá con el <strong class="inv-next-label" style="color: var(--color-gold);">N° ${window.InvoiceRenderer.pad5(nextNumber)}</strong> y no se puede repetir.` : 'Se le asigna el siguiente número de factura y no se puede repetir.'}
                ${nextNumber && isAdmin() ? `<button type="button" class="btn-inv-next-change" style="background: none; border: none; color: var(--color-gold); text-decoration: underline; cursor: pointer; font-weight: 800; font-size: 0.7rem; padding: 0 0.2rem;">Cambiar (admin)</button>` : ''}
                Revise los datos antes de emitir.
            </div>
        </form>`;
    bindClose();

    const editAccountBtn = panel.querySelector('.btn-inv-edit-account');
    if (editAccountBtn) {
        // Reusa "Modificar/Corregir" de Clientes: la cuenta vuelve a la Vitrina
        // con sus combos y precios en Bs, el stock se ajusta al agregar o quitar,
        // y al cobrarla se reemplaza la venta (mismo horario, sin duplicarla).
        editAccountBtn.addEventListener('click', () => {
            closeAllPosModals();
            window.handleEditSale(timestamp);
        });
    }

    const nextChangeBtn = panel.querySelector('.btn-inv-next-change');
    if (nextChangeBtn) {
        nextChangeBtn.addEventListener('click', async () => {
            const answer = window.prompt('¿Con qué número sale la próxima factura?', String(nextNumber));
            if (answer === null) return;
            const next = parseInt(answer.replace(/\D/g, ''), 10);
            if (!(next > 0)) return showToast('⚠️ Escriba un número válido.', 'fa-solid fa-triangle-exclamation');
            const { next: saved, error } = await window.SupabaseManager.setInvoiceNextNumber(next);
            if (!saved) return showToast(`⚠️ ${error}`, 'fa-solid fa-triangle-exclamation');
            panel.querySelector('.inv-next-label').textContent = `N° ${window.InvoiceRenderer.pad5(saved)}`;
            showToast(`🧾 La próxima factura sale con el N° ${window.InvoiceRenderer.pad5(saved)}.`, 'fa-solid fa-file-invoice-dollar');
        });
    }

    const form = panel.querySelector('.inv-issue-form');
    const errorBox = panel.querySelector('.inv-issue-error');
    const submitBtn = panel.querySelector('.btn-inv-issue');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const val = (id) => panel.querySelector(id).value.trim();
        const cf = window.InvoiceRenderer.CONSUMIDOR_FINAL;
        const typedRif = readRifField(panel, 'inv-client-rif');
        const digits = typedRif.replace(/\D/g, '');
        const showError = (msg) => { errorBox.textContent = msg; errorBox.style.display = 'block'; };
        if (digits.length > 0 && digits.length < 5) return showError('La cédula o el RIF no parece válido.');
        // Sin cédula sale a consumidor final; los datos se completan después.
        const rif = digits.length ? typedRif : cf.rif;
        const name = val('#inv-client-name') || (digits.length ? '' : cf.name);
        if (!name) return showError('Falta el nombre o la razón social.');
        if (!(effectiveRate > 0)) return showError('No hay tasa BCV cargada. Actualice la tasa y vuelva a intentar.');
        errorBox.style.display = 'none';
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Emitiendo...';

        const { invoice, error } = await window.SupabaseManager.issueInvoice({
            saleTimestamp: timestamp,
            clientName: name,
            clientRif: rif,
            clientAddress: val('#inv-client-address'),
            clientPhone: val('#inv-client-phone'),
            clientEmail: val('#inv-client-email'),
            paymentMethod: payMethod,
            bcvRate: effectiveRate,
            items
        });
        if (!invoice) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fa-solid fa-file-circle-check"></i> EMITIR FACTURA';
            return showError(error || 'No se pudo emitir la factura. Intente de nuevo.');
        }
        panel.style.maxWidth = '880px';
        showToast(`🧾 Factura N° ${window.InvoiceRenderer.pad5(invoice.number)} emitida.`, 'fa-solid fa-file-invoice-dollar');
        await showInvoice(invoice);
    });
}
