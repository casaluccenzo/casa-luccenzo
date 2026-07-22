// Supabase Integration & Offline Queue Sync Manager

let client = null;
let activeSubscription = null;
let dbSupportsLastClose = false;
let supabaseLastCloseTime = null;

// Production Hardcoded Defaults (to prevent manual configuration on new devices)
const DEFAULT_SUPABASE_URL = "https://xttpaqokeyywjaajvjyu.supabase.co";
const DEFAULT_SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh0dHBhcW9rZXl5d2phYWp2anl1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyNDQ2NDcsImV4cCI6MjA5OTgyMDY0N30.GUREG-_krI5l3cowwuGZv1774q3AaWEjbmwrWLqhXDE";

/**
 * Check if Supabase URL and Key are set up
 */
function isConfigured() {
    const prefs = window.StorageManager ? window.StorageManager.loadPreferences() : {};
    const url = prefs.supabaseUrl || DEFAULT_SUPABASE_URL;
    const key = prefs.supabaseKey || DEFAULT_SUPABASE_KEY;
    return !!(url && key);
}

/**
 * Check if running in isolated test environment (Sandbox)
 */
function isTestEnvironment() {
    try {
        return window.location.port === '8080' || 
               window.location.search.includes('test=true') || 
               window.location.hash.includes('test');
    } catch(e) {
        return false;
    }
}

/**
 * Initialize the Supabase client using stored credentials or defaults
 */
