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

console.log('✨ Build completed successfully! All assets are ready in www/ folder.');
