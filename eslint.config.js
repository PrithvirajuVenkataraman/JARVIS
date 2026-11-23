import js from '@eslint/js';
import globals from 'globals';
export default [
    { ignores: ['dist/**', 'scratch/**', 'node_modules/**', 'app/legacy-runtime.js', 'app/features/**', 'katex.min.js'] },
    {
        files: ['app/{main,horde-client,image-generator,image-decoder,image-decoder-core,image-decoder-worker,code-runner,contracts,markup-security,capabilities,stream-renderer,persistence-controller,performance-metrics,dialog-controller,composer-controller,composer-tools-controller,slash-command-controller,file-format,lazy-features,permission-controller,location-controller,paste-controller,settings-controller,request-preferences,request-payload,context-retrieval,recall-cache,recall-model,recall-worker,text-chunks,text-safety}.js', 'api/_lib/{request-lifecycle,arithmetic,answer-preferences,answer-visibility,model-failure}.js', 'vite.config.js'],
        languageOptions: { globals: { ...globals.browser, ...globals.worker, ...globals.node }, ecmaVersion: 'latest', sourceType: 'module' },
        rules: { ...js.configs.recommended.rules, 'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }] }
    }
];
