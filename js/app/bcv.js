// Tasa BCV: configuración, cabecera y consulta automática.
//
// Antes formaba parte de js/app.js. Script clásico (no módulo ES): comparte el
// ámbito global con los demás archivos de js/app/ y js/ui/, así que el orden de
// carga importa. Ese orden vive en sistema/index.html (y se repite en sw.js y
// js/app/index.js; tests/script-order.test.js comprueba que coincidan).

// ================= APP INITIALIZATION =================

/**
 * Saves BCV configuration locally and updates Supabase
 */
function saveAndSyncBcvConfig() {
    window.StorageManager.saveBcvPreferences(bcvRate, useAutoBcv);
    // Only admin/local are allowed to write app_config per RLS (DB role 'venta'
    // maps to frontend role 'local' -- see handleUserLogin's mappedRole) --
    // anonymous visitors and 'cocina' sessions would just hit a policy
    // violation on every auto-fetch, spamming the console and the offline
    // retry queue for nothing.
    if (currentRole === 'admin' || currentRole === 'local') {
        window.SupabaseManager.upsertAppConfig({ bcvRate, useAutoBcv });
    }
}

/**
 * Update the header exchange rate text, flagging it visually when the rate
 * hasn't been refreshed in over 24h (e.g. the app was left open across days
 * without a day close, so the BCV rate stopped tracking today's dollar).
 */
function updateBcvHeaderDisplay() {
    const el = document.getElementById('header-bcv-rate-input');
    if (!el) return;
    el.value = bcvRate;

    const ageHours = bcvLastFetchTime ? (Date.now() - new Date(bcvLastFetchTime).getTime()) / 3600000 : null;
    const isStale = ageHours === null || ageHours >= 24;
    el.classList.toggle('bcv-rate-stale', isStale);
    if (isStale) {
        const lastLabel = bcvLastFetchTime ? new Date(bcvLastFetchTime).toLocaleString() : 'nunca';
        el.title = `⚠️ Tasa BCV desactualizada (última actualización: ${lastLabel}). Verifica tu conexión.`;
    } else if (el.getAttribute('readonly')) {
        el.title = 'Tasa BCV del día (Solo modificable por Administrador)';
    } else {
        el.title = 'Toca para cambiar la tasa manualmente (Modo Administrador)';
    }
}

/**
 * Fetch the official BCV rate from DolarVZLA API (which updates correctly with next business day value date)
 */
// Sub-centavo drift between the two rate providers is noise, not a rate move.
// A difference at or under 1 céntimo counts as "unchanged" so fetchBcvRate can
// skip the expensive app_config write (fans out over realtime) + full
// renderAllViews() on a poll that found the same published rate. Exported for
// tests.
function bcvRateChangedEnough(prevRate, newRate) {
    if (!(newRate > 0)) return false;
    if (!(prevRate > 0)) return true;
    return Math.abs(newRate - prevRate) > 0.01;
}

async function fetchBcvRate(force = false) {
    if (!useAutoBcv && !force) return;
    try {
        console.log("Fetching official BCV exchange rate...");
        let rate1 = 0;
        let rate2 = 0;

        // Provider 1: DolarVZLA (returns official rate for next business day)
        try {
            const res1 = await fetch('https://rates.dolarvzla.com/bcv/current.json');
            if (res1.ok) {
                const data1 = await res1.json();
                if (data1 && data1.current && data1.current.usd) {
                    rate1 = parseFloat(data1.current.usd);
                }
            }
        } catch(e1) {
            console.warn("DolarVZLA fetch failed:", e1);
        }

        // Provider 2: DolarAPI Venezuela
        try {
            const res2 = await fetch('https://ve.dolarapi.com/v1/dolares/oficial');
            if (res2.ok) {
                const data2 = await res2.json();
                if (data2 && (data2.promedio || data2.monto || data2.precio)) {
                    rate2 = parseFloat(data2.promedio || data2.monto || data2.precio);
                }
            }
        } catch(e2) {
            console.warn("DolarAPI fetch failed:", e2);
        }

        // Pick the newest/highest valid official published rate
        const newRate = Math.max(rate1 || 0, rate2 || 0);

        if (newRate > 0) {
            const prevRate = bcvRate;
            const rateChanged = bcvRateChangedEnough(prevRate, newRate);

            bcvRate = newRate;
            window.bcvRate = bcvRate;
            useAutoBcv = true;

            // A successful fetch always refreshes the "last checked" clock even
            // when the published rate did not move -- otherwise the 6h-stale
            // guard on visibilitychange keeps re-firing this on every focus.
            bcvLastFetchTime = new Date().toISOString();
            window.StorageManager.saveBcvLastFetch(bcvLastFetchTime);

            // Everything below is expensive: saveAndSyncBcvConfig() writes
            // app_config (which fans out over realtime to every other device)
            // and renderAllViews() repaints all ~13 views. This used to run on
            // every poll regardless of whether the rate actually changed, which
            // is what made the POS feel slow. Only pay that cost on a real move.
            if (rateChanged) {
                saveAndSyncBcvConfig();
                console.log(`BCV Rate updated: ${prevRate} -> ${bcvRate} Bs.`);

                const bcvRateInput = document.getElementById('pref-bcv-rate');
                const autoCheckbox = document.getElementById('pref-bcv-auto');
                const headerBcvInput = document.getElementById('header-bcv-rate-input');
                if (bcvRateInput) {
                    bcvRateInput.value = bcvRate;
                    bcvRateInput.disabled = true;
                }
                if (headerBcvInput) {
                    headerBcvInput.value = bcvRate;
                }
                if (autoCheckbox) {
                    autoCheckbox.checked = true;
                }

                updateBcvHeaderDisplay();

                // Re-render UI
                renderAllViews();
            } else {
                console.log(`BCV Rate unchanged (${bcvRate} Bs) -- skipping sync + re-render.`);
            }
        }
    } catch (e) {
        console.error("Failed to fetch BCV rate, using fallback/cached value.", e);
    }
}
