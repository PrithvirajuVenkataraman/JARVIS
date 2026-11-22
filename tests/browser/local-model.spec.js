import { test, expect } from '@playwright/test';

test('optional local model runs real semantic recall and reopens from verified cached weights', async ({ page, context, browserName }, info) => {
    test.skip(process.env.JARVIS_REAL_MODEL_TEST !== 'true', 'Opt-in public model download; run explicitly.');
    test.setTimeout(180000);
    await page.addInitScript(() => localStorage.setItem('jarvis_permission_intro_v1', 'true'));
    const logs = [];
    page.on('console', message => { if (message.type() === 'error') logs.push(message.text()); });
    page.on('pageerror', error => logs.push(error.message));
    await page.goto('/'); await page.waitForFunction(() => window.__jarvisModernReady);
    const init = (target = page) => target.evaluate(async () => {
        try { await window.JarvisRecall.callWorker('initialize', {}, 150000); return { state: window.JarvisRecall.getStatus() }; }
        catch (error) { return { error: error.message }; }
    });
    const initialized = await init();
    await info.attach('local-model-init', { body: JSON.stringify({ initialized, logs }), contentType: 'application/json' });
    expect(initialized).toEqual({ state: 'ready' });
    const records = [{ id: '0', text: 'A physician treats people at a medical clinic.', order: 0 }, { id: '1', text: 'We booked train tickets for a mountain holiday.', order: 1 }];
    await page.evaluate(records => window.JarvisRecall.callWorker('search', { records, query: 'Which person provides healthcare?' }), records);
    await expect.poll(() => page.evaluate(async records => {
        const result = await window.JarvisRecall.callWorker('search', { records, query: 'Which person provides healthcare?' });
        return result.records[0]?.score > 0 ? result.records[0].id : null;
    }, records), { timeout: 30000 }).toBe('0');
    await context.route('https://huggingface.co/**', route => route.abort());
    await page.close();
    const reopened = await context.newPage();
    await reopened.goto('/'); await reopened.waitForFunction(() => window.__jarvisModernReady);
    expect(await init(reopened)).toEqual({ state: 'ready' });
    if (browserName === 'chromium') {
        await context.setOffline(true);
        await reopened.reload(); await reopened.waitForFunction(() => window.__jarvisModernReady);
        expect(await init(reopened)).toEqual({ state: 'ready' });
    }
});
