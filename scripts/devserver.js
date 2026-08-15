/**
 * Local dev server for Casa Lucenzo.
 *
 * Serves the repo root, which is the SOURCE. vercel.json declares
 * `buildCommand: node scripts/build.js` + `outputDirectory: www`, so in theory
 * production serves a built copy with SUPABASE_URL / SUPABASE_ANON_KEY /
 * SENTRY_DSN substituted for their placeholders.
 *
 * In practice it does not: as of 2026-08-15 https://www.luccenzo.com/sistema/
 * still ships `var sentryDsn = '__SENTRY_DSN__'` and js/supabase.js still ships
 * `"__SUPABASE_URL__"`, i.e. the build is NOT running and the deployed site is
 * this same unbuilt source. Both run on their hardcoded fallbacks. So local and
 * production currently match -- but by accident, not by design. Check the
 * placeholders on the real domain before trusting either.
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
