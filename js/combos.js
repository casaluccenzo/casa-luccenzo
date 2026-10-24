// Precios en Bs fijos: promo del pastel por día de la semana y combos.
// Lo usan la caja (sistema/index.html) y el menú web (index.html, pedido.html),
// así que no depende de nada más. La promo solo aplica a productos que ya
// tienen precio fijo en Bs (products.price_bs, que pone Gustavo a mano).
(function (root) {
    // Promo del pastel suelto con precio fijo: Bs 2.000 los días de `days`
    // (0 = domingo). Vacío = sin promo; el pastel queda a su price_bs siempre.
    const PROMO = { category: 'pastelitos', days: [], priceBs: 2000, label: 'martes y miércoles' };

    // Los combos solo se muestran y se venden estos días (martes y miércoles).
    const COMBO_DAYS = [2, 3];
    const COMBO_DAYS_LABEL = 'martes y miércoles';

    // Cada combo: pasteles del sabor que elija el cliente + una bebida. El
    // pastel se cobra a su precio fijo del día y la bebida a `drinkBs`, así
    // que el combo suma `priceBs` en un día normal (en días de promo, menos).
    const COMBOS = [
        { id: 'clasico', name: 'Combo Clásico', pasteles: 1, drink: 'Malta Retornable', drinkBs: 800, priceBs: 3000 },
        { id: 'mananero', name: 'Combo Mañanero', pasteles: 1, drink: 'Café negro', drinkBs: 500, priceBs: 2700 },
        { id: 'pana', name: 'Combo Pana', pasteles: 2, drink: 'Malta Retornable', drinkBs: 600, priceBs: 5000 }
    ];

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

    function isComboDay(date) {
        return COMBO_DAYS.includes(caracasWeekday(date));
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

    root.Combos = { PROMO, COMBOS, COMBO_DAYS, COMBO_DAYS_LABEL, caracasWeekday, isPromoDay, isComboDay, fixedBsPrice, findDrink, comboBsToday };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.Combos;
})(typeof window !== 'undefined' ? window : globalThis);
