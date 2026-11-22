import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const prompt = String.raw`Evaluate this definite integral. Give the exact answer and show each step. Use a substitution to simplify the integral.
\[
\int_0^1 \frac{\ln(1+x)}{1+x^2}\,dx
\]`;

test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('jarvis_permission_intro_v1', 'true'));
    await page.route('https://**/*', route => route.abort());
    await page.goto('/');
    await page.waitForFunction(() => window.__jarvisModernReady === true);
});

for (const [width, height] of [[320, 568], [390, 844], [768, 1024], [1024, 768], [1440, 900]]) {
    test(`composer and math at ${width}px`, async ({ page }, info) => {
        await page.setViewportSize({ width, height });
        const input = page.locator('#text-input');
        await input.fill(prompt);
        await expect(input).toHaveValue(prompt);
        const send = await page.locator('#send-message-btn').boundingBox();
        expect(send.width).toBeGreaterThanOrEqual(44);
        expect(send.height).toBeGreaterThanOrEqual(44);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await input.press('Enter');
        await expect(page.locator('.assistant-message-text .katex').first()).toBeVisible();
        await expect(page.locator('#request-status')).toHaveText('Response finished.');
        expect(await page.locator('.katex-error').count()).toBe(0);
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: info.outputPath(`layout-${width}.png`), fullPage: true });
        await info.attach('local-performance', { body: JSON.stringify(await page.evaluate(() => window.JarvisPerformance.getMetrics())), contentType: 'application/json' });
    });
}

test('sanitization strips executable attributes while math and trusted actions work', async ({ page }) => {
    const result = await page.evaluate(() => {
        const html = window.JarvisMarkupSecurity.sanitizeAssistantMarkup('<img src="/missing" onerror="window.__xss=1"><svg onload="window.__xss=1"></svg><a href="javascript:alert(1)" onclick="window.__xss=1">click</a>');
        const host = document.createElement('div'); host.innerHTML = html; document.body.append(host);
        return { handlers: Boolean(host.querySelector('[onerror], [onclick], [onload]')), dangerousLink: Boolean(host.querySelector('[href^="javascript:"]')), marker: window.__xss };
    });
    expect(result.handlers).toBe(false); expect(result.dangerousLink).toBe(false); expect(result.marker).toBeUndefined();
    await page.evaluate(() => {
        const host = document.createElement('div'); host.id = 'action-test'; host.className = 'assistant-message-text';
        host.innerHTML = sanitizeAssistantMarkup(window.JarvisMarkdownRenderer.renderMarkdown('```js\nlet x = 1;\n```'));
        document.body.append(host);
    });
    await page.locator('#action-test [data-assistant-action="code-wrap"]').click();
    await expect(page.locator('#action-test [data-assistant-action="code-wrap"]')).toHaveAttribute('aria-pressed', 'true');
});

test('IME composition does not submit and stop responds immediately', async ({ page }) => {
    const input = page.locator('#text-input');
    await input.fill('Composition fixture');
    await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true, keyCode: 229 });
    await expect(input).toHaveValue('Composition fixture');
    await input.fill('Explain sorting for the stop fixture example in detail'); await input.press('Enter');
    await expect(page.locator('#send-message-btn')).toHaveClass(/composer-send-stop/);
    await page.evaluate(() => {
        const before = performance.now(); window.stopActiveGeneration();
        window.__stopDuration = performance.now() - before;
    });
    expect(await page.evaluate(() => window.__stopDuration)).toBeLessThan(100);
    await expect(page.locator('#request-status')).toHaveText('Response stopped.');
    await expect(page.locator('#send-message-btn')).not.toHaveClass(/composer-send-stop/);
});

test('settings trap focus, restore it, and hide unavailable features', async ({ page }) => {
    await page.locator('#text-input').focus();
    await page.evaluate(() => window.showHelpModal());
    const dialog = page.locator('#help-modal'); await expect(dialog).toBeVisible();
    await expect(page.locator('#settings-row-byok')).toBeHidden();
    for (let index = 0; index < 18; index++) await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.getElementById('help-modal').contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
    await expect(page.locator('#text-input')).toBeFocused();
});

