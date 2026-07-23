// Agent / AI Assistant Module for Casa Lucenzo Admin Panel

class AgentManager {
    constructor() {
        this.geminiApiKey = localStorage.getItem('casa_lucenzo_gemini_api_key') || '';
    }

    setGeminiApiKey(key) {
        this.geminiApiKey = (key || '').trim();
        localStorage.setItem('casa_lucenzo_gemini_api_key', this.geminiApiKey);
    }

    getGeminiApiKey() {
        return this.geminiApiKey;
    }

    /**
     * Process user query using offline logic parser or Gemini API if available
     */
    async processQuery(userInput, context) {
        const query = (userInput || '').trim();
        if (!query) return { text: "Por favor escribe un mensaje o elige una sugerencia." };

        // 1. Check if user wants to use Gemini API and Key is present
        if (this.geminiApiKey) {
            try {
                const aiResult = await this.callGeminiAPI(query, context);
                if (aiResult) return aiResult;
            } catch (err) {
                console.warn("Gemini API call failed, falling back to local agent logic:", err);
            }
        }

        // 2. Local Intelligent Command / Intent Parser (Offline Mode)
        return this.processLocalIntent(query, context);
    }

    /**
     * Local parser for offline capabilities
     */
    processLocalIntent(query, context) {
        const lower = query.toLowerCase();
        const { products = [], salesLog = [], expenses = [], bcvRate = 1, actions = {} } = context;

        // Intent A: Resumen del día / Ventas de hoy
        if (lower.includes('resumen') || lower.includes('ventas de hoy') || lower.includes('cuanto vendimos') || lower.includes('cuánto vendimos') || lower.includes('caja') || lower.includes('cierre')) {
            return this.getTodaySummaryResponse(salesLog, expenses, bcvRate);
        }

        // Intent B: Bajo stock / Productos por reponer
        if (lower.includes('bajo stock') || lower.includes('falta') || lower.includes('reponer') || lower.includes('sin stock') || lower.includes('poco stock')) {
            return this.getLowStockResponse(products);
        }

        // Intent C: Producto más vendido
        if (lower.includes('mas vendido') || lower.includes('más vendido') || lower.includes('top') || lower.includes('estrella')) {
            return this.getTopProductsResponse(salesLog, products);
        }

        // Intent D: Registrar gasto (ej. "registra un gasto de 5 en vasos" o "gasto de $10 en harina")
        const gastoMatch = query.match(/(?:registra|agrega|añade)?\s*(?:un)?\s*gasto\s*(?:de)?\s*\$?([0-9]+(?:\.[0-9]+)?)\s*(?:en|por|para)?\s*(.+)/i) ||
                           query.match(/gasto\s+(.+)\s+\$?([0-9]+(?:\.[0-9]+)?)/i);
        if (gastoMatch) {
            let amount = parseFloat(gastoMatch[1]);
            let desc = gastoMatch[2].trim();
            if (isNaN(amount)) {
                amount = parseFloat(gastoMatch[2]);
                desc = gastoMatch[1].trim();
            }
            if (!isNaN(amount) && amount > 0 && desc) {
                if (actions && typeof actions.addExpense === 'function') {
                    actions.addExpense(desc, amount);
                    return {
                        text: `✅ **Gasto registrado con éxito**:\n• **Descripción**: ${desc}\n• **Monto**: $${amount.toFixed(2)} (Bs. ${(amount * bcvRate).toFixed(2)})`,
                        actionTaken: 'addExpense'
                    };
                }
            }
        }

        // Intent E: Cambiar precio de un producto (ej. "cambia el precio de pollo a 1.6" o "precio de malta a 1.20")
        const priceMatch = query.match(/(?:cambia|modifica|ajusta|pon|establece)\s*(?:el)?\s*precio\s*(?:de)?\s*(.+?)\s*(?:a|en)\s*\$?([0-9]+(?:\.[0-9]+)?)/i);
        if (priceMatch) {
            const prodSearch = priceMatch[1].trim().toLowerCase();
            const newPrice = parseFloat(priceMatch[2]);
            const targetProd = products.find(p => p.name.toLowerCase().includes(prodSearch) || p.id.toLowerCase() === prodSearch);
            if (targetProd && !isNaN(newPrice) && newPrice >= 0) {
                if (actions && typeof actions.updateProductPrice === 'function') {
                    actions.updateProductPrice(targetProd.id, newPrice);
                    return {
                        text: `✅ **Precio actualizado**:\n• **Producto**: ${targetProd.name}\n• **Nuevo Precio**: $${newPrice.toFixed(2)} (Bs. ${(newPrice * bcvRate).toFixed(2)})`,
                        actionTaken: 'updateProductPrice'
                    };
                }
            } else if (!targetProd) {
                return { text: `🔍 No encontré ningún producto que coincida con "${priceMatch[1]}". Revisa el nombre e intenta de nuevo.` };
            }
        }

        // Intent F: Reabastecer vitrina / Reset to max
        if (lower.includes('reabastece') || lower.includes('rellena') || lower.includes('resetear vitrina') || lower.includes('maximo stock') || lower.includes('máximo stock')) {
            if (actions && typeof actions.resetToMax === 'function') {
                actions.resetToMax();
                return {
                    text: `✨ **Vitrina reabastecida al 100%**: Todos los productos han vuelto a su stock máximo para la jornada.`,
                    actionTaken: 'resetToMax'
                };
            }
        }

        // Intent G: Agregar producto (ej. "agrega producto Pasticho precio 5")
        const addProdMatch = query.match(/(?:agrega|crea|añade)\s*(?:un)?\s*(?:nuevo)?\s*producto\s+(.+?)\s+precio\s+\$?([0-9]+(?:\.[0-9]+)?)/i);
        if (addProdMatch) {
            const name = addProdMatch[1].trim();
            const price = parseFloat(addProdMatch[2]);
            if (name && !isNaN(price)) {
                if (actions && typeof actions.addNewProduct === 'function') {
                    actions.addNewProduct({
                        name: name,
                        price: price,
                        stock: 15,
                        min: 5,
                        max: 15,
                        unit: 'unid.',
                        category: 'pastelitos'
                    });
                    return {
                        text: `✅ **Producto creado exitosamente**:\n• **Nombre**: ${name}\n• **Precio**: $${price.toFixed(2)}\n• **Stock inicial**: 15 unid.`,
                        actionTaken: 'addNewProduct'
                    };
                }
            }
        }

        // Intent H: Ayuda / Qué puedes hacer
        if (lower.includes('ayuda') || lower.includes('que puedes hacer') || lower.includes('qué puedes hacer') || lower.includes('hola') || lower.includes('comandos')) {
            return {
                text: `👋 **¡Hola! Soy tu Agente Lucenzo IA.** Puedo ayudarte con:\n\n` +
                      `1. 📊 **Resúmenes**: *"Dame el resumen de ventas de hoy"*, *"¿Qué vendimos hoy?"*\n` +
                      `2. ⚠️ **Inventario**: *"¿Qué productos están bajos en stock?"*\n` +
                      `3. 💸 **Gastos**: *"Registra un gasto de $5 en bolsas"*\n` +
                      `4. 🏷️ **Precios**: *"Cambia el precio de Pollo a 1.60"*\n` +
                      `5. 📦 **Vitrina**: *"Reabastece la vitrina a stock máximo"*\n` +
                      `6. 🏆 **Top Ventas**: *"¿Cuál es el producto más vendido?"*`
            };
        }

        // Fallback default
        return {
            text: `🤔 No comprendí completamente tu instrucción "${query}".\n\nPrueba pidiéndome algo como:\n• *"Resumen de ventas de hoy"*\n• *"Registra un gasto de $5 en cajas"*\n• *"¿Qué productos tienen poco stock?"*\n• *"Cambia el precio de Pollo a 1.60"*`
        };
    }

