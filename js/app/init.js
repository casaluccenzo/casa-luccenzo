// Arranque al cargar la página (DOMContentLoaded) y funciones publicadas en window.
//
// Antes formaba parte de js/app.js. Script clásico (no módulo ES): comparte el
// ámbito global con los demás archivos de js/app/ y js/ui/, así que el orden de
// carga importa. Ese orden vive en sistema/index.html (y se repite en sw.js y
// js/app/index.js; tests/script-order.test.js comprueba que coincidan).

document.addEventListener('DOMContentLoaded', () => {
    // 1. Register PWA Service Worker (only in a browser on http/https -- NOT in
    // the Electron shell, where the frontend is already local under app:// and
    // the SW would just add a redundant cache layer).
    if ('serviceWorker' in navigator && !window.electronAPI
        && (window.location.protocol === 'http:' || window.location.protocol === 'https:')) {
        let refreshing = false;
        
        // Listen for controllerchange to trigger automated reload when new sw takes over
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (refreshing) return;
            refreshing = true;
            console.log('Service Worker controller changed, reloading.');
            if (window.UIManager && window.UIManager.showUpdateOverlay) {
                window.UIManager.showUpdateOverlay();
                window.UIManager.updateOverlayStatusSuccess();
            }
            setTimeout(() => {
                window.location.reload();
            }, 1200);
        });

        navigator.serviceWorker.register('/sw.js', { scope: '/sistema/' })
            .then(reg => {
                console.log('Service Worker Registered with scope:', reg.scope);
                
                // If there's an update already waiting to be activated, trigger it!
                if (reg.waiting) {
                    console.log('New update is waiting in background. Triggering activation.');
                    if (window.UIManager && window.UIManager.showUpdateOverlay) {
                        window.UIManager.showUpdateOverlay();
                        window.UIManager.updateOverlayStatusSuccess();
                    }
                    setTimeout(() => {
                        window.location.reload();
                    }, 1200);
                    return;
                }

                // Check for updates automatically every 30 seconds
                setInterval(() => {
                    reg.update().catch(err => console.debug('Periodic SW update check deferred', err));
                }, 30000);

                // Also check for updates when returning to the tab
                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'visible') {
                        reg.update().catch(err => console.debug('Tab focus SW update check deferred', err));
                    }
                });

                reg.onupdatefound = () => {
                    const installingWorker = reg.installing;
                    if (installingWorker) {
                        // Display full screen update overlay when installing begins
                        if (window.UIManager && window.UIManager.showUpdateOverlay) {
                            window.UIManager.showUpdateOverlay();
                        }
                        
                        installingWorker.onstatechange = () => {
                            if (installingWorker.state === 'installed') {
                                if (navigator.serviceWorker.controller) {
                                    console.log('New update installed, performing auto-reload.');
                                    if (window.UIManager && window.UIManager.updateOverlayStatusSuccess) {
                                        window.UIManager.updateOverlayStatusSuccess();
                                    }
                                    setTimeout(() => {
                                        window.location.reload();
                                    }, 1500);
                                }
                            }
                        };
                    }
                };
            })
            .catch(err => console.warn('Service Worker registration failed:', err));
    }

    // 2. Load preferences and inputs configuration
    preferences = window.StorageManager.loadPreferences();

    // One-time cleanup: devices that opened Ajustes before v284 had the legacy
    // JWT anon key pre-filled into the credentials field, so any change in that
    // panel silently persisted it -- and a saved preference outranks the key
    // injected at build time. Drop it so those devices go back to whatever the
    // deployment actually configures. Only clears these exact legacy values;
    // a deliberate override to another project is left alone.
    const LEGACY_PINNED_KEY_PREFIX = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh0dHBhcW9rZXl5d2phYWp2anl1';
    const LEGACY_PINNED_URL = 'https://xttpaqokeyywjaajvjyu.supabase.co';
    if ((preferences.supabaseKey || '').startsWith(LEGACY_PINNED_KEY_PREFIX) || preferences.supabaseUrl === LEGACY_PINNED_URL) {
        console.log('Clearing legacy pinned Supabase credentials from this device; falling back to the deployed configuration.');
        preferences.supabaseKey = '';
        preferences.supabaseUrl = '';
        window.StorageManager.savePreferences(preferences);
    }
    costInsumos = window.StorageManager.loadCostInsumos();
    
    // Load active cart if stored
    const savedCart = localStorage.getItem('casa_lucenzo_current_cart');
    if (savedCart) {
        try {
            currentCart = JSON.parse(savedCart);
        } catch (e) {
            currentCart = [];
        }
    }

    // Initialize BCV Exchange Rate
    const bcvPrefs = window.StorageManager.loadBcvPreferences();
    bcvRate = bcvPrefs.bcvRate || 732.48;
    useAutoBcv = bcvPrefs.useAutoBcv !== false;
    window.bcvRate = bcvRate;
    bcvLastFetchTime = window.StorageManager.loadBcvLastFetch() || null;
    
    const headerBcvInput = document.getElementById('header-bcv-rate-input');
    const autoBcvCheckbox = document.getElementById('pref-bcv-auto');
    const bcvRateInput = document.getElementById('pref-bcv-rate');
    
    if (headerBcvInput) {
        headerBcvInput.value = bcvRate;
        
        headerBcvInput.addEventListener('change', () => {
            const val = parseFloat(headerBcvInput.value);
            if (val > 0) {
                bcvRate = val;
                window.bcvRate = bcvRate;
                useAutoBcv = false; // Disable automatic sync since they manually set the rate
                bcvLastFetchTime = new Date().toISOString();
                window.StorageManager.saveBcvLastFetch(bcvLastFetchTime);
                saveAndSyncBcvConfig();

                // Sync Settings Modal components
                if (autoBcvCheckbox) autoBcvCheckbox.checked = false;
                if (bcvRateInput) {
                    bcvRateInput.value = bcvRate;
                    bcvRateInput.disabled = false;
                }

                updateBcvHeaderDisplay();

                // Re-render all views
                window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
                window.UIManager.renderCashRegister(salesLog, expenses);
                window.UIManager.renderSalesHistory(salesLog, handleUndoSale);
                window.UIManager.renderDebts(debts, settleDebtPayment);

                window.UIManager.showToast(`💵 Tasa cambiada a ${bcvRate.toFixed(2)} Bs.`, "fa-solid fa-dollar-sign");
            }
        });
    }

    if (autoBcvCheckbox && bcvRateInput) {
        autoBcvCheckbox.checked = useAutoBcv;
        bcvRateInput.value = bcvRate;
        bcvRateInput.disabled = useAutoBcv;
        
        autoBcvCheckbox.addEventListener('change', () => {
            useAutoBcv = autoBcvCheckbox.checked;
            bcvRateInput.disabled = useAutoBcv;
            if (useAutoBcv) {
                fetchBcvRate();
            } else {
                saveAndSyncBcvConfig();
            }
        });
        
        bcvRateInput.addEventListener('change', () => {
            const val = parseFloat(bcvRateInput.value);
            if (val > 0) {
                bcvRate = val;
                window.bcvRate = bcvRate;
                bcvLastFetchTime = new Date().toISOString();
                window.StorageManager.saveBcvLastFetch(bcvLastFetchTime);
                saveAndSyncBcvConfig();

                // Sync Header input
                updateBcvHeaderDisplay();

                // Re-render
                window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
                window.UIManager.renderCashRegister(salesLog, expenses);
                window.UIManager.renderSalesHistory(salesLog, handleUndoSale);
                window.UIManager.renderDebts(debts, settleDebtPayment);
            }
        });
    }

    updateBcvHeaderDisplay();
    if (useAutoBcv) {
        fetchBcvRate();
    }

    // The BCV rate otherwise only refreshes on app load or day close, so a
    // device left open across days (kiosk/tablet) silently keeps selling at
    // a stale dollar rate. Re-check periodically and whenever the tab
    // regains focus, same pattern as the service worker update check above.
    setInterval(() => {
        if (useAutoBcv) fetchBcvRate();
        updateBcvHeaderDisplay();
    }, 6 * 60 * 60 * 1000); // every 6h

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        const ageHours = bcvLastFetchTime ? (Date.now() - new Date(bcvLastFetchTime).getTime()) / 3600000 : Infinity;
        if (useAutoBcv && ageHours >= 6) fetchBcvRate();
        updateBcvHeaderDisplay();
    });

    document.getElementById('pref-sound').checked = preferences.sound !== false;
    document.getElementById('pref-vibrate').checked = preferences.vibration !== false;
    // Left blank unless this device has a genuine override saved. These two
    // fields used to be pre-filled with the project URL and a hardcoded legacy
    // JWT anon key, which meant simply toggling Sonido or Vibración in this
    // panel wrote both into preferences -- and getSupabaseConfig() prefers a
    // saved preference over the build-injected value. One unrelated tap and the
    // device was pinned forever to a key nobody could rotate. The placeholders
    // show what the app falls back to without persisting anything.
    const prefUrlInput = document.getElementById('pref-supabase-url');
    const prefKeyInput = document.getElementById('pref-supabase-key');
    prefUrlInput.value = preferences.supabaseUrl || '';
    prefUrlInput.placeholder = 'Por defecto: el proyecto configurado en el despliegue';
    prefKeyInput.value = preferences.supabaseKey || '';
    prefKeyInput.placeholder = 'Por defecto: la llave pública del despliegue';

    const pinLocalInput = document.getElementById('pref-pin-local');
    const pinCocinaInput = document.getElementById('pref-pin-cocina');
    const pinAdminInput = document.getElementById('pref-pin-admin');
    if (pinLocalInput) pinLocalInput.value = pinLocal;
    if (pinCocinaInput) pinCocinaInput.value = pinCocina;
    if (pinAdminInput) pinAdminInput.value = pinAdmin;

    // 3. Initialize connection status dots
    if (window.SupabaseManager.isConfigured()) {
        if (navigator.onLine) {
            window.UIManager.updateConnectionStatus('online');
        } else {
            window.UIManager.updateConnectionStatus('offline');
        }
    } else {
        window.UIManager.updateConnectionStatus('local');
    }

    // 4. Initialize Supabase if keys are provided
    const isSupabaseReady = window.SupabaseManager.init();

    if (isSupabaseReady) {
        loadAllDataFromSupabase();
        window.SupabaseManager.subscribeToChanges(handleRealtimeDbUpdate);
        
        // Register active session & heartbeat
        refreshMySession();
        setInterval(refreshMySession, 45000); // 45s heartbeat
    } else {
        loadAllDataFromLocalStorage();
    }

    // 5. User roles validation checks & Login Form event listeners
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const userInput = document.getElementById('login-username-input');
            const passInput = document.getElementById('login-password-input');
            const username = userInput ? userInput.value : '';
            const password = passInput ? passInput.value : '';
            await handleUserLogin(username, password);
        });
    }

    const btnTogglePass = document.getElementById('btn-toggle-password');
    if (btnTogglePass) {
        btnTogglePass.addEventListener('click', () => {
            const passInput = document.getElementById('login-password-input');
            if (passInput) {
                const isPass = passInput.type === 'password';
                passInput.type = isPass ? 'text' : 'password';
                btnTogglePass.innerHTML = isPass ? '<i class="fa-solid fa-eye-slash"></i>' : '<i class="fa-solid fa-eye"></i>';
            }
        });
    }

    const quickUserPills = document.querySelectorAll('.btn-quick-user-pill');
    quickUserPills.forEach(pill => {
        pill.addEventListener('click', () => {
            const targetUser = pill.getAttribute('data-user');
            const userInput = document.getElementById('login-username-input');
            const passInput = document.getElementById('login-password-input');
            if (userInput) userInput.value = targetUser;
            if (passInput) passInput.focus();
            triggerHaptic(10);
        });
    });

    const btnOpenAddUser = document.getElementById('btn-open-add-user-modal');
    if (btnOpenAddUser) {
        btnOpenAddUser.addEventListener('click', () => openUserModal());
    }

    const btnUserModalClose = document.getElementById('user-modal-close');
    if (btnUserModalClose) {
        btnUserModalClose.addEventListener('click', closeUserModal);
    }

    const userForm = document.getElementById('user-form');
    if (userForm) {
        userForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            if (!window.SupabaseManager || !window.SupabaseManager.isConfigured()) {
                window.UIManager.showToast("⚠️ Conexión con Supabase no disponible.", "fa-solid fa-wifi");
                return;
            }

            const id = document.getElementById('user-modal-id').value;
            const name = document.getElementById('user-modal-name').value.trim();
            const username = document.getElementById('user-modal-username').value.trim().toLowerCase();
            const password = document.getElementById('user-modal-password').value;
            const role = document.getElementById('user-modal-role').value;

            const submitBtn = userForm.querySelector('button[type="submit"]');

            if (id) {
                // Editing: name/role only. Username maps to the account's real
                // Supabase Auth email (username@casalucenzo.com) and can't be
                // repointed from here; password can't be changed without a
                // service-role Admin API call, which this client doesn't have.
                if (submitBtn) submitBtn.disabled = true;
                try {
                    await window.SupabaseManager.upsertProfile({ id, username, name: name || username, role, active: true });
                    window.UIManager.showToast("✅ Usuario actualizado.", "fa-solid fa-circle-check");
                    logActivity("Usuario Editado", `Editado: ${name || username} (${role})`);
                    closeUserModal();
                    loadAndRenderUsersManagement();
                } finally {
                    if (submitBtn) submitBtn.disabled = false;
                }
                return;
            }

            if (!username || !password) {
                window.UIManager.showToast("❌ Por favor completa usuario y contraseña.", "fa-solid fa-triangle-exclamation");
                return;
            }
            if (password.length < 6) {
                window.UIManager.showToast("❌ La contraseña debe tener al menos 6 caracteres.", "fa-solid fa-triangle-exclamation");
                return;
            }

            if (submitBtn) submitBtn.disabled = true;
            try {
                const { success, error } = await window.SupabaseManager.signUpNewUser({ username, name: name || username, role, password });
                if (success) {
                    window.UIManager.showToast(`✅ Usuario "${username}" creado con éxito.`, "fa-solid fa-circle-check");
                    logActivity("Usuario Creado", `Nuevo usuario: ${name || username} (${role})`);
                    closeUserModal();
                    loadAndRenderUsersManagement();
                } else {
                    const msg = (error && error.message) ? error.message : 'error desconocido';
                    window.UIManager.showToast(`❌ No se pudo crear el usuario: ${msg}`, "fa-solid fa-circle-xmark");
                }
            } finally {
                if (submitBtn) submitBtn.disabled = false;
            }
        });
    }

    const activeRole = sessionStorage.getItem('casa_lucenzo_active_role');
    if (activeRole) {
        applyUserRole(activeRole);
        // Recarga con la sesion ya abierta: sin esto PowerSync no conectaba.
        if (window.ensurePowerSyncConnected) window.ensurePowerSyncConnected('recarga');
    } else {
        lockSession();
    }

    // 6. Bind navigation buttons (Dashboard, Vitrina, Clientes, Cocina, Fiados, Cambio)
    const btnAdminDash = document.getElementById('btn-admin-dashboard');
    if (btnAdminDash) {
        btnAdminDash.addEventListener('click', () => {
            window.UIManager.switchView('admin-dashboard');
            updateAdminDashboard();
            loadAndRenderAdminStats();
            loadAndRenderActiveDevices();
        });
    }

    const btnRefreshDash = document.getElementById('btn-refresh-dashboard');
    if (btnRefreshDash) {
        btnRefreshDash.addEventListener('click', () => {
            updateAdminDashboard();
            if (window.UIManager && window.UIManager.showToast) {
                window.UIManager.showToast('Resumen del día actualizado', 'fa-solid fa-rotate');
            }
        });
    }

    document.getElementById('btn-local').addEventListener('click', () => {
        window.UIManager.switchView('local');
        window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
        window.UIManager.renderActiveCart(currentCart, handleAddToCart, handleRemoveFromCart, handleClearCart, handleCheckoutCart);
        window.UIManager.renderPendingDispatches(replenishments, confirmReceipt);
    });

    document.getElementById('btn-clientes').addEventListener('click', () => {
        window.UIManager.switchView('clientes');
        window.UIManager.renderClientesView(salesLog, handleUndoSale, handleEditSale, markTransactionAsPaid, products);
    });

    const btnResumenNav = document.getElementById('btn-resumen');
    if (btnResumenNav) {
        btnResumenNav.addEventListener('click', () => {
            window.UIManager.switchView('resumen');
            window.UIManager.renderClientesView(salesLog, handleUndoSale, handleEditSale, markTransactionAsPaid, products);
        });
    }

    document.getElementById('btn-cocina').addEventListener('click', () => {
        window.UIManager.switchView('cocina');
        window.UIManager.renderCocina(products, deliverProduct, replenishments, salesLog);
        window.UIManager.renderIngredientsPantry(ingredients, addIngredientStock);
    });

    document.getElementById('btn-fiados').addEventListener('click', () => {
        window.UIManager.switchView('fiados');
        window.UIManager.renderDebts(debts, settleDebtPayment);
    });

    document.getElementById('btn-cambio').addEventListener('click', () => {
        window.UIManager.switchView('cambio');
        window.UIManager.renderQuickConversionTable();
    });

    document.getElementById('btn-pedidos').addEventListener('click', () => {
        window.UIManager.switchView('pedidos');
        window.UIManager.renderPedidosOnline(pedidosOnline, handleConfirmPedido, handleRechazarPedido);
    });

    // 7. Bind Clientes sub-navigation buttons (Mesas vs Cuentas Activas vs Historial)
    const btnSubMesas = document.getElementById('btn-sub-mesas');
    const btnSubCuentas = document.getElementById('btn-sub-cuentas');
    const btnSubHistorial = document.getElementById('btn-sub-historial');
    const subViewMesas = document.getElementById('sub-view-mesas');
    const subViewCuentas = document.getElementById('sub-view-cuentas');
    const subViewHistorial = document.getElementById('sub-view-historial');

    if (btnSubMesas && btnSubCuentas && btnSubHistorial && subViewMesas && subViewCuentas && subViewHistorial) {
        btnSubMesas.addEventListener('click', () => {
            btnSubMesas.classList.add('active');
            btnSubMesas.classList.remove('inactive');
            btnSubMesas.setAttribute('aria-selected', 'true');
            
            btnSubCuentas.classList.remove('active');
            btnSubCuentas.classList.add('inactive');
            btnSubCuentas.setAttribute('aria-selected', 'false');
            
            btnSubHistorial.classList.remove('active');
            btnSubHistorial.classList.add('inactive');
            btnSubHistorial.setAttribute('aria-selected', 'false');

            subViewMesas.classList.remove('hidden');
            subViewCuentas.classList.add('hidden');
            subViewHistorial.classList.add('hidden');
            triggerHaptic(10);
        });

        btnSubCuentas.addEventListener('click', () => {
            btnSubCuentas.classList.add('active');
            btnSubCuentas.classList.remove('inactive');
            btnSubCuentas.setAttribute('aria-selected', 'true');
            
            btnSubMesas.classList.remove('active');
            btnSubMesas.classList.add('inactive');
            btnSubMesas.setAttribute('aria-selected', 'false');
            
            btnSubHistorial.classList.remove('active');
            btnSubHistorial.classList.add('inactive');
            btnSubHistorial.setAttribute('aria-selected', 'false');

            subViewCuentas.classList.remove('hidden');
            subViewMesas.classList.add('hidden');
            subViewHistorial.classList.add('hidden');
            triggerHaptic(10);
        });

        // Small "Actualizar" button in Cuentas Activas: repaints right away
        // with what this device already has, then reconnects the realtime
        // channel and re-reads everything (same as reopening the tab), for
        // when an account taken on another device seems slow to show up.
        const btnRefreshCuentas = document.getElementById('btn-refresh-cuentas');
        if (btnRefreshCuentas) {
            btnRefreshCuentas.addEventListener('click', async () => {
                if (btnRefreshCuentas.disabled) return;
                btnRefreshCuentas.disabled = true;
                const icon = btnRefreshCuentas.querySelector('i');
                if (icon) icon.classList.add('fa-spin');
                triggerHaptic(10);
                try {
                    window.UIManager.renderClientesView(salesLog, handleUndoSale, handleEditSale, markTransactionAsPaid, products);
                    if (window.SupabaseManager.isConfigured() && navigator.onLine) {
                        window.SupabaseManager.subscribeToChanges(handleRealtimeDbUpdate);
                        await loadAllDataFromSupabase();
                        window.UIManager.showToast("🔄 Cuentas actualizadas.", "fa-solid fa-rotate");
                    } else {
                        window.UIManager.showToast("📴 Sin conexión: se muestran las cuentas guardadas en este equipo.", "fa-solid fa-wifi");
                    }
                } catch (e) {
                    console.error("Manual Cuentas refresh failed:", e);
                    window.UIManager.showToast("⚠️ No se pudo actualizar. Probá de nuevo en unos segundos.", "fa-solid fa-triangle-exclamation");
                } finally {
                    if (icon) icon.classList.remove('fa-spin');
                    btnRefreshCuentas.disabled = false;
                }
            });
        }

        btnSubHistorial.addEventListener('click', () => {
            btnSubHistorial.classList.add('active');
            btnSubHistorial.classList.remove('inactive');
            btnSubHistorial.setAttribute('aria-selected', 'true');
            
            btnSubMesas.classList.remove('active');
            btnSubMesas.classList.add('inactive');
            btnSubMesas.setAttribute('aria-selected', 'false');
            
            btnSubCuentas.classList.remove('active');
            btnSubCuentas.classList.add('inactive');
            btnSubCuentas.setAttribute('aria-selected', 'false');

            subViewHistorial.classList.remove('hidden');
            subViewMesas.classList.add('hidden');
            subViewCuentas.classList.add('hidden');
            triggerHaptic(10);
        });
    }

    // Converter Calculator Logic
    const calcUsd = document.getElementById('calc-usd');
    const calcVes = document.getElementById('calc-ves');
    if (calcUsd && calcVes) {
        calcUsd.addEventListener('input', () => {
            const usd = parseFloat(calcUsd.value);
            if (!isNaN(usd)) {
                calcVes.value = (usd * bcvRate).toFixed(2);
            } else {
                calcVes.value = '';
            }
        });
        
        calcVes.addEventListener('input', () => {
            const ves = parseFloat(calcVes.value);
            if (!isNaN(ves)) {
                calcUsd.value = (ves / bcvRate).toFixed(2);
            } else {
                calcUsd.value = '';
            }
        });
    }

    // 7. Bind configuration modal toggles
    document.getElementById('btn-settings-toggle').addEventListener('click', () => {
        window.UIManager.switchView('admin-dashboard');
        
        const isUserAdmin = currentRole === 'admin';
        const targetTabId = isUserAdmin ? 'admin-tab-btn-products' : 'admin-tab-btn-preferences';
        const targetPanelId = isUserAdmin ? 'admin-panel-products' : 'admin-panel-preferences';

        const tabBtn = document.getElementById(targetTabId);
        const panel = document.getElementById(targetPanelId);

        if (tabBtn && panel) {
            const allTabBtns = document.querySelectorAll('.admin-tab-btn');
            const allPanels = document.querySelectorAll('.admin-panel');
            allTabBtns.forEach(b => b.classList.remove('active'));
            allPanels.forEach(p => p.classList.remove('active'));
            tabBtn.classList.add('active');
            panel.classList.add('active');
        }

        window.UIManager.renderSettingsProducts(products, editProductPrompt, deleteProduct);
    });

    const btnSettingsClose = document.getElementById('btn-settings-close');
    if (btnSettingsClose) {
        btnSettingsClose.addEventListener('click', () => {
            window.UIManager.toggleSettingsModal(false);
        });
    }

    const btnSettingsCancel = document.getElementById('btn-settings-cancel');
    if (btnSettingsCancel) {
        btnSettingsCancel.addEventListener('click', () => {
            // Reset the mobile drawer so it doesn't reopen already-expanded
            // next time the admin dashboard is entered.
            document.getElementById('admin-sidebar')?.classList.remove('open');
            document.getElementById('admin-sidebar-backdrop')?.classList.remove('open');
            document.getElementById('btn-admin-sidebar-toggle')?.setAttribute('aria-expanded', 'false');
            window.UIManager.switchView('local');
            window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
            window.UIManager.renderActiveCart(currentCart, handleAddToCart, handleRemoveFromCart, handleClearCart, handleCheckoutCart);
        });
    }

    // 8. Bind WhatsApp sharing (Kitchen report)
    document.getElementById('btn-whatsapp-share').addEventListener('click', () => {
        window.ShareManager.shareToWhatsApp(products, window.UIManager.showToast);
    });

    // 9. Bind vitrina refill all
    document.getElementById('btn-reset-all').addEventListener('click', resetToMax);

    // 10. Bind factory reset
    document.getElementById('btn-factory-reset').addEventListener('click', restoreDefaultProducts);

    // 11. Bind clear sales history
    document.getElementById('btn-clear-sales').addEventListener('click', clearAllSales);

    // 12. Bind add product form
    document.getElementById('add-product-form').addEventListener('submit', addNewProduct);

    // 13. Bind expenses form
    document.getElementById('add-expense-form').addEventListener('submit', addExpense);

    // 14. Bind debts form
    document.getElementById('add-debt-form').addEventListener('submit', addDebt);

    // 15. Bind Day Close triggers
    document.getElementById('btn-cierre-dia-open').addEventListener('click', openDayCloseModal);
    document.getElementById('btn-corte-turno-open').addEventListener('click', openShiftCutModal);
    document.getElementById('btn-cierre-dia-close').addEventListener('click', closeDayCloseModal);
    document.getElementById('btn-clean-offline-cache').addEventListener('click', handleCleanOfflineCache);
    document.getElementById('btn-cierre-dia-confirm').addEventListener('click', async (ev) => {
        const confirmBtn = ev.currentTarget;
        if (confirmBtn.disabled) return;
        confirmBtn.disabled = true;
        confirmBtn.style.opacity = '0.6';

        // Safari/iPadOS only allows window.open() when it's called synchronously
        // inside the click handler -- any await before it (closeDayAndResetLogs
        // below does several) drops the "user just clicked this" flag and the
        // tab gets silently blocked, no error, nothing to catch. Opening a blank
        // tab here, before any await, keeps it authorized; we just point it at
        // the real WhatsApp URL once the report is ready.
        const waTab = window.open('', '_blank');

        try {
            // Build the report from whatever data the modal is currently showing.
            const dateLabel = currentReportData.dateLabel || new Date().toLocaleDateString();
            const reportRate = currentReportData.rate || window.bcvRate || bcvRate;
            const shift = currentReportData.shift || null;
            let message = generateWhatsAppReport(currentReportData.sales, currentReportData.expenses, dateLabel, reportRate, products, shift);
            // El PDF se arma unos segundos después del cierre; el enlace sirve en cuanto esté.
            if (shift) message += `\n\n📄 PDF del turno: ${dayReportPdfUrl(caracasDateStr(), shift)}`;
            else if (!currentReportData.isHistory) message += `\n\n📄 PDF del día: ${dayReportPdfUrl(caracasDateStr())}`;

            // Close first, share second. Opening WhatsApp up front announced a
            // closed day before the database had agreed to it -- if the close
            // then failed, the report was already sent and the day was still open.
            if (shift) {
                // Corte de turno: NO cierra la jornada; solo comparte el resumen y su PDF.
                shareShiftReportPdf(caracasDateStr(), shift);
            } else if (!currentReportData.isHistory) {
                const closed = await closeDayAndResetLogs();
                // Sin await: el PDF se arma en el servidor y no debe demorar WhatsApp.
                if (closed) requestDayReportPdf();
            }

            const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(message)}`;
            if (waTab) {
                waTab.location.href = waUrl;
            } else {
                // Blocked even as a blank tab (e.g. popups fully disabled) -- try
                // anyway so desktop/Android, which don't need the pre-open trick,
                // still get their normal window.open() behavior.
                window.open(waUrl, '_blank');
            }
            closeDayCloseModal();
        } catch (e) {
            // Don't leave a stray blank tab hanging if something above threw.
            if (waTab) waTab.close();
            throw e;
        } finally {
            confirmBtn.disabled = false;
            confirmBtn.style.opacity = '';
        }
    });
    
    document.getElementById('btn-cierre-dia-pdf').addEventListener('click', () => {
        triggerHaptic(15);
        const dateLabel = currentReportData.dateLabel || new Date().toLocaleDateString();
        const reportRate = currentReportData.rate || window.bcvRate || bcvRate;
        window.UIManager.exportDayCloseToPDF(currentReportData.sales, currentReportData.expenses, products, dateLabel, reportRate);
    });

    // 15b. Bind Report Preview button (opens report modal without closing day)
    document.getElementById('btn-preview-report').addEventListener('click', () => {
        triggerHaptic(15);
        const todayLabel = new Date().toLocaleDateString();
        const currentRate = window.bcvRate || bcvRate;
        currentReportData = { sales: salesLog, expenses: expenses, dateLabel: todayLabel, rate: currentRate, isHistory: false };
        setDayCloseModalShift(null);
        window.UIManager.renderDayCloseModal(salesLog, expenses, products, todayLabel, currentRate);
        document.getElementById('day-close-modal').classList.remove('hidden');
    });

    // 15c. Bind Report History button and modal controls
    document.getElementById('btn-report-history').addEventListener('click', openReportHistoryModal);
    document.getElementById('btn-report-history-close').addEventListener('click', () => {
        triggerHaptic(15);
        document.getElementById('report-history-modal').classList.add('hidden');
    });
    document.getElementById('btn-report-history-done').addEventListener('click', () => {
        triggerHaptic(15);
        document.getElementById('report-history-modal').classList.add('hidden');
    });

    // 16. Bind preference toggle checkboxes and credentials
    document.getElementById('pref-sound').addEventListener('change', handlePreferencesChange);
    document.getElementById('pref-vibrate').addEventListener('change', handlePreferencesChange);
    document.getElementById('pref-supabase-url').addEventListener('change', handlePreferencesChange);
    document.getElementById('pref-supabase-key').addEventListener('change', handlePreferencesChange);

    // 17. Bind lock icon buttons
    document.getElementById('btn-lock-user').addEventListener('click', lockSession);

    // 17b. Bind logo click to reload page
    const logoContainer = document.querySelector('.logo-container');
    if (logoContainer) {
        logoContainer.style.cursor = 'pointer';
        logoContainer.title = 'Toca el logo para recargar la aplicación';
        logoContainer.addEventListener('click', () => {
            triggerHaptic(15);
            window.location.reload();
        });
    }

    // 18. Bind online/offline, visibility & focus auto-reconnect listeners
    // Returning to the tab fires visibilitychange AND focus in most browsers,
    // and both used to run the full routine: two realtime channel teardowns
    // plus two rounds of the eight-query loader, every single time the cashier
    // glanced at the phone. Collapse bursts into one run.
    let lastAutoSyncAt = 0;
    const AUTO_SYNC_MIN_GAP_MS = 3000;

    const autoSyncAndReconnect = ({ force = false } = {}) => {
        if (!window.SupabaseManager.isConfigured() || !navigator.onLine) return;

        const now = Date.now();
        if (!force && now - lastAutoSyncAt < AUTO_SYNC_MIN_GAP_MS) return;
        lastAutoSyncAt = now;

        window.UIManager.updateConnectionStatus('online');
        window.SupabaseManager.subscribeToChanges(handleRealtimeDbUpdate);
        loadAllDataFromSupabase();
    };

    // A real offline->online transition always resyncs; it is exactly the
    // moment the queued writes need to go out, so it skips the debounce.
    window.addEventListener('online', () => {
        autoSyncAndReconnect({ force: true });
        // Facturas de cuentas cobradas sin conexión.
        setTimeout(retryPendingInvoices, 3000);
    });
    setTimeout(retryPendingInvoices, 8000);
    window.addEventListener('offline', () => {
        if (window.SupabaseManager.isConfigured()) {
            window.UIManager.updateConnectionStatus('offline');
        }
    });

    // Auto-refresh data when user switches back to tab or turns screen on
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            console.log("Tab/screen reactivated. Triggering instant background sync...");
            autoSyncAndReconnect();
        }
    });
    window.addEventListener('focus', () => {
        if (document.visibilityState === 'visible') {
            autoSyncAndReconnect();
        }
    });


    // Periodic silent background re-sync as a backstop for the realtime channel.
    // Realtime (subscribeToChanges) is the primary freshness mechanism and fires
    // on every row change; autoSyncAndReconnect() also runs a full sync on every
    // tab focus / reconnect. This interval only needs to catch anything a
    // dropped socket missed, so 3 min is plenty -- 45s meant a burst of ~8 REST
    // calls + dataset re-parse every 45s on the till, for near-zero benefit.
    setInterval(() => {
        if (document.visibilityState === 'visible' && window.SupabaseManager.isConfigured() && navigator.onLine) {
            loadAllDataFromSupabase();
        }
    }, 3 * 60 * 1000);

    // Ticks the "Actualizado hace X" freshness label in Resumen
    setInterval(updateSyncFreshnessDisplay, 3000);

    // 19. Bind the sync status badge to PowerSync's real status (Task 13).
    // client.js is a deferred module script loaded before this one -- by
    // DOMContentLoaded it has already run, so window.PowerSyncManager exists.
    if (window.PowerSyncManager && window.PowerSyncManager.onStatusChange) {
        window.PowerSyncManager.onStatusChange(updateSyncStatusUI);
        const initialStatus = window.PowerSyncManager.getSyncStatus();
        if (initialStatus) updateSyncStatusUI(initialStatus);
    }

    initAdminDashboardListeners();
    initAgentListeners();
});

// Expose functions globally for UI callbacks and fallbacks
window.handleEditSale = handleEditSale;
window.handleUndoSale = handleUndoSale;
window.startExtraInvoiceAccount = startExtraInvoiceAccount;
window.autoIssueInvoice = autoIssueInvoice;
window.getCurrentRole = () => currentRole;
window.handleCartQtyChange = handleCartQtyChange;
window.updateProductStockDirect = updateProductStockDirect;

// Dynamically link currentCart to window.currentCart to avoid array reference mismatch
Object.defineProperty(window, 'currentCart', {
    get: () => currentCart,
    set: (val) => { currentCart = val; }
});
