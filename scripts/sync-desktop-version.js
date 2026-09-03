// Mantiene desktop/package.json a la misma version que el package.json raiz.
// Se corre como npm "version" lifecycle: despues de bumpear la raiz, antes del
// commit de version. Deja desktop/package.json staged para que entre en el
// mismo commit.
const fs = require('node:fs');
const path = require('node:path');

const rootVersion = require('../package.json').version;
const file = path.join(__dirname, '..', 'desktop', 'package.json');
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));

if (pkg.version !== rootVersion) {
  pkg.version = rootVersion;
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  console.log(`🔗 desktop/package.json -> ${rootVersion}`);
}
