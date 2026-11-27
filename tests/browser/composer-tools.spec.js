import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('jarvis_permission_intro_v1', 'true'));
    await page.route('https://**/*', route => route.abort());
    await page.goto('/'); await page.waitForFunction(() => window.__jarvisModernReady);
    await expect(page.locator('#web-search-toggle-btn')).toHaveAttribute('data-capability-unavailable', 'false');
});

test('slash filtering selects on Enter without sending, then sends the completed draft once', async ({ page }) => {
    let sends = 0; page.on('request', request => { if (request.url().endsWith('/api/chat-groq') && request.method() === 'POST' && request.postDataJSON()?.stream) sends++; });
    const input = page.locator('#text-input'); await input.fill('/');
    await expect(page.locator('#slash-command-results [role=option]')).toHaveCount(5);
    await expect(page.locator('#slash-command-results [role=option] span')).toHaveText(['Translate', 'Verify', 'Summarize', 'Professional', 'Study']);
    await input.press('s'); await expect(page.locator('#slash-command-results [role=option]')).toHaveCount(4);
    await expect(page.locator('#slash-command-results [role=option]').first()).toHaveAttribute('data-command', 'summarize');
    await input.press('u'); await expect(page.locator('#slash-command-results [role=option]')).toHaveText(['SummarizeSummarize text or a document']);
    await input.press('Enter'); await expect(input).toHaveValue('summarize this: ');
    expect(sends).toBe(0); await expect(page.locator('.chat-row[data-role=user]')).toHaveCount(0);
    await input.fill('summarize this: Plants use light to produce energy.'); await input.press('Enter');
    await expect(page.locator('#request-status')).toHaveText('Response finished.'); expect(sends).toBe(1);
});

test('minimal workspace keeps visible sidebar access beside JARVIS and retains tools and settings', async ({ page }) => {
    const header = page.locator('#app-header');
    await expect(header).toHaveText('JARVIS'); await expect(header.locator('button')).toHaveCount(1);
    await expect(header.getByRole('button', { name: 'Open sidebar', exact: true })).toBeVisible();
    await expect(header.locator('svg')).toHaveCount(1);
    await expect(page.locator('.empty-state-capabilities, .empty-state-emblem, .empty-state-headline, .empty-state-sub')).toHaveCount(0);
    await header.getByRole('button').click();
    await expect(page.locator('#chat-sidebar-panel')).toHaveAttribute('aria-hidden', 'false');
    await page.locator('#chat-sidebar-panel').getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.locator('#help-modal')).toBeVisible();
    await page.keyboard.press('Escape');
});

