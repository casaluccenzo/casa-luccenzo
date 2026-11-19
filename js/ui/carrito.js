// Carrito: comida del personal, combos, delivery, extras y carrito activo.
//
// Antes formaba parte de js/ui.js. Script clásico (no módulo ES): comparte el
// ámbito global con los demás archivos de js/app/ y js/ui/, así que el orden de
// carga importa. Ese orden vive en sistema/index.html (y se repite en sw.js y
// js/app/index.js; tests/script-order.test.js comprueba que coincidan).

/**
 * Part of a cart/account in $ that carries no IVA: the staff's pastelitos,
 * sold at cost (Combos.isStaffSale). The rest is split with splitIvaIncluded.
 */
function staffExemptUSD(items) {
    if (!window.Combos) return 0;
    return (items || []).reduce((sum, item) => sum + (window.Combos.isStaffSale(item) ? (item.price || 0) * (item.quantity || 1) : 0), 0);
}

/**
 * Part of a cart/account in $ for products sold outside IVA (the papelón,
 * Combos.IVA_EXEMPT): charged at its fixed Bs price with no IVA in it.
 */
function productExemptUSD(items) {
    if (!window.Combos || !window.Combos.ivaExemptUsdOf) return 0;
    return window.Combos.ivaExemptUsdOf(items);
}

/**
 * Split a total whose prices already include the 16% IVA into base + IVA.
 * Rounds the base to cents and derives IVA from it, so the two shown
 * amounts always add back up to the total charged.
 */
function splitIvaIncluded(totalUSD, totalVES) {
    const round2 = (n) => Math.round(n * 100) / 100;
    const baseUSD = round2(totalUSD / 1.16);
    const baseVES = round2(totalVES / 1.16);
    return {
        baseUSD,
        ivaUSD: round2(totalUSD - baseUSD),
        baseVES,
        ivaVES: round2(totalVES - baseVES),
    };
}

/**
 * Render active customer account / cart card
 * @param {Array} cart Current items in cart
 * @param {Function} onAdd Callback to add 1 quantity
 * @param {Function} onRemove Callback to remove 1 quantity
 * @param {Function} onClear Callback to empty the cart
 * @param {Function} onCheckout Callback to checkout
 */
/** Fixed Bs price of a loose item (no weekday promo; that's only in combos), or 0. */
function fixedBsOf(product) {
    if (window.Combos) return window.Combos.fixedBsPrice(product);
    return product && product.price_bs > 0 ? product.price_bs : 0;
}

function formatBsWhole(n) {
    return 'Bs ' + Math.round(n).toLocaleString('es-VE');
}

/**
 * Pestaña "Personal" de la vitrina: los pastelitos al costo, sin IVA, para quien
 * trabaja en el local. Cada toque agrega uno a la cuenta como "Consumo
 * personal" (window.addStaffMealToCart), que descuenta vitrina igual que una
 * venta y sale aparte en el cierre.
 */
