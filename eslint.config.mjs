import globals from 'globals';
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';

//
//  ESLint flat config, matched to ENiGMA½'s own. This file is .mjs on purpose:
//  ENiGMA requires every top-level .js file in a mod folder at startup, so a
//  tooling file named *.js here would run inside the BBS.
//
export default [
    {
        ignores: ['node_modules/**', 'art/**'],
    },

    {
        files: ['**/*.js', '**/*.mjs'],
        languageOptions: {
            globals: {
                ...globals.node,
            },
            ecmaVersion: 'latest',
            sourceType: 'commonjs',
        },

        rules: {
            ...js.configs.recommended.rules,

            indent: [
                'error',
                4,
                {
                    SwitchCase: 1,
                },
            ],

            'linebreak-style': ['error', 'unix'],
            quotes: ['error', 'single'],
            semi: ['error', 'always'],
            'comma-dangle': 0,
            'no-trailing-spaces': 'error',
            'no-control-regex': 0,

            'no-unused-vars': [
                'error',
                {
                    args: 'after-used',
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    caughtErrors: 'none',
                },
            ],
        },
    },

    {
        files: ['**/*.mjs'],
        languageOptions: {
            sourceType: 'module',
        },
    },

    prettier,
];
