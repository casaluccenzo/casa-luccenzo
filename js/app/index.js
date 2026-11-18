// Solo para Node (tests/unit.test.js hace `require('../js/app')`). El navegador
// NO carga este archivo: sistema/index.html carga cada parte de js/app/ como
// script clásico, en este mismo orden, y todas comparten el ámbito global.
//
// Para reproducir eso en Node, se concatenan las partes y se ejecutan dentro de
// una sola función, igual que cuando todo vivía en js/app.js. Los `require('./x')`
// de las partes se resuelven desde js/, como antes.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');

const APP_FILES = [
    'estado.js',
    'carrito.js',
    'ventas.js',
    'inventario.js',
    'finanzas.js',
    'fiados-pedidos.js',
    'cierre.js',
    'productos.js',
    'datos.js',
    'sesion.js',
    'bcv.js',
    'init.js',
    'admin.js'
];

const source = APP_FILES
    .map(f => fs.readFileSync(path.join(__dirname, f), 'utf8'))
    .join('\n');
const jsDir = path.join(__dirname, '..');
const run = vm.compileFunction(source, ['require', 'module', 'exports'], {
    filename: path.join(__dirname, 'app-concatenado.js')
});
run(createRequire(path.join(jsDir, 'index.js')), module, module.exports);

module.exports.APP_FILES = APP_FILES;
