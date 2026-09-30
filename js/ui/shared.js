/**
 * Casa Lucenzo UI - Shared UI Utilities & Controls
 * Extracted from ui.js for modular architecture.
 *
 * sistema/index.html loads this file first, so everything it publishes on
 * `window` is available to every other js/ module.
 *
 * Note: showToast lives in js/ui.js, not here. This file used to carry a second
 * implementation that rendered into a `#toast-container` element the page never
 * had, so it silently did nothing and was shadowed by ui.js at load time.
 */

/**
 * Safely escapes HTML special characters to prevent XSS injection
 * @param {string} str Input string
 * @returns {string} Escaped HTML string
 */
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Calendar date (YYYY-MM-DD) of `d` in the device's local time zone. Use this
 * instead of `toISOString().slice(0, 10)`, which is the UTC date: in Caracas
 * (UTC-4) that flips to "tomorrow" from 20:00 on, so evening expenses landed
 * in the next day/month and report days drifted by one.
 * @param {Date} [d] Date to format (defaults to now)
 * @returns {string} e.g. "2026-09-30"
 */
function localDateStr(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

if (typeof window !== 'undefined') {
    window.escapeHtml = escapeHtml;
    window.localDateStr = localDateStr;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { escapeHtml, localDateStr };
}