    getTodaySummaryResponse(salesLog, expenses, rate) {
        const totalSales = salesLog.reduce((sum, s) => sum + (s.price || 0), 0);
        const totalExpenses = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
        const netCash = totalSales - totalExpenses;
        const totalUnits = salesLog.filter(s => s.productId !== 'abono').length;

        let res = `📊 **RESUMEN DE VENTAS DE HOY**\n\n`;
        res += `• **Unidades vendidas**: ${totalUnits} productos\n`;
        res += `• 💰 **Ventas Totales**: $${totalSales.toFixed(2)} (Bs. ${(totalSales * rate).toFixed(2)})\n`;
        res += `• 💸 **Gastos**: -$${totalExpenses.toFixed(2)} (Bs. ${(totalExpenses * rate).toFixed(2)})\n`;
        res += `• 💵 **Caja Neta**: **$${netCash.toFixed(2)}** _(Bs. ${(netCash * rate).toFixed(2)})_\n\n`;
        res += `💱 *Tasa BCV*: ${rate.toFixed(2)} Bs.`;
        return { text: res };
    }

    getLowStockResponse(products) {
        const lowStock = products.filter(p => p.stock <= p.min);
        if (lowStock.length === 0) {
            return { text: `✨ **¡Excelente!** Todos los productos están con buen nivel de stock en vitrina.` };
        }
        let res = `⚠️ **PRODUCTOS CON BAJO STOCK (${lowStock.length})**:\n\n`;
        lowStock.forEach(p => {
            res += `• **${p.name}**: ${p.stock} / ${p.max} ${p.unit} _(Mínimo: ${p.min})_\n`;
        });
        res += `\n💡 Puedes decirme *"Reabastece la vitrina"* para rellenar al máximo.`;
        return { text: res };
    }

