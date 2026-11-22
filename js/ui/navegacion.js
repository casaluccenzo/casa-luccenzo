// Navegación entre vistas, buscador y barra de categorías.
//
// Antes formaba parte de js/ui.js. Script clásico (no módulo ES): comparte el
// ámbito global con los demás archivos de js/app/ y js/ui/, así que el orden de
// carga importa. Ese orden vive en sistema/index.html (y se repite en sw.js y
// js/app/index.js; tests/script-order.test.js comprueba que coincidan).

// UI Rendering and DOM Interactions

function parseUTCTimestamp(timestampStr) {
    if (!timestampStr) return new Date();
    let cleanStr = timestampStr;
    if (typeof cleanStr === 'string') {
        cleanStr = cleanStr.replace(' ', 'T');
        if (!cleanStr.includes('Z') && !cleanStr.includes('+') && !/-\d{2}:\d{2}$/.test(cleanStr)) {
            cleanStr += 'Z';
        }
    }
    return new Date(cleanStr);
}
window.parseUTCTimestamp = parseUTCTimestamp;

// escapeHtml (XSS-safe HTML escaping) is defined once in js/ui/shared.js, which
// sistema/index.html loads before this file and exposes as a browser global.

/**
 * Switch view tabs in the header and toggle main sections
 * @param {string} view 'local' or 'cocina' or 'fiados'
 */
function switchView(view) {
    const btnAdminDashboard = document.getElementById('btn-admin-dashboard');
    const btnLocal = document.getElementById('btn-local');
    const btnClientes = document.getElementById('btn-clientes');
    const btnResumen = document.getElementById('btn-resumen');
    const btnCocina = document.getElementById('btn-cocina');
    const btnFiados = document.getElementById('btn-fiados');
    const btnCambio = document.getElementById('btn-cambio');
    const btnPedidos = document.getElementById('btn-pedidos');

    const viewAdminDashboard = document.getElementById('view-admin-dashboard');
    const viewLocal = document.getElementById('view-local');
    const viewClientes = document.getElementById('view-clientes');
    const viewResumen = document.getElementById('view-resumen');
    const viewCocina = document.getElementById('view-cocina');
    const viewFiados = document.getElementById('view-fiados');
    const viewCambio = document.getElementById('view-cambio');
    const viewPedidos = document.getElementById('view-pedidos');

    if (btnAdminDashboard) {
        btnAdminDashboard.classList.remove('active');
        btnAdminDashboard.classList.add('inactive');
        btnAdminDashboard.setAttribute('aria-selected', 'false');
    }

    btnLocal.classList.remove('active');
    btnLocal.classList.add('inactive');
    btnLocal.setAttribute('aria-selected', 'false');

    if (btnClientes) {
        btnClientes.classList.remove('active');
        btnClientes.classList.add('inactive');
        btnClientes.setAttribute('aria-selected', 'false');
    }

    if (btnResumen) {
        btnResumen.classList.remove('active');
        btnResumen.classList.add('inactive');
        btnResumen.setAttribute('aria-selected', 'false');
    }

    btnCocina.classList.remove('active');
    btnCocina.classList.add('inactive');
    btnCocina.setAttribute('aria-selected', 'false');

    btnFiados.classList.remove('active');
    btnFiados.classList.add('inactive');
    btnFiados.setAttribute('aria-selected', 'false');

    if (btnCambio) {
        btnCambio.classList.remove('active');
        btnCambio.classList.add('inactive');
        btnCambio.setAttribute('aria-selected', 'false');
    }

    if (btnPedidos) {
        btnPedidos.classList.remove('active');
        btnPedidos.classList.add('inactive');
        btnPedidos.setAttribute('aria-selected', 'false');
    }

    if (viewAdminDashboard) viewAdminDashboard.classList.add('hidden');
    viewLocal.classList.add('hidden');
    if (viewClientes) viewClientes.classList.add('hidden');
    if (viewResumen) viewResumen.classList.add('hidden');
    viewCocina.classList.add('hidden');
    viewFiados.classList.add('hidden');
    if (viewCambio) viewCambio.classList.add('hidden');
    if (viewPedidos) viewPedidos.classList.add('hidden');

    if (view === 'admin-dashboard') {
        if (btnAdminDashboard) {
            btnAdminDashboard.classList.add('active');
            btnAdminDashboard.classList.remove('inactive');
            btnAdminDashboard.setAttribute('aria-selected', 'true');
        }
        if (viewAdminDashboard) viewAdminDashboard.classList.remove('hidden');
    } else if (view === 'local') {
        btnLocal.classList.add('active');
        btnLocal.classList.remove('inactive');
        btnLocal.setAttribute('aria-selected', 'true');
        viewLocal.classList.remove('hidden');
    } else if (view === 'clientes') {
        if (btnClientes) {
            btnClientes.classList.add('active');
            btnClientes.classList.remove('inactive');
            btnClientes.setAttribute('aria-selected', 'true');
        }
        if (viewClientes) viewClientes.classList.remove('hidden');
    } else if (view === 'resumen') {
        if (btnResumen) {
            btnResumen.classList.add('active');
            btnResumen.classList.remove('inactive');
            btnResumen.setAttribute('aria-selected', 'true');
        }
        if (viewResumen) viewResumen.classList.remove('hidden');
    } else if (view === 'cocina') {
        btnCocina.classList.add('active');
        btnCocina.classList.remove('inactive');
        btnCocina.setAttribute('aria-selected', 'true');
        viewCocina.classList.remove('hidden');
    } else if (view === 'fiados') {
        btnFiados.classList.add('active');
        btnFiados.classList.remove('inactive');
        btnFiados.setAttribute('aria-selected', 'true');
        viewFiados.classList.remove('hidden');
    } else if (view === 'cambio') {
        if (btnCambio) {
            btnCambio.classList.add('active');
            btnCambio.classList.remove('inactive');
            btnCambio.setAttribute('aria-selected', 'true');
        }
        if (viewCambio) viewCambio.classList.remove('hidden');
    } else if (view === 'pedidos') {
        if (btnPedidos) {
            btnPedidos.classList.add('active');
            btnPedidos.classList.remove('inactive');
            btnPedidos.setAttribute('aria-selected', 'true');
        }
        if (viewPedidos) viewPedidos.classList.remove('hidden');
    }

    // Teléfono: la barra de pestañas se desliza de lado; centra la pestaña
    // activa para que nunca quede escondida. Solo mueve la barra, no la página.
    const navBar = document.getElementById('switch-nav-bar');
    const activeTab = navBar && navBar.querySelector('button.active');
    if (activeTab && navBar.scrollWidth > navBar.clientWidth) {
        navBar.scrollTo({
            left: activeTab.offsetLeft - (navBar.clientWidth - activeTab.offsetWidth) / 2,
            behavior: 'smooth'
        });
    }
}

