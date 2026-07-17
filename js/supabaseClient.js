// Supabase Client Initializer with LocalStorage Fallback

let supabase = null;
let isSupabaseConfigured = false;

// 1. Try to load from js/supabaseConfig.js
try {
    const config = await import('./supabaseConfig.js');
    if (config.SUPABASE_URL && !config.SUPABASE_URL.includes('YOUR_SUPABASE') && config.SUPABASE_ANON_KEY && !config.SUPABASE_ANON_KEY.includes('YOUR_SUPABASE')) {
        const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
        supabase = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
        isSupabaseConfigured = true;
        console.log("Supabase conectado a través del archivo de configuración.");
    }
} catch (e) {
    // El archivo de configuración puede no existir (está en .gitignore)
    console.log("Archivo supabaseConfig.js no encontrado. Buscando en localStorage...");
}

// 2. Si no está configurado por archivo, buscar en localStorage
if (!isSupabaseConfigured) {
    const localUrl = localStorage.getItem('supabase_url');
    const localKey = localStorage.getItem('supabase_anon_key');
    if (localUrl && localKey) {
        try {
            const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
            supabase = createClient(localUrl, localKey);
            isSupabaseConfigured = true;
            console.log("Supabase conectado a través de credenciales de localStorage.");
        } catch (e) {
            console.error("Error al inicializar Supabase desde localStorage:", e);
        }
    }
}

export { supabase, isSupabaseConfigured };

/**
 * Guarda o borra las credenciales de Supabase en localStorage
 * @param {string} url 
 * @param {string} key 
 */
export function saveSupabaseCredentials(url, key) {
    if (url && key) {
        localStorage.setItem('supabase_url', url.trim());
        localStorage.setItem('supabase_anon_key', key.trim());
    } else {
        localStorage.removeItem('supabase_url');
        localStorage.removeItem('supabase_anon_key');
    }
}
