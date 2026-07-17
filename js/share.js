// WhatsApp integration module

/**
 * Compiles missing stock products and formats a WhatsApp message to share with family members.
 * Opens the message in a new window using the WhatsApp web API.
 * @param {Array} products Current list of products.
 * @param {Function} showToast Callback function to display toast notification.
 */
function shareToWhatsApp(products, showToast) {
    const neededItems = products.filter(p => p.stock < p.max);
    
    if (neededItems.length === 0) {
        if (typeof showToast === 'function') {
            showToast("✨ ¡Todo completo! No hay productos por reponer hoy.", "fa-solid fa-circle-info");
        }
        return;
    }

    let message = "📋 *FALTA COCINAR - CASA LUCENZO*\n";
    message += "--------------------------------------\n";
    
    neededItems.forEach(item => {
        const amountNeeded = item.max - item.stock;
        message += `• *${item.name}*: Falta cocinar *${amountNeeded}* ${item.unit} (Quedan: ${item.stock} en vitrina)\n`;
    });
    
    message += "--------------------------------------\n";
    message += "📢 _¡Por favor preparar y enviar al local lo antes posible!_ 🧑‍🍳";

    const encodedMessage = encodeURIComponent(message);
    const whatsappUrl = `https://api.whatsapp.com/send?text=${encodedMessage}`;
    
    window.open(whatsappUrl, '_blank');
}

// Expose to window namespace
window.ShareManager = {
    shareToWhatsApp
};