test('sidebar shortcuts remain reachable on all widths and open their working features', async ({ page }, info) => {
    test.setTimeout(60000);
    const toggle = page.getByRole('button', { name: 'Open sidebar', exact: true });
    const sidebar = page.locator('#chat-sidebar-panel');
    const actions = sidebar.getByRole('navigation', { name: 'Main chat actions' });
    const labels = ['New chat', 'Search', 'Memory', 'Custom instructions', 'Settings'];
    await expect(page.locator('#sidebar-vision-btn')).toHaveCount(0);
    for (const [width, height] of [[320, 568], [390, 844], [768, 1024], [1024, 768], [1440, 900], [844, 390]]) {
        await page.setViewportSize({ width, height });
        await expect(toggle).toBeVisible();
        await expect.poll(async () => {
            const title = await page.locator('#app-header .header-brand-title').boundingBox();
            return Math.abs(title.x + title.width / 2 - width / 2);
        }).toBeLessThan(1);
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        if (width >= 1024) {
            // The header and composer can share a center while both are still
            // transitioning. Verify all final layout bounds together.
            await expect(async () => {
                const composer = await page.locator('#input-bar-inner').boundingBox();
                const title = await page.locator('#app-header .header-brand-title').boundingBox();
                const panel = await sidebar.boundingBox();
                expect(Math.abs(composer.x + composer.width / 2 - title.x - title.width / 2)).toBeLessThan(1);
                expect(composer.x).toBeGreaterThanOrEqual(panel.x + panel.width);
                expect(composer.x + composer.width).toBeLessThanOrEqual(width);
            }).toPass();
        }
        await expect(actions.getByRole('button')).toHaveText(labels);
        for (const label of labels) {
            const action = actions.getByRole('button', { name: label, exact: true });
            await action.scrollIntoViewIfNeeded();
            await expect(action).toBeInViewport();
            expect((await action.boundingBox()).height).toBeGreaterThanOrEqual(44);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if ([390, 1440].includes(width)) await page.screenshot({ path: info.outputPath(`sidebar-${width}.png`) });
        await page.keyboard.press('Escape');
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(toggle).toBeFocused();
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await toggle.click(); await actions.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(sidebar.getByRole('searchbox')).toBeFocused();
    await sidebar.getByRole('searchbox').fill('missing conversation');
    await expect(page.locator('#chat-sidebar-list')).toContainText('No matching chats found.');
    await page.keyboard.press('Escape');
    await toggle.click(); await actions.getByRole('button', { name: 'Memory', exact: true }).click();
    await expect(page.locator('#memory-manager-modal')).toBeVisible();
    await page.getByRole('button', { name: 'Close memory manager', exact: true }).click();
    await expect(toggle).toBeFocused();
    await toggle.click(); await actions.getByRole('button', { name: 'Custom instructions', exact: true }).click();
    await expect(page.locator('#settings-view-custom-instructions')).toBeVisible();
    await expect(page.locator('#custom-system-prompt-input')).toBeVisible();
    await page.keyboard.press('Escape'); await expect(page.locator('#help-modal')).toHaveCount(0);
    await toggle.click();
    await actions.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.locator('#settings-view-main')).toBeVisible(); await page.keyboard.press('Escape');
    await page.locator('#text-input').fill('Explain the sidebar test.'); await page.locator('#text-input').press('Enter');
    await expect(page.locator('#request-status')).toHaveText('Response finished.');
    await toggle.click(); await sidebar.getByRole('searchbox').fill('');
    await expect(page.locator('#chat-sidebar-list .chat-session-row').first()).toBeVisible();
    await actions.getByRole('button', { name: 'New chat', exact: true }).click();
    await expect(page.locator('#chat-container .chat-row')).toHaveCount(0);
    await toggle.click(); await expect(page.locator('#chat-sidebar-list .chat-session-row').first()).toBeVisible();
});

test('sidebar Search text aligns with navigation and New chat has no decorative side line', async ({ page }, info) => {
    for (const width of [320, 390, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 844 });
        await page.getByRole('button', { name: 'Open sidebar', exact: true }).click();
        const nav = page.getByRole('navigation', { name: 'Main chat actions' });
        const newChat = nav.getByRole('button', { name: 'New chat', exact: true });
        expect(await newChat.evaluate(element => getComputedStyle(element, '::before').content)).toMatch(/^(none|normal)$/);
        expect(await page.locator('#sidebar-drag-handle').evaluate(element => getComputedStyle(element, '::after').content)).toMatch(/^(none|normal)$/);
        const search = nav.getByRole('button', { name: 'Search', exact: true }); await search.click();
        const input = page.getByRole('searchbox', { name: 'Search', exact: true });
        await expect(input).toBeFocused(); await expect(input).toHaveAttribute('placeholder', 'Search');
        const alignment = await input.evaluate(element => {
            const style = getComputedStyle(element), label = document.querySelector('.chat-sidebar-nav-item:nth-child(2) span');
            return Math.abs(element.getBoundingClientRect().left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth) - label.getBoundingClientRect().left);
        });
        expect(alignment).toBeLessThanOrEqual(2);
        expect((await input.boundingBox()).height).toBeGreaterThanOrEqual(44);
        await expect(page.locator('#chat-sidebar-section-title')).toHaveText('Recent chats');
        await expect(page.locator('.chat-sidebar-empty')).toHaveText('Your chats will appear here.');
        if ([390, 1440].includes(width)) await page.screenshot({ path: info.outputPath(`search-${width}.png`), animations: 'disabled' });
        await page.keyboard.press('Escape');
    }
});

