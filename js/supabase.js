// Supabase Integration & Offline Queue Sync Manager

let client = null;
let activeSubscription = null;

/**
 * Check if Supabase URL and Key are set up
 */
function isConfigured() {
    const prefs = window.StorageManager ? window.StorageManager.loadPreferences() : {};
    return !!(prefs.supabaseUrl && prefs.supabaseKey);
}

/**
 * Initialize the Supabase client using stored credentials
 */
function init() {
    if (!isConfigured()) {
        client = null;
        return false;
    }
    
    const prefs = window.StorageManager.loadPreferences();
    if (window.supabase) {
        try {
            client = window.supabase.createClient(prefs.supabaseUrl, prefs.supabaseKey);
            console.log("Supabase Client initialized successfully.");
            
            // Trigger offline queue synchronization on startup and when coming online
            window.addEventListener('online', syncOfflineQueue);
            syncOfflineQueue();
            return true;
        } catch (e) {
            console.error("Failed to initialize Supabase client", e);
            client = null;
            return false;
        }
    } else {
        console.warn("Supabase SDK is not loaded from CDN.");
        client = null;
        return false;
    }
}

// ================= OFFLINE QUEUE UTILITIES =================

/**
 * Pushes a database operation to the offline queue
 * @param {string} table Database table name
 * @param {string} action 'insert' | 'upsert' | 'delete'
 * @param {Object} data Record payload
 * @param {string} key Primary key name (only for delete)
 * @param {string} keyValue Primary key value (only for delete)
 */
function enqueueOfflineOp(table, action, data = null, key = null, keyValue = null) {
    const queue = JSON.parse(localStorage.getItem('casa_lucenzo_offline_queue') || '[]');
    queue.push({ table, action, data, key, keyValue, timestamp: Date.now() });
    localStorage.setItem('casa_lucenzo_offline_queue', JSON.stringify(queue));
    console.log(`Enqueued offline action for table: ${table} (${action})`);
}

/**
 * Process the local offline queue and push pending items to Supabase
 */
async function syncOfflineQueue() {
    if (!client || !navigator.onLine) return;

    const queue = JSON.parse(localStorage.getItem('casa_lucenzo_offline_queue') || '[]');
    if (queue.length === 0) return;

    console.log(`Syncing ${queue.length} offline operations to Supabase...`);
    const remaining = [];

    for (const op of queue) {
        try {
            let error = null;
            if (op.action === 'upsert' || op.action === 'insert') {
                const res = await client.from(op.table).upsert(op.data);
                error = res.error;
            } else if (op.action === 'delete') {
                const res = await client.from(op.table).delete().eq(op.key, op.keyValue);
                error = res.error;
            }
            
            if (error) {
                console.warn(`Error syncing offline action for ${op.table}:`, error.message);
                remaining.push(op); // Retry later
            }
        } catch (e) {
            console.error(`Network error syncing offline action for ${op.table}:`, e);
            remaining.push(op); // Retry later
        }
    }

    localStorage.setItem('casa_lucenzo_offline_queue', JSON.stringify(remaining));
    if (remaining.length === 0) {
        console.log("All offline operations synced successfully to Supabase.");
    }
}

// ================= DATA FETCHERS =================

async function fetchProducts() {
    if (!client) return null;
    try {
        const { data, error } = await client.from('products').select('*').order('name');
        if (error) throw error;
        return data;
    } catch (e) {
        console.error("Error fetching products from Supabase:", e);
        return null;
    }
}

async function fetchSales() {
    if (!client) return null;
    try {
        // Only load sales from today for POS dashboard (timezone-safe)
        const todayStr = new Date();
        todayStr.setHours(0, 0, 0, 0);
        const { data, error } = await client.from('sales').select('*').gte('timestamp', todayStr.toISOString());
        if (error) throw error;
        return data.map(s => ({ ...s, productId: s.product_id }));
    } catch (e) {
        console.error("Error fetching sales from Supabase:", e);
        return null;
    }
}