    getTopProductsResponse(salesLog, products) {
        const counts = {};
        salesLog.forEach(s => {
            if (s.productId === 'abono') return;
            const name = s.name.replace(/\s*\[.*\](\s*\(Pagado(?: - .*?)?\))?$/, '');
            counts[name] = (counts[name] || 0) + 1;
        });

        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        if (sorted.length === 0) {
            return { text: `🛒 Aún no hay ventas registradas en la jornada de hoy.` };
        }

        let res = `🏆 **PRODUCTOS MÁS VENDIDOS HOY**:\n\n`;
        sorted.slice(0, 5).forEach(([name, count], index) => {
            const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '•';
            res += `${medal} **${name}**: ${count} unidades\n`;
        });
        return { text: res };
    }

    async callGeminiAPI(query, context) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${this.geminiApiKey}`;

        const { products = [], salesLog = [], expenses = [], bcvRate = 1 } = context;
        const totalSales = salesLog.reduce((s, x) => s + (x.price || 0), 0);
        const totalExpenses = expenses.reduce((s, x) => s + (x.amount || 0), 0);
        const netCash = totalSales - totalExpenses;

        const systemPrompt = `Eres el Agente Virtual de Inteligencia Artificial para el negocio "Casa Lucenzo" (venta de pastelitos, bebidas y tortas). 
Tu objetivo es responder de forma amable, directa, ejecutiva y formateada en Markdown al dueño/administrador.

DATOS EN TIEMPO REAL DEL NEGOCIO:
- Tasa BCV: ${bcvRate} Bs/USD
- Ventas Totales Hoy: $${totalSales.toFixed(2)} USD (Caja Neta: $${netCash.toFixed(2)})
- Cantidad de Gastos Hoy: ${expenses.length} ($${totalExpenses.toFixed(2)})
- Productos en Inventario: ${JSON.stringify(products.map(p => ({ id: p.id, name: p.name, stock: p.stock, price: p.price, category: p.category })))}
- Últimas 10 ventas: ${JSON.stringify(salesLog.slice(-10).map(s => ({ name: s.name, price: s.price })))}

Responde directamente a la consulta del usuario usando emojis, negritas y listas.`;

        const payload = {
            contents: [
                {
                    role: "user",
                    parts: [{ text: `${systemPrompt}\n\nConsulta del usuario: ${query}` }]
                }
            ]
        };

        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) throw new Error(`Gemini API error: ${res.statusText}`);
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
            return { text: text };
        }
        return null;
    }
}

window.AgentManager = new AgentManager();
