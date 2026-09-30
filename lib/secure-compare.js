// Constant-time string comparison for shared secrets (CRON_SECRET, Telegram
// webhook token). A plain `!==` returns as soon as the first byte differs,
// which leaks how much of a guess was right through response timing.
// Same approach as verifyMetaSignature in api/whatsapp-webhook.js.
const crypto = require('crypto');

function safeEqual(received, expected) {
    if (typeof received !== 'string' || typeof expected !== 'string') return false;
    const a = Buffer.from(received);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

/**
 * True when the request carries `Authorization: Bearer <CRON_SECRET>`.
 * False when CRON_SECRET is unset, so a missing env var never opens the door.
 */
function hasValidCronSecret(req) {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) return false;
    return safeEqual(req.headers['authorization'] || '', `Bearer ${cronSecret}`);
}

module.exports = { safeEqual, hasValidCronSecret };
