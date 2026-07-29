/**
 * Casa Lucenzo - Quick PIN Management Domain Module
 * Handles client-side wrappers and validation for Supabase RPC PIN functions.
 */

const PINManager = {
    /**
     * Sets a quick 4-digit PIN for the logged-in user
     * @param {string} pin 4-digit PIN string
     * @returns {Promise<{success: boolean, error: object}>}
     */
    async setQuickPin(pin) {
        const pinStr = (pin || '').trim();
        if (!pinStr || pinStr.length !== 4 || !/^\d{4}$/.test(pinStr)) {
            return { success: false, error: new Error("El PIN debe tener exactamente 4 números.") };
        }
        if (window.SupabaseManager && window.SupabaseManager.isConfigured()) {
            return await window.SupabaseManager.setQuickPin(pinStr);
        }
        return { success: false, error: new Error("Conexión con Supabase no disponible.") };
    },

    /**
     * Asigna un PIN de 4 dígitos a un usuario objetivo (Solo Admin)
     * @param {string} targetUserId Target user UUID
     * @param {string} pin 4-digit PIN string
     * @returns {Promise<{success: boolean, error: object}>}
     */
    async setUserPinByAdmin(targetUserId, pin) {
        const pinStr = (pin || '').trim();
        if (!targetUserId) {
            return { success: false, error: new Error("Usuario no especificado.") };
        }
        if (!pinStr || pinStr.length !== 4 || !/^\d{4}$/.test(pinStr)) {
            return { success: false, error: new Error("El PIN debe tener exactamente 4 números.") };
        }
        if (window.SupabaseManager && window.SupabaseManager.isConfigured()) {
            return await window.SupabaseManager.setUserPinByAdmin(targetUserId, pinStr);
        }
        return { success: false, error: new Error("Conexión con Supabase no disponible.") };
    },

    /**
     * Verifies a 4-digit PIN for a user via server-side RPC
     * @param {string} userId User UUID
     * @param {string} pin 4-digit PIN string
     * @returns {Promise<boolean>}
     */
    async verifyQuickPin(userId, pin) {
        if (!userId || !pin) return false;
        if (window.SupabaseManager && window.SupabaseManager.isConfigured()) {
            return await window.SupabaseManager.verifyQuickPin(userId, pin);
        }
        return false;
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PINManager };
}
if (typeof window !== 'undefined') {
    window.PINManager = PINManager;
}
