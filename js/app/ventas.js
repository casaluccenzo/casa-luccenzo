// Facturación automática, facturas pendientes y edición/anulación de ventas.
//
// Antes formaba parte de js/app.js. Script clásico (no módulo ES): comparte el
// ámbito global con los demás archivos de js/app/ y js/ui/, así que el orden de
// carga importa. Ese orden vive en sistema/index.html (y se repite en sw.js y
// js/app/index.js; tests/script-order.test.js comprueba que coincidan).

/**
 * Una cuenta cobrada tiene su factura talonario (se emite sola al registrar
 * el pago), y la factura guarda los ítems y el total con un número que no se
 * repite. Para corregir o deshacer la cuenta, esa factura se ANULA primero
 * (queda guardada con su número) y al cobrar de nuevo sale otra con el
 * siguiente. La caja puede anular las de hoy; las de días anteriores, solo el
 * admin. Lo que el cliente pida de más va en una cuenta nueva con su propia
 * factura (startExtraInvoiceAccount).
 * Devuelve true si se puede seguir.
 */
async function canChangeInvoicedAccount(timestamp, action) {
    if (!window.SupabaseManager || !window.SupabaseManager.isConfigured()) return true;
    const pending = PendingInvoices.has(timestamp);
    if (!navigator.onLine) {
        // Sin internet no se puede anular. Si la factura todavía no salió
        // (cobrada sin conexión), basta con sacarla de la cola.
        if (pending) {
            PendingInvoices.remove(timestamp);
            return true;
        }
        const isPaid = salesLog.some(s => s.timestamp === timestamp && /\(Pagado/.test(s.name));
        if (isPaid) {
            alert(`Sin internet no se puede anular la factura de esta cuenta cobrada, así que todavía no se puede ${action}. Vuelva a intentarlo cuando haya conexión.`);
            return false;
        }
        return confirm(`Sin internet no se puede revisar si esta cuenta ya tiene factura carta. Si ya se le emitió factura, NO la ${action}: abra una cuenta nueva para lo adicional. ¿Continuar igual?`);
    }
    const invoice = await window.SupabaseManager.fetchInvoiceForSale(timestamp);
    if (!invoice || invoice.status === 'anulada') {
        PendingInvoices.remove(timestamp);
        return true;
    }
    const num = window.InvoiceRenderer ? window.InvoiceRenderer.pad5(invoice.number) : invoice.number;
    if (!confirm(`Esta cuenta tiene la Factura N° ${num}.\n\nPara ${action}la, esa factura queda ANULADA (se guarda con su número, que no se vuelve a usar)${action === 'modificar' ? ' y al cobrar de nuevo sale otra factura con el siguiente número' : ''}.\n\nSi el cliente solo pide algo más, mejor cancele y use "El cliente pide más" en la factura.\n\n¿Anular la Factura N° ${num} y continuar?`)) {
        return false;
    }
    const reason = action === 'deshacer' ? 'Cuenta deshecha en caja' : 'Cuenta corregida en caja';
    const { error } = await window.SupabaseManager.voidInvoiceForCorrection(timestamp, reason);
    if (error) {
        alert(`No se pudo anular la Factura N° ${num}: ${error}\n\nLa cuenta no se cambió.`);
        return false;
    }
    PendingInvoices.remove(timestamp);
    logActivity("Anulación Factura", `Factura N° ${num} anulada (${reason.toLowerCase()}) - cuenta del horario ${new Date(timestamp).toLocaleTimeString()}`);
    window.UIManager.showToast(`🚫 Factura N° ${num} anulada.`, "fa-solid fa-ban");
    return true;
}

/**
 * Cuentas cobradas cuya factura no se pudo emitir todavía (sin internet o
 * error): se reintentan al volver la conexión. Guardadas por horario de la
 * cuenta, que es lo que identifica la cuenta en la base.
 */
const PendingInvoices = (() => {
    const KEY = 'casa_lucenzo_pending_invoices';
    const read = () => {
        try {
            const list = JSON.parse(localStorage.getItem(KEY) || '[]');
            return Array.isArray(list) ? list : [];
        } catch {
            return [];
        }
    };
    const write = (list) => {
        try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* sin espacio: se reintenta desde Historial */ }
    };
    return {
        list: read,
        has: (ts) => read().includes(ts),
        add: (ts) => { const l = read(); if (!l.includes(ts)) { l.push(ts); write(l); } },
        remove: (ts) => write(read().filter(t => t !== ts))
    };
})();
window.PendingInvoices = PendingInvoices;

