import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';
import { server } from '../tools/local-dev-server.mjs';

// Use an isolated browser profile and an ephemeral server; never attach to a user's tabs.
const chromePath = process.env.CHROME_PATH || [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].find(existsSync);
assert.ok(chromePath, 'Set CHROME_PATH to an installed Chromium browser');
const profile = await mkdtemp(join(tmpdir(), 'jarvis-math-'));
let browser;
let socket;
let browserErrors = '';
const pending = new Map();
let nextId = 0;

try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = spawn(chromePath, [
        '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'
    ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    browser.stderr.on('data', chunk => { browserErrors += chunk; });
    browser.on('error', error => { console.error(error); });

    let port;
    for (let attempt = 0; attempt < 100 && !port; attempt++) {
        try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); }
        catch { await delay(100); }
    }
    assert.ok(port, 'Headless browser did not start');
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
    await once(socket, 'open');
    socket.addEventListener('message', event => {
        const response = JSON.parse(event.data);
        const request = pending.get(response.id);
        if (!request) return;
        pending.delete(response.id);
        clearTimeout(request.timer);
        if (response.error) request.reject(new Error(JSON.stringify(response.error)));
        else request.resolve(response.result);
    });
    const command = (method, params = {}) => new Promise((resolveRequest, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 15000);
        pending.set(id, { resolve: resolveRequest, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
        const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
        return result.result.value;
    };
    console.log('Browser:', (await command('Browser.getVersion')).product);
    await command('Page.enable');
    await command('Network.enable');
    // Math assets must work locally, without Tailwind, Google Fonts, or a KaTeX CDN.
    await command('Network.setBlockedURLs', { urls: ['https://*'] });
    await command('Page.navigate', { url: origin });
    let ready = false;
    for (let attempt = 0; attempt < 100 && !ready; attempt++) {
        ready = await evaluate('Boolean(window.katex && window.JarvisMarkdownRenderer && typeof sanitizeAssistantMarkup === "function")');
        if (!ready) await delay(100);
    }
    assert.ok(ready, 'The production renderer and sanitizer did not load');

    const integral = String.raw`\int \sqrt{\tan x}\,dx`;
    const inline = String.raw`t = \sqrt{\tan x}`;
    const answer = String.raw`\frac{1}{2\sqrt{2}}\ln\left|\frac{t^2-\sqrt{2}t+1}{t^2+\sqrt{2}t+1}\right|+\frac{1}{\sqrt{2}}\arctan\left(\frac{t^2-1}{\sqrt{2}t}\right)+C`;
    const alignment = String.raw`\begin{aligned}t^2 &= \tan x \\ dx &= \frac{2t}{1+t^4}\,dt\end{aligned}`;
    const matrix = String.raw`\begin{pmatrix}1 & 2 \\ 3 & 4\end{pmatrix}`;
    const markdown = `Step 1: Substitute\n\n$$${integral}$$\n\nLet $${inline}$. The price is $50 each.\n\nStep 2: Transform\n\n$$${alignment}$$\n\nStep 3: Result\n\n$$${answer}$$\n\nMatrix: $${matrix}$`;
    await evaluate(`(() => {
        const host = document.createElement('div');
        host.id = 'math-regression';
        host.className = 'assistant-message-text';
        host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;overflow:auto;padding:24px;background:black;box-sizing:border-box;';
        host.innerHTML = sanitizeAssistantMarkup(renderAssistantMarkdown(${JSON.stringify(markdown)}));
        document.body.appendChild(host);
    })()`);

    for (const width of [1280, 390]) {
        await command('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
        const metrics = await evaluate(`(async () => {
            await document.fonts.ready;
            await new Promise(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
            const host = document.getElementById('math-regression');
            const display = host.querySelector('.math-display-block');
            const base = display.querySelector('.base');
            const sizing = host.querySelector('.sizing.size3');
            const radical = host.querySelector('.sqrt svg');
            const inline = host.querySelector('.math-inline');
            const bounds = inline.getBoundingClientRect();
            const displays = [...host.querySelectorAll('.math-display-block')];
            const overflow = displays.filter(el => el.scrollWidth > el.clientWidth + 1);
            const canReadBothEnds = overflow.every(el => {
                el.scrollLeft = 0;
                const left = el.querySelector('.katex-html').getBoundingClientRect().left >= el.getBoundingClientRect().left - 1;
                el.scrollLeft = el.scrollWidth;
                const reachesEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
                el.scrollLeft = 0;
                return left && reachesEnd;
            });
            return {
                displayCount: displays.length,
                errors: host.querySelectorAll('.katex-error').length,
                baseWhiteSpace: getComputedStyle(base).whiteSpace,
                mathFont: getComputedStyle(base.querySelector('.mathnormal')).fontFamily,
                sizingRatio: parseFloat(getComputedStyle(sizing).fontSize) / parseFloat(getComputedStyle(sizing.parentElement).fontSize),
                inlineWidth: bounds.width, inlineHeight: bounds.height,
                integralWidth: base.getBoundingClientRect().width,
                integralHeight: display.getBoundingClientRect().height,
                radicalAspectRatio: radical.getAttribute('preserveAspectRatio'),
                localFontsLoaded: document.fonts.check('16px KaTeX_Main') && document.fonts.check('italic 16px KaTeX_Math'),
                hostOverflow: host.scrollWidth > host.clientWidth + 1,
                overflowCount: overflow.length, canReadBothEnds,
                annotationMarkup: [...host.querySelectorAll('annotation')].some(el => /<sup>|<sub>|<em>|<br>/.test(el.innerHTML)),
                currency: host.textContent.includes('$50 each'),
                trailingDollar: host.lastElementChild.textContent.endsWith('$')
            };
        })()`);
        console.log(`${width}px math layout:`, metrics);
        assert.equal(metrics.displayCount, 3);
        assert.equal(metrics.errors, 0);
        assert.equal(metrics.baseWhiteSpace, 'nowrap', 'Chat styles must not wrap KaTeX bases');
        assert.match(metrics.mathFont, /KaTeX_Math/, 'Chat font must not replace the math font');
        assert.ok(metrics.sizingRatio < 0.9, 'Scripts and fractions must retain KaTeX font scaling');
        assert.ok(metrics.integralWidth > 90 && metrics.integralHeight < 130, 'Integral must stay horizontal');
        assert.ok(metrics.inlineWidth > metrics.inlineHeight * 1.5, 'Inline substitution must stay horizontal');
        assert.equal(metrics.radicalAspectRatio, 'xMinYMin slice', 'Sanitization must preserve radical SVG sizing');
        assert.equal(metrics.localFontsLoaded, true);
        assert.equal(metrics.hostOverflow, false, 'Long equations must scroll within their own block');
        assert.equal(metrics.canReadBothEnds, true, 'Both ends of overflowing equations must be reachable');
        assert.equal(metrics.annotationMarkup, false);
        assert.equal(metrics.currency, true);
        assert.equal(metrics.trailingDollar, false, 'Currency must not add a trailing math delimiter');
        if (width === 390) assert.ok(metrics.overflowCount > 0, 'The long answer should scroll on mobile');
        if (process.argv.includes('--screenshots')) {
            const directory = new URL('../scratch/math-rendering/', import.meta.url);
            await mkdir(directory, { recursive: true });
            const screenshot = await command('Page.captureScreenshot', { format: 'png' });
            await writeFile(new URL(`${width}.png`, directory), Buffer.from(screenshot.data, 'base64'));
        }
    }
    console.log('Browser math rendering passed with external assets blocked.');
} catch (error) {
    console.error(browserErrors.slice(-4000));
    throw error;
} finally {
    for (const request of pending.values()) clearTimeout(request.timer);
    socket?.close();
    if (browser && browser.exitCode === null) {
        const closed = once(browser, 'exit');
        browser.kill();
        await closed;
    }
    server.closeAllConnections();
    await new Promise(resolveClose => server.close(resolveClose));
    assert.ok(resolve(profile).startsWith(resolve(tmpdir()) + sep));
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
