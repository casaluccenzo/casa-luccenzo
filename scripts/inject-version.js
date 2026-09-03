const fs = require('node:fs');
const path = require('node:path');

// Recorre dir y reemplaza el literal __APP_VERSION__ por `version` en cada
// archivo de texto (.js/.html/.css/.json/.webmanifest). Los binarios (imagenes)
// no se tocan porque no matchean la extension.
function injectVersion(dir, version) {
  const exts = new Set(['.js', '.html', '.css', '.json', '.webmanifest']);
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!exts.has(path.extname(entry.name))) continue;
      const src = fs.readFileSync(full, 'utf8');
      if (src.includes('__APP_VERSION__')) {
        fs.writeFileSync(full, src.split('__APP_VERSION__').join(version), 'utf8');
      }
    }
  };
  walk(dir);
}

module.exports = { injectVersion };
