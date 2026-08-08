/**
 * Local dev server for Casa Lucenzo.
 *
 * Mirrors production exactly: vercel.json declares a no-op build with
 * `outputDirectory: "."`, so the repo root IS the deployed site. Serving the
 * root here means what you test locally is what gets served.
 *
 *   npm run dev   ->   http://localhost:4173
 *
 * Node core only, no dependencies.
 *
 * Heads up: js/supabase.js falls back to the real project URL + publishable key,
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
