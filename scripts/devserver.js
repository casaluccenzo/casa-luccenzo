/**
 * Local dev server for Casa Lucenzo.
 *
 * Serves the repo root, which is the SOURCE, not the deployed output. That
 * used to be the same thing, back when vercel.json declared a no-op build with
 * `outputDirectory: "."`. It no longer is: vercel.json now runs
 * `node scripts/build.js` and deploys `www/`, where the build substitutes
 * SUPABASE_URL / SUPABASE_ANON_KEY / SENTRY_DSN for their placeholders.
 *
 * So locally the placeholders stay unreplaced and js/supabase.js takes its
 * hardcoded fallback branch. Anything that depends on those injected values
 * has to be checked on the real domain, not here.
 *
 *   npm run dev   ->   http://localhost:4173
 *
 * Node core only, no dependencies.
 *
 * Heads up: that fallback points at the real project URL + publishable key,
 * so this talks to the production database. Read freely, write carefully.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.PORT || 4173;

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp'
};

http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    let filePath = path.join(ROOT, urlPath);

    // Never serve anything outside the project root
    if (!path.resolve(filePath).startsWith(ROOT)) {
        res.writeHead(403).end('Forbidden');
        return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html');
    }

    if (!fs.existsSync(filePath)) {
        console.log(`404 ${urlPath}`);
        res.writeHead(404).end('Not found');
        return;
    }

    console.log(`200 ${urlPath}`);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(filePath)] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
}).listen(PORT, () => {
    console.log(`Casa Lucenzo dev server -> http://localhost:${PORT}`);
    console.log(`  landing: http://localhost:${PORT}/`);
    console.log(`  sistema: http://localhost:${PORT}/sistema/`);
});
