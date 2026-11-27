// js/app/ y js/ui/ son scripts clásicos que comparten el ámbito global, así que
// el orden de carga importa. Ese orden está escrito en tres sitios:
//   - sistema/index.html (lo que carga el navegador)
//   - sw.js (lo que se guarda para funcionar sin internet)
//   - js/app/index.js (cómo los tests de Node arman la app)
// Este test falla si alguno se desincroniza o falta un archivo.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'sistema/index.html'), 'utf8');

const htmlScripts = [...html.matchAll(/<script(?![^>]*type="module")[^>]*src="\/js\/([^"?]+)\?v=__APP_VERSION__"/g)]
    .map(m => m[1]);

const swSrc = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const swBlock = swSrc.match(/const SCRIPTS = \[([\s\S]*?)\]/)[1];
const swScripts = [...swBlock.matchAll(/'([^']+)'/g)].map(m => m[1]);

assert.deepStrictEqual(swScripts, htmlScripts, 'sw.js SCRIPTS no coincide con los <script> de sistema/index.html');

// Se lee el texto (no se hace require: cargar la app necesita los mocks de
// navegador que monta tests/unit.test.js).
const loaderSrc = fs.readFileSync(path.join(root, 'js/app/index.js'), 'utf8');
const APP_FILES = [...loaderSrc.match(/const APP_FILES = \[([\s\S]*?)\]/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
const htmlApp = htmlScripts.filter(f => f.startsWith('app/')).map(f => f.slice(4));
assert.deepStrictEqual(htmlApp, APP_FILES, 'js/app/index.js APP_FILES no coincide con sistema/index.html');

for (const f of htmlScripts) {
    assert.ok(fs.existsSync(path.join(root, 'js', f)), `falta js/${f}`);
}
for (const dir of ['app', 'ui']) {
    for (const f of fs.readdirSync(path.join(root, 'js', dir))) {
        if (dir === 'app' && f === 'index.js') continue;
        assert.ok(htmlScripts.includes(`${dir}/${f}`), `js/${dir}/${f} existe pero sistema/index.html no lo carga`);
    }
}
console.log('script-order.test.js: OK');