test('model routing explains the current preference without promotional badges or fixed model claims', async ({ page }, info) => {
    await page.evaluate(async () => { await window.showHelpModal(); });
    await expect(page.locator('#help-modal')).toBeVisible();
    await page.evaluate(() => window.switchSettingsView('architecture_info'));
    const routing = page.locator('.settings-routing-card'); await routing.scrollIntoViewIfNeeded();
    await expect(routing.getByRole('heading', { name: 'Model routing', exact: true })).toBeVisible();
    await expect(routing).not.toContainText('No Lock-In');
    await expect(routing).not.toContainText('GPT OSS 120B');
    await expect(routing).toContainText('Automatic');
    for (const width of [320, 390, 1440]) {
        await page.setViewportSize({ width, height: 844 }); await routing.scrollIntoViewIfNeeded();
        expect(await routing.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
    await page.setViewportSize({ width: 390, height: 844 }); await routing.scrollIntoViewIfNeeded();
    await routing.screenshot({ path: info.outputPath('model-routing-mobile.png') });
});

test('picker navigation preserves drafts, composition, payloads, and changing capabilities', async ({ page }) => {
    const input = page.locator('#text-input'); await input.fill('/');
    await input.press('ArrowUp'); await expect(page.locator('[role=option][aria-selected=true]')).toHaveAttribute('data-command', 'study');
    await input.press('ArrowDown'); await expect(page.locator('[role=option][aria-selected=true]')).toHaveAttribute('data-command', 'translate');
    await input.press('Enter');
    await expect(input).toHaveValue('Translate this text to [language]: ');
    expect(await input.evaluate(element => element.value.slice(element.selectionStart, element.selectionEnd))).toBe('[language]');
    await input.fill('/nothing'); await expect(page.locator('.slash-command-empty')).toHaveText('No matching commands');
    await input.press('Enter'); await expect(input).toHaveValue('/nothing');
    await input.press('Escape'); await expect(page.locator('#slash-command-picker')).toHaveCount(0);
    await input.fill('/study'); await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true, keyCode: 229 }); await expect(input).toHaveValue('/study');
    await input.press('Shift+Enter'); await expect(input).toHaveValue('/study\n'); await expect(page.locator('#slash-command-picker')).toHaveCount(0);
    await input.fill('/summarize already supplied text'); await expect(page.locator('#slash-command-picker')).toHaveCount(0);
    await input.fill('/pro'); await page.locator('[data-command=professional]').click(); await expect(input).toHaveValue('make this professional: ');
});

test('web search preserves its state and respects the existing motion preferences', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const shell = page.locator('#input-bar-inner'), active = page.locator('#composer-web-search-active');
    await page.locator('#text-input').fill('Keep this draft');
    await page.locator('#composer-plus-btn').click(); await page.locator('#web-search-toggle-btn').click();
    await expect(active).toBeVisible(); await expect(shell).toHaveClass(/has-web-search/);
    await expect(active).toHaveAttribute('aria-pressed', 'true'); await expect(page.locator('#composer-actions-menu')).toBeHidden();
    expect(await page.locator('.composer-web-outline').evaluate(element => getComputedStyle(element).animationName)).toBe('web-outline-travel');
    await page.reload(); await page.waitForFunction(() => window.__jarvisModernReady); await expect(active).toBeVisible();
    await expect(page.locator('#text-input')).toHaveValue('Keep this draft');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await page.locator('.composer-web-outline').evaluate(element => getComputedStyle(element).animationName)).toBe('none');
    await active.click(); await expect(shell).not.toHaveClass(/has-web-search/); await expect(active).toBeHidden();
    expect(await page.locator('.composer-web-outline').evaluate(element => getComputedStyle(element).animationName)).toBe('none');
    await page.evaluate(() => { window.setWebSearchMode('force'); window.startNewChatSession({ forceNew: true }); });
    await expect(active).toBeHidden();
    await page.evaluate(() => { window.setWebSearchMode('force'); window.JarvisCapabilities.applyCapabilities({ search: { available: false, reasonCode: 'quota_exhausted' } }); });
    await expect(shell).not.toHaveClass(/has-web-search/); await expect(page.locator('#web-search-toggle-btn')).toBeHidden();
});

