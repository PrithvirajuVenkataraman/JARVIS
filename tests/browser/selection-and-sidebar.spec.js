import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('jarvis_permission_intro_v1', 'true'));
    await page.route('https://**/*', route => route.abort());
    await page.route('**/api/chat-groq', route => {
        const body = route.request().postDataJSON();
        const response = 'A source-supported statement is safer than an invented production-house claim.';
        return body.stream
            ? route.fulfill({ contentType: 'text/event-stream', body: `event: delta\ndata: ${JSON.stringify({ text: response })}\n\nevent: done\ndata: ${JSON.stringify({ success: true, response, provider: 'public_sources', sourceBased: true })}\n\n` })
            : route.fulfill({ json: { success: true, response: 'Source profile' } });
    });
    await page.goto('/');
    await page.waitForFunction(() => window.__jarvisModernReady);
});

async function ask(page, message) {
    await page.locator('#text-input').fill(message);
    await page.locator('#text-input').press('Enter');
    await expect(page.locator('#request-status')).toHaveText('Response finished.');
}

test('chat menus, rename on blur, and keyboard restore work under the strict CSP', async ({ page }) => {
    const violations = [];
    page.on('console', message => { if (/inline event handler/i.test(message.text())) violations.push(message.text()); });
    await ask(page, 'First source profile.');
    await page.evaluate(() => window.startNewChatSession());
    await ask(page, 'Second source profile.');
    await page.getByRole('button', { name: 'Open sidebar', exact: true }).click();
    const rows = page.locator('.chat-session-row');
    await expect(rows).toHaveCount(2);
    await rows.first().click({ button: 'right' });
    await expect(page.locator('#chat-session-menu')).toBeVisible();
    await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
    await page.locator('.chat-session-title-input').fill('Renamed on blur');
    const otherId = await rows.last().getAttribute('data-chat-id');
    await rows.last().getByRole('button', { name: 'Chat actions', exact: true }).click();
    await expect(page.locator('.chat-session-title-input')).toHaveCount(0);
    await expect(page.locator('.chat-session-title').filter({ hasText: 'Renamed on blur' })).toHaveCount(1);
    await expect(page.locator('#chat-session-menu')).toBeVisible();
    await page.getByRole('menuitem', { name: 'Pin', exact: true }).click();
    await expect(page.locator(`.chat-session-row[data-chat-id="${otherId}"]`)).toHaveClass(/is-pinned/);
    const renamed = page.locator('.chat-session-row').filter({ hasText: 'Renamed on blur' });
    const renamedId = await renamed.getAttribute('data-chat-id');
    await renamed.focus(); await renamed.press('Enter');
    await expect(page.locator('.chat-session-row.is-active')).toHaveAttribute('data-chat-id', renamedId);
    await page.setViewportSize({ width: 390, height: 844 });
    await renamed.focus(); await renamed.press('Space');
    await expect(page.locator('#chat-sidebar-panel')).toBeHidden();
    expect(violations).toEqual([]);
});

test('a touch long press opens the chat menu without the following click restoring the chat', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await ask(page, 'Touch source profile.');
    await page.getByRole('button', { name: 'Open sidebar', exact: true }).click();
    const row = page.locator('.chat-session-row').first();
    await row.dispatchEvent('pointerdown', { pointerType: 'touch', bubbles: true });
    await expect(page.locator('#chat-session-menu')).toBeVisible();
    await row.dispatchEvent('pointerup', { pointerType: 'touch', bubbles: true });
    await row.dispatchEvent('click', { bubbles: true });
    await expect(page.locator('#chat-session-menu')).toBeVisible();
    await page.getByRole('menuitem', { name: 'Pin', exact: true }).click();
    await expect(page.locator('.chat-session-row').first()).toHaveClass(/is-pinned/);
});

test('selection actions stay readable and preserve the selected context at phone, tablet, and desktop widths', async ({ page }) => {
    await ask(page, 'Explain source evidence.');
    await expect(page.locator('.assistant-model-badge')).toHaveCount(0);
    for (const width of [320, 390, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.locator('.assistant-message-text').last().evaluate(element => {
            const range = document.createRange(); range.selectNodeContents(element.querySelector('p') || element);
            const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
            element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        });
        const popover = page.locator('#selection-helper-popover');
        const button = popover.getByRole('button', { name: 'Ask about selection', exact: true });
        await expect(button).toBeVisible();
        const bounds = await popover.boundingBox(); const hit = await button.boundingBox();
        expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
        expect(hit.height).toBeGreaterThanOrEqual(44);
        expect(await button.textContent()).not.toContain('✨');
        await page.screenshot({ path: `scratch/selection-${test.info().project.name}-${width}.png` });
        await page.keyboard.press('Escape'); await expect(popover).toBeHidden();
    }
    await page.locator('.assistant-message-text').last().evaluate(element => {
        const range = document.createRange(); range.selectNodeContents(element.querySelector('p') || element);
        getSelection().removeAllRanges(); getSelection().addRange(range);
        element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await page.getByRole('button', { name: 'Ask about selection', exact: true }).click();
    await expect(page.locator('#composer-selection-tray')).toContainText('source-supported statement');
    await expect(page.locator('#text-input')).toBeFocused();
    await expect(page.locator('#text-input')).toHaveAttribute('placeholder', 'Ask a question about this text...');
    await expect(page.locator('#selection-helper-popover')).toBeHidden();
});