test('idle screen passes serious accessibility checks and respects reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(results.violations.filter(item => ['critical', 'serious'].includes(item.impact))).toEqual([]);
});

test('completed blocks retain their DOM identity during streaming', async ({ page }) => {
    expect(await page.evaluate(() => {
        const host = document.createElement('div');
        window.JarvisStreamRenderer.updateMessageHtml(host, '<p>Completed</p><p>A</p>', true);
        const completed = host.firstChild;
        window.JarvisStreamRenderer.updateMessageHtml(host, '<p>Completed</p><p>Answer</p>', true);
        return host.firstChild === completed && host.lastChild.textContent === 'Answer';
    })).toBe(true);
});

test('long pasted text becomes a lossless previewable attachment without replacing the question', async ({ page }) => {
    const source = '    indented code\n' + String.raw`\[\frac{1+x}{1+x^2}\]` + '\n' + 'Long reference text.\n'.repeat(450);
    const input = page.locator('#text-input'); await input.fill('Explain this reference.');
    await input.evaluate((element, text) => {
        const data = new DataTransfer(); data.setData('text/plain', text);
        const event = new Event('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'clipboardData', { value: data });
        element.dispatchEvent(event);
    }, source);
    await expect(page.locator('[data-paste-preview]')).toBeVisible();
    await expect(input).toHaveValue('Explain this reference.');
    await page.locator('[data-paste-preview]').click();
    await expect(page.locator('.text-preview-panel pre')).toHaveText(source);
    await page.locator('.text-preview-panel button').click();
    await input.evaluate(element => element.setSelectionRange(element.value.length, element.value.length));
    await page.locator('[data-paste-inline]').click();
    await expect(input).toHaveValue('Explain this reference.' + source);
    await expect(page.locator('[data-paste-preview]')).toHaveCount(0);
});

test('custom instructions apply on Done and dirty dismissal preserves the committed value', async ({ page }, info) => {
    await page.evaluate(() => window.showHelpModal());
    await page.locator('#settings-row-custom-instructions').click();
    const input = page.locator('#custom-system-prompt-input');
    await input.fill('Answer in Tamil using concise steps.');
    await page.screenshot({ path: info.outputPath('settings-custom.png') });
    expect(await page.evaluate(() => window.customSystemPrompt)).toBe('');
    await page.locator('#settings-view-custom-instructions .help-modal-ok-btn').click();
    expect(await page.evaluate(() => window.customSystemPrompt)).toBe('Answer in Tamil using concise steps.');
    await page.locator('#settings-row-custom-instructions').click(); await input.fill('Unsaved draft');
    await page.locator('#settings-view-custom-instructions .help-modal-back-btn').click();
    await expect(page.getByText('Discard changes?', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
    await expect(input).toHaveValue('Unsaved draft');
    await input.fill('Answer in Tamil using concise steps.');
    await page.keyboard.press('Escape');
    await page.reload(); await page.waitForFunction(() => window.__jarvisModernReady);
    expect(await page.evaluate(() => window.customSystemPrompt)).toBe('Answer in Tamil using concise steps.');
    const request = page.waitForRequest(request => request.url().endsWith('/api/chat-groq') && request.method() === 'POST' && request.postDataJSON().stream);
    await page.locator('#text-input').fill('Explain the algorithm for this example.'); await page.locator('#text-input').press('Enter');
    expect((await request).postDataJSON().preferences.customSystemPrompt).toBe('Answer in Tamil using concise steps.');
});

test('one permission action reports partial results and stops temporary media tracks', async ({ page }, info) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.evaluate(() => {
        window.permissionStops = 0;
        navigator.permissions.query = async () => ({ state: 'prompt' });
        Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async constraints => {
            if (constraints.video) throw new DOMException('Blocked by user', 'NotAllowedError');
            return { getTracks: () => [{ stop: () => window.permissionStops++ }] };
        } } });
        navigator.geolocation.getCurrentPosition = (_success, error) => error({ code: 1 });
        return window.JarvisPermissions.show();
    });
    const panel = await page.locator('.permissions-modal-panel').boundingBox();
    expect(panel.y).toBeGreaterThanOrEqual(0);
    expect(panel.y + panel.height).toBeLessThanOrEqual(568);
    await expect(page.getByRole('button', { name: 'Not now', exact: true })).toBeInViewport();
    await page.screenshot({ path: info.outputPath('permissions.png') });
    await page.getByRole('button', { name: 'Enable permissions', exact: true }).click();
    await expect(page.locator('[data-permission="microphone"]')).toHaveText('Allowed');
    await expect(page.locator('[data-permission="camera"]')).toHaveText('Blocked');
    await expect(page.locator('[data-permission="geolocation"]')).toHaveText('Blocked');
    await expect(page.locator('.permission-result')).not.toHaveText('Permissions enabled.');
    expect(await page.evaluate(() => window.permissionStops)).toBe(1);
    await page.locator('.permission-enable').click();
    await expect(page.locator('#startup-permissions-modal')).toHaveCount(0);
});

