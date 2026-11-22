import { defineConfig } from '@playwright/test';
export default defineConfig({
    testDir: './tests/browser',
    timeout: 30000,
    fullyParallel: false,
    workers: 1,
    retries: 0,
    outputDir: 'scratch/browser-results',
    reporter: [['list'], ['html', { outputFolder: 'scratch/browser-report', open: 'never' }]],
    use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
    projects: ['chromium', 'firefox', 'webkit'].map(browserName => ({ name: browserName, use: { browserName } })),
    webServer: { command: 'node tools/browser-fixture-server.mjs', url: 'http://127.0.0.1:4173', reuseExistingServer: false }
});
