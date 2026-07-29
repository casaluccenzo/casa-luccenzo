const fs = require('fs');
const path = require('path');

const srcDir = path.resolve(__dirname, '..');
const destDir = path.resolve(srcDir, 'www');

// List of files/directories to copy
const assetsToCopy = [
    'index.html',
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
if (fs.existsSync(supabaseBuildFile)) {
    let content = fs.readFileSync(supabaseBuildFile, 'utf8');

    const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
    if (isProduction && (!process.env.SUPABASE_ANON_KEY || !process.env.SUPABASE_URL)) {
        console.error('❌ BUILD ERROR: Missing mandatory SUPABASE_ANON_KEY or SUPABASE_URL in production build environment!');
        process.exit(1);
    }

    const envUrl = process.env.SUPABASE_URL || 'https://xttpaqokeyywjaajvjyu.supabase.co';
    const envKey = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh0dHBhcW9rZXl5d2phYWp2anl1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyNDQ2NDcsImV4cCI6MjA5OTgyMDY0N30.GUREG-_krI5l3cowwuGZv1774q3AaWEjbmwrWLqhXDE';

    content = content.replace('__SUPABASE_URL__', envUrl);
    content = content.replace('__SUPABASE_ANON_KEY__', envKey);
    fs.writeFileSync(supabaseBuildFile, content, 'utf8');
    console.log('🔒 Environment variables injected into www/js/supabase.js');
}

console.log('✨ Build completed successfully! All assets are ready in www/ folder.');