test('first-visit setup asks for no hardware access before its primary action and stays dismissed', async ({ context, page }) => {
    await page.evaluate(() => localStorage.removeItem('jarvis_permission_intro_v1'));
    const fresh = await context.newPage();
    await fresh.addInitScript(() => {
        window.hardwareRequests = 0;
        navigator.permissions.query = async () => ({ state: 'prompt' });
        Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => { window.hardwareRequests++; return Promise.reject(new Error('No automatic hardware request expected')); } } });
    });
    await fresh.goto('/');
    await expect(fresh.locator('#startup-permissions-modal')).toBeVisible();
    expect(await fresh.evaluate(() => window.hardwareRequests)).toBe(0);
    await fresh.getByRole('button', { name: 'Not now', exact: true }).click();
    await fresh.reload(); await fresh.waitForFunction(() => window.__jarvisModernReady);
    await expect(fresh.locator('#startup-permissions-modal')).toHaveCount(0);
    await fresh.close();
});

test('where am I renders only the device location and coordinates without extra lookups', async ({ page }, info) => {
    // Intercept at fetch so service-worker routing differences cannot reach real geocoders.
    await page.evaluate(() => {
        const fetch = window.fetch;
        window.locationRequests = [];
        window.fetch = (input, options) => {
            const url = String(input instanceof Request ? input.url : input);
            window.locationRequests.push(url);
            if (url.includes('reverse')) return Promise.resolve(Response.json({ address: { city: 'Example City', state: 'Example State', country: 'Example Country' } }));
            if (url.startsWith('https://')) return Promise.reject(new TypeError('Unexpected external lookup'));
            return fetch(input, options);
        };
        navigator.geolocation.getCurrentPosition = success => success({ coords: { latitude: 12.97, longitude: 77.59, accuracy: 20 } });
    });
    await page.locator('#text-input').fill('Where am I?'); await page.locator('#text-input').press('Enter');
    await expect(page.locator('.location-reply')).toContainText('Example City, Example State, Example Country');
    await expect(page.locator('.location-reply')).toContainText('Latitude 12.97000, Longitude 77.59000');
    const calls = await page.evaluate(() => window.locationRequests);
    expect(calls.filter(url => url.includes('reverse'))).toHaveLength(1);
    expect(calls.filter(url => /open-meteo|ipapi|ipwho|air-quality/i.test(url))).toEqual([]);
    expect(await page.locator('.location-reply a, .location-reply table').count()).toBe(0);
    expect(await page.locator('.location-reply').evaluate(element => getComputedStyle(element).borderTopWidth)).toBe('0px');
    await page.screenshot({ path: info.outputPath('location.png') });
});