test('touch emulation can select commands and toggle search without overlapping controls', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    try {
        await context.addInitScript(() => localStorage.setItem('jarvis_permission_intro_v1', 'true'));
        const page = await context.newPage(); await page.route('https://**/*', route => route.abort());
        await page.goto('/'); await page.waitForFunction(() => window.__jarvisModernReady);
        await page.locator('#text-input').fill('/pro'); await page.locator('[data-command=professional]').tap();
        await expect(page.locator('#text-input')).toHaveValue('make this professional: ');
        await page.locator('#composer-plus-btn').tap(); await page.locator('#web-search-toggle-btn').tap();
        await expect(page.locator('#composer-web-search-active')).toBeVisible();
        await page.locator('#composer-web-search-active').tap(); await expect(page.locator('#input-bar-inner')).not.toHaveClass(/has-web-search/);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally { await context.close(); }
});

test('image attachment metadata stays synchronous after reopening and browser zoom shortcuts remain available', async ({ page }) => {
    await page.reload(); await page.waitForFunction(() => window.__jarvisModernReady);
    const metadata = await page.evaluate(() => ({ size: window.JarvisAttachments.formatBytes(23347), html: window.buildUserMessageAttachmentsHtml([{ name: 'pasted-media.png', size: 23347, mimeType: 'image/png' }]) }));
    expect(metadata.size).toBe('22.8 KB'); expect(metadata.html).toContain('22.8 KB'); expect(metadata.html).toContain('IMAGE'); expect(metadata.html).not.toContain('[object Promise]');
    const zoomPrevented = await page.evaluate(() => {
        const key = new KeyboardEvent('keydown', { key: '+', ctrlKey: true, bubbles: true, cancelable: true }); window.dispatchEvent(key);
        const wheel = new WheelEvent('wheel', { ctrlKey: true, bubbles: true, cancelable: true }); document.dispatchEvent(wheel);
        return key.defaultPrevented || wheel.defaultPrevented;
    });
    expect(zoomPrevented).toBe(false);
    // Chromium serializes pan-x pan-y pinch-zoom as the equivalent manipulation keyword.
    expect(await page.evaluate(() => getComputedStyle(document.body).touchAction)).toMatch(/pinch-zoom|^manipulation$/);
});

test('short landscape and 200-percent-equivalent reflow keep menus and settings reachable', async ({ page }, info) => {
    // 640x450 CSS pixels represents a 1280x900 browser viewport at 200% zoom.
    for (const [width, height] of [[640, 450], [844, 390]]) {
        await page.setViewportSize({ width, height }); await page.evaluate(() => window.setWebSearchMode('force'));
        await page.locator('#composer-plus-btn').click();
        const menu = await page.locator('#composer-actions-menu').boundingBox(); expect(menu.y).toBeGreaterThanOrEqual(0); expect(menu.y + menu.height).toBeLessThanOrEqual(height);
        await page.keyboard.press('Escape'); await page.evaluate(() => window.closeComposerActionsMenu());
        await page.evaluate(() => window.showHelpModal()); await page.locator('#settings-permissions').scrollIntoViewIfNeeded();
        await expect(page.locator('#settings-permissions')).toBeInViewport();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: info.outputPath(`settings-short-${width}.png`) });
        await page.keyboard.press('Escape'); await expect(page.locator('#help-modal')).toHaveCount(0);
    }
});

