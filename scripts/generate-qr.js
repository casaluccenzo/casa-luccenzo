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
        color: { dark: '#0f2137', light: '#f6f1e4' }
    });

    const logoSize = Math.round(SIZE * LOGO_RATIO);
    const padSize = Math.round(logoSize * 1.18); // aro crema detrás del logo

    const circleMask = Buffer.from(
        `<svg width="${logoSize}" height="${logoSize}"><circle cx="${logoSize / 2}" cy="${logoSize / 2}" r="${logoSize / 2}" fill="#fff"/></svg>`
    );

    const logo = await sharp(LOGO_PATH)
        .resize(logoSize, logoSize)
        .composite([{ input: circleMask, blend: 'dest-in' }])
        .png()
        .toBuffer();

    const padCircleSvg = Buffer.from(
        `<svg width="${padSize}" height="${padSize}"><circle cx="${padSize / 2}" cy="${padSize / 2}" r="${padSize / 2}" fill="#f6f1e4"/></svg>`
    );

    await sharp({
        create: { width: SIZE, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
    })
        .composite([
            { input: qrBuffer, top: 0, left: 0 },
            { input: padCircleSvg, top: Math.round((SIZE - padSize) / 2), left: Math.round((SIZE - padSize) / 2) },
            { input: logo, top: Math.round((SIZE - logoSize) / 2), left: Math.round((SIZE - logoSize) / 2) }
        ])
        .png()
        .toFile(OUTPUT_PATH);

    console.log(`QR regenerado en ${OUTPUT_PATH}`);
}

main().catch(e => { console.error(e); process.exit(1); });