async function fetchExpenses() {
    if (!client) return null;
    try {
        const todayStr = new Date();
        todayStr.setHours(0, 0, 0, 0);
        const { data, error } = await client.from('expenses').select('*').gte('timestamp', todayStr.toISOString());
        if (error) throw error;
        return data;
    } catch (e) {
        console.error("Error fetching expenses from Supabase:", e);
        return null;
    }
}

async function fetchDebts() {
    if (!client) return null;
    try {
        const { data, error } = await client.from('debts').select('*').order('timestamp', { ascending: false });
        if (error) throw error;
        return data.map(d => ({ ...d, clientName: d.client_name }));
    } catch (e) {
        console.error("Error fetching debts from Supabase:", e);
        return null;
    }
}

async function fetchReplenishments() {
    if (!client) return null;
    try {
        const { data, error } = await client.from('replenishments').select('*');
        if (error) throw error;
        return data.map(r => ({ ...r, productId: r.product_id }));
    } catch (e) {
        console.error("Error fetching replenishments from Supabase:", e);
        return null;
    }
}

// ================= DATA MUTATORS =================

async function upsertProduct(product) {
    if (!client) return;
    try {
        const payload = {
            id: product.id,
            name: product.name,
            stock: product.stock,
            min: product.min,
            max: product.max,
            unit: product.unit,
            price: product.price,
            category: product.category,
            updated_at: new Date().toISOString()
        };
        
        if (!navigator.onLine) {
            enqueueOfflineOp('products', 'upsert', payload);
            return;
        }

        const { error } = await client.from('products').upsert(payload);
        if (error) throw error;
    } catch (e) {
        console.error("Supabase upsertProduct failed. Enqueuing offline...", e);
        enqueueOfflineOp('products', 'upsert', product);
    }
}

async function deleteProduct(id) {
    if (!client) return;
    try {
        if (!navigator.onLine) {
            enqueueOfflineOp('products', 'delete', null, 'id', id);
            return;
        }
        const { error } = await client.from('products').delete().eq('id', id);
        if (error) throw error;
    } catch (e) {
        console.error("Supabase deleteProduct failed. Enqueuing offline...", e);
        enqueueOfflineOp('products', 'delete', null, 'id', id);
    }
}

async function insertSale(sale) {
    if (!client) return;
    try {
        const payload = {
            uuid: sale.uuid,
            product_id: sale.productId,
            name: sale.name,
            price: sale.price,
            timestamp: sale.timestamp
        };

        if (!navigator.onLine) {
            enqueueOfflineOp('sales', 'insert', payload);
            return;
        }

        const { error } = await client.from('sales').insert(payload);
        if (error) throw error;
    } catch (e) {
        console.error("Supabase insertSale failed. Enqueuing offline...", e);
        enqueueOfflineOp('sales', 'insert', sale);
    }
}

async function deleteSale(uuid) {
    if (!client) return;
    try {
        if (!navigator.onLine) {
            enqueueOfflineOp('sales', 'delete', null, 'uuid', uuid);
            return;
        }
        const { error } = await client.from('sales').delete().eq('uuid', uuid);
        if (error) throw error;
    } catch (e) {
        console.error("Supabase deleteSale failed. Enqueuing offline...", e);
        enqueueOfflineOp('sales', 'delete', null, 'uuid', uuid);
    }
}

async function insertExpense(expense) {
    if (!client) return;
    try {
        const payload = {
            uuid: expense.uuid,
            description: expense.description,
            amount: expense.amount,
            timestamp: expense.timestamp
        };

        if (!navigator.onLine) {
            enqueueOfflineOp('expenses', 'insert', payload);
            return;
        }

        const { error } = await client.from('expenses').insert(payload);
        if (error) throw error;
    } catch (e) {
        console.error("Supabase insertExpense failed. Enqueuing offline...", e);
        enqueueOfflineOp('expenses', 'insert', expense);
    }
}

