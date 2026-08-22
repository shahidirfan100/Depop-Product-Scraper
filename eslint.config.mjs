import prettier from 'eslint-config-prettier';

import apify from '@apify/eslint-config/js.js';

export default [{ ignores: ['**/dist', 'eslint.config.mjs'] }, ...apify, prettier];
