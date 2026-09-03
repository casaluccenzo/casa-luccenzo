const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { injectVersion } = require('../scripts/inject-version');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-'));
fs.mkdirSync(path.join(tmp, 'sistema'), { recursive: true });
fs.mkdirSync(path.join(tmp, 'img'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'sw.js'), "const APP_VERSION = '__APP_VERSION__';\n");
fs.writeFileSync(path.join(tmp, 'sistema', 'index.html'),
  '<link href="/css/main.css?v=__APP_VERSION__">\n' +
  '<script src="/js/app.js?v=__APP_VERSION__"></script>\n' +
  '<span>v__APP_VERSION__</span>\n');
// un binario que NO debe tocarse
fs.writeFileSync(path.join(tmp, 'img', 'logo.jpg'), Buffer.from([0xff, 0xd8, 0xff]));

injectVersion(tmp, '1.2.3');

const sw = fs.readFileSync(path.join(tmp, 'sw.js'), 'utf8');
const html = fs.readFileSync(path.join(tmp, 'sistema', 'index.html'), 'utf8');

assert.strictEqual(sw, "const APP_VERSION = '1.2.3';\n", 'sw.js version not injected');
assert.ok(html.includes('main.css?v=1.2.3'), 'css ?v= not injected');
assert.ok(html.includes('app.js?v=1.2.3'), 'js ?v= not injected');
assert.ok(html.includes('<span>v1.2.3</span>'), 'footer token not injected');
assert.ok(!html.includes('__APP_VERSION__'), 'token still present in html');
assert.deepStrictEqual(
  [...fs.readFileSync(path.join(tmp, 'img', 'logo.jpg'))],
  [0xff, 0xd8, 0xff],
  'binary file was modified'
);

fs.rmSync(tmp, { recursive: true, force: true });
console.log('build.test.js: OK');