test('composer is neutral, has no empty badge, and fits a shortened mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 380 });
    await expect(page.locator('#composer-mode-badge')).toHaveCount(0);
    const input = page.locator('#text-input'); await input.focus(); await input.fill('Keyboard viewport example');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await input.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
    const send = await page.locator('#send-message-btn').boundingBox(); expect(send.height).toBeGreaterThanOrEqual(44);
    expect(await page.locator('#input-bar-inner').evaluate(element => getComputedStyle(element).boxShadow)).toBe('none');
});

test('document references survive reopening and stay inside their conversation', async ({ page }) => {
    await page.locator('#text-input').fill('Study the document I will attach.'); await page.locator('#text-input').press('Enter');
    await expect(page.locator('#request-status')).toHaveText('Response finished.');
    await page.evaluate(() => window.JarvisRecall.selectDocumentFile(new File(['The agreement specifies a 47-day cancellation notice.'], 'agreement.txt', { type: 'text/plain' }), 'agreement', 'What is the cancellation notice?'));
    await page.reload(); await page.waitForFunction(() => window.__jarvisModernReady);
    const same = await page.evaluate(() => window.JarvisRecall.buildContext(window.JarvisConversation, { message: 'What deadline did that agreement set?' }));
    expect(same.summaryText).toContain('47-day');
    await page.evaluate(() => window.startNewChatSession({ keepVisible: true }));
    const another = await page.evaluate(() => window.JarvisRecall.buildContext(window.JarvisConversation, { message: 'What deadline did that agreement set?' }));
    expect(another.summaryText || '').not.toContain('47-day');
});

test('JavaScript runs without access to the app storage or network', async ({ page }) => {
    const result = await page.evaluate(() => window.JarvisCodeRunner.executeJavaScript('console.log(6 * 7); try { localStorage.getItem("x"); return "unsafe"; } catch { return "isolated"; }'));
    expect(result.logs[0].text).toBe('42'); expect(result.result).toBe('isolated');
    const timeout = await page.evaluate(async () => {
        try { await window.JarvisCodeRunner.executeJavaScript('while (true) {}', 150); return 'unsafe'; }
        catch (error) { return error.message; }
    });
    expect(timeout).toContain('time limit');
    await page.locator('#text-input').fill('The application remains responsive.');
});

test('a failed upgrade retains the active worker and its cache', async ({ page }) => {
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    const active = await page.evaluate(() => navigator.serviceWorker.controller.scriptURL);
    await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration('/');
        await fetch('/__test/fail-worker-update', { method: 'POST' });
        await registration.update();
        const installing = registration.installing;
        if (installing && installing.state !== 'redundant') await new Promise(resolve => installing.addEventListener('statechange', () => { if (installing.state === 'redundant') resolve(); }));
    });
    expect(await page.evaluate(() => navigator.serviceWorker.controller.scriptURL)).toBe(active);
    expect(await page.evaluate(() => caches.has('jarvis-cache-failed-fixture'))).toBe(false);
});

test('the shell reloads offline with supported service-worker emulation', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'Playwright service-worker network control is Chromium-only: https://playwright.dev/docs/service-workers');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await context.setOffline(true);
    await page.reload();
    await page.waitForFunction(() => window.__jarvisModernReady === true);
    await expect(page.locator('#text-input')).toBeVisible();
    await context.setOffline(false);
});

test('record a throttled loading baseline without making production latency claims', async ({ page, browserName }, info) => {
    test.skip(browserName !== 'chromium', 'CPU throttling is available through Chromium CDP.');
    const session = await page.context().newCDPSession(page);
    await session.send('Network.enable');
    await session.send('Network.setCacheDisabled', { cacheDisabled: true });
    await session.send('Network.setBypassServiceWorker', { bypass: true });
    await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await session.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 200000, uploadThroughput: 93750 });
    await page.reload();
    await page.waitForFunction(() => window.__jarvisModernReady === true);
    const measurements = await page.evaluate(() => ({ readyMs: performance.now(), metrics: window.JarvisPerformance.getMetrics() }));
    await info.attach('throttled-baseline', { body: JSON.stringify(measurements), contentType: 'application/json' });
    expect(measurements.readyMs).toBeGreaterThan(0);
});
