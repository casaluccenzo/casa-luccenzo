// Clientes frecuentes: al cobrar, la caja puede buscar a un cliente que ya
// compró antes (por nombre o cédula) y llenar su nombre y cédula con un toque.
// La lista sale de los datos que la caja ya guardó: las facturas con cédula
// real y las cuentas que llevan "[Nombre - V-123]". Solo lee; no guarda nada
// nuevo en la base. Sin dependencias, para poder probarlo en Node.
(function (root) {
    const CACHE_KEY = 'casa_lucenzo_clientes_frecuentes';

    /** Quita acentos y pasa a minúsculas, para buscar sin importar cómo se escribió. */
    function fold(text) {
        return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    }

    /**
     * Clave de la cédula/RIF para no repetir al mismo cliente: letra + solo dígitos
     * ("V- 20.172.306" y "V-20172306" son la misma). null si no sirve (vacía o
     * puros ceros, como el V-00000000 de Consumidor final).
     */
    function rifKey(rif) {
        const text = String(rif || '').trim().toUpperCase();
        const m = text.match(/^([VJEGP])\s*-?\s*([\d.\-\s]+)$/);
        if (!m) return null;
        const digits = m[2].replace(/\D/g, '');
        if (!digits || /^0+$/.test(digits) || digits.length < 5) return null;
        return `${m[1]}${digits}`;
    }

    /** La cédula/RIF escrita de forma pareja: "V-20172306", "J-41302282-6" se deja como J-413022826. */
    function prettyRif(rif) {
        const key = rifKey(rif);
        return key ? `${key[0]}-${key.slice(1)}` : '';
    }

    /** Nombres que no identifican a nadie (no se sugieren como nombre del cliente). */
    function isGenericName(name) {
        const n = fold(name);
        return !n || n === 'consumidor final' || n === 'cliente' || /^cliente\s*#?\s*\d*$/.test(n);
    }

    /**
     * Saca el cliente del nombre de una venta: "Pollo [Gina España - V-20172306] (Pagado - Pago Móvil)"
     * → { name: 'Gina España', rif: 'V-20172306' }. null si la venta no trae cédula.
     */
    function parseSaleClient(saleName) {
        const m = String(saleName || '').match(/\[([^\]]*?)\s+-\s+([VJEGP]\s*-\s*[\d.\-\s]+?)\s*\]/i);
        if (!m) return null;
        return { name: m[1].trim(), rif: m[2].trim() };
    }

    /**
     * Arma la lista sin repetidos. `entries`: [{ name, rif, ts }] (de facturas y ventas).
     * Una entrada por cédula, con el nombre más reciente que no sea genérico,
     * cuántas veces vino (cuentas distintas) y la última visita. Ordenada por
     * los que más vienen.
     */
    function buildDirectory(entries) {
        const byKey = new Map();
        (entries || []).forEach(e => {
            const key = rifKey(e && e.rif);
            if (!key) return;
            const ts = String(e.ts || '');
            let c = byKey.get(key);
            if (!c) { c = { key, rif: prettyRif(e.rif), name: '', nameTs: '', visits: new Set(), lastTs: '' }; byKey.set(key, c); }
            if (ts) c.visits.add(ts.slice(0, 19));
            if (ts > c.lastTs) c.lastTs = ts;
            const name = String(e.name || '').replace(/\s+/g, ' ').trim();
            if (name && !isGenericName(name) && (!c.name || ts >= c.nameTs)) { c.name = name; c.nameTs = ts; }
        });
        return [...byKey.values()]
            .filter(c => c.name)
            .map(c => ({ name: c.name, rif: c.rif, visits: Math.max(1, c.visits.size), lastTs: c.lastTs }))
            .sort((a, b) => (b.visits - a.visits) || (b.lastTs > a.lastTs ? 1 : b.lastTs < a.lastTs ? -1 : 0));
    }

    /** Busca por nombre (sin acentos, cualquier palabra) o por números de la cédula. */
    function search(directory, query, limit = 8) {
        const q = fold(query);
        const list = directory || [];
        if (!q) return list.slice(0, limit);
        const digits = q.replace(/\D/g, '');
        const words = q.split(/\s+/).filter(Boolean);
        return list.filter(c => {
            if (digits.length >= 3 && c.rif.replace(/\D/g, '').includes(digits)) return true;
            const name = fold(c.name);
            return words.every(w => name.includes(w));
        }).slice(0, limit);
    }

    /** Entradas a partir de facturas ({client_name, client_rif, sale_timestamp}) y ventas ({name, timestamp}). */
    function entriesFrom(invoices, sales) {
        const out = [];
        (invoices || []).forEach(inv => out.push({ name: inv.client_name, rif: inv.client_rif, ts: inv.sale_timestamp }));
        (sales || []).forEach(s => {
            const c = parseSaleClient(s.name);
            if (c) out.push({ name: c.name, rif: c.rif, ts: s.timestamp });
        });
        return out;
    }

    function readCache() {
        try {
            const raw = root.localStorage && root.localStorage.getItem(CACHE_KEY);
            const list = raw ? JSON.parse(raw) : null;
            return Array.isArray(list) ? list : [];
        } catch (e) { return []; }
    }

    function writeCache(list) {
        try { if (root.localStorage) root.localStorage.setItem(CACHE_KEY, JSON.stringify(list)); } catch (e) { /* sin espacio: no pasa nada */ }
    }

    /**
     * La lista para la caja: lo que diga la base (si hay conexión) más las
     * cuentas de hoy que están en memoria. Si no hay internet, la última lista
     * guardada en este equipo.
     */
    async function load(localSales) {
        let remote = null;
        const sm = root.SupabaseManager;
        if (sm && sm.isConfigured && sm.isConfigured() && sm.fetchKnownClients) {
            remote = await sm.fetchKnownClients();
        }
        const local = entriesFrom([], localSales || []);
        if (remote) {
            const list = buildDirectory([...entriesFrom(remote.invoices, remote.sales), ...local]);
            writeCache(list);
            return list;
        }
        // Sin conexión: la lista guardada, más los de hoy que no estén en ella.
        const cached = readCache().filter(c => c && rifKey(c.rif) && c.name);
        const known = new Set(cached.map(c => rifKey(c.rif)));
        const extra = buildDirectory(local).filter(c => !known.has(rifKey(c.rif)));
        return [...cached, ...extra];
    }

    root.ClientesFrecuentes = { fold, rifKey, prettyRif, isGenericName, parseSaleClient, buildDirectory, search, entriesFrom, load, CACHE_KEY };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.ClientesFrecuentes;
})(typeof window !== 'undefined' ? window : globalThis);
