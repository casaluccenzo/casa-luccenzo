const { SupabaseRest, getTelegramAuthorizationLevel, handleIncomingMessage } = require('../lib/bot-shared');

/**
 * Main Vercel Serverless Function Endpoint: /api/telegram-webhook
 */
const handler = async (req, res) => {
    // ----------------------------------------------------
    // 0. Safety Check: Bot Disabled by Default (HTTP 503)
    // ----------------------------------------------------
    if (process.env.TELEGRAM_BOT_ENABLED !== 'true') {
        return res.status(503).json({ error: 'Telegram Bot is currently disabled (TELEGRAM_BOT_ENABLED !== true)' });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // ----------------------------------------------------
    // 1. Verify the request actually came from Telegram, via the secret token
    //    Telegram sets when we called setWebhook (not a signature, but the closest
    //    Telegram's Bot API offers -- see https://core.telegram.org/bots/api#setwebhook)
    // ----------------------------------------------------
    const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!expectedSecret) {
        console.error('❌ Missing required environment variable: TELEGRAM_WEBHOOK_SECRET');
        return res.status(500).json({ error: 'Server misconfiguration: TELEGRAM_WEBHOOK_SECRET missing' });
    }
    const receivedSecret = req.headers['x-telegram-bot-api-secret-token'];
    if (receivedSecret !== expectedSecret) {
        console.warn('❌ Telegram Webhook secret token mismatch');
        return res.status(403).json({ error: 'Invalid secret token' });
    }

    try {
        const update = req.body || {};
        const message = update.message;

        if (!message || !message.text) {
            return res.status(200).json({ status: 'event_ignored_no_text_message' });
        }

        const chatId = message.chat?.id;
        const telegramUserId = message.from?.id;
        const senderName = message.from?.first_name || message.from?.username || 'Administrador';
        const messageText = message.text || '';

        if (!chatId || !telegramUserId) {
            return res.status(200).json({ status: 'event_ignored_missing_sender' });
        }

        // ----------------------------------------------------
        // 2. Security Authorization Check (admin vs viewer vs none)
        // ----------------------------------------------------
        const authLevel = getTelegramAuthorizationLevel(telegramUserId);
        if (!authLevel) {
            await sendTelegramMessage(chatId, `⛔ Acceso denegado: tu cuenta (id ${telegramUserId}) no está autorizada para hablar con Casa Lucenzo. Contacta al administrador.`);
            return res.status(200).json({ status: 'unauthorized_sender', telegramUserId });
        }

        if (!messageText.trim()) {
            return res.status(200).json({ status: 'empty_message' });
        }

        // ----------------------------------------------------
        // 3. Fetch context, ask the AI, execute any authorized action --
        //    shared with the WhatsApp/Baileys channels via bot-shared.js
        // ----------------------------------------------------
        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
        const db = new SupabaseRest(supabaseUrl, supabaseKey);

        const { replyMessage, intent } = await handleIncomingMessage({
            db,
            conversationKey: `tg:${telegramUserId}`,
            senderName,
            messageText,
            authLevel,
            channelLabel: 'Telegram'
        });

        await sendTelegramMessage(chatId, replyMessage);
        return res.status(200).json({ status: 'success', intent, reply: replyMessage });

    } catch (err) {
        console.error('❌ Error processing Telegram Webhook:', err);
        return res.status(500).json({ error: err.message });
    }
};

module.exports = handler;

/**
 * Send Outgoing Message via Telegram Bot API
 */
async function sendTelegramMessage(chatId, textBody) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;

    if (!botToken) {
        console.log(`📱 [SIMULATED TELEGRAM OUTGOING TO ${chatId}]:\n${textBody}`);
        return;
    }

    try {
        const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: textBody,
                parse_mode: 'Markdown'
            })
        });

        if (!resp.ok) {
            const errTxt = await resp.text();
            console.error('❌ Telegram sendMessage error:', errTxt);
        }
    } catch (e) {
        console.error('❌ Error sending Telegram message:', e.message);
    }
}