/**
 * Ítems y datos de la factura de una cuenta, o el motivo por el que no lleva
 * factura automática: no está cobrada, es consumo del personal, un abono de
 * fiado o un ajuste de inventario.
 */
function invoiceDataForAccount(accountSales, fallbackRate) {
    if (accountSales.length === 0) return { skip: 'sin ventas' };
    const first = accountSales[0];
    if (!accountSales.every(s => /\(Pagado/.test(s.name))) return { skip: 'sin cobrar' };
    if (accountSales.some(s => s.productId === 'abono')) return { skip: 'abono' };
    if (accountSales.some(s => Combos && Combos.isStaffSale(s))) return { skip: 'personal' };

    const tagMatch = first.name.match(/\[(.*?)\]/);
    const tag = tagMatch ? tagMatch[1].trim() : '';
    if (tag === 'Ajuste Inventario') return { skip: 'ajuste' };
    const [rawName, rawRif = ''] = tag.split(/\s+-\s+/);
    const methodMatch = first.name.match(/\(Pagado\s*-\s*(.*?)\)\s*$/);

    // El delivery y el papelón (Combos.IVA_EXEMPT) van fuera de la factura
    // talonario (no llevan IVA ni exento).
    const invoiceSales = accountSales.filter(s => !(Combos && (Combos.isDeliverySale(s) || (Combos.isIvaExemptSale && Combos.isIvaExemptSale(s)))));
    if (invoiceSales.length === 0) return { skip: 'delivery' };
    const lines = {};
    invoiceSales.forEach(s => {
        const desc = s.name.replace(/\s*\[.*?\]/g, '').replace(/\s*\((?:Pagado|Punto|Pago|Efectivo|Biopago).*?\)/gi, '').trim();
        if (!lines[desc]) lines[desc] = { desc, qty: 0, total: 0 };
        lines[desc].qty += 1;
        lines[desc].total += s.price || 0;
    });
    const items = Object.values(lines).map(l => ({ desc: l.desc, qty: l.qty, price: Math.round((l.total / l.qty) * 100) / 100 }));

    // Sin cédula sale a consumidor final: el nombre de la cuenta suele ser un
    // apodo o "Mesa 3", no un dato fiscal. Se completa después en la factura.
    const rifDigits = rawRif.replace(/\D/g, '');
    const cf = window.InvoiceRenderer.CONSUMIDOR_FINAL;
    const hasRif = rifDigits.length >= 5;
    const rate = accountSales.map(s => parseFloat(s.bcvRate)).find(r => r > 0) || fallbackRate;
    return {
        clientName: hasRif ? (rawName || '').trim() || cf.name : cf.name,
        clientRif: hasRif ? rawRif.trim() : cf.rif,
        paymentMethod: methodMatch ? methodMatch[1] : '',
        bcvRate: rate,
        items
    };
}

/**
 * Emite sola la factura talonario de una cuenta recién cobrada. La base no le
 * da dos números a la misma cuenta (issue_invoice devuelve la que ya tenía),
 * así que un reintento o dos teléfonos a la vez no duplican. Sin internet
 * queda en cola y sale al volver la conexión.
 */
async function autoIssueInvoice(timestamp, { quiet = false } = {}) {
    if (!window.SupabaseManager || !window.SupabaseManager.isConfigured() || !window.InvoiceRenderer) return null;
    const data = invoiceDataForAccount(salesLog.filter(s => s.timestamp === timestamp), bcvRate);
    if (data.skip) {
        PendingInvoices.remove(timestamp);
        if (!quiet && data.skip === 'personal') {
            window.UIManager.showToast("👥 Consumo del personal: no lleva factura talonario.", "fa-solid fa-users");
        }
        return null;
    }
    if (!(data.bcvRate > 0)) {
        PendingInvoices.add(timestamp);
        return null;
    }
    if (!navigator.onLine) {
        PendingInvoices.add(timestamp);
        if (!quiet) window.UIManager.showToast("📶 Sin internet: la factura talonario se emite sola al volver la conexión.", "fa-solid fa-wifi");
        return null;
    }
    const { invoice, error } = await window.SupabaseManager.issueInvoice({
        saleTimestamp: timestamp,
        clientName: data.clientName,
        clientRif: data.clientRif,
        paymentMethod: data.paymentMethod,
        bcvRate: data.bcvRate,
        items: data.items
    });
    if (!invoice) {
        PendingInvoices.add(timestamp);
        if (!quiet) window.UIManager.showToast(`⚠️ La factura talonario no salió (${error}). Se reintenta sola; también puede emitirla desde Historial.`, "fa-solid fa-triangle-exclamation");
        return null;
    }
    PendingInvoices.remove(timestamp);
    if (!quiet && !invoice.reissued) {
        const who = window.InvoiceRenderer.isConsumidorFinal(invoice) ? 'consumidor final' : invoice.client_name;
        window.UIManager.showToast(`🧾 Factura N° ${window.InvoiceRenderer.pad5(invoice.number)} emitida (${who}).`, "fa-solid fa-file-invoice-dollar");
    }
    if (!invoice.reissued) {
        logActivity("Factura Talonario", `Factura N° ${window.InvoiceRenderer.pad5(invoice.number)} emitida al cobrar (${invoice.client_name} ${invoice.client_rif})`);
    }
    window.UIManager.refreshHistorialInvoices && window.UIManager.refreshHistorialInvoices({ force: true });
    return invoice;
}

/** Reintenta las facturas que quedaron en cola, una por una (en orden de cobro). */
async function retryPendingInvoices() {
    if (retryPendingInvoices._running || !navigator.onLine) return;
    retryPendingInvoices._running = true;
    try {
        for (const ts of PendingInvoices.list()) {
            await autoIssueInvoice(ts, { quiet: true });
        }
    } finally {
        retryPendingInvoices._running = false;
    }
}

/**
 * Cuenta nueva para lo que el cliente pide después de facturar: deja el
 * carrito vacío con el nombre del cliente ya puesto, y al cobrarla vuelve a
 * Clientes, donde se le emite su propia factura.
 */
function startExtraInvoiceAccount(clientLabel) {
    if (currentCart.length > 0 && !confirm("Ya tienes productos en la cuenta activa. ¿Deseas vaciarla para empezar la cuenta adicional?")) {
        return;
    }
    if (currentCart.length > 0) {
        currentCart.forEach(cartItem => {
            const product = products.find(p => p.id === cartItem.productId);
            if (product) {
                const before = product.stock;
                product.stock = product.stock >= product.max ? product.stock + cartItem.quantity : Math.min(product.max, product.stock + cartItem.quantity);
                recordStockMovement(product, product.stock - before, 'sale_return');
            }
        });
        window.StorageManager.saveProducts(products);
    }
    currentCart = [];
    localStorage.removeItem('casa_lucenzo_current_cart');
    sessionStorage.removeItem('casa_lucenzo_editing_sales');
    sessionStorage.removeItem('casa_lucenzo_editing_timestamp');
    sessionStorage.setItem('casa_lucenzo_editing_client_name', clientLabel || 'Cliente');

    window.UIManager.switchView('local');
    window.UIManager.renderActiveCart(currentCart, handleAddToCart, handleRemoveFromCart, handleClearCart, handleCheckoutCart);
    window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
    window.UIManager.showToast(`➕ Cuenta adicional de "${clientLabel}": agregue lo nuevo, cóbrelo y emita otra factura.`, "fa-solid fa-plus");
}

/**
 * Undoes a sales transaction by restoring stock and subtracting from register
 * @param {string} timestamp Sales log entry transaction timestamp
 */
async function handleUndoSale(timestamp) {
    const matchingSales = salesLog.filter(s => s.timestamp === timestamp);
    if (matchingSales.length === 0) return;
    triggerHaptic(15);

    // La factura se revisa (y se anula) después del sí, para no anularla si
    // al final no se deshace la cuenta.
    if (confirm(`¿Estás seguro de deshacer esta cuenta completa y devolver los productos al stock?`)
        && await canChangeInvoicedAccount(timestamp, 'deshacer')) {
        // Immediately record voided UUIDs locally so a stale Supabase-direct
        // refetch (pre-first-sync only -- PowerSync's own local view updates
        // instantly) can't resurrect them into salesLog before the void
        // upload lands.
        const uuidsToVoid = matchingSales.map(s => s.uuid).filter(Boolean);
        if (uuidsToVoid.length > 0) {
            window.StorageManager.addDeletedSalesUuids(uuidsToVoid);
        }

        matchingSales.forEach(sale => {
            const product = products.find(p => p.id === sale.productId);
            if (product) {
                const beforeUndo = product.stock;
                product.stock = product.stock >= product.max ? product.stock + 1 : Math.min(product.max, product.stock + 1);
                recordStockMovement(product, product.stock - beforeUndo, 'sale_return', sale.uuid);
            }
        });

        if (window.SupabaseManager.isConfigured() && uuidsToVoid.length > 0) {
            uuidsToVoid.forEach(uuid => window.SupabaseManager.voidSale(uuid, "Cuenta deshecha por el usuario"));
        }

        // Filter out these sales from memory
        salesLog = salesLog.filter(s => s.timestamp !== timestamp);
        window.StorageManager.saveSalesLog(salesLog);
        window.StorageManager.saveProducts(products);

        logActivity("Reversión de Venta", `Revertida cuenta del horario ${new Date(timestamp).toLocaleTimeString()} (${matchingSales.length} ítems devueltos a stock)`);

        // Refresh all views
        renderAllViews();
        window.UIManager.showToast("↩️ Cuenta deshecha y productos devueltos al stock.", "fa-solid fa-rotate-left");
        logActivity("Anulación Venta", `Venta anulada por el usuario (monto total devuelto al stock: $${matchingSales.reduce((s,x)=>s+x.price,0).toFixed(2)})`);
    }
}

/**
 * Autocorrects today's sales log to match the physical vitrina stock discrepancies
 * @param {Array} discrepancyList Audited products with discrepancies
 */
async function handleAutocorrectSales(discrepancyList) {
    triggerHaptic(15);
    
    const timestamp = new Date().toISOString();
    const newSales = [];
    
    discrepancyList.forEach(item => {
        if (item.discrepancy <= 0) return; // Only autocorrect missing items (expected > logged)
        
        for (let i = 0; i < item.discrepancy; i++) {
            const saleItem = {
                uuid: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2) + Date.now().toString(36),
                productId: item.product.id,
                name: `${item.product.name} [Ajuste Inventario]`,
                price: saleUsdPrice(item.product, bcvRate),
                cost: window.AnalyticsManager.productCostBs(item.product, bcvRate),
                timestamp: timestamp
            };
            newSales.push(saleItem);
        }
    });
    
    if (newSales.length === 0) return;
    
    salesLog.push(...newSales);
    window.StorageManager.saveSalesLog(salesLog);
    
    // Sync to Supabase
    if (window.SupabaseManager.isConfigured()) {
        try {
            await window.SupabaseManager.insertSales(newSales);
        } catch (e) {
            console.error("Error syncing autocorrected sales to Supabase", e);
        }
    }
    
    window.UIManager.showToast(`✨ Se han registrado ${newSales.length} ventas faltantes con éxito.`, "fa-solid fa-circle-check");
    
    // Refresh UI dashboards
    window.UIManager.renderCashRegister(salesLog, expenses);
    window.UIManager.renderSalesHistory(salesLog, handleUndoSale, handleEditSale);
    window.UIManager.renderClientesView(salesLog, handleUndoSale, handleEditSale, markTransactionAsPaid, products);
}
window.handleAutocorrectSales = handleAutocorrectSales;


