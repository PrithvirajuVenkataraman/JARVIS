import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => localStorage.setItem('jarvis_permission_intro_v1', 'true'));
    await page.route('https://**/*', route => route.abort());
    await page.goto('/'); await page.waitForFunction(() => window.__jarvisModernReady);
});

for (const width of [320, 390, 768, 1024, 1440]) test(`reduced-motion interface and readable composer at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
    await page.evaluate(() => window.setWebSearchMode('force'));
    await expect(page.locator('#composer-web-search-active')).toBeVisible();
    expect(await page.locator('.composer-web-outline').evaluate(element => getComputedStyle(element).animationName)).toBe('none');
    await page.locator('#composer-plus-btn').click();
    await expect(page.locator('#composer-actions-menu')).toBeVisible();
    expect(await page.evaluate(() => document.getAnimations().filter(animation => ['running', 'pending'].includes(animation.playState)).length)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const send = await page.locator('#send-message-btn').boundingBox();
    expect(send.width).toBeGreaterThanOrEqual(44); expect(send.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: info.outputPath(`static-${width}.png`), fullPage: true });
});

test('failed evidence retrieval finishes honestly without making a fallback chat generation', async ({ page }) => {
    let generations = 0, searches = 0;
    page.on('request', request => { if (request.url().endsWith('/api/chat-groq') && request.postDataJSON()?.stream) generations++; });
    await page.route('**/api/search', route => {
        if (route.request().postDataJSON()?.action) return route.fulfill({ json: { success: true, entity: null } });
        searches++;
        return route.fulfill({ status: 503, json: { success: false, error: { message: 'Search unavailable' } } });
    });
    await page.evaluate(() => window.setWebSearchMode('force'));
    await page.locator('#text-input').fill('Does the performer own a production company?'); await page.locator('#text-input').press('Enter');
    await expect(page.locator('.assistant-message-text').last()).toContainText(/could not finish|could not verify|could not complete|unavailable/i);
    await expect(page.locator('#request-status')).toHaveText(/finished|failed|unable|stopped/i);
    expect(searches).toBe(1); expect(generations).toBe(0);
});

test('partial factual answers retain uncertainty and source references without simulated typing', async ({ page }) => {
    const content = 'The performer is credited as a singer. [1]\n\nStill unverified: ownership of a production company.';
    await page.route('**/api/search', route => {
        if (route.request().postDataJSON()?.action) return route.fulfill({ json: { success: true, entity: null } });
        const source = { id: 1, title: 'Performer credits', url: 'https://example.com/credits', description: 'The performer is credited as a singer on the official credits page.' };
        return route.fulfill({ contentType: 'text/event-stream', body: `event: sources\ndata: ${JSON.stringify({ sources: [source] })}\n\nevent: done\ndata: ${JSON.stringify({ content, sources: [source], answerStatus: 'partial', verified: false, provenance: 'web_grounded', verificationScope: 'retrieved_passages' })}\n\n` });
    });
    await page.evaluate(() => window.setWebSearchMode('force'));
    await page.locator('#text-input').fill('What does singer Rowan Vale do and which businesses does Rowan Vale own?'); await page.locator('#text-input').press('Enter');
    await expect(page.locator('.assistant-message-text').last()).toContainText('Still unverified: ownership');
    expect(await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running').length)).toBe(0);
});