function init() {
    if (isTestEnvironment()) {
        console.warn("🧪 MODO PRUEBAS (SANDBOX): Supabase deshabilitado en entorno de pruebas local para aislar producción.");
        client = null;
        return false;
    }

    if (!isConfigured()) {
        client = null;
        return false;
    }
    
    const prefs = window.StorageManager ? window.StorageManager.loadPreferences() : {};
    const url = prefs.supabaseUrl || DEFAULT_SUPABASE_URL;
    const key = prefs.supabaseKey || DEFAULT_SUPABASE_KEY;
    
    if (window.supabase) {
        try {
            client = window.supabase.createClient(url, key);
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
    if (isTestEnvironment()) {
        console.log(`🧪 Test environment: bypassing offline queue for ${table}`);
        return;
    }
    const queue = JSON.parse(localStorage.getItem('casa_lucenzo_offline_queue') || '[]');
    queue.push({ table, action, data, key, keyValue, timestamp: Date.now() });
    localStorage.setItem('casa_lucenzo_offline_queue', JSON.stringify(queue));
    console.log(`Enqueued offline action for table: ${table} (${action})`);
}

/**
 * Process the local offline queue and push pending items to Supabase in optimized batches
 */
async function syncOfflineQueue() {
    if (!client || !navigator.onLine) return;

    const queue = JSON.parse(localStorage.getItem('casa_lucenzo_offline_queue') || '[]');
    if (queue.length === 0) return;

    console.log(`Syncing ${queue.length} offline operations to Supabase in optimized batches...`);
    
    // Group operations by action and table to process them in batches
    const upsertsByTable = {};
    const deletesByTableAndKey = {};
    const nonBatchable = [];

    queue.forEach(op => {
        if (op.action === 'insert' || op.action === 'upsert') {
            if (!upsertsByTable[op.table]) {
                upsertsByTable[op.table] = [];
            }
            if (Array.isArray(op.data)) {
                upsertsByTable[op.table].push(...op.data);
            } else {
                upsertsByTable[op.table].push(op.data);
            }
        } else if (op.action === 'delete') {
            if (!deletesByTableAndKey[op.table]) {
                deletesByTableAndKey[op.table] = {};
            }
            if (!deletesByTableAndKey[op.table][op.key]) {
                deletesByTableAndKey[op.table][op.key] = [];
            }
            deletesByTableAndKey[op.table][op.key].push(op.keyValue);
        } else {
            nonBatchable.push(op);
        }
    });

    const failedOps = [];

    // 1. Process Upsert Batches
    for (const [table, records] of Object.entries(upsertsByTable)) {
        if (records.length === 0) continue;
        try {
            // Deduplicate records by unique identifier to prevent conflict key violations in the same batch
            const uniqueRecords = [];
            const seenIds = new Set();
            for (let i = records.length - 1; i >= 0; i--) {
                const rec = records[i];
                const keyVal = rec.uuid || rec.id || JSON.stringify(rec);
                if (!seenIds.has(keyVal)) {
                    seenIds.add(keyVal);
                    uniqueRecords.push(rec);
                }
            }
            uniqueRecords.reverse();

            const { error } = await client.from(table).upsert(uniqueRecords);
            if (error) {
                console.error(`Batch upsert error for table ${table}:`, error.message);
                records.forEach(r => failedOps.push({ table, action: 'upsert', data: r }));
            } else {
                console.log(`Synced batch of ${uniqueRecords.length} upserts for table: ${table}`);
            }
        } catch (e) {
            console.error(`Batch upsert network error for table ${table}:`, e);
            records.forEach(r => failedOps.push({ table, action: 'upsert', data: r }));
        }
    }

    // 2. Process Delete Batches (using .in() selection)
    for (const [table, keysObj] of Object.entries(deletesByTableAndKey)) {
        for (const [key, values] of Object.entries(keysObj)) {
            if (values.length === 0) continue;
            try {
                const uniqueValues = [...new Set(values)];
                const { error } = await client.from(table).delete().in(key, uniqueValues);
                if (error) {
                    console.error(`Batch delete error for table ${table} on ${key}:`, error.message);
                    values.forEach(val => failedOps.push({ table, action: 'delete', key, keyValue: val }));
                } else {
                    console.log(`Synced batch of ${uniqueValues.length} deletes for table: ${table}`);
                }
            } catch (e) {
                console.error(`Batch delete network error for table ${table}:`, e);
                values.forEach(val => failedOps.push({ table, action: 'delete', key, keyValue: val }));
            }
        }
    }

    // 3. Process remaining non-batchable operations
    for (const op of nonBatchable) {
        try {
            let error = null;
            if (op.action === 'update_stock') {
                const res = await client.from(op.table).update(op.data).eq(op.key, op.keyValue);
                error = res.error;
            }
            if (error) {
                console.error(`Error syncing non-batchable operation for ${op.table}:`, error.message);
                failedOps.push(op);
            }
        } catch (e) {
            console.error(`Network error for non-batchable operation on ${op.table}:`, e);
            failedOps.push(op);
        }
    }

    // Write failed items back to queue
    localStorage.setItem('casa_lucenzo_offline_queue', JSON.stringify(failedOps));
    if (failedOps.length === 0) {
        console.log("All offline operations synced successfully to Supabase.");
    } else {
        console.log(`Offline sync finished. ${failedOps.length} operations remain in queue.`);
    }
}

// ================= DATA FETCHERS =================

async function fetchProducts() {
    if (!client) return null;
    try {
        const { data, error } = await client.from('products').select('*').order('name');
        if (error) throw error;
        return data.map(p => ({
            ...p,
            initial_stock: (p.initial_stock !== null && p.initial_stock !== undefined && p.initial_stock > 0) ? p.initial_stock : p.stock
        }));
    } catch (e) {
        console.error("Error fetching products from Supabase:", e);
        return null;
    }
}

async function fetchSales() {
    if (!client) return null;
    try {
        let filterTime = supabaseLastCloseTime;
        if (!filterTime) {
            const localSaved = window.StorageManager ? window.StorageManager.loadLastCloseTime() : null;
            if (localSaved) {
                filterTime = localSaved;
            } else {
                const todayStr = new Date();
                todayStr.setHours(0, 0, 0, 0);
                filterTime = todayStr.toISOString();
            }
        }
        const { data, error } = await client.from('sales').select('*').gt('timestamp', filterTime);
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
        let filterTime = supabaseLastCloseTime;
        if (!filterTime) {
            const localSaved = window.StorageManager ? window.StorageManager.loadLastCloseTime() : null;
            if (localSaved) {
                filterTime = localSaved;
            } else {
                const todayStr = new Date();
                todayStr.setHours(0, 0, 0, 0);
                filterTime = todayStr.toISOString();
            }
        }
        const { data, error } = await client.from('expenses').select('*').gt('timestamp', filterTime);
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

async function fetchIngredients() {
    if (!client) return null;
    try {
        const { data, error } = await client.from('ingredients').select('*').order('name');
        if (error) throw error;
        return data;
    } catch (e) {
        console.error("Error fetching ingredients from Supabase:", e);
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
            initial_stock: product.initial_stock !== undefined ? product.initial_stock : product.stock,
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
        enqueueOfflineOp('products', 'upsert', payload);
    }
}

async function updateProductStock(id, stock, max, initialStock) {
    if (!client) return;
    const payload = {
        stock: stock,
        updated_at: new Date().toISOString()
    };
    if (max !== undefined) {
        payload.max = max;
    }
    if (initialStock !== undefined) {
        payload.initial_stock = initialStock;
    }
    try {
        if (!navigator.onLine) {
            enqueueOfflineOp('products', 'update_stock', payload, 'id', id);
            return;
        }

        const { error } = await client.from('products').update(payload).eq('id', id);
        if (error) throw error;
    } catch (e) {
        console.error("Supabase updateProductStock failed. Enqueuing offline...", e);
        enqueueOfflineOp('products', 'update_stock', payload, 'id', id);
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
        enqueueOfflineOp('sales', 'insert', payload);
    }
}

async function insertSales(sales) {
    if (!client) return;
    if (!Array.isArray(sales) || sales.length === 0) return;
    
    const payloads = sales.map(sale => ({
        uuid: sale.uuid,
        product_id: sale.productId,
        name: sale.name,
        price: sale.price,
        timestamp: sale.timestamp
    }));

    try {
        if (!navigator.onLine) {
            payloads.forEach(payload => enqueueOfflineOp('sales', 'insert', payload));
            return;
        }

        const { error } = await client.from('sales').insert(payloads);
        if (error) throw error;
    } catch (e) {
        console.error("Supabase insertSales batch failed. Enqueuing offline...", e);
        payloads.forEach(payload => enqueueOfflineOp('sales', 'insert', payload));
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

async function deleteSales(uuids) {
    if (!client) return;
    if (!Array.isArray(uuids) || uuids.length === 0) return;
    try {
        if (!navigator.onLine) {
            uuids.forEach(uuid => enqueueOfflineOp('sales', 'delete', null, 'uuid', uuid));
            return;
        }
        const { error } = await client.from('sales').delete().in('uuid', uuids);
        if (error) throw error;
    } catch (e) {
        console.error("Supabase deleteSales batch failed. Enqueuing offline...", e);
        uuids.forEach(uuid => enqueueOfflineOp('sales', 'delete', null, 'uuid', uuid));
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
        enqueueOfflineOp('expenses', 'insert', payload);
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

async function deleteExpenses(uuids) {
    if (!client) return;
    if (!Array.isArray(uuids) || uuids.length === 0) return;
    try {
        if (!navigator.onLine) {
            uuids.forEach(uuid => enqueueOfflineOp('expenses', 'delete', null, 'uuid', uuid));
            return;
        }
        const { error } = await client.from('expenses').delete().in('uuid', uuids);
        if (error) throw error;
    } catch (e) {
        console.error("Supabase deleteExpenses batch failed. Enqueuing offline...", e);
        uuids.forEach(uuid => enqueueOfflineOp('expenses', 'delete', null, 'uuid', uuid));
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
        enqueueOfflineOp('debts', 'upsert', payload);
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
        enqueueOfflineOp('replenishments', 'upsert', payload);
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

async function upsertIngredient(ing) {
    if (!client) return;
    try {
        const payload = {
            id: ing.id,
            name: ing.name,
            stock: ing.stock,
            unit: ing.unit,
            updated_at: new Date().toISOString()
        };

        if (!navigator.onLine) {
            enqueueOfflineOp('ingredients', 'upsert', payload);
            return;
        }

        const { error } = await client.from('ingredients').upsert(payload);
        if (error) throw error;
    } catch (e) {
        console.error("Supabase upsertIngredient failed. Enqueuing offline...", e);
        enqueueOfflineOp('ingredients', 'upsert', payload);
    }
}

async function fetchAppConfig() {
    if (!client) return null;
    try {
        const { data, error } = await client.from('app_config').select('*').eq('id', 1).maybeSingle();
        if (error) throw error;
        if (data) {
            dbSupportsLastClose = ('last_close_time' in data);
            if (dbSupportsLastClose && data.last_close_time) {
                supabaseLastCloseTime = data.last_close_time;
            }
        }
        return data;
    } catch (e) {
        console.error("Error fetching app config from Supabase:", e);
        return null;
    }
}

async function upsertAppConfig(config) {
    if (!client) return;
    try {
        const payload = {
            id: 1,
            bcv_rate: parseFloat(config.bcvRate) || 732.48,
            use_auto_bcv: !!config.useAutoBcv,
            updated_at: new Date().toISOString()
        };
        
        if (config.pinLocal !== undefined) payload.pin_local = config.pinLocal;
        if (config.pinCocina !== undefined) payload.pin_cocina = config.pinCocina;
        if (config.pinAdmin !== undefined) payload.pin_admin = config.pinAdmin;
        
        if (dbSupportsLastClose) {
            if (config.lastCloseTime !== undefined) {
                payload.last_close_time = config.lastCloseTime;
                supabaseLastCloseTime = config.lastCloseTime;
            }
        }

        if (!navigator.onLine) {
            enqueueOfflineOp('app_config', 'upsert', payload);
            return;
        }

        const { error } = await client.from('app_config').upsert(payload);
        if (error) throw error;
    } catch (e) {
        console.error("Supabase upsertAppConfig failed. Enqueuing offline...", e);
        enqueueOfflineOp('app_config', 'upsert', payload);
    }
}

async function fetchStatsData() {
    if (!client) return null;
    try {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        sevenDaysAgo.setHours(0, 0, 0, 0);

        // Fetch sales and expenses in parallel
        const [salesRes, expensesRes] = await Promise.all([
            client.from('sales').select('*').gte('timestamp', sevenDaysAgo.toISOString()),
            client.from('expenses').select('*').gte('timestamp', sevenDaysAgo.toISOString())
        ]);

        const sales = salesRes.data;
        const salesError = salesRes.error;
        const expenses = expensesRes.data;
        const expensesError = expensesRes.error;

        if (salesError) throw salesError;
        if (expensesError) throw expensesError;

        return {
            sales: sales.map(s => ({ ...s, productId: s.product_id })),
            expenses: expenses
        };
    } catch (e) {
        console.error("Error fetching stats data from Supabase:", e);
        return null;
    }
}

/**
 * Fetch sales and expenses for a specific date range (single day)
 * @param {string} dateStr Date string in YYYY-MM-DD format
 * @returns {Object|null} { sales, expenses } for that day
 */
async function fetchDayReport(dateStr) {
    if (!client) return null;
    try {
        const dayStart = new Date(dateStr + 'T00:00:00');
        const dayEnd = new Date(dateStr + 'T23:59:59.999');

        const [salesRes, expensesRes] = await Promise.all([
            client.from('sales').select('*')
                .gte('timestamp', dayStart.toISOString())
                .lte('timestamp', dayEnd.toISOString())
                .order('timestamp', { ascending: true }),
            client.from('expenses').select('*')
                .gte('timestamp', dayStart.toISOString())
                .lte('timestamp', dayEnd.toISOString())
                .order('timestamp', { ascending: true })
        ]);

        if (salesRes.error) throw salesRes.error;
        if (expensesRes.error) throw expensesRes.error;

        return {
            sales: (salesRes.data || []).map(s => ({
                ...s,
                productId: s.product_id,
                name: s.product_name || s.name || 'Producto',
                price: s.price || 0
            })),
            expenses: (expensesRes.data || []).map(e => ({
                ...e,
                amount: e.amount || 0
            }))
        };
    } catch (e) {
        console.error("Error fetching day report from Supabase:", e);
        return null;
    }
}

/**
 * Fetch list of unique days with sales activity in the last N days
 * @param {number} days Number of days to look back (default 14)
 * @returns {Array} Array of date strings with activity
 */
async function fetchReportDays(days = 14) {
    if (!client) return [];
    try {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        startDate.setHours(0, 0, 0, 0);

        const { data, error } = await client.from('sales')
            .select('timestamp')
            .gte('timestamp', startDate.toISOString())
            .order('timestamp', { ascending: false });

        if (error) throw error;

        // Extract unique dates
        const uniqueDays = new Set();
        (data || []).forEach(s => {
            const d = window.parseUTCTimestamp ? window.parseUTCTimestamp(s.timestamp) : new Date(s.timestamp);
            uniqueDays.add(d.toISOString().split('T')[0]);
        });

        return Array.from(uniqueDays).sort().reverse();
    } catch (e) {
        console.error("Error fetching report days from Supabase:", e);
        return [];
    }
}

/**
 * Fetch all active sessions
 * @returns {Array} List of session rows
 */
async function fetchActiveSessions() {
    if (!client) return [];
    try {
        const { data, error } = await client.from('active_sessions').select('*').order('last_active_at', { ascending: false });
        if (error) throw error;
        return data || [];
    } catch (e) {
        console.error("Error fetching active sessions from Supabase:", e);
        return [];
    }
}

/**
 * Register or update device active session
 * @param {string} deviceId Unique client identifier
 * @param {string} deviceName User Agent string
 * @param {string} role App role
 * @returns {boolean} Success state
 */
async function registerSession(deviceId, deviceName, role) {
    if (!client) return false;
    try {
        const payload = {
            device_id: deviceId,
            device_name: deviceName,
            role: role || 'local',
            last_active_at: new Date().toISOString(),
            is_blocked: false
        };
        const { error } = await client.from('active_sessions').upsert(payload, { onConflict: 'device_id' });
        if (error) throw error;
        return true;
    } catch (e) {
        console.error("Error registering session to Supabase:", e);
        return false;
    }
}

/**
 * Delete a session (kickout or logout)
 * @param {string} deviceId Device identifier
 */
async function deleteSession(deviceId) {
    if (!client) return;
    try {
        const { error } = await client.from('active_sessions').delete().eq('device_id', deviceId);
        if (error) throw error;
    } catch (e) {
        console.error("Error deleting session from Supabase:", e);
    }
}

/**
 * Block or unblock a session
 * @param {string} deviceId Device identifier
 * @param {boolean} isBlocked Block state
 */
async function blockSession(deviceId, isBlocked) {
    if (!client) return;
    try {
        const { error } = await client.from('active_sessions').update({ is_blocked: isBlocked }).eq('device_id', deviceId);
        if (error) throw error;
    } catch (e) {
        console.error("Error blocking session in Supabase:", e);
    }
}

/**
 * Trust or untrust a session
 * @param {string} deviceId Device identifier
 * @param {boolean} isTrusted Trust state
 */
async function trustSession(deviceId, isTrusted) {
    if (!client) return;
    try {
        const { error } = await client.from('active_sessions').update({ is_trusted: isTrusted }).eq('device_id', deviceId);
        if (error) throw error;
    } catch (e) {
        console.error("Error setting session trust in Supabase:", e);
    }
}

// ================= AUDIT & ACTIVITY LOGS =================

/**
 * Inserts a new activity log record
 * @param {string} role Profile role ('local', 'cocina', 'admin')
 * @param {string} action Action description
 * @param {string} details JSON or details string
 */
async function insertActivityLog(role, action, details) {
    // Also save locally for offline fallback
    try {
        const localLogs = JSON.parse(localStorage.getItem('casa_lucenzo_local_activity_logs') || '[]');
        localLogs.push({
            role: role || 'unknown',
            action: action || '',
            details: details || '',
            timestamp: new Date().toISOString()
        });
        // Limit to 100 logs locally
        if (localLogs.length > 100) localLogs.shift();
        localStorage.setItem('casa_lucenzo_local_activity_logs', JSON.stringify(localLogs));
    } catch(e) {
        console.error("Local log write failed", e);
    }

    if (!client) return;
    const payload = {
        role: role || 'unknown',
        action: action || '',
        details: details || '',
        timestamp: new Date().toISOString()
    };
    try {
        if (!navigator.onLine) {
            enqueueOfflineOp('activity_logs', 'insert', payload);
            return;
        }
        const { error } = await client.from('activity_logs').insert(payload);
        if (error) throw error;
    } catch (e) {
        console.error("Error inserting activity log to Supabase:", e);
        // Fallback to offline queue
        enqueueOfflineOp('activity_logs', 'insert', payload);
    }
}

/**
 * Fetches recent activity logs
 * @returns {Array} List of logs
 */
async function fetchActivityLogs() {
    if (!client) {
        try {
            const localLogs = JSON.parse(localStorage.getItem('casa_lucenzo_local_activity_logs') || '[]');
            return [...localLogs].reverse();
        } catch(e) {
            return [];
        }
    }
    try {
        const { data, error } = await client.from('activity_logs').select('*').order('timestamp', { ascending: false }).limit(50);
        if (error) throw error;
        return data || [];
    } catch (e) {
        console.error("Error fetching activity logs from Supabase:", e);
        try {
            const localLogs = JSON.parse(localStorage.getItem('casa_lucenzo_local_activity_logs') || '[]');
            return [...localLogs].reverse();
        } catch(err) {
            return [];
        }
    }
}

let reconnectTimer = null;

/**
 * Subscribes to real-time events on all Supabase tables with auto-reconnection
 * @param {Function} onDbChange Callback when any table updates
 */
function subscribeToChanges(onDbChange) {
    if (!client) return;
    
    if (activeSubscription) {
        try {
            activeSubscription.unsubscribe();
        } catch(e) {}
    }

    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }

    activeSubscription = client.channel('casa-lucenzo-realtime-sync')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, (p) => onDbChange('products', p))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, (p) => onDbChange('sales', p))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, (p) => onDbChange('expenses', p))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'debts' }, (p) => onDbChange('debts', p))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'replenishments' }, (p) => onDbChange('replenishments', p))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'ingredients' }, (p) => onDbChange('ingredients', p))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'app_config' }, (p) => onDbChange('app_config', p))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'active_sessions' }, (p) => onDbChange('active_sessions', p))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'activity_logs' }, (p) => onDbChange('activity_logs', p))
        .subscribe((status) => {
            console.log(`Realtime channel status: ${status}`);
            if (status === 'SUBSCRIBED') {
                console.log("Subscribed to all PostgreSQL change channels successfully.");
            } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                console.warn(`Realtime channel interrupted (${status}). Scheduling auto-reconnect...`);
                if (!reconnectTimer) {
                    reconnectTimer = setTimeout(() => {
                        reconnectTimer = null;
                        if (navigator.onLine && client) {
                            subscribeToChanges(onDbChange);
                            if (typeof onDbChange === 'function') {
                                onDbChange('all', null);
                            }
                        }
                    }, 3000);
                }
            }
        });
}

// Expose to window namespace
window.SupabaseManager = {
    isConfigured,
    isTestEnvironment,
    init,
    fetchProducts,
    fetchSales,
    fetchExpenses,
    fetchDebts,
    fetchReplenishments,
    fetchIngredients,
    upsertProduct,
    updateProductStock,
    deleteProduct,
    insertSale,
    insertSales,
    deleteSale,
    deleteSales,
    insertExpense,
    deleteExpense,
    deleteExpenses,
    upsertDebt,
    deleteDebt,
    upsertReplenishment,
    deleteReplenishment,
    upsertIngredient,
    fetchAppConfig,
    upsertAppConfig,
    subscribeToChanges,
    syncOfflineQueue,
    getDbSupportsTotp: () => dbSupportsTotp,
    getDbSupportsLastClose: () => dbSupportsLastClose,
    fetchStatsData,
    fetchDayReport,
    fetchReportDays,
    fetchActiveSessions,
    registerSession,
    deleteSession,
    blockSession,
    trustSession,
    insertActivityLog,
    fetchActivityLogs
};
