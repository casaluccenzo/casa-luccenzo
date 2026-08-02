const js = require('@eslint/js');

const browserGlobals = {
    window: 'readonly',
    document: 'readonly',
    navigator: 'readonly',
    localStorage: 'readonly',
    sessionStorage: 'readonly',
    fetch: 'readonly',
    console: 'readonly',
    setTimeout: 'readonly',
    clearTimeout: 'readonly',
    setInterval: 'readonly',
    clearInterval: 'readonly',
    Audio: 'readonly',
    URL: 'readonly',
    Blob: 'readonly',
    FileReader: 'readonly',
    CustomEvent: 'readonly',
    alert: 'readonly',
    confirm: 'readonly',
    // js/*.js files are dual CommonJS/browser modules (guarded by `typeof module !== 'undefined'`)
    // to stay unit-testable under Node — see tests/unit.test.js.
    module: 'readonly',
    require: 'readonly',
    exports: 'writable'
};

const nodeGlobals = {
    require: 'readonly',
    module: 'writable',
    exports: 'writable',
    process: 'readonly',
    console: 'readonly',
    Buffer: 'readonly',
    __dirname: 'readonly',
    fetch: 'readonly',
    setTimeout: 'readonly',
    clearTimeout: 'readonly'
};

module.exports = [
    js.configs.recommended,
    {
        files: ['js/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'script',
            globals: browserGlobals
        },
        rules: {
            'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
            'no-undef': 'warn'
        }
    },
    {
        files: ['api/**/*.js', 'lib/**/*.js', 'scripts/**/*.js', 'tools/**/*.js', 'tests/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: nodeGlobals
        },
        rules: {
            'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
            'no-undef': 'warn'
        }
    },
    {
        files: ['sw.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'script',
            globals: {
                self: 'readonly',
                caches: 'readonly',
                fetch: 'readonly',
                console: 'readonly'
            }
        }
    },
    {
        ignores: ['www/', 'node_modules/', 'whatsapp-session/', 'supabase/.temp/']
    }
];
