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

if (typeof window !== 'undefined') {
    window.escapeHtml = escapeHtml;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { escapeHtml };
}
