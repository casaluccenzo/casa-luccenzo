// Regenera img/qr-pedido.png -- el QR de mesa que enlaza a pedido.html, con el
// logo de Casa Lucenzo superpuesto. Correrlo de nuevo si cambia la URL de
// pedido, el logo, o el tamaño/colores del QR.
//
// Requiere `sharp` (devDependency, solo para esta tarea de build de assets):
//   npm install
//   node scripts/generate-qr.js

const path = require('path');
const QRCode = require('qrcode');
const sharp = require('sharp');

// El QR ya está impreso y pegado en las mesas: esta URL es lo único que el
// papel "sabe" -- el menú, los precios y el diseño de pedido.html se leen en
// vivo cada vez que alguien lo escanea, así que se pueden seguir cambiando
// libremente SIN reimprimir nada. Lo único que invalidaría el QR ya impreso
// es tocar esta URL en sí (cambiar de dominio, o mover/renombrar
// pedido.html) -- si eso pasa alguna vez, hay que reimprimir la tarjeta.
const URL_PEDIDO = 'https://casalucenzo.com/pedido.html';
const OUTPUT_PATH = path.join(__dirname, '..', 'img', 'qr-pedido.png');
const LOGO_PATH = path.join(__dirname, '..', 'img', 'logo-512.png');
const SIZE = 1000;
const LOGO_RATIO = 0.22; // fracción del ancho del QR cubierta por el logo -- segura con
                          // errorCorrectionLevel 'H' (~30% de los módulos son recuperables)

async function main() {
    const qrBuffer = await QRCode.toBuffer(URL_PEDIDO, {
        type: 'png',
        errorCorrectionLevel: 'H',
        width: SIZE,
        margin: 2,
        // light module = transparente (no '#f6f1e4' opaco): así el fondo crema
        // de la tarjeta (qr-mesa.html) se ve a través del QR sin depender de
        // que dos renders del mismo crema (CSS vs. este PNG) coincidan a ojo.
        color: { dark: '#0f2137', light: '#f6f1e400' }
    });

    const logoSize = Math.round(SIZE * LOGO_RATIO);

    const circleMask = Buffer.from(
        `<svg width="${logoSize}" height="${logoSize}"><circle cx="${logoSize / 2}" cy="${logoSize / 2}" r="${logoSize / 2}" fill="#fff"/></svg>`
    );

    const logo = await sharp(LOGO_PATH)
        .resize(logoSize, logoSize)
        .composite([{ input: circleMask, blend: 'dest-in' }])
        .png()
        .toBuffer();

    // Nada de relleno propio detrás del logo: todo lo que no es un módulo
    // oscuro del QR o el logo queda transparente, así el único crema que se
    // ve es el fondo de la tarjeta/página (CSS) por detrás -- sin esto, el
    // crema "propio" del PNG y el crema de la tarjeta podían no coincidir
    // a ojo (perfil de color / compresión distintos) y se notaba un borde.
    await sharp({
        create: { width: SIZE, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
    })
        .composite([
            { input: qrBuffer, top: 0, left: 0 },
            { input: logo, top: Math.round((SIZE - logoSize) / 2), left: Math.round((SIZE - logoSize) / 2) }
        ])
        .png()
        .toFile(OUTPUT_PATH);

    console.log(`QR regenerado en ${OUTPUT_PATH}`);
}

main().catch(e => { console.error(e); process.exit(1); });