for (const [width, height] of [[320, 568], [390, 844], [768, 1024], [1024, 768], [1440, 900]]) {
    test(`menus, active search, and settings stay readable at ${width}px`, async ({ page }, info) => {
        await page.setViewportSize({ width, height });
        await page.screenshot({ path: info.outputPath(`welcome-${width}.png`) });
        const plus = page.locator('#composer-plus-btn'); await plus.focus(); await plus.press('ArrowDown');
        const menu = page.locator('#composer-actions-menu'); await expect(menu).toBeVisible();
        await expect(menu.getByRole('menuitem').first()).toBeFocused();
        const rect = await menu.boundingBox(); expect(rect.x).toBeGreaterThanOrEqual(0); expect(rect.x + rect.width).toBeLessThanOrEqual(width); expect(rect.y).toBeGreaterThanOrEqual(0);
        await page.screenshot({ path: info.outputPath(`menu-${width}.png`) });
        await page.keyboard.press('Escape'); await expect(plus).toBeFocused();
        await page.evaluate(() => window.setWebSearchMode('force'));
        await expect(page.locator('#composer-web-search-active')).toBeVisible();
        for (const selector of ['#composer-plus-btn', '#composer-think-btn', '#voice-to-text-btn', '#send-message-btn']) {
            const bounds = await page.locator(selector).boundingBox(); expect(bounds.width).toBeGreaterThanOrEqual(44); expect(bounds.height).toBeGreaterThanOrEqual(44); expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
        }
        const input = page.locator('#text-input');
        await input.fill('A long draft '.repeat(30));
        await expect(input).toBeFocused();
        await expect(input).toHaveCSS('resize', 'none');
        await expect(input).toHaveCSS('border-top-width', '0px');
        await expect(input).toHaveCSS('outline-style', 'none');
        await expect(input).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        await expect(page.locator('#input-bar-inner')).toHaveCSS('border-top-color', 'rgb(56, 189, 248)');
        await page.screenshot({ path: info.outputPath(`composer-${width}.png`) });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.evaluate(() => window.showHelpModal());
        const modelRow = page.locator('.settings-row').filter({ has: page.locator('.settings-select') });
        if (width <= 640) {
            const select = await modelRow.locator('.settings-select').boundingBox();
            const row = await modelRow.boundingBox();
            expect(select.x).toBeGreaterThanOrEqual(row.x);
            expect(select.x + select.width).toBeLessThanOrEqual(row.x + row.width + 1);
        }
        const recall = page.locator('#settings-local-recall-group'); await recall.scrollIntoViewIfNeeded();
        await expect(page.locator('#local-recall-enabled')).toHaveAttribute('role', 'switch');
        expect(await recall.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
        await page.screenshot({ path: info.outputPath(`settings-${width}.png`) });
        const errors = (await new AxeBuilder({ page }).include('#help-modal').withTags(['wcag2a', 'wcag2aa']).analyze()).violations.filter(row => ['serious', 'critical'].includes(row.impact));
        expect(errors).toEqual([]);
        await page.evaluate(() => window.switchSettingsView('custom_instructions'));
        const header = page.locator('#settings-view-custom-instructions .help-modal-header');
        await expect.poll(() => header.evaluate(element => {
            const title = element.querySelector('.settings-modal-heading');
            const range = document.createRange(); range.selectNodeContents(title);
            const text = range.getBoundingClientRect();
            const back = element.firstElementChild.getBoundingClientRect();
            const done = element.lastElementChild.getBoundingClientRect();
            return Math.min(text.left - back.right, done.left - text.right);
        })).toBeGreaterThanOrEqual(0);
        expect(await header.evaluate(element => {
            const title = element.querySelector('.settings-modal-heading').getBoundingClientRect();
            const frame = element.getBoundingClientRect();
            return title.y >= frame.y && title.bottom <= frame.bottom;
        })).toBe(true);
        await page.screenshot({ path: info.outputPath(`custom-instructions-${width}.png`) });
    });
}