/**
 * Loads a sales transaction back into the active cart for modification, deleting old sales records
 * @param {string} timestamp Sales log entry transaction timestamp
 */
async function handleEditSale(timestamp) {
    const matchingSales = salesLog.filter(s => s.timestamp === timestamp);
    if (matchingSales.length === 0) return;

    // A closed/collected sale is tagged "(Pagado ...)" on every item's name.
    // Reopening one for correction is money-sensitive: the corrected cuenta comes
    // back as pending payment, so the cashier must re-register the collection.
    const wasPaid = /\(Pagado(?:\s*-\s*.*?)?\)\s*$/.test(matchingSales[0].name);
    if (wasPaid) {
        if (!confirm("Esta venta ya fue cobrada. Al corregirla, la cuenta volverá a quedar PENDIENTE DE PAGO y tendrás que registrar el cobro de nuevo con el monto correcto. ¿Deseas continuar?")) {
            return;
        }
    }

    if (currentCart.length > 0) {
        if (!confirm("Ya tienes productos en la cuenta activa. ¿Deseas vaciarla para cargar esta cuenta del historial?")) {
            return;
        }
    }

    // Último paso antes de tocar la cuenta: si tiene factura, se anula aquí.
    if (!(await canChangeInvoicedAccount(timestamp, 'modificar'))) return;

    triggerHaptic(15);

    if (wasPaid) {
        logActivity("Corrección de Venta Cerrada", `Cuenta del horario ${new Date(timestamp).toLocaleTimeString()} reabierta para corrección (monto original: $${matchingSales.reduce((s, x) => s + x.price, 0).toFixed(2)}). Vuelve a estar pendiente de pago.`);
    }

    // 1. Group matching sales by product_id to reconstruct the cart
    const cartReconstructed = [];
    matchingSales.forEach(sale => {
        const cleanName = sale.name.replace(/\s*\[.*\](\s*\(Pagado(?: - .*?)?\))?$/, '');
        // "Pollo · Combo Clásico" comes back as a combo line, not a loose one.
        const comboMatch = Combos && cleanName.match(/ · (Combo .+)$/);
        const comboDef = comboMatch && Combos.COMBOS.find(c => c.name === comboMatch[1]);
        const isExtra = !!(Combos && Combos.isExtraSale(sale));
        const existing = cartReconstructed.find(item => item.productId === sale.productId && item.name === cleanName
            && (!isExtra || (Math.abs(item.price - (sale.price || 0)) < 1e-6 && (item.costBs || 0) === (parseFloat(sale.cost_at_sale ?? sale.cost) || 0))));
        if (existing) {
            existing.quantity++;
        } else {
            const line = {
                productId: sale.productId,
                name: cleanName,
                price: sale.price || 0,
                quantity: 1
            };
            if (comboDef) line.combo = comboDef.id;
            else if (Combos && Combos.isStaffSale(cleanName)) line.combo = 'personal';
            else if (Combos && Combos.isDeliverySale(sale)) line.combo = 'delivery';
            else if (isExtra) {
                line.combo = `extra-${cartReconstructed.length}`;
                line.costBs = parseFloat(sale.cost_at_sale ?? sale.cost) || 0;
            }
            cartReconstructed.push(line);
        }
    });

    // Extract client name
    let clientName;
    const firstSale = matchingSales[0];
    const match = firstSale.name.match(/^(.*)\s+\[(.*)\](\s*\(Pagado(?: - .*?)?\))?$/);
    if (match) {
        clientName = match[2];
    } else {
        clientName = firstSale.productId === 'abono' ? 'Abono Deuda' : 'Cliente';
    }

    // 2. Set active cart in memory and localStorage
    currentCart = cartReconstructed;
    localStorage.setItem('casa_lucenzo_current_cart', JSON.stringify(currentCart));
    sessionStorage.setItem('casa_lucenzo_editing_client_name', clientName);
    sessionStorage.setItem('casa_lucenzo_editing_timestamp', timestamp);
    sessionStorage.setItem('casa_lucenzo_editing_sales', JSON.stringify(matchingSales));

    // 3. Remove old sales locally to avoid double counting in active cart
    salesLog = salesLog.filter(s => s.timestamp !== timestamp);
    window.StorageManager.saveSalesLog(salesLog);

    // 4. Switch to local view and update UI
    window.UIManager.switchView('local');
    window.UIManager.renderActiveCart(currentCart, handleAddToCart, handleRemoveFromCart, handleClearCart, handleCheckoutCart);
    window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
    window.UIManager.renderCashRegister(salesLog, expenses);
    window.UIManager.renderSalesHistory(salesLog, handleUndoSale, handleEditSale);

    if (currentRole === 'admin') {
        window.UIManager.renderStats(salesLog, expenses);
    }

    window.UIManager.showToast(`✏️ Cuenta de "${clientName}" cargada para modificar.`, "fa-solid fa-pen-to-square");
}

