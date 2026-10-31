// Precios en Bs fijos: promo del pastel por día de la semana y combos.
// Lo usan la caja (sistema/index.html) y el menú web (index.html, pedido.html),
// así que no depende de nada más. La promo solo aplica a productos que ya
// tienen precio fijo en Bs (products.price_bs, que pone Gustavo a mano).
(function (root) {
    // Martes y miércoles el pastel cuesta Bs 2.000, pero SOLO dentro de un
    // combo. El pastel suelto se cobra siempre a su precio fijo (Bs 2.200).
    const PROMO = { category: 'pastelitos', days: [2, 3], priceBs: 2000, label: 'martes y miércoles' };

    // Cada combo: pasteles del sabor que elija el cliente + una bebida. El
    // pastel se cobra a su precio fijo del día y la bebida a `drinkBs`, así
    // que el combo suma `priceBs` en un día normal (en días de promo, menos).
    // `category`: de dónde salen los pasteles (por defecto 'pastelitos').
    // `pastelBs`: precio fijo de cada pastel dentro del combo; con él el combo
    // cuesta siempre `priceBs`, todos los días y sin la promo.
    // `productId`: el combo lleva siempre ese producto, sin elegir sabores
    // (un clic y va a la cuenta).
    const COMBOS = [
        { id: 'clasico', name: 'Combo Clásico', pasteles: 1, drink: 'Malta Retornable', drinkBs: 800, priceBs: 3000 },
        { id: 'mananero', name: 'Combo Mañanero', pasteles: 1, drink: 'Café negro', drinkBs: 500, priceBs: 2700 },
        { id: 'pana', name: 'Combo Pana', pasteles: 2, drink: 'Malta Retornable', drinkBs: 600, priceBs: 5000 },
        { id: 'mini', name: 'Combo Mini', pasteles: 6, category: 'minis', productId: 'pastelito_mini', unit: 'minis', pastelBs: 750, drink: 'Coca-Cola desechable 355ml', drinkBs: 900, priceBs: 5400 }
    ];

    // Consumo del personal: el pastel al costo exacto (products.cost, en Bs),
    // sin IVA ni recargo. La venta lleva " · Consumo personal" en el nombre
    // para que reportes, cierre y desglose de IVA la separen de las ventas.
    const STAFF = { category: 'pastelitos', label: 'Consumo personal' };

    // Categorías que ya no se venden (dulces desde el 27/10/2026, empanadas
    // desde el 31/10/2026): no salen en la Vitrina, la cocina, las alertas de
    // stock ni el menú web. Los productos
    // y sus ventas viejas quedan en la base, así que cierres e informes siguen
    // sumando igual. `keepInPos`: productos de esa categoría que la caja sigue
    // cobrando. Para volver a vender la categoría, sacarla de `categories`.
    const HIDDEN = { categories: ['dulces', 'empanadas'], keepInPos: ['caja_chica', 'caja_grande'] };

    // Pedido habitual de clientes fijos: un toque en la Vitrina pone sus
    // pasteles (elige los sabores del día) y su bebida en la cuenta, cada uno
    // a su precio NORMAL de venta suelta (no es combo, no cambia precios), y
    // deja el nombre y la cédula/RIF listos para cobrar.
    // `drinkId`: products.id de la bebida.
    const HABITUALES = [
        { id: 'maploca', name: 'Maploca', rif: 'J-000244995', pasteles: 3, drinkId: 'malta' }
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

    /** Precio fijo en Bs del producto suelto (products.price_bs), o 0 si no tiene. Sin promo. */
    function fixedBsPrice(product) {
        const bs = parseFloat(product && product.price_bs);
        return bs > 0 ? bs : 0;
    }

    /** Categoría de la que salen los pasteles del combo. */
    function comboCategory(combo) {
        return (combo && combo.category) || 'pastelitos';
    }

    /** Productos que pueden ir en el combo: el fijo (`productId`) o los de su categoría. */
    function comboProducts(combo, products) {
        return (products || []).filter(p => combo && combo.productId
            ? p.id === combo.productId
            : p.category === comboCategory(combo));
    }

    /** Precio en Bs del pastel dentro de un combo hoy: con la promo si toca, o 0. */
    function comboPastelBsPrice(product, date, combo) {
        if (combo && combo.pastelBs > 0) return combo.pastelBs;
        const bs = fixedBsPrice(product);
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

    /** Precio del combo en Bs hoy: pasteles al precio de combo del día + bebida. */
    function comboBsToday(combo, pastelProduct, date) {
        const pastelBs = comboPastelBsPrice(pastelProduct, date, combo) || 0;
        return pastelBs * combo.pasteles + combo.drinkBs;
    }

    /** Precio en Bs para el personal: el costo, o 0 si el producto no aplica o no tiene costo. */
    function staffBsPrice(product) {
        const cost = parseFloat(product && product.cost);
        if (!(cost > 0) || product.category !== STAFF.category) return 0;
        return Math.round(cost * 100) / 100;
    }

    /** ¿La categoría está oculta? (el menú web la oculta entera) */
    function isHiddenCategory(category) {
        return HIDDEN.categories.includes(category);
    }

    /** ¿El producto ya no se vende en la caja? */
    function isHiddenFromSale(product) {
        return !!product && isHiddenCategory(product.category) && !HIDDEN.keepInPos.includes(product.id);
    }

    /** ¿Esta venta (por su nombre) es consumo del personal? */
    function isStaffSale(sale) {
        const name = typeof sale === 'string' ? sale : (sale && sale.name);
        return String(name || '').includes(` · ${STAFF.label}`);
    }

    root.Combos = { PROMO, COMBOS, STAFF, caracasWeekday, isPromoDay, fixedBsPrice, comboCategory, comboProducts, comboPastelBsPrice, findDrink, comboBsToday, staffBsPrice, isStaffSale, HIDDEN, isHiddenCategory, isHiddenFromSale, HABITUALES };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.Combos;
})(typeof window !== 'undefined' ? window : globalThis);
