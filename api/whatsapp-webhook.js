const crypto = require('crypto');
const { SupabaseRest, getAuthorizationLevel, handleIncomingMessage, sendWhatsAppMessage } = require('../lib/bot-shared');

// Read raw body buffer from request
function getRawBody(req) {
    return new Promise((resolve, reject) => {
        if (req.rawBody) return resolve(req.rawBody);
        if (Buffer.isBuffer(req.body)) return resolve(req.body);
        if (typeof req.body === 'string') return resolve(Buffer.from(req.body, 'utf8'));
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', (err) => reject(err));
    });
}

// Verify Meta HMAC-SHA256 signature
function verifyMetaSignature(rawBodyBuffer, signatureHeader, appSecret) {
    if (!signatureHeader || !appSecret) return false;
    try {
        const hmac = crypto.createHmac('sha256', appSecret).update(rawBodyBuffer).digest('hex');
        const expected = `sha256=${hmac}`;
        const expectedBuffer = Buffer.from(expected);
        const signatureBuffer = Buffer.from(signatureHeader);
        if (expectedBuffer.length !== signatureBuffer.length) {
            return false;
        }
        return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
    } catch (e) {
        return false;
    }
}

/**
 * Main Vercel Serverless Function Endpoint: /api/whatsapp-webhook
 */
// Manual kill switch -- paused 2026-08-14 at the owner's request while
// investigating an unrelated data-integrity incident (duplicate sales rows).
// Not a fix for that incident -- this bot never wrote to `sales` -- just
// honoring "turn it off for now". Flip back to false to let
// WHATSAPP_BOT_ENABLED govern it alone again.
const WHATSAPP_BOT_MANUALLY_PAUSED = true;

const handler = async (req, res) => {
    // ----------------------------------------------------
    // 0. Safety Check: Bot Disabled by Default (HTTP 503)
    // ----------------------------------------------------
    if (WHATSAPP_BOT_MANUALLY_PAUSED || process.env.WHATSAPP_BOT_ENABLED !== 'true') {
        return res.status(503).json({ error: 'WhatsApp Bot is currently disabled.' });
    }

    // ----------------------------------------------------
    // 1. GET Request: Meta Webhook Handshake Verification
    // ----------------------------------------------------
    if (req.method === 'GET') {
        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];

        const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN;
        if (!expectedToken) {
            console.error('❌ Missing required environment variable: WHATSAPP_VERIFY_TOKEN');
            return res.status(500).json({ error: 'Server misconfiguration: WHATSAPP_VERIFY_TOKEN missing' });
        }

        if (mode === 'subscribe' && token === expectedToken) {
            console.log('✅ WhatsApp Webhook Verified Successfully!');
            return res.status(200).send(challenge);
        } else {
            console.warn('❌ WhatsApp Webhook Verification Failed: Invalid Token');
            return res.status(403).json({ error: 'Verification failed' });
        }
    }

    // ----------------------------------------------------
    // 2. POST Request: Incoming WhatsApp Message Event
    // ----------------------------------------------------
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const rawBodyBuffer = await getRawBody(req);
        const signatureHeader = req.headers['x-hub-signature-256'];
        const appSecret = process.env.WHATSAPP_APP_SECRET;

        if (!appSecret) {
            console.error('❌ Missing required environment variable: WHATSAPP_APP_SECRET');
            return res.status(500).json({ error: 'Server misconfiguration: WHATSAPP_APP_SECRET missing' });
        }

        // Verify Meta HMAC-SHA256 signature
        if (!verifyMetaSignature(rawBodyBuffer, signatureHeader, appSecret)) {
            console.warn('❌ WhatsApp Webhook Signature Verification Failed: Invalid X-Hub-Signature-256');
            return res.status(403).json({ error: 'Invalid request signature' });
        }

        const rawBodyStr = rawBodyBuffer.toString('utf8');
        const body = rawBodyStr ? JSON.parse(rawBodyStr) : {};

        // Extract incoming message payload from Meta Graph API structure
        const entry = body.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;
        const message = value?.messages?.[0];
        const contact = value?.contacts?.[0];

        if (!message) {
            return res.status(200).json({ status: 'event_ignored_no_message' });
        }

        const rawFrom = message.from;
        const senderName = contact?.profile?.name || 'Administrador';

        // ----------------------------------------------------
        // 3. Security Authorization Check (admin vs viewer vs none)
        // ----------------------------------------------------
        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
        const db = new SupabaseRest(supabaseUrl, supabaseKey);

        const authLevel = await getAuthorizationLevel(db, rawFrom);

        if (!authLevel) {
            const unauthorizedMsg = `⛔ Acceso denegado: El número (+${rawFrom}) no está autorizado para hablar con Casa Lucenzo. Contacta al administrador para registrar tu número.`;
            await sendWhatsAppMessage(rawFrom, unauthorizedMsg);
            return res.status(200).json({ status: 'unauthorized_sender', phone: rawFrom });
        }

        // ----------------------------------------------------
        // 4. Extract Message Content (Text or Audio Media)
        // ----------------------------------------------------
        let messageText = '';

        if (message.type === 'text') {
            messageText = message.text?.body || '';
        } else if (message.type === 'audio' || message.type === 'voice') {
            const audioId = message.audio?.id;
            messageText = await downloadAndTranscribeAudio(audioId);
        } else {
            const reply = `🤖 Hola ${senderName}, por el momento solo puedo procesar mensajes de texto y notas de voz para gestionar Casa Lucenzo.`;
            await sendWhatsAppMessage(rawFrom, reply);
            return res.status(200).json({ status: 'unsupported_message_type' });
        }

        if (!messageText.trim()) {
            return res.status(200).json({ status: 'empty_message' });
        }

        // ----------------------------------------------------
        // 5-7. Fetch context, ask the AI, execute any authorized action --
        //      all shared with the Telegram/Baileys channels via bot-shared.js
        // ----------------------------------------------------
        const { replyMessage, intent } = await handleIncomingMessage({
            db,
            conversationKey: rawFrom,
            senderName,
            messageText,
            authLevel,
            channelLabel: 'WhatsApp'
        });

        await sendWhatsAppMessage(rawFrom, replyMessage);
        return res.status(200).json({ status: 'success', intent, reply: replyMessage });

    } catch (err) {
        console.error('❌ Error processing WhatsApp Webhook:', err);
        return res.status(500).json({ error: err.message });
    }
};

