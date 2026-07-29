// Exchange Rate Module (BCV Rate Manager for Casa Lucenzo)

class ExchangeRateManager {
    constructor() {
        this.currentRate = 744.23;
        this.useAutoBcv = true;
        this.lastUpdated = null;
        this.loadPreferences();
    }

    loadPreferences() {
        try {
            const prefs = JSON.parse(localStorage.getItem('casa_lucenzo_bcv_config') || '{}');
            if (prefs.bcvRate && prefs.bcvRate > 0) this.currentRate = parseFloat(prefs.bcvRate);
            if (prefs.useAutoBcv !== undefined) this.useAutoBcv = prefs.useAutoBcv !== false;
            if (prefs.lastUpdated) this.lastUpdated = new Date(prefs.lastUpdated);
        } catch(e) {
            console.warn("Failed loading exchange rate preferences:", e);
        }
    }

    savePreferences() {
        try {
            const config = {
                bcvRate: this.currentRate,
                useAutoBcv: this.useAutoBcv,
                lastUpdated: this.lastUpdated ? this.lastUpdated.toISOString() : new Date().toISOString()
            };
            localStorage.setItem('casa_lucenzo_bcv_config', JSON.stringify(config));
        } catch(e) {
            console.error("Failed saving exchange rate preferences:", e);
        }
    }

    getRate() {
        return this.currentRate || 744.23;
    }

    isOutdated() {
        if (!this.lastUpdated) return false;
        const diffHours = (Date.now() - this.lastUpdated.getTime()) / (1000 * 60 * 60);
        return diffHours >= 24;
    }

    /**
     * Fetch rate with resiliency: DolarVZLA -> DolarAPI -> Cached Fallback
     */
    async fetchLiveRate(force = false) {
        if (!this.useAutoBcv && !force) return this.currentRate;

        let rate1 = 0;
        let rate2 = 0;

        // Provider 1: DolarVZLA Rates (returns official next day publication)
        try {
            const res1 = await fetch('https://rates.dolarvzla.com/bcv/current.json');
            if (res1.ok) {
                const data1 = await res1.json();
                if (data1 && data1.current && data1.current.usd) {
                    rate1 = parseFloat(data1.current.usd);
                }
            }
        } catch(e1) {
            console.warn("ExchangeRateManager: DolarVZLA provider failed:", e1);
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
            console.warn("ExchangeRateManager: DolarAPI provider failed:", e2);
        }

        const newestRate = Math.max(rate1 || 0, rate2 || 0);

        if (newestRate > 0) {
            this.currentRate = newestRate;
            this.lastUpdated = new Date();
            this.savePreferences();
            console.log(`ExchangeRateManager: Updated rate to ${this.currentRate} Bs. (${this.lastUpdated.toLocaleTimeString()})`);
            return this.currentRate;
        }

        console.warn("ExchangeRateManager: Both live APIs failed. Preserving cached rate:", this.currentRate);
        return this.currentRate;
    }
}

window.ExchangeRateManager = new ExchangeRateManager();
