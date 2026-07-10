/**
 * ESLint flat config (ESLint 9+) — the `lint`/`lint:fix` scripts in
 * package.json existed with no config file backing them (ESLint 9 dropped
 * the old .eslintrc.* format), so `npm run lint` had never actually run.
 * This is intentionally light: catch real bugs (undefined vars, unreachable
 * code, unused vars) without imposing a new style regime on ~150 existing
 * files that were never linted against anything.
 */
'use strict';

const js = require('@eslint/js');

module.exports = [
    js.configs.recommended,
    {
        files: ['src/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: {
                require: 'readonly',
                module: 'readonly',
                exports: 'readonly',
                process: 'readonly',
                __dirname: 'readonly',
                __filename: 'readonly',
                console: 'readonly',
                Buffer: 'readonly',
                setTimeout: 'readonly',
                setInterval: 'readonly',
                clearTimeout: 'readonly',
                clearInterval: 'readonly',
            },
        },
        rules: {
            'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
            'no-empty': ['warn', { allowEmptyCatch: true }],
            'no-constant-condition': ['warn', { checkLoops: false }],
        },
    },
    {
        ignores: ['node_modules/**', 'logs/**', 'uploads/**', 'coverage/**'],
    },
];
