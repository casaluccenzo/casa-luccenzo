// Genera los íconos del APK Android (android/app/src/main/res) a partir de
// img/logo-512.png. El logo es un círculo sobre fondo blanco: se recorta en
// círculo para que el ícono no quede con esquinas blancas en el launcher.
// Uso: node scripts/android-icons.js  (solo hace falta si cambia el logo)
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'img', 'logo-512.png');
const res = path.join(root, 'android', 'app', 'src', 'main', 'res');

const DENSITIES = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };

async function circle(size) {
    const mask = Buffer.from(
        `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}"/></svg>`
    );
    return sharp(src)
        .resize(size, size)
        .composite([{ input: mask, blend: 'dest-in' }])
        .png()
        .toBuffer();
}

(async () => {
    for (const [density, size] of Object.entries(DENSITIES)) {
        const dir = path.join(res, `mipmap-${density}`);
        fs.mkdirSync(dir, { recursive: true });
        const png = await circle(size);
        fs.writeFileSync(path.join(dir, 'ic_launcher.png'), png);
        fs.writeFileSync(path.join(dir, 'ic_launcher_round.png'), png);
    }
    // Imagen del splash mientras abre Chrome.
    const splashDir = path.join(res, 'drawable-nodpi');
    fs.mkdirSync(splashDir, { recursive: true });
    fs.writeFileSync(path.join(splashDir, 'splash.png'), await circle(384));
    console.log('Íconos Android generados en', path.relative(root, res));
})();
