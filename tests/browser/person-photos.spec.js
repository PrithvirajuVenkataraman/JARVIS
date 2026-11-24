import { test, expect } from '@playwright/test';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const entity = { name: 'Ada Lovelace', isPerson: true, image: { url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Test-portrait.png', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Test-portrait.png', sourceName: 'Wikimedia Commons', imageDate: '2024-06-04', author: '<img src=x onerror="window.__photoXss=1">', license: 'CC BY 4.0', width: 100, height: 120 } };
test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('jarvis_permission_intro_v1', 'true'));
    await page.route('https://**/*', route => route.abort());
    await page.route('https://upload.wikimedia.org/**', route => route.fulfill({ contentType: 'image/png', body: png }));
    await page.goto('/'); await page.waitForFunction(() => window.__jarvisModernReady);
});

async function answer(page, query = 'Who is Ada Lovelace?') {
    return page.evaluate(query => {
        const id = window.createStreamingAssistantMessage({ userMessage: query });
        window.finalizeStreamingAssistantMessage(id, 'Ada Lovelace was a mathematician and writer.', { userMessage: query });
        return id;
    }, query);
}

test('person photos arrive independently after the answer and retain source, date, attribution and related works', async ({ page }) => {
    let release;
    const ready = new Promise(resolve => { release = resolve; }); let requests = 0;
    await page.route('**/api/search', async route => {
        if (route.request().postDataJSON()?.action !== 'person_photo') return route.continue();
        requests++; await ready; await route.fulfill({ json: { success: true, entity } }).catch(() => {});
    });
    await answer(page);
    await expect(page.locator('.assistant-message-text').last()).toContainText('mathematician');
    await expect.poll(() => requests).toBe(1);
    await expect(page.locator('.person-photo')).toHaveCount(0);
    await page.evaluate(() => {
        const bubble = document.querySelector('.chat-bubble-assistant');
        const container = document.createElement('div'); container.className = 'chat-entity-visual-container';
        container.innerHTML = '<div class="entity-hero-card">Old portrait</div><div class="notable-works-section"><a href="https://example.com">Work reference</a></div>';
        bubble.querySelector('.assistant-message-text').before(container);
    });
    release();
    await expect(page.locator('.person-photo-image')).toBeVisible();
    await expect(page.locator('.person-photo figcaption')).toContainText('Image dated 2024-06-04');
    await expect(page.locator('.person-photo figcaption')).toContainText('CC BY 4.0');
    await expect(page.locator('.person-photo figcaption a')).toHaveAttribute('href', entity.image.sourceUrl);
    await expect(page.getByText('Work reference', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.__photoXss)).toBeUndefined();
    await expect(page.locator('.person-photo [onerror]')).toHaveCount(0);
});

test('stopping a turn cancels photo enrichment and prevents a late image from changing that answer', async ({ page }) => {
    let release; const ready = new Promise(resolve => { release = resolve; }); let requested = false;
    await page.route('**/api/search', async route => {
        if (route.request().postDataJSON()?.action !== 'person_photo') return route.continue();
        requested = true; await ready; await route.fulfill({ json: { success: true, entity } }).catch(() => {});
    });
    await answer(page); await expect.poll(() => requested).toBe(true);
    await page.evaluate(() => window.stopActiveGeneration()); release();
    await page.waitForTimeout(150);
    await expect(page.locator('.person-photo')).toHaveCount(0);
    await expect(page.locator('.assistant-message-text').last()).toContainText('mathematician');
});

test('reference portraits are labelled honestly and vague follow-ups do not request unrelated people', async ({ page }) => {
    let requests = 0;
    await page.route('**/api/search', route => {
        if (route.request().postDataJSON()?.action !== 'person_photo') return route.continue();
        requests++; return route.fulfill({ json: { success: true, entity: { ...entity, image: { ...entity.image, imageDate: null } } } });
    });
    await answer(page); await expect(page.locator('.person-photo figcaption')).toContainText('Reference portrait');
    await answer(page, 'What was it?'); await page.waitForTimeout(100);
    expect(requests).toBe(1); await expect(page.locator('.person-photo')).toHaveCount(1);
});

test('a fresh role-qualified query renders media even when there is no prior conversation reference', async ({ page }) => {
    let query;
    await page.route('**/api/search', route => {
        const body = route.request().postDataJSON();
        if (body?.action !== 'person_photo') return route.continue();
        query = body.query; return route.fulfill({ json: { success: true, entity } });
    });
    await page.evaluate(() => {
        const userMessage = 'Actor Example Person';
        const id = window.createStreamingAssistantMessage({ userMessage });
        window.finalizeStreamingAssistantMessage(id, 'A short sourced profile.', { userMessage, contextReference: { status: 'missing', evidenceIds: [] } });
    });
    await expect(page.locator('.person-photo-image')).toBeVisible(); expect(query).toBe('Actor Example Person');
});

for (const width of [768, 1024, 1440]) {
    test(`Automatic is centered within its dropdown on a ${width}px laptop/tablet viewport`, async ({ page }, info) => {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(() => window.showHelpModal());
        const select = page.locator('.settings-select'); await expect(select).toBeVisible();
        await expect(select).toHaveValue('auto'); await expect(select).toHaveCSS('text-align-last', 'center');
        const padding = await select.evaluate(element => { const style = getComputedStyle(element); return [style.paddingLeft, style.paddingRight]; });
        expect(padding[0]).toBe(padding[1]);
        await select.screenshot({ path: info.outputPath(`automatic-${width}.png`), animations: 'disabled' });
    });
}
