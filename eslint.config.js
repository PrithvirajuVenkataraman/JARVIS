import js from '@eslint/js';
import globals from 'globals';
export default [
    { ignores: ['dist/**', 'scratch/**', 'node_modules/**', 'app/legacy-runtime.js', 'app/features/**', 'katex.min.js'] },
    {
        files: ['app/{main,code-runner,contracts,markup-security,capabilities,stream-renderer,persistence-controller,performance-metrics,dialog-controller,composer-controller,lazy-features}.js', 'api/_lib/request-lifecycle.js', 'vite.config.js'],
        languageOptions: { globals: { ...globals.browser, ...globals.node }, ecmaVersion: 'latest', sourceType: 'module' },
        rules: { ...js.configs.recommended.rules, 'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }] }
    }
];
