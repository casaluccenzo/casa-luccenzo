// Shared helpers for the two WhatsApp bot entry points:
//   - api/whatsapp-webhook.js   (official Meta Graph API webhook, used in production)
//   - tools/whatsapp-qr-bridge.js (unofficial Baileys QR bridge, local/manual use only)
// Keeping this logic in one place avoids the two integrations drifting apart.

function normalizeText(str) {
    if (!str) return '';
    return String(str)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '');
}

function normalizePhone(phone) {
    if (!phone) return '';
    return String(phone).replace(/[^0-9]/g, '');
}

const DEFAULT_PRODUCTS = [
    { id: 'p1', name: 'Pastelito de Queso', stock: 20, price: 1.50, category: 'pastelitos' },
    { id: 'p2', name: 'Pastelito de Pollo', stock: 15, price: 1.50, category: 'pastelitos' },
    { id: 'p3', name: 'Pastelito de Carne', stock: 12, price: 1.50, category: 'pastelitos' },
    { id: 'p4', name: 'Empanada de Queso', stock: 25, price: 1.20, category: 'empanadas' },
    { id: 'p5', name: 'Empanada de Carne', stock: 18, price: 1.20, category: 'empanadas' },
    { id: 'p6', name: 'Coca Cola 355ml', stock: 30, price: 1.00, category: 'bebidas' },
    { id: 'p7', name: 'Malta 250ml', stock: 24, price: 1.00, category: 'bebidas' },
    { id: 'p8', name: 'Torta Tres Leches', stock: 8, price: 3.50, category: 'tortas' }
];

/**
 * Lightweight Zero-Dependency Supabase REST Helper
 */
class SupabaseRest {
    constructor(url, key) {
        this.url = url?.replace(/\/$/, '');
        this.key = key;
    }

    async get(table, select = '*') {
        if (!this.url || !this.key) return null;
        try {
            const resp = await fetch(`${this.url}/rest/v1/${table}?select=${encodeURIComponent(select)}`, {
                headers: {
                    'apikey': this.key,
                    'Authorization': `Bearer ${this.key}`
                }
            });
            if (!resp.ok) return null;
            return await resp.json();
        } catch (e) {
            return null;
        }
    }

    async patch(table, filterCol, filterVal, data) {
        if (!this.url || !this.key) return false;
        try {
            const resp = await fetch(`${this.url}/rest/v1/${table}?${filterCol}=eq.${encodeURIComponent(filterVal)}`, {
                method: 'PATCH',
                headers: {
                    'apikey': this.key,
                    'Authorization': `Bearer ${this.key}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal'
                },
                body: JSON.stringify(data)
            });
            return resp.ok;
        } catch (e) {
            return false;
        }
    }

    async post(table, data) {
        if (!this.url || !this.key) return false;
        try {
            const resp = await fetch(`${this.url}/rest/v1/${table}`, {
                method: 'POST',
                headers: {
                    'apikey': this.key,
                    'Authorization': `Bearer ${this.key}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal'
                },
                body: JSON.stringify(data)
            });
            return resp.ok;
        } catch (e) {
            return false;
        }
    }
}

/**
 * Checks whether a raw phone number is allowed to administer the business via WhatsApp,
 * either via the WHATSAPP_ADMIN_PHONE env whitelist or via an admin profile in Supabase.
 * @param {SupabaseRest|null} db
 * @param {string} rawFrom
 * @returns {Promise<boolean>}
 */
async function isAuthorizedPhone(db, rawFrom) {
    const normalizedFrom = normalizePhone(rawFrom);
    const adminPhonesEnv = process.env.WHATSAPP_ADMIN_PHONE;
    if (!adminPhonesEnv) return false;

    const allowedPhones = adminPhonesEnv.split(',').map(p => normalizePhone(p));
    if (allowedPhones.includes(normalizedFrom)) return true;

    if (db) {
        const userProfiles = await db.get('profiles', 'phone,role');
        if (userProfiles) {
            const found = userProfiles.find(p => normalizePhone(p.phone) === normalizedFrom && p.role === 'admin');
            if (found) return true;
        }
    }

    return false;
}

/**
 * Call Gemini 2.5 Flash API for Conversational NLU & Natural Language Generation
 */
async function processIntentWithGemini(userText, catalog, liveContext) {
    const apiKey = process.env.GEMINI_API_KEY;
    const catalogText = catalog.map(p => `- ID: "${p.id}" | Nombre: "${p.name}" | Categoría: "${p.category}" | Stock Actual en Vitrina: ${p.stock}`).join('\n');

    const fallback = () => ({
        intent: 'conversational_chat',
        reply_text: `🤖 ¡Hola ${liveContext.senderName}! Hoy en Casa Lucenzo llevamos **$${liveContext.totalSalesUsd.toFixed(2)} USD** en ventas (${liveContext.salesCount} operaciones).\n\n🏆 *Productos más vendidos hoy:*\n${liveContext.topProductsText}`
    });

    if (!apiKey) return fallback();

    const systemPrompt = `Eres el Asistente Conversacional Inteligente de Casa Lucenzo (panadería/pastelería).
Hablas con ${liveContext.senderName} (el dueño/administrador) de forma totalmente natural, amable, cercana y profesional por WhatsApp.

DATOS EN TIEMPO REAL DEL NEGOCIO (HOY):
- Resumen de Caja: ${liveContext.salesSummaryText}
- Productos Más Vendidos Hoy:
${liveContext.topProductsText}

CATÁLOGO E INVENTARIO ACTUAL EN VITRINA:
${catalogText}

INSTRUCCIONES:
1. Responde a la pregunta de ${liveContext.senderName} de forma 100% conversacional, natural y directa (ej: si pregunta qué sabor se vende más, dile cuál es el producto estrella hoy con las cantidades vendidas y cuál le sigue).
2. Si el usuario pide cargar stock, cambiar tasa o modificar algo en lenguaje natural, identifica la intención ("add_stock", "set_stock", "update_bcv", "query_sales", "conversational_chat"), extrae los parámetros y redacta una respuesta conversacional confirmando la acción.

RESPONDE ÚNICAMENTE CON UN OBJETO JSON VÁLIDO SIN BLOQUES MARKDOWN:
{
  "intent": "add_stock" | "set_stock" | "query_sales" | "update_bcv" | "conversational_chat",
  "target_product_id": "ID del producto si aplica",
  "product_name": "Nombre detectado del producto si aplica",
  "quantity": numero_entero_si_aplica,
  "bcv_rate": numero_decimal_si_aplica,
  "reply_text": "Tu respuesta conversacional en español formateada con emojis elegantes para WhatsApp"
}`;

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    role: "user",
                    parts: [{ text: `${systemPrompt}\n\nMensaje de ${liveContext.senderName}: "${userText}"` }]
                }]
            })
        });
        if (!resp.ok) throw new Error(`Gemini API Error ${resp.status}`);
        const data = await resp.json();
        let rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(rawText);
    } catch (e) {
        return fallback();
    }
}

module.exports = {
    normalizeText,
    normalizePhone,
    DEFAULT_PRODUCTS,
    SupabaseRest,
    isAuthorizedPhone,
    processIntentWithGemini
};