/**
 * Marks a sales transaction as paid, updating Supabase and memory (changing suffix to include (Pagado))
 * @param {string} timestamp Sales log entry transaction timestamp
 */
async function markTransactionAsPaid(timestamp, paymentMethod, updatedName = null, updatedRif = null) {
    const matchingSales = salesLog.filter(s => s.timestamp === timestamp);
    if (matchingSales.length === 0) return;

    let clientName = "Cliente";
    let clientRif = "";
    const firstSale = matchingSales[0];
    const bracketMatch = firstSale.name.match(/\[(.*?)\]/);
    if (bracketMatch) {
        const rawTag = bracketMatch[1].trim();
        if (rawTag.includes(' - ')) {
            const parts = rawTag.split(/\s+-\s+/);
            clientName = parts[0].trim();
            clientRif = parts[1].trim();
        } else {
            clientName = rawTag;
        }
    }

    const finalName = updatedName !== null ? updatedName.trim() : clientName;
    const finalRif = updatedRif !== null ? updatedRif.trim() : clientRif;

    // Ask for payment method if not provided yet
    if (!paymentMethod) {
        const itemMap = {};
        matchingSales.forEach(s => {
            let baseName = s.name.replace(/\s*\[.*?\]/g, '').replace(/\s*\((?:Pagado|Punto|Pago|Efectivo|Biopago).*?\)/gi, '').trim();
            if (!itemMap[baseName]) {
                itemMap[baseName] = { name: baseName, quantity: 0, totalPrice: 0, price: s.price };
            }
            itemMap[baseName].quantity += 1;
            itemMap[baseName].totalPrice += s.price;
        });
        const items = Object.values(itemMap);

        if (window.UIManager && window.UIManager.showPaymentMethodModal) {
            window.UIManager.showPaymentMethodModal(finalName, finalRif, items, timestamp, (method, name, rif) => {
                markTransactionAsPaid(timestamp, method, name, rif);
            });
        } else {
            markTransactionAsPaid(timestamp, "Efectivo", finalName, finalRif);
        }
        return;
    }

    triggerHaptic(15);

    const clientTag = (finalRif && finalRif.trim()) ? `${finalName} - ${finalRif.trim()}` : finalName;

    // Map to updated sales with selected payment method
    const updatedSales = matchingSales.map(sale => {
        let baseProductName = sale.name
            .replace(/\s*\[.*?\]/g, '')
            .replace(/\s*\((?:Pagado|Punto|Pago|Efectivo|Biopago).*?\)/gi, '')
            .trim();
        let newName = `${baseProductName} [${clientTag}] (Pagado - ${paymentMethod})`;
        return {
            ...sale,
            name: newName
        };
    });

    if (window.SupabaseManager.isConfigured()) {
        await window.SupabaseManager.upsertSales(updatedSales);
    }

    // Update local salesLog
    salesLog = salesLog.map(s => {
        if (s.timestamp === timestamp) {
            let baseProductName = s.name
                .replace(/\s*\[.*?\]/g, '')
                .replace(/\s*\((?:Pagado|Punto|Pago|Efectivo|Biopago).*?\)/gi, '')
                .trim();
            let newName = `${baseProductName} [${clientTag}] (Pagado - ${paymentMethod})`;
            return { ...s, name: newName };
        }
        return s;
    });

    window.StorageManager.saveSalesLog(salesLog);
    renderAllViews();
    window.UIManager.showToast(`💵 Cuenta de "${finalName}" cobrada con éxito.`, "fa-solid fa-circle-check");

    // La factura talonario sale sola al cobrar (sin cédula: consumidor final).
    await autoIssueInvoice(timestamp);
}

/**
 * Reset all log history and cash register to $0.00
 */
function clearAllSales() {
    triggerHaptic(20);
    if (confirm("¿Estás seguro de que quieres borrar el historial de ventas y reiniciar la caja a $0.00?")) {
        // Void instead of delete (spec §5.2) -- doesn't touch product stock,
        // same as the delete this replaces never did either.
        if (window.SupabaseManager.isConfigured()) {
            salesLog.forEach(s => window.SupabaseManager.voidSale(s.uuid, "Reinicio de caja"));
        }

        salesLog = [];
        window.StorageManager.clearSalesLog();
        window.UIManager.renderCashRegister(salesLog, expenses);
        window.UIManager.renderSalesHistory(salesLog, handleUndoSale);
        
        if (currentRole === 'admin') {
            window.UIManager.renderStats(salesLog, expenses, products);
        }

        window.UIManager.showToast("🧹 Historial de ventas y caja reiniciados.", "fa-solid fa-trash-can");
    }
}
