// Fiados (cuentas por cobrar), pedidos en línea y stock de insumos.
//
// Antes formaba parte de js/app.js. Script clásico (no módulo ES): comparte el
// ámbito global con los demás archivos de js/app/ y js/ui/, así que el orden de
// carga importa. Ese orden vive en sistema/index.html (y se repite en sw.js y
// js/app/index.js; tests/script-order.test.js comprueba que coincidan).

// ================= DEBTS virtual ledger (FIADOS) =================

/**
 * Register client debt or add more balance to existing debtor
 * @param {Event} e Submit event
 */
function addDebt(e) {
    e.preventDefault();

    const nameInput = document.getElementById('debt-client-name');
    const amountInput = document.getElementById('debt-amount');
    const descInput = document.getElementById('debt-desc');

    const name = nameInput.value.trim();
    const amount = parseFloat(amountInput.value);
    const description = descInput.value.trim();

    if (!name || isNaN(amount) || amount <= 0) return;

    triggerHaptic(15);

    const existingClient = debts.find(d => d.clientName.toLowerCase() === name.toLowerCase());
    let targetDebtObj;

    if (existingClient) {
        // Plan B, Task 8: existingClient.amount is now a COMPUTED balance
        // (original - abonos, see mapDebtRow), not the stored value -- must
        // add the new debt onto originalAmount, or upsertDebt would persist
        // an already-paid-down number as if it were the fresh original.
        const currentOriginal = (existingClient.originalAmount !== undefined && existingClient.originalAmount !== null)
            ? existingClient.originalAmount : existingClient.amount;
        existingClient.originalAmount = currentOriginal + amount;
        existingClient.amount += amount;
        existingClient.timestamp = new Date().toISOString();
        if (description) {
            existingClient.description = existingClient.description 
                ? `${existingClient.description}, ${description}` 
                : description;
        }
        targetDebtObj = existingClient;
    } else {
        const newDebt = {
            uuid: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2) + Date.now().toString(36),
            clientName: name,
            amount,
            description,
            timestamp: new Date().toISOString()
        };
        debts.push(newDebt);
        targetDebtObj = newDebt;
    }

    window.StorageManager.saveDebts(debts);

    if (window.SupabaseManager.isConfigured()) {
        window.SupabaseManager.upsertDebt(targetDebtObj);
    }

    window.UIManager.renderDebts(debts, settleDebtPayment);

    document.getElementById('add-debt-form').reset();
    window.UIManager.showToast(`📝 Cuenta de "${name}" actualizada.`, "fa-solid fa-book");
}

/**
 * Settle customer payments, subtracting from debt ledger and adding cash to register
 * @param {string} uuid Client ledger unique identifier
 */
function settleDebtPayment(uuid) {
    const client = debts.find(d => d.uuid === uuid);
    if (!client) return;

    triggerHaptic(15);

    const paymentPrompt = prompt(`Ingresa el monto que abona ${client.clientName}:\nDeuda actual: $${client.amount.toFixed(2)}`, client.amount.toFixed(2));
    if (paymentPrompt === null) return;

    const paymentAmount = parseFloat(paymentPrompt);
    if (isNaN(paymentAmount) || paymentAmount <= 0 || paymentAmount > client.amount) {
        alert("Monto inválido. No puede ser mayor que la deuda actual.");
        return;
    }

    triggerHaptic(15);

    // Plan B, Task 8: abonos son append-only (spec §5.3) -- ya no se persiste
    // una resta de debts.amount (ver insertDebtPayment más abajo), así que
    // dejar de mutar client.timestamp/description también: nada los sube a
    // Postgres desde acá, y mutarlos solo local crearía una vista distinta a
    // la de cualquier otro dispositivo (o esta misma pestaña tras un
    // refetch). El monto sí se mantiene optimista en memoria para feedback
    // instantáneo -- fetchDebts vuelve a calcular el mismo valor apenas
    // insertDebtPayment sube.
    client.amount = Math.max(0, client.amount - paymentAmount);

    const saleItem = {
        uuid: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2) + Date.now().toString(36),
        productId: 'abono',
        name: `Abono: ${client.clientName}`,
        price: paymentAmount,
        timestamp: new Date().toISOString()
    };
    salesLog.push(saleItem);

    window.StorageManager.saveDebts(debts);
    window.StorageManager.saveSalesLog(salesLog);

    logActivity("Abono de Deuda", `Cliente ${client.clientName} abonó $${paymentAmount.toFixed(2)}. Restante: $${client.amount.toFixed(2)}`);

    if (window.SupabaseManager.isConfigured()) {
        window.SupabaseManager.insertDebtPayment(client.uuid, paymentAmount, null, myDeviceId);
        window.SupabaseManager.insertSale(saleItem);
    }

    window.UIManager.renderDebts(debts, settleDebtPayment);
    window.UIManager.renderCashRegister(salesLog, expenses);
    window.UIManager.renderSalesHistory(salesLog, handleUndoSale);

    if (currentRole === 'admin') {
        window.UIManager.renderStats(salesLog, expenses);
    }

    window.UIManager.showToast(`💵 Pago de $${paymentAmount.toFixed(2)} registrado en caja.`, "fa-solid fa-hand-holding-dollar");
}

