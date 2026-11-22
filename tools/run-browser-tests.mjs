import { spawn } from 'node:child_process';
const child = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', ...process.argv.slice(2)], {
    stdio: 'inherit', windowsHide: true, env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: '0' }
});
child.on('exit', code => process.exitCode = code || 0);