async function deleteExpense(uuid) {
    if (!client) return;
    try {
        if (!navigator.onLine) {
            enqueueOfflineOp('expenses', 'delete', null, 'uuid', uuid);
            return;
        }
        const { error } = await client.from('expenses').delete().eq('uuid', uuid);
        if (error) throw error;
    } catch (e) {
        console.error("Supabase deleteExpense failed. Enqueuing offline...", e);
        enqueueOfflineOp('expenses', 'delete', null, 'uuid', uuid);
    }
}

async function upsertDebt(debt) {
    if (!client) return;
    try {
        const payload = {
            uuid: debt.uuid,
            client_name: debt.clientName,
            amount: debt.amount,
            description: debt.description,
            timestamp: debt.timestamp
        };

        if (!navigator.onLine) {
            enqueueOfflineOp('debts', 'upsert', payload);
            return;
        }

        const { error } = await client.from('debts').upsert(payload);
        if (error) throw error;
    } catch (e) {
        console.error("Supabase upsertDebt failed. Enqueuing offline...", e);
        enqueueOfflineOp('debts', 'upsert', debt);
    }
}

async function deleteDebt(uuid) {
    if (!client) return;
    try {
        if (!navigator.onLine) {
            enqueueOfflineOp('debts', 'delete', null, 'uuid', uuid);
            return;
        }
        const { error } = await client.from('debts').delete().eq('uuid', uuid);
        if (error) throw error;
    } catch (e) {
        console.error("Supabase deleteDebt failed. Enqueuing offline...", e);
        enqueueOfflineOp('debts', 'delete', null, 'uuid', uuid);
    }
}

async function upsertReplenishment(repl) {
    if (!client) return;
    try {
        const payload = {
            uuid: repl.uuid,
            product_id: repl.productId,
            name: repl.name,
            amount: repl.amount,
            unit: repl.unit,
            status: repl.status,
            timestamp: repl.timestamp
        };

        if (!navigator.onLine) {
            enqueueOfflineOp('replenishments', 'upsert', payload);
            return;
        }

        const { error } = await client.from('replenishments').upsert(payload);
        if (error) throw error;
    } catch (e) {
        console.error("Supabase upsertReplenishment failed. Enqueuing offline...", e);
        enqueueOfflineOp('replenishments', 'upsert', repl);
    }
}

async function deleteReplenishment(uuid) {
    if (!client) return;
    try {
        if (!navigator.onLine) {
            enqueueOfflineOp('replenishments', 'delete', null, 'uuid', uuid);
            return;
        }
        const { error } = await client.from('replenishments').delete().eq('uuid', uuid);
        if (error) throw error;
    } catch (e) {
        console.error("Supabase deleteReplenishment failed. Enqueuing offline...", e);
        enqueueOfflineOp('replenishments', 'delete', null, 'uuid', uuid);
    }
}

// ================= REALTIME CHANNELS LISTENERS =================

/**
 * Subscribes to real-time events on all Supabase tables
 * @param {Function} onDbChange Callback when any table updates
 */
function subscribeToChanges(onDbChange) {
    if (!client) return;
    
    if (activeSubscription) {
        activeSubscription.unsubscribe();
    }

    activeSubscription = client.channel('casa-lucenzo-realtime-sync')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => onDbChange('products'))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, () => onDbChange('sales'))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, () => onDbChange('expenses'))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'debts' }, () => onDbChange('debts'))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'replenishments' }, () => onDbChange('replenishments'))
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                console.log("Subscribed to all PostgreSQL change channels successfully.");
            }
        });
}

// Expose to window namespace
window.SupabaseManager = {
    isConfigured,
    init,
    fetchProducts,
    fetchSales,
    fetchExpenses,
    fetchDebts,
    fetchReplenishments,
    upsertProduct,
    deleteProduct,
    insertSale,
    deleteSale,
    insertExpense,
    deleteExpense,
    upsertDebt,
    deleteDebt,
    upsertReplenishment,
    deleteReplenishment,
    subscribeToChanges,
    syncOfflineQueue
};
