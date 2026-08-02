const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const { SupabaseRest, getAuthorizationLevel, handleIncomingMessage } = require('../lib/bot-shared');

async function startWhatsAppQRBridge() {
    console.log('🚀 Iniciando Servicio de Conexión por Código QR (Casa Lucenzo WhatsApp Bridge)...');

    const authFolder = path.join(__dirname, '..', 'whatsapp-session');
    if (!fs.existsSync(authFolder)) {
        fs.mkdirSync(authFolder, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(authFolder);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        auth: state,
        printQRInTerminal: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('\n=============================================================');
            console.log('📱 ¡ESCANEA ESTE CÓDIGO QR DESDE TU WHATSAPP!');
            console.log('=============================================================\n');
            qrcode.generate(qr, { small: true });

            // Generate HTML & PNG for web view
            try {
                const qrDataUrl = await QRCode.toDataURL(qr);
                const htmlContent = `
                    <!DOCTYPE html>
                    <html lang="es">
                    <head>
                        <meta charset="UTF-8">
                        <title>Vincular WhatsApp Casa Lucenzo</title>
                        <style>
                            body { font-family: system-ui, sans-serif; background: #0f172a; color: white; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                            .card { background: #1e293b; padding: 2rem; border-radius: 1rem; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
                            img { border: 10px solid white; border-radius: 0.5rem; margin: 1.5rem 0; width: 280px; height: 280px; }
                            h1 { color: #f59e0b; margin-top: 0; }
                            p { color: #94a3b8; font-size: 1.1rem; }
                        </style>
                    </head>
                    <body>
                        <div class="card">
                            <h1>🥖 Casa Lucenzo WhatsApp AI</h1>
                            <p>Abre WhatsApp en tu teléfono ➔ <b>Dispositivos vinculados</b> ➔ <b>Vincular un dispositivo</b> y escanea este código:</p>
                            <img src="${qrDataUrl}" alt="Código QR WhatsApp" />
                            <p><i>Este código se actualizará en unos segundos si expira.</i></p>
                        </div>
                        <script>setTimeout(() => location.reload(), 15000);</script>
                    </body>
                    </html>
                `;
                fs.writeFileSync(path.join(__dirname, '..', 'www', 'whatsapp-qr.html'), htmlContent);
                console.log('🔗 Vista Web del QR generada en: www/whatsapp-qr.html');
            } catch (e) {
                console.error('Error generando QR HTML:', e.message);
            }
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('⚠️ Conexión de WhatsApp cerrada. Reinstalando sesión...', shouldReconnect);
            if (shouldReconnect) {
                setTimeout(startWhatsAppQRBridge, 3000);
            }
        } else if (connection === 'open') {
            console.log('\n=============================================================');
            console.log('✅ ¡WHATSAPP DE CASA LUCENZO CONECTADO CON ÉXITO VÍA CÓDIGO QR!');
            console.log('🤖 La Inteligencia Artificial ya está escuchando y lista para responder.');
            console.log('=============================================================\n');

            // Replace QR HTML with success page
            const successHtml = `
                <!DOCTYPE html>
                <html lang="es">
                <head>
                    <meta charset="UTF-8">
                    <title>WhatsApp Conectado - Casa Lucenzo</title>
                    <style>
                        body { font-family: system-ui, sans-serif; background: #0f172a; color: white; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                        .card { background: #1e293b; padding: 2.5rem; border-radius: 1rem; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
                        .icon { font-size: 4rem; margin-bottom: 1rem; }
                        h1 { color: #10b981; margin: 0; }
                        p { color: #cbd5e1; font-size: 1.2rem; }
                    </style>
                </head>
                <body>
                    <div class="card">
                        <div class="icon">✅</div>
                        <h1>¡WhatsApp Conectado Exitosamente!</h1>
                        <p>El Bot Inteligente de Casa Lucenzo está activo y sincronizado con tu teléfono.</p>
                    </div>
                </body>
                </html>
            `;
            fs.writeFileSync(path.join(__dirname, '..', 'www', 'whatsapp-qr.html'), successHtml);
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg || msg.key.fromMe) return; // Ignore self messages

            const remoteJid = msg.key.remoteJid;
            const senderName = msg.pushName || 'Administrador';
            const messageText = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';

            if (!messageText.trim()) return;

            console.log(`📩 Mensaje recibido de ${senderName} (${remoteJid}): "${messageText}"`);

            const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
            const db = new SupabaseRest(supabaseUrl, supabaseKey);

            // Security: only whitelisted phones may talk to the bot at all, and only
            // 'admin' can drive stock/BCV changes. The Baileys bridge has no signature
            // verification like the official Meta webhook, so this check is the only
            // thing standing between a random WhatsApp contact and your inventory.
            const rawFrom = String(remoteJid || '').split('@')[0];
            const authLevel = await getAuthorizationLevel(db, rawFrom);
            if (!authLevel) {
                console.warn(`⛔ Mensaje ignorado de número no autorizado: ${rawFrom}`);
                await sock.sendMessage(remoteJid, { text: `⛔ Acceso denegado: este número no está autorizado para hablar con Casa Lucenzo.` });
                return;
            }

            const { replyMessage } = await handleIncomingMessage({
                db,
                conversationKey: rawFrom,
                senderName,
                messageText,
                authLevel,
                channelLabel: 'WhatsApp QR'
            });

            // Send Outgoing WhatsApp Response
            console.log(`📤 Enviando respuesta a ${senderName}...`);
            await sock.sendMessage(remoteJid, { text: replyMessage });

        } catch (err) {
            console.error('❌ Error procesando mensaje de WhatsApp QR:', err.message);
        }
    });
}

if (require.main === module) {
    startWhatsAppQRBridge();
}

module.exports = { startWhatsAppQRBridge };
