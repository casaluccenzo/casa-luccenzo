// Precios en Bs fijos: promo del pastel por día de la semana y combos.
// Lo usan la caja (sistema/index.html) y el menú web (index.html, pedido.html),
// así que no depende de nada más. La promo solo aplica a productos que ya
// tienen precio fijo en Bs (products.price_bs, que pone Gustavo a mano).
(function (root) {
    // Martes y miércoles el pastel con precio fijo cuesta Bs 2.000.
    const PROMO = { category: 'pastelitos', days: [2, 3], priceBs: 2000, label: 'martes y miércoles' };

    // Cada combo: pasteles del sabor que elija el cliente + una bebida. El
    // pastel se cobra a su precio fijo del día y la bebida a `drinkBs`, así
    // que el combo suma `priceBs` en un día normal (en días de promo, menos).
    const COMBOS = [
        { id: 'clasico', name: 'Combo Clásico', pasteles: 1, drink: 'Malta Retornable', drinkBs: 800, priceBs: 3000 },
        { id: 'mananero', name: 'Combo Mañanero', pasteles: 1, drink: 'Café negro', drinkBs: 500, priceBs: 2700 },
        { id: 'pana', name: 'Combo Pana', pasteles: 2, drink: 'Malta Retornable', drinkBs: 600, priceBs: 5000 }
    ];

    // Consumo del personal: el pastel al costo (products.cost, en Bs) más el
    // 16% de IVA, así lo que entra a caja cubre el costo después del impuesto.
    // La venta lleva " · Consumo personal" en el nombre para que reportes y
    // cierre la separen de las ventas normales.
    const STAFF = { category: 'pastelitos', label: 'Consumo personal', iva: 0.16 };

    const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

    /** Día de la semana en Caracas (0 = domingo), sin importar la zona del dispositivo. */
    function caracasWeekday(date) {
        const d = date || new Date();
        try {
            const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Caracas', weekday: 'short' }).format(d);
            if (wd in WEEKDAYS) return WEEKDAYS[wd];
        } catch (e) { /* Intl sin zonas horarias: cae a UTC-4 fijo */ }
        return new Date(d.getTime() - 4 * 3600 * 1000).getUTCDay();
    }

    function isPromoDay(date) {
        return PROMO.days.includes(caracasWeekday(date));
    }

    /** Precio fijo en Bs del producto hoy (con la promo si toca), o 0 si no tiene. */
    function fixedBsPrice(product, date) {
        const bs = parseFloat(product && product.price_bs);
        if (!(bs > 0)) return 0;
        if (product.category === PROMO.category && isPromoDay(date) && PROMO.priceBs < bs) return PROMO.priceBs;
        return bs;
    }

    /** Busca la bebida del combo por nombre, sin importar mayúsculas ni tildes. */
    function norm(s) {
        return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
    }
    function findDrink(combo, products) {
        return (products || []).find(p => norm(p.name) === norm(combo.drink)) || null;
    }

    /** Precio del combo en Bs hoy: pasteles al precio fijo del día + bebida. */
    function comboBsToday(combo, pastelProduct, date) {
        const pastelBs = fixedBsPrice(pastelProduct, date) || 0;
        return pastelBs * combo.pasteles + combo.drinkBs;
    }

    /** Precio en Bs para el personal: costo + IVA, o 0 si el producto no aplica o no tiene costo. */
    function staffBsPrice(product) {
        const cost = parseFloat(product && product.cost);
        if (!(cost > 0) || product.category !== STAFF.category) return 0;
        return Math.round(cost * (1 + STAFF.iva) * 100) / 100;
    }

    /** ¿Esta venta (por su nombre) es consumo del personal? */
    function isStaffSale(sale) {
        const name = typeof sale === 'string' ? sale : (sale && sale.name);
        return String(name || '').includes(` · ${STAFF.label}`);
    }

    root.Combos = { PROMO, COMBOS, STAFF, caracasWeekday, isPromoDay, fixedBsPrice, findDrink, comboBsToday, staffBsPrice, isStaffSale };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.Combos;
})(typeof window !== 'undefined' ? window : globalThis);
