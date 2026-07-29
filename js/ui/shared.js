/**
 * Casa Lucenzo UI - Shared UI Utilities & Controls
 * Extracted from ui.js for modular architecture.
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

function showToast(message, iconClass = 'fa-solid fa-circle-check', durationMs = 3200) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.innerHTML = `<i class="${escapeHtml(iconClass)}"></i> <span>${escapeHtml(message)}</span>`;
    
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
    }, durationMs);
}

if (typeof window !== 'undefined') {
    window.escapeHtml = escapeHtml;
    window.showToast = showToast;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { escapeHtml, showToast };
}
