const fs = require('fs');
const path = require('path');

const srcDir = path.resolve(__dirname, '..');
const destDir = path.resolve(srcDir, 'www');

// List of files/directories to copy
const assetsToCopy = [
    'index.html',
    'sistema',
    'manifest.json',
    'sw.js',
    'css',
    'js',
    'img'
];

console.log('🧹 Cleaning www folder...');
if (fs.existsSync(destDir)) {
    fs.rmSync(destDir, { recursive: true, force: true });
}
fs.mkdirSync(destDir);

console.log('📦 Copying assets to www...');
assetsToCopy.forEach(asset => {
    const srcPath = path.join(srcDir, asset);
    const destPath = path.join(destDir, asset);

    if (fs.existsSync(srcPath)) {
        fs.cpSync(srcPath, destPath, { recursive: true });
        console.log(`  Copied: ${asset}`);
    } else {
        console.warn(`  Warning: Asset ${asset} not found!`);
    }
});

// Perform environment variable placeholder injection for production www/ build
const supabaseBuildFile = path.join(destDir, 'js', 'supabase.js');
// The Sentry init + __SENTRY_DSN__ placeholder lives in the internal POS app
// (sistema/index.html), not the public landing page (index.html).
const indexBuildFile = path.join(destDir, 'sistema', 'index.html');

// Previously this hard-failed the whole deploy (process.exit(1)) when any of
// these three were missing on Vercel (VERCEL=1 is set for every Vercel build,
// Preview included, not just Production -- so "isProduction" was misleading).
// That's unnecessarily fragile: the runtime code already falls back cleanly
// when a placeholder is left unreplaced (js/supabase.js keeps the hardcoded
// prod URL/key; the Sentry init below has its own mock-DSN fallback), so a
// missing env var here should degrade gracefully, not take down every deploy
// on every branch until someone notices and fixes it in the Vercel dashboard.
if (!process.env.SUPABASE_ANON_KEY || !process.env.SUPABASE_URL || !process.env.SENTRY_DSN) {
    console.warn('⚠️ SUPABASE_ANON_KEY, SUPABASE_URL, or SENTRY_DSN not set for this deployment -- continuing with fallback values.');
}

if (fs.existsSync(supabaseBuildFile)) {
    const envUrl = process.env.SUPABASE_URL;
    const envKey = process.env.SUPABASE_ANON_KEY;

    if (envUrl && envKey) {
        let content = fs.readFileSync(supabaseBuildFile, 'utf8');
        content = content.replace('__SUPABASE_URL__', envUrl);
        content = content.replace('__SUPABASE_ANON_KEY__', envKey);
        fs.writeFileSync(supabaseBuildFile, content, 'utf8');
        console.log('🔒 Environment variables injected into www/js/supabase.js');
    } else {
        console.warn('⚠️ SUPABASE_URL/SUPABASE_ANON_KEY not set — leaving placeholders unreplaced (app will run in local-only mode).');
    }
}

if (fs.existsSync(indexBuildFile)) {
    let indexContent = fs.readFileSync(indexBuildFile, 'utf8');
    const sentryDsn = process.env.SENTRY_DSN || 'https://mock-sentry-dsn@o0.ingest.sentry.io/0';
    indexContent = indexContent.replace('__SENTRY_DSN__', sentryDsn);
    fs.writeFileSync(indexBuildFile, indexContent, 'utf8');
    console.log('🛡️ SENTRY_DSN injected into www/sistema/index.html');
}

console.log('✨ Build completed successfully! All assets are ready in www/ folder.');