function renderStaffMeals(products, listContainer, searchQuery = '') {
    const combosBar = document.getElementById('combos-bar');
    if (combosBar) {
        combosBar.innerHTML = '';
        combosBar.classList.add('hidden');
    }
    const query = searchQuery.toLowerCase().trim();
    const pasteles = products.filter(p => window.Combos.staffBsPrice(p) > 0 && (!query || p.name.toLowerCase().includes(query)));
    const inCart = (id) => {
        const line = (window.currentCart || []).find(item => item.productId === id && item.combo === 'personal');
        return line ? line.quantity : 0;
    };
    listContainer.innerHTML = `
        <div class="staff-meals-note">
            <i class="fa-solid fa-user-group"></i>
            <span>Consumo del personal: cada pastel al costo, sin IVA. Se descuenta de la vitrina y sale aparte en el cierre, no como venta.</span>
        </div>
        ${pasteles.length === 0 ? `
            <div style="text-align: center; color: var(--color-text-muted); font-size: 0.875rem; padding: 2rem 0;">
                No se encontraron pastelitos con costo cargado.
            </div>` : ''}
        ${pasteles.map(p => {
            const bs = window.Combos.staffBsPrice(p);
            const qty = inCart(p.id);
            return `
            <div class="product-card staff-meal-card">
                <div class="product-info">
                    <div class="product-header-row">
                        <h3 class="product-name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</h3>
                        ${qty > 0 ? `<span class="staff-meal-qty">${qty} en cuenta</span>` : ''}
                    </div>
                    <p class="product-stock-desc">
                        Quedan: <span class="stock-value">${p.stock}</span>
                        <span style="color: var(--color-gold); margin-left: 0.5rem; font-weight: 600;">
                            ${formatBsWhole(bs)}
                            <span style="font-size: 0.725rem; font-weight: 400; opacity: 0.8; margin-left: 0.25rem;">(al costo, sin IVA &bull; ≈ $${(bs / (window.bcvRate || 1)).toFixed(2)})</span>
                        </span>
                    </p>
                </div>
                <button type="button" data-id="${escapeHtml(p.id)}" class="btn-touch btn-success btn-staff-meal" title="Agregar para el personal">+</button>
            </div>`;
        }).join('')}`;

    listContainer.querySelectorAll('.btn-staff-meal').forEach(btn => {
        btn.addEventListener('click', () => {
            if (window.addStaffMealToCart) window.addStaffMealToCart(btn.getAttribute('data-id'));
        });
    });
}

/**
 * Combo buttons above the vitrina (js/combos.js). Shows each combo's Bs price
 * for today; tapping one opens the flavor picker.
 */
function renderCombosBar(products) {
    const bar = document.getElementById('combos-bar');
    if (!bar || !window.Combos) return;
    const C = window.Combos;
    const sample = products.find(p => p.category === 'pastelitos' && fixedBsOf(p) > 0);
    // Combos are priced in fixed Bs: one needs a fixed-price pastel (or its own
    // `pastelBs`) and something in its category to pick from.
    const offered = C.visibleCombos().filter(c => C.comboProducts(c, products).length > 0 && (c.pastelBs > 0 || sample));
    if (!offered.length) {
        bar.innerHTML = '';
        bar.classList.add('hidden');
        return;
    }
    bar.classList.remove('hidden');
    const promo = window.Combos.isPromoDay();
    bar.innerHTML = `
        <div class="combos-bar-title"><i class="fa-solid fa-gift"></i> Combos${promo ? ` <span class="combos-promo">Promo ${escapeHtml(window.Combos.PROMO.label)}: pastel en combo ${formatBsWhole(window.Combos.PROMO.priceBs)}</span>` : ''}</div>
        <div class="combos-bar-list">
            ${offered.map(c => `
                <button type="button" class="btn-combo" data-combo="${c.id}">
                    <span class="btn-combo-name">${escapeHtml(c.name)}</span>
                    <span class="btn-combo-desc">${c.pasteles === 1 ? 'Pastel' : `${c.pasteles} ${c.unit || 'pasteles'}`} + ${escapeHtml(c.drink)}</span>
                    <span class="btn-combo-price">${formatBsWhole(window.Combos.comboBsToday(c, sample))}</span>
                </button>`).join('')}
        </div>`;
    bar.querySelectorAll('.btn-combo').forEach(btn => {
        btn.addEventListener('click', () => openComboPicker(btn.getAttribute('data-combo'), products));
    });
}

/**
 * Flavor picker for a combo: one tap per pastel (the same flavor can be
 * picked twice), then the combo goes to the cart via window.addComboToCart.
 */