// ================= PEDIDOS ONLINE =================

/**
 * Marks a customer's online order as confirmed (payment received).
 * Does NOT touch stock or create a sale record -- staff still ring up the
 * sale normally when the customer picks up the order.
 */
function handleConfirmPedido(id) {
    const pedido = pedidosOnline.find(p => p.id === id);
    if (!pedido) return;

    triggerHaptic(15);
    pedido.status = 'confirmado';

    window.SupabaseManager.updatePedidoStatus(id, 'confirmado');
    logActivity("Pedido Online Confirmado", `Pedido de ${pedido.customer_name} por $${Number(pedido.total).toFixed(2)} confirmado.`);

    window.UIManager.renderPedidosOnline(pedidosOnline, handleConfirmPedido, handleRechazarPedido);
    window.UIManager.updatePedidosBadge(pedidosOnline);
    window.UIManager.showToast(`✅ Pedido de ${pedido.customer_name} confirmado.`, "fa-solid fa-check");
}

/**
 * Marks a customer's online order as rejected (e.g. payment never arrived).
 */
function handleRechazarPedido(id) {
    const pedido = pedidosOnline.find(p => p.id === id);
    if (!pedido) return;

    if (!confirm(`¿Rechazar el pedido de ${pedido.customer_name} por $${Number(pedido.total).toFixed(2)}?`)) return;

    triggerHaptic(15);
    pedido.status = 'rechazado';

    window.SupabaseManager.updatePedidoStatus(id, 'rechazado');
    logActivity("Pedido Online Rechazado", `Pedido de ${pedido.customer_name} por $${Number(pedido.total).toFixed(2)} rechazado.`);

    window.UIManager.renderPedidosOnline(pedidosOnline, handleConfirmPedido, handleRechazarPedido);
    window.UIManager.updatePedidosBadge(pedidosOnline);
    window.UIManager.showToast(`🚫 Pedido de ${pedido.customer_name} rechazado.`, "fa-solid fa-ban");
}

// ================= INGREDIENTS STOCK =================

/**
 * Prompt to add stock to kitchen ingredient alacena
 * @param {string} id Ingredient identifier
 */
function addIngredientStock(id) {
    const ing = ingredients.find(i => i.id === id);
    if (!ing) return;

    triggerHaptic(15);
    const promptAmount = prompt(`¿Cuántos ${ing.unit} de "${ing.name}" deseas agregar?`, "5.0");
    if (promptAmount === null) return;
    const amountVal = parseFloat(promptAmount);
    if (isNaN(amountVal) || amountVal <= 0) {
        alert("Cantidad inválida.");
        return;
    }

    triggerHaptic(15);
    ing.stock += amountVal;
    window.StorageManager.saveIngredients(ingredients);

    if (window.SupabaseManager.isConfigured()) {
        window.SupabaseManager.upsertIngredient(ing);
    }

    window.UIManager.renderIngredientsPantry(ingredients, addIngredientStock);
    window.UIManager.showToast(`📦 Se agregaron +${amountVal} ${ing.unit} de ${ing.name}.`, "fa-solid fa-circle-check");
}