/**
 * Render search input bar
 * @param {Function} onSearchChange Callback when search query changes
 */
function renderSearchBar(onSearchChange) {
    const container = document.getElementById('search-bar-container');
    if (!container) return;

    // Do not overwrite input if already rendered to prevent focus loss
    if (container.children.length > 0) return;

    container.innerHTML = `
        <div class="search-container">
            <i class="fa-solid fa-magnifying-glass search-icon"></i>
            <input type="text" id="search-input" class="search-input" placeholder="Buscar sabor (ej: mechada)...">
        </div>
    `;

    document.getElementById('search-input').addEventListener('input', (e) => {
        onSearchChange(e.target.value);
    });
}

/** Productos que la caja sigue vendiendo: sin las categorías ocultas (Combos.HIDDEN). */
function forSale(products) {
    const C = window.Combos;
    return (products || []).filter(p => !(C && C.isHiddenFromSale(p)));
}

/**
 * Render category selector filters
 * @param {string} activeCategory Selected category ID
 * @param {Function} onCategoryChange Callback when category changes
 * @param {Array} products Current product list, used to hide categories with no products
 *   (different deployments of this same codebase carry different catalogs -- e.g. a
 *   location that doesn't sell "dulces" shouldn't show that pill at all).
 */
function renderCategoryFilterBar(activeCategory, onCategoryChange, products) {
    const container = document.getElementById('category-filter-container');
    if (!container) return;

    const allCategories = [
        { id: 'pastelitos', name: 'Pastelitos' },
        { id: 'empanadas', name: 'Empanadas' },
        { id: 'minis', name: 'Minis' },
        { id: 'bebidas', name: 'Bebidas' },
        { id: 'dulces', name: 'Dulces' }
    ];
    // Solo las categorías con algo que la caja vende: una categoría oculta
    // (Combos.HIDDEN) sigue con su pestaña si tiene productos en keepInPos
    // (Dulces: cajas y Porción de Tres Leches).
    const presentIds = new Set(forSale(products).map(p => p.category));
    const categories = [
        { id: 'todos', name: 'Todo' },
        ...allCategories.filter(cat => presentIds.has(cat.id))
    ];
    // Pestaña del personal: solo si algún pastel tiene costo cargado.
    if (window.Combos && (products || []).some(p => window.Combos.staffBsPrice(p) > 0)) {
        categories.push({ id: 'personal', name: '👥 Personal' });
    }

    container.innerHTML = '';
    categories.forEach(cat => {
        const btn = document.createElement('button');
        btn.className = `category-pill${activeCategory === cat.id ? ' active' : ''}`;
        btn.innerText = cat.name;
        btn.addEventListener('click', () => onCategoryChange(cat.id));
        container.appendChild(btn);
    });
}