module.exports = handler;
module.exports.config = {
    api: {
        bodyParser: false
    }
};
// Exposed so tests can tell "the bot is off because the owner paused it"
// apart from "the bot is broken". While this is true every request short-
// circuits to 503, so the handshake/signature/authorization assertions below
// it are unreachable by construction, not failing.
module.exports.WHATSAPP_BOT_MANUALLY_PAUSED = WHATSAPP_BOT_MANUALLY_PAUSED;

/**
 * Transcribe Audio Voice Notes using Gemini 2.5 Flash Multimodal
 */
async function downloadAndTranscribeAudio(audioId) {
    const waToken = process.env.WHATSAPP_API_TOKEN;
    if (!waToken || !audioId) {
        return 'Mensaje de voz recibido';
    }

    try {
        const mediaUrlResp = await fetch(`https://graph.facebook.com/v19.0/${audioId}`, {
            headers: { 'Authorization': `Bearer ${waToken}` }
        });
        const mediaData = await mediaUrlResp.json();
        if (mediaData.url) {
            const audioFileResp = await fetch(mediaData.url, {
                headers: { 'Authorization': `Bearer ${waToken}` }
            });
            const arrayBuffer = await audioFileResp.arrayBuffer();
            const base64Audio = Buffer.from(arrayBuffer).toString('base64');

            const apiKey = process.env.GEMINI_API_KEY;
            if (apiKey) {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`;
                const resp = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{
                            parts: [
                                { text: "Transcribe exactamente este audio de voz en español sobre inventario de panadería:" },
                                { inline_data: { mime_type: "audio/ogg", data: base64Audio } }
                            ]
                        }]
                    })
                });
                const data = await resp.json();
                return data.candidates?.[0]?.content?.parts?.[0]?.text || 'Mensaje de voz procesado';
            }
        }
    } catch (e) {
        console.warn('⚠️ Audio transcription error:', e.message);
    }
    return 'Mensaje de voz recibido';
}

