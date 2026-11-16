/**
 * Casa Lucenzo - caché de formateadores de números y fechas (solo velocidad).
 *
 * Por qué existe: el POS formatea montos y horas con
 *   (123.4).toLocaleString('es-VE', { minimumFractionDigits: 2, ... })
 *   fecha.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
 * en ~100 lugares, y cada llamada con locale/opciones obliga al navegador a
 * construir un Intl.NumberFormat / Intl.DateTimeFormat nuevo, lo cual es lento
 * (sobre todo en teléfonos Android viejos). Medido 2026-11-16 con datos como los
 * reales y CPU 4x más lenta: redibujar todas las pantallas bajó de ~200 ms a
 * ~105 ms solo con esto.
 *
 * Qué hace: reemplaza Number.prototype.toLocaleString y Date.prototype.
 * toLocale{,Date,Time}String por versiones que REUSAN un formateador por cada
 * combinación (locale, opciones). El texto que devuelven es exactamente el mismo:
 * la especificación (ECMA-402) define esos métodos como "crear el formateador
 * con esas opciones y formatear", y para las fechas se aplican los mismos
 * valores por defecto que aplica el navegador (ToDateTimeOptions). Cualquier caso
 * raro (opciones que no son un objeto plano, fecha inválida, error) cae al
 * método original del navegador, así que nunca cambia un resultado.
 *
 * No toca precios, cálculos ni datos: solo cómo se escribe un número/fecha que
 * ya estaba calculado. tests/intl-cache.test.js compara salidas contra el
 * navegador/Node original.
 *
 * Se carga antes que cualquier otro script del POS (sistema/index.html, sw.js).
 */
(function () {
    'use strict';
    if (typeof Intl === 'undefined' || !Intl.NumberFormat || !Intl.DateTimeFormat) return;
    var cache = new Map();
    var MAX = 200;
    function keyOf(kind, locales, options) {
        try { return kind + '|' + JSON.stringify(locales === undefined ? null : locales) + '|' + JSON.stringify(options === undefined ? null : options); }
        catch (e) { return null; }
    }
    function plain(o) {
        if (o === undefined) return true;
        if (o === null || typeof o !== 'object' || Array.isArray(o)) return false;
        var proto = Object.getPrototypeOf(o);
        if (proto !== Object.prototype && proto !== null) return false;
        for (var k in o) { var v = o[k]; var t = typeof v; if (!(t === 'string' || t === 'number' || t === 'boolean' || v === undefined)) return false; }
        return true;
    }
    function plainLocales(l) {
        return l === undefined || typeof l === 'string' || (Array.isArray(l) && l.every(function (x) { return typeof x === 'string'; }));
    }
    var DATE_KEYS = ['weekday', 'year', 'month', 'day'];
    var TIME_KEYS = ['dayPeriod', 'hour', 'minute', 'second', 'fractionalSecondDigits'];
    function has(o, keys) { if (!o) return false; for (var i = 0; i < keys.length; i++) if (o[keys[i]] !== undefined) return true; return false; }
    // ECMA-402 ToDateTimeOptions(options, required, defaults)
    function withDefaults(options, required, defaults) {
        var o = {}; var k;
        if (options) for (k in options) o[k] = options[k];
        var need = true;
        if ((required === 'date' || required === 'any') && has(o, DATE_KEYS)) need = false;
        if ((required === 'time' || required === 'any') && has(o, TIME_KEYS)) need = false;
        if (o.dateStyle !== undefined || o.timeStyle !== undefined) need = false;
        if (need && (defaults === 'date' || defaults === 'all')) { o.year = 'numeric'; o.month = 'numeric'; o.day = 'numeric'; }
        if (need && (defaults === 'time' || defaults === 'all')) { o.hour = 'numeric'; o.minute = 'numeric'; o.second = 'numeric'; }
        return o;
    }
    function get(kind, locales, options, make) {
        var key = keyOf(kind, locales, options);
        if (key === null) return null;
        var f = cache.get(key);
        if (!f) { f = make(); if (cache.size >= MAX) cache.clear(); cache.set(key, f); }
        return f;
    }
    var nativeNum = Number.prototype.toLocaleString;
    Number.prototype.toLocaleString = function (locales, options) {
        if (typeof this !== 'number' && !(this instanceof Number)) return nativeNum.apply(this, arguments);
        if (!plainLocales(locales) || !plain(options)) return nativeNum.apply(this, arguments);
        var f;
        try { f = get('n', locales, options, function () { return new Intl.NumberFormat(locales, options); }); }
        catch (e) { return nativeNum.apply(this, arguments); }
        return f ? f.format(Number(this)) : nativeNum.apply(this, arguments);
    };
    function patchDate(name, required, defaults) {
        var nativeFn = Date.prototype[name];
        Date.prototype[name] = function (locales, options) {
            if (!(this instanceof Date) || !plainLocales(locales) || !plain(options)) return nativeFn.apply(this, arguments);
            var t = this.getTime();
            if (t !== t) return nativeFn.apply(this, arguments); // Invalid Date -> same text/behaviour as native
            if (required === 'date' && options && options.timeStyle !== undefined) return nativeFn.apply(this, arguments);
            if (required === 'time' && options && options.dateStyle !== undefined) return nativeFn.apply(this, arguments);
            var f;
            try { f = get(name, locales, options, function () { return new Intl.DateTimeFormat(locales, withDefaults(options, required, defaults)); }); }
            catch (e) { return nativeFn.apply(this, arguments); }
            return f ? f.format(this) : nativeFn.apply(this, arguments);
        };
    }
    patchDate('toLocaleString', 'any', 'all');
    patchDate('toLocaleDateString', 'date', 'date');
    patchDate('toLocaleTimeString', 'time', 'time');
})();