function openComboPicker(comboId, products) {
    const combo = window.Combos.COMBOS.find(c => c.id === comboId);
    if (!combo) return;
    const pasteles = window.Combos.comboProducts(combo, products);
    // A single choice (the Combo Mini's fixed product) needs no picker.
    if (pasteles.length === 1) {
        if (window.addComboToCart) window.addComboToCart(combo.id, Array(combo.pasteles).fill(pasteles[0].id));
        return;
    }
    const picked = [];

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <strong>${escapeHtml(combo.name)}</strong>
                <button type="button" class="btn-combo-close" aria-label="Cerrar"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="modal-body">
                <p class="combo-picker-hint"></p>
                <div class="combo-flavor-grid">
                    ${pasteles.map(p => `<button type="button" class="btn-combo-flavor" data-id="${escapeHtml(p.id)}">${escapeHtml(p.name)}<small>Quedan ${p.stock}</small></button>`).join('')}
                </div>
            </div>
        </div>`;
    const hint = overlay.querySelector('.combo-picker-hint');
    const updateHint = () => {
        const names = picked.map(id => (pasteles.find(p => p.id === id) || {}).name).filter(Boolean);
        hint.textContent = combo.pasteles === 1
            ? `Elige el sabor del pastel. Va con ${combo.drink}.`
            : `Elige ${combo.pasteles} sabores (puede repetirse): ${picked.length}/${combo.pasteles}${names.length ? ' · ' + names.join(', ') : ''}. Va con ${combo.drink}.`;
    };
    updateHint();
    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('.btn-combo-close').addEventListener('click', close);
    overlay.querySelectorAll('.btn-combo-flavor').forEach(btn => {
        btn.addEventListener('click', () => {
            picked.push(btn.getAttribute('data-id'));
            if (picked.length >= combo.pasteles) {
                close();
                if (window.addComboToCart) window.addComboToCart(combo.id, picked);
            } else {
                updateHint();
            }
        });
    });
    document.body.appendChild(overlay);
}

/**
 * Monto del delivery de la cuenta activa: botones rápidos ($2, $2.50...) o el
 * monto que se escriba. Va fuera de IVA; se guarda con window.setCartDelivery.
 * @param {number} currentUsd Delivery que ya tiene la cuenta (0 si no tiene)
 */
function openDeliveryPicker(currentUsd = 0) {
    const D = window.Combos && window.Combos.DELIVERY;
    if (!D || !window.setCartDelivery) return;
    const rate = window.bcvRate || 0;
    const money = (usd) => `$${usd.toFixed(2)}${rate > 0 ? ` · Bs ${(usd * rate).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''}`;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <strong>🛵 Delivery</strong>
                <button type="button" class="btn-combo-close" aria-label="Cerrar"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="modal-body">
                <p class="combo-picker-hint">Lo que cobra el motorizado. Va aparte, <b>fuera de IVA</b> y fuera de la factura; se suma al total a cobrar.</p>
                <div class="combo-flavor-grid">
                    ${D.quickUsd.map(v => `<button type="button" class="btn-combo-flavor" data-usd="${v}">$${v.toFixed(2)}<small>${rate > 0 ? 'Bs ' + (v * rate).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''}</small></button>`).join('')}
                </div>
                <form class="delivery-form" style="display: flex; gap: 0.5rem; margin-top: 0.9rem; align-items: stretch;">
                    <input class="delivery-input" type="text" inputmode="decimal" autocomplete="off" placeholder="Otro monto en $ (ej. 4,50)" value="${currentUsd > 0 ? String(currentUsd).replace('.', ',') : ''}"
                        style="flex: 1; min-width: 0; height: 44px; padding: 0 0.75rem; border-radius: 8px; border: 1px solid rgba(212,175,55,0.5); background: rgba(255,255,255,0.06); color: var(--color-white); font-size: 1rem; font-weight: 700;">
                    <button type="submit" style="height: 44px; padding: 0 1rem; border-radius: 8px; border: none; background: var(--color-gold); color: var(--color-bg-navy); font-weight: 900; cursor: pointer;">Listo</button>
                </form>
                <div class="delivery-preview" style="font-size: 0.8rem; color: var(--color-text-muted); margin-top: 0.4rem; min-height: 1.1em;"></div>
                ${currentUsd > 0 ? `<button type="button" class="delivery-remove" style="width: 100%; height: 40px; margin-top: 0.6rem; border-radius: 8px; border: 1px solid rgba(239,68,68,0.5); background: rgba(239,68,68,0.1); color: #fca5a5; font-weight: 800; cursor: pointer;"><i class="fa-solid fa-trash-can"></i> Quitar delivery (${money(currentUsd)})</button>` : ''}
            </div>
        </div>`;
    const close = () => overlay.remove();
    const save = (usd) => { close(); window.setCartDelivery(usd); };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('.btn-combo-close').addEventListener('click', close);
    overlay.querySelectorAll('[data-usd]').forEach(btn => btn.addEventListener('click', () => save(parseFloat(btn.getAttribute('data-usd')))));
    const input = overlay.querySelector('.delivery-input');
    const preview = overlay.querySelector('.delivery-preview');
    const updatePreview = () => {
        const v = window.Combos.parseDeliveryUsd(input.value);
        preview.textContent = v === null ? `Escriba solo el monto en dólares (hasta $${D.maxUsd}).` : v > 0 ? `Delivery: ${money(v)}` : '';
        preview.style.color = v === null ? 'var(--color-danger)' : 'var(--color-text-muted)';
    };
    input.addEventListener('input', updatePreview);
    overlay.querySelector('.delivery-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const v = window.Combos.parseDeliveryUsd(input.value);
        if (v === null) { updatePreview(); input.focus(); return; }
        save(v);
    });
    const remove = overlay.querySelector('.delivery-remove');
    if (remove) remove.addEventListener('click', () => save(0));
    document.body.appendChild(overlay);
    updatePreview();
}

/**
 * Producto extra para la cuenta activa: algo que no está en el sistema (un
 * jugo o una bebida comprada en el local de al lado). Nombre, precio por
 * unidad en Bs o $, cantidad y, si se quiere, lo que costó (para que
 * Rentabilidad sepa la ganancia). Se guarda con window.addCartExtra.
 */
function openExtraPicker() {
    const C = window.Combos;
    const E = C && C.EXTRA;
    if (!E || !window.addCartExtra) return;
    const rate = window.bcvRate || 0;
    const fmtBs = (v) => v.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    let currency = rate > 0 ? 'bs' : 'usd';
    let qty = 1;
    const fieldStyle = 'width: 100%; height: 44px; padding: 0 0.75rem; border-radius: 8px; border: 1px solid rgba(212,175,55,0.5); background: rgba(255,255,255,0.06); color: var(--color-white); font-size: 1rem; font-weight: 700; box-sizing: border-box;';
    const labelStyle = 'display: block; font-size: 0.75rem; font-weight: 800; color: var(--color-gold); margin: 0.75rem 0 0.3rem; text-transform: uppercase; letter-spacing: 0.04em;';
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <strong>🛍️ Producto extra</strong>
                <button type="button" class="btn-combo-close" aria-label="Cerrar"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="modal-body">
                <p class="combo-picker-hint">Algo que no está en el sistema (por ejemplo, un jugo comprado al lado). Se suma a la cuenta con IVA incluido y sale en la factura. No toca la vitrina.</p>
                <form class="extra-form">
                    <label style="${labelStyle}" for="extra-name">Nombre</label>
                    <input id="extra-name" class="extra-name" type="text" maxlength="${E.maxNameLen}" autocomplete="off" placeholder="Ej. Jugo de naranja" style="${fieldStyle}">
                    <div class="extra-chips" style="display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.45rem;">
                        ${['Jugo', 'Refresco', 'Agua', 'Café', 'Té'].map(n => `<button type="button" class="extra-chip" data-name="${n}" style="padding: 0.3rem 0.7rem; border-radius: 999px; border: 1px solid rgba(255,255,255,0.18); background: rgba(255,255,255,0.05); color: var(--color-white); font-size: 0.8rem; cursor: pointer;">${n}</button>`).join('')}
                    </div>

                    <label style="${labelStyle}" for="extra-price">Precio por unidad</label>
                    <div style="display: flex; gap: 0.5rem;">
                        <input id="extra-price" class="extra-price" type="text" inputmode="decimal" autocomplete="off" style="${fieldStyle} flex: 1; min-width: 0;">
                        <div class="extra-currency" role="group" aria-label="Moneda" style="display: flex; border: 1px solid rgba(212,175,55,0.5); border-radius: 8px; overflow: hidden; flex-shrink: 0;">
                            <button type="button" data-cur="bs" style="width: 52px; border: none; font-weight: 900; cursor: pointer;">Bs</button>
                            <button type="button" data-cur="usd" style="width: 52px; border: none; font-weight: 900; cursor: pointer;">$</button>
                        </div>
                    </div>

                    <label style="${labelStyle}">Cantidad</label>
                    <div style="display: flex; align-items: center; gap: 0.75rem;">
                        <button type="button" class="btn-cart-adjust-circle minus extra-qty-minus" aria-label="Uno menos">-</button>
                        <span class="extra-qty cart-qty-badge" style="min-width: 2ch; text-align: center; font-size: 1.15rem;">1</span>
                        <button type="button" class="btn-cart-adjust-circle plus extra-qty-plus" aria-label="Uno más">+</button>
                    </div>

                    <label style="${labelStyle}" for="extra-cost">Lo que me costó por unidad (opcional, Bs)</label>
                    <input id="extra-cost" class="extra-cost" type="text" inputmode="decimal" autocomplete="off" placeholder="Para saber la ganancia" style="${fieldStyle}">

                    <div class="extra-preview" style="font-size: 0.85rem; color: var(--color-text-muted); margin-top: 0.75rem; min-height: 1.2em;"></div>
                    <button type="submit" style="width: 100%; height: 48px; margin-top: 0.6rem; border-radius: 8px; border: none; background: var(--color-gold); color: var(--color-bg-navy); font-weight: 900; font-size: 1rem; cursor: pointer;"><i class="fa-solid fa-plus"></i> Agregar a la cuenta</button>
                </form>
            </div>
        </div>`;
    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('.btn-combo-close').addEventListener('click', close);

    const nameIn = overlay.querySelector('.extra-name');
    const priceIn = overlay.querySelector('.extra-price');
    const costIn = overlay.querySelector('.extra-cost');
    const qtyEl = overlay.querySelector('.extra-qty');
    const preview = overlay.querySelector('.extra-preview');
    const curBtns = overlay.querySelectorAll('[data-cur]');

    // Lee el formulario: { name, unitUsd, unitBs, costBs } o { error }.
    const read = () => {
        const name = C.cleanExtraName(nameIn.value);
        const price = C.parseAmount(priceIn.value, currency);
        const cost = C.parseAmount(costIn.value, 'bs');
        if (price === null) return { error: currency === 'bs' ? `Escriba el precio en Bs (ej. 1.500).` : `Escriba el precio en $ (ej. 1,50).` };
        if (cost === null) return { error: 'Escriba lo que costó en Bs, o déjelo vacío.' };
        if (!(price > 0)) return { empty: true };
        const unitUsd = currency === 'bs' ? (rate > 0 ? price / rate : 0) : price;
        const unitBs = currency === 'bs' ? price : price * rate;
        if (!(unitUsd > 0)) return { error: 'Falta la tasa BCV del día para cobrar en Bs. Use $.' };
        if (unitUsd > E.maxUsd) return { error: `Máximo $${E.maxUsd} por unidad.` };
        return { name, unitUsd, unitBs, costBs: cost };
    };
    const update = () => {
        curBtns.forEach(b => {
            const on = b.getAttribute('data-cur') === currency;
            b.style.background = on ? 'var(--color-gold)' : 'transparent';
            b.style.color = on ? 'var(--color-bg-navy)' : 'var(--color-white)';
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        priceIn.placeholder = currency === 'bs' ? 'Ej. 1.500' : 'Ej. 1,50';
        qtyEl.textContent = String(qty);
        const r = read();
        preview.style.color = r.error ? 'var(--color-danger)' : 'var(--color-text-muted)';
        if (r.error) { preview.textContent = r.error; return; }
        if (r.empty) { preview.textContent = ''; return; }
        const totUsd = r.unitUsd * qty;
        preview.innerHTML = `<b style="color: var(--color-white);">${qty} × ${escapeHtml(r.name || 'producto')}</b> = ${rate > 0 ? `Bs ${fmtBs(r.unitBs * qty)} · ` : ''}$${totUsd.toFixed(2)}`
            + (r.costBs > 0 && rate > 0 ? `<br>Ganancia: Bs ${fmtBs((r.unitBs - r.costBs) * qty)}` : '');
    };
    curBtns.forEach(b => b.addEventListener('click', () => {
        const next = b.getAttribute('data-cur');
        if (next === 'bs' && !(rate > 0)) { preview.textContent = 'Falta la tasa BCV del día para cobrar en Bs. Use $.'; preview.style.color = 'var(--color-danger)'; return; }
        currency = next;
        update();
        priceIn.focus();
    }));
    overlay.querySelectorAll('.extra-chip').forEach(b => b.addEventListener('click', () => {
        nameIn.value = b.getAttribute('data-name');
        update();
        nameIn.focus();
    }));
    overlay.querySelector('.extra-qty-minus').addEventListener('click', () => { qty = Math.max(1, qty - 1); update(); });
    overlay.querySelector('.extra-qty-plus').addEventListener('click', () => { qty = Math.min(E.maxQty, qty + 1); update(); });
    [nameIn, priceIn, costIn].forEach(i => i.addEventListener('input', update));
    overlay.querySelector('.extra-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const r = read();
        if (!r.name) { preview.textContent = 'Escriba el nombre del producto.'; preview.style.color = 'var(--color-danger)'; nameIn.focus(); return; }
        if (r.error || r.empty) { if (r.empty) { preview.textContent = 'Escriba el precio.'; preview.style.color = 'var(--color-danger)'; } priceIn.focus(); return; }
        if (window.addCartExtra({ name: r.name, unitUsd: r.unitUsd, qty, costBs: r.costBs })) close();
    });
    document.body.appendChild(overlay);
    update();
    nameIn.focus();
}

function renderActiveCart(cart, onAdd, onRemove, onClear, onCheckout) {
    const container = document.getElementById('active-cart-container');
    if (!container) return;

    if (!cart || cart.length === 0) {
        container.innerHTML = '';
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');

    const totalUSD = cart.reduce((sum, item) => sum + (item.price || 0) * item.quantity, 0);
    const totalVES = totalUSD * (window.bcvRate || 1);
    // Prices already include the 16% IVA -- only break the same total down.
    // The staff's pastelitos go at cost with no IVA, so they stay out of it.
    const exemptUSD = staffExemptUSD(cart);
    const exemptVES = exemptUSD * (window.bcvRate || 1);
    // The delivery (what the motorizado charges) is outside IVA altogether.
    const deliveryUSD = window.Combos ? window.Combos.deliveryUsdOf(cart) : 0;
    const deliveryVES = deliveryUSD * (window.bcvRate || 1);
    // The papelón (Combos.IVA_EXEMPT) goes at its fixed Bs price, outside IVA.
    const papelonUSD = productExemptUSD(cart);
    const papelonVES = papelonUSD * (window.bcvRate || 1);
    const iva = splitIvaIncluded(totalUSD - exemptUSD - deliveryUSD - papelonUSD, totalVES - exemptVES - deliveryVES - papelonVES);
    const isDelivery = (item) => !!(window.Combos && window.Combos.isDeliverySale(item));
    const isExtra = (item) => !!(window.Combos && window.Combos.isExtraSale(item));
    const productLines = cart.filter(item => !isDelivery(item));

    container.innerHTML = `
        <div class="active-cart-card">
            <div class="active-cart-header">
                <span class="active-cart-title">
                    <i class="fa-solid fa-cart-shopping animate-pulse"></i> Cuenta del Cliente Activa
                </span>
                <span style="font-size: 10px; color: var(--color-gold); font-weight: bold;">
                    ${productLines.reduce((sum, item) => sum + item.quantity, 0)} artículos${deliveryUSD > 0 ? ' + delivery' : ''}
                </span>
            </div>

            <div class="cart-items-list">
                ${cart.map(item => isDelivery(item) ? `
                    <div class="cart-item-row cart-delivery-row">
                        <div class="cart-item-details">
                            <span class="cart-item-title">🛵 ${escapeHtml(window.Combos.DELIVERY.label)}</span>
                            <span class="cart-item-sub">
                                $${(item.price || 0).toFixed(2)} &bull; Bs. ${((item.price || 0) * (window.bcvRate || 1)).toFixed(2)}
                            </span>
                        </div>
                        <div class="cart-item-controls">
                            <button class="btn-cart-adjust-circle" data-action="delivery-edit" aria-label="Cambiar monto del delivery" style="background: var(--color-gold); color: var(--color-bg-navy); border: none;">✎</button>
                            <button class="btn-cart-adjust-circle minus" data-id="${escapeHtml(`${item.productId}|${item.combo || 'delivery'}`)}" data-action="minus" aria-label="Quitar delivery">✕</button>
                        </div>
                    </div>
                ` : `
                    <div class="cart-item-row${isExtra(item) ? ' cart-extra-row' : ''}">
                        <div class="cart-item-details">
                            <span class="cart-item-title">${isExtra(item) ? '🛍️ ' : ''}${escapeHtml(item.name)}</span>
                            <span class="cart-item-sub">
                                $${(item.price || 0).toFixed(2)} &bull; Sub: $${((item.price || 0) * item.quantity).toFixed(2)}${isExtra(item) ? ` &bull; Bs. ${((item.price || 0) * item.quantity * (window.bcvRate || 1)).toFixed(2)} &bull; extra` : ''}
                            </span>
                        </div>
                        <div class="cart-item-controls">
                            <button class="btn-cart-adjust-circle minus" data-id="${escapeHtml(item.combo ? `${item.productId}|${item.combo}` : item.productId)}" data-action="minus">-</button>
                            <span class="cart-qty-badge">${item.quantity}</span>
                            ${isExtra(item) ? `<button class="btn-cart-adjust-circle plus" data-id="${escapeHtml(`${item.productId}|${item.combo}`)}" data-action="plus">+</button>`
                                : item.combo ? '' : `<button class="btn-cart-adjust-circle plus" data-id="${escapeHtml(item.productId)}" data-action="plus">+</button>`}
                        </div>
                    </div>
                `).join('')}
            </div>

            <div class="cart-totals-section">
                ${deliveryUSD > 0 ? `
                <div class="cart-iva-row">
                    <span>Productos:</span>
                    <span>$${(totalUSD - deliveryUSD).toFixed(2)} &bull; Bs. ${(totalVES - deliveryVES).toFixed(2)}</span>
                </div>
                <div class="cart-iva-row" style="color: var(--color-gold);">
                    <span>🛵 Delivery (fuera de IVA):</span>
                    <span>$${deliveryUSD.toFixed(2)} &bull; Bs. ${deliveryVES.toFixed(2)}</span>
                </div>` : ''}
                <div class="cart-total-row">
                    <span class="cart-total-lbl">Total a Cobrar:</span>
                    <span class="cart-total-val-usd">$${totalUSD.toFixed(2)}</span>
                </div>
                <div class="cart-total-row" style="justify-content: flex-end;">
                    <span class="cart-total-val-ves">Bs. ${totalVES.toFixed(2)} VES</span>
                </div>
                <div class="cart-iva-row">
                    <span>Base imponible:</span>
                    <span>$${iva.baseUSD.toFixed(2)} &bull; Bs. ${iva.baseVES.toFixed(2)}</span>
                </div>
                <div class="cart-iva-row">
                    <span>IVA (16% incluido):</span>
                    <span>$${iva.ivaUSD.toFixed(2)} &bull; Bs. ${iva.ivaVES.toFixed(2)}</span>
                </div>
                ${exemptUSD > 0 ? `
                <div class="cart-iva-row">
                    <span>Personal (al costo, sin IVA):</span>
                    <span>$${exemptUSD.toFixed(2)} &bull; Bs. ${exemptVES.toFixed(2)}</span>
                </div>` : ''}
                ${papelonUSD > 0 ? `
                <div class="cart-iva-row">
                    <span>Papelón (fuera de IVA):</span>
                    <span>$${papelonUSD.toFixed(2)} &bull; Bs. ${papelonVES.toFixed(2)}</span>
                </div>` : ''}
            </div>

            <div class="cart-actions-grid">
                <button class="btn-cart-submit" id="btn-cart-checkout">
                    <i class="fa-solid fa-hand-holding-dollar text-lg"></i> COBRAR / REGISTRAR VENTA
                </button>
                <button class="btn-cart-secondary danger-outline" id="btn-cart-clear">
                    <i class="fa-solid fa-trash-can"></i> Vaciar
                </button>
                <button class="btn-cart-secondary whatsapp-outline" id="btn-cart-share">
                    <i class="fa-brands fa-whatsapp"></i> Ticket Cliente
                </button>
                ${window.Combos ? `
                <button class="btn-cart-secondary btn-cart-delivery" id="btn-cart-delivery">
                    <i class="fa-solid fa-motorcycle"></i> ${deliveryUSD > 0 ? `Delivery $${deliveryUSD.toFixed(2)}` : 'Agregar delivery'}
                </button>
                <button class="btn-cart-secondary btn-cart-extra" id="btn-cart-extra">
                    <i class="fa-solid fa-bag-shopping"></i> Agregar producto extra
                </button>` : ''}
            </div>
        </div>
    `;

    container.querySelectorAll('#btn-cart-delivery, [data-action="delivery-edit"]').forEach(btn => {
        btn.addEventListener('click', () => openDeliveryPicker(deliveryUSD));
    });
    const extraBtn = container.querySelector('#btn-cart-extra');
    if (extraBtn) extraBtn.addEventListener('click', () => openExtraPicker());

    // Bind event listeners
    container.querySelectorAll('[data-action="minus"]').forEach(btn => {
        btn.addEventListener('click', () => {
            onRemove(btn.getAttribute('data-id'));
        });
    });

    container.querySelectorAll('[data-action="plus"]').forEach(btn => {
        btn.addEventListener('click', () => {
            onAdd(btn.getAttribute('data-id'));
        });
    });

    document.getElementById('btn-cart-checkout').addEventListener('click', onCheckout);
    document.getElementById('btn-cart-clear').addEventListener('click', onClear);
    document.getElementById('btn-cart-share').addEventListener('click', () => {
        const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
        let msg = `🛒 *TICKET DE COMPRA - CASA LUCENZO*\n`;
        msg += `--------------------------------------\n`;
        cart.forEach(item => {
            if (isDelivery(item)) return;
            msg += `• ${item.quantity}x ${item.name} - $${(item.price * item.quantity).toFixed(2)}\n`;
        });
        if (deliveryUSD > 0) {
            msg += `• 🛵 Delivery (fuera de IVA) - $${deliveryUSD.toFixed(2)}\n`;
        }
        msg += `--------------------------------------\n`;
        msg += `💰 *TOTAL A PAGAR:* *$${total.toFixed(2)} USD*\n`;
        msg += `💵 *Tasa BCV:* ${(window.bcvRate || 1).toFixed(2)} Bs.\n`;
        msg += `🇻🇪 *Total en Bolívares:* *Bs. ${(total * (window.bcvRate || 1)).toFixed(2)} VES*\n`;
        const shareExempt = staffExemptUSD(cart);
        const sharePapelon = productExemptUSD(cart);
        const shareTaxed = total - shareExempt - deliveryUSD - sharePapelon;
        const shareIva = splitIvaIncluded(shareTaxed, shareTaxed * (window.bcvRate || 1));
        msg += `🧾 Base imponible: $${shareIva.baseUSD.toFixed(2)} / Bs. ${shareIva.baseVES.toFixed(2)}\n`;
        msg += `🧾 IVA (16% incluido): $${shareIva.ivaUSD.toFixed(2)} / Bs. ${shareIva.ivaVES.toFixed(2)}\n`;
        if (shareExempt > 0) {
            msg += `🧾 Personal (al costo, sin IVA): $${shareExempt.toFixed(2)} / Bs. ${(shareExempt * (window.bcvRate || 1)).toFixed(2)}\n`;
        }
        if (sharePapelon > 0) {
            msg += `🧾 Papelón (fuera de IVA): $${sharePapelon.toFixed(2)} / Bs. ${(sharePapelon * (window.bcvRate || 1)).toFixed(2)}\n`;
        }
        msg += `--------------------------------------\n`;
        msg += `¡Muchas gracias por su compra! 🌟`;

        const encoded = encodeURIComponent(msg);
        window.open(`https://api.whatsapp.com/send?text=${encoded}`, '_blank');
    });
}
