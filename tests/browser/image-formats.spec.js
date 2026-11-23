import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import * as magick from '@imagemagick/magick-wasm';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const fixtures = new Map();
test.beforeAll(async () => {
    await magick.initializeImageMagick(new Uint8Array(fs.readFileSync(new URL('../../node_modules/@imagemagick/magick-wasm/dist/x86/magick.wasm', import.meta.url))));
    for (const format of ['TIFF', 'PSD', 'AVIF', 'JXL', 'JP2']) fixtures.set(format, magick.ImageMagick.read(png, image => image.write(format, bytes => Buffer.from(bytes))));
    const heic = process.env.JARVIS_HEIC_TEST_FILE || 'scratch/image-fixtures/example.heic';
    if (fs.existsSync(heic)) fixtures.set('HEIC', fs.readFileSync(heic));
});
test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('jarvis_permission_intro_v1', 'true'));
    await page.route('https://**/*', route => route.abort());
    await page.goto('/'); await page.waitForFunction(() => window.__jarvisModernReady === true);
});
test.use({ serviceWorkers: 'block' });

test('native uploads avoid the decoder, uncommon formats convert locally', async ({ page }) => {
    test.setTimeout(90000);
    const wasm = [], upstream = [];
    page.on('request', request => { if (request.url().endsWith('.wasm')) wasm.push(request.url()); if (request.method() === 'POST') upstream.push(request.url()); });
    const input = page.locator('#composer-photo-library-input');
    await input.setInputFiles({ name: 'normal.png', mimeType: 'image/png', buffer: png });
    await expect(page.locator('.composer-attachment-chip')).toHaveCount(1);
    expect(wasm).toEqual([]);
    for (const [format, bytes] of fixtures) {
        await page.evaluate(() => window.JarvisAttachments.clearPendingAttachments());
        await input.setInputFiles({ name: `image.${format.toLowerCase()}`, mimeType: 'application/octet-stream', buffer: bytes });
        await expect.poll(() => page.evaluate(() => window.JarvisAttachments.getPendingAttachments().length), { timeout: 45000 }).toBe(1);
        const prepared = await page.evaluate(() => { const file = window.JarvisAttachments.getPendingAttachments()[0]; return { mime: file.mimeType, name: file.preparedName, size: file.preparedSize, original: file.file.size }; });
        expect(prepared.mime).toMatch(/^image\/(jpeg|png)$/);
        expect(prepared.name).toMatch(/\.(jpg|png)$/);
        expect(prepared.original).toBe(bytes.length);
        await expect.poll(() => page.locator('.composer-attachment-thumb').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
    }
    expect(wasm.length).toBeGreaterThan(0); expect(upstream).toEqual([]);
});

test('real Nikon NEF prepares as JPEG without uploading RAW', async ({ page }) => {
    test.setTimeout(90000);
    const raw = process.env.JARVIS_RAW_TEST_FILE || 'scratch/image-fixtures/nikon-d1.nef';
    test.skip(!fs.existsSync(raw), 'Optional public RAW fixture: see tests/image-codecs.test.mjs.');
    await page.locator('#composer-photo-library-input').setInputFiles({ name: 'DSC_0035.NEF', mimeType: 'image/x-nikon-nef', buffer: fs.readFileSync(raw) });
    await expect.poll(() => page.evaluate(() => window.JarvisAttachments.getPendingAttachments().map(file => file.preparedName)), { timeout: 45000 }).toEqual(['DSC_0035.jpg']);
    expect(await page.evaluate(() => window.JarvisAttachments.getPendingAttachments()[0].mimeType)).toBe('image/jpeg');
    await expect.poll(() => page.locator('.composer-attachment-thumb').evaluate(image => image.complete && image.naturalWidth === 1600)).toBe(true);
});

test('free image card handles queue, completion, download type and Stop', async ({ page }, info) => {
    const submissions = []; const methods = []; let done = false;
    await page.route('https://aihorde.net/api/v2/**', route => {
        const request = route.request(); methods.push(request.method());
        if (request.url().endsWith('/async')) { submissions.push(request.postDataJSON()); return route.fulfill({ json: { id: '12345678-1234-1234-1234-123456789abc' } }); }
        if (request.url().includes('/check/')) return route.fulfill({ json: { done, wait_time: 20, queue_position: 2 } });
        return route.fulfill({ json: { generations: [{ img: png.toString('base64'), model: 'community' }] } });
    });
    await page.waitForFunction(() => window.JarvisCapabilities.isAvailable('images'));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => { window.__imageTask = window.handleImageGenerationRequest('Draw a quiet forest'); });
    const card = page.locator('.free-image-card').last();
    await expect(card).toContainText('Waiting for an available image worker');
    await card.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(card).toContainText('Image creation stopped.');
    await expect.poll(() => methods.filter(method => method === 'DELETE').length).toBe(1);
    expect(submissions).toHaveLength(1);
    done = true;
    await card.getByRole('button', { name: 'Retry' }).click();
    const complete = page.locator('.free-image-card').last();
    await expect(complete.locator('img')).toBeVisible();
    await expect(page.locator('.chat-row[data-role="assistant"]')).toHaveCount(1);
    expect(await page.evaluate(async () => (await window.JarvisImageStorage.getRecentGeneratedImages()).some(image => image.dataUrl?.startsWith('data:image/png;base64,')))).toBe(true);
    const image = complete.locator('img');
    const menu = page.getByRole('menu', { name: 'Image actions', exact: true });
    await expect(complete.locator('.free-image-actions')).toHaveCount(0);
    await expect(complete.locator('button:visible')).toHaveCount(0);
    await expect(menu).toBeHidden();
    await image.click({ button: 'right' });
    await expect(menu.getByRole('menuitem')).toHaveText(['Copy', 'Download']);
    const downloadEvent = page.waitForEvent('download');
    await menu.getByRole('menuitem', { name: 'Download', exact: true }).click();
    expect((await downloadEvent).suggestedFilename()).toMatch(/\.png$/);
    await expect(menu).toBeHidden(); await expect(image).toBeFocused();
    await image.press('Shift+F10'); await expect(menu.getByRole('menuitem', { name: 'Copy', exact: true })).toBeFocused();
    await page.keyboard.press('ArrowDown'); await expect(menu.getByRole('menuitem', { name: 'Download', exact: true })).toBeFocused();
    await page.keyboard.press('Escape'); await expect(image).toBeFocused(); await expect(menu).toBeHidden();
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        write: async items => { const blob = await items[0].getType('image/png'); window.__copiedImage = { type: blob.type, bytes: [...new Uint8Array(await blob.arrayBuffer())].slice(0, 4) }; }
    } }));
    await image.press('Shift+F10'); await menu.getByRole('menuitem', { name: 'Copy', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__copiedImage)).toEqual({ type: 'image/png', bytes: [137, 80, 78, 71] });
    const pointer = { pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, clientX: 180, clientY: 170 };
    await image.dispatchEvent('pointerdown', pointer); await image.dispatchEvent('pointermove', { ...pointer, clientY: 200 });
    await page.waitForTimeout(550); await expect(menu).toBeHidden(); await image.dispatchEvent('pointercancel', pointer);
    await image.dispatchEvent('pointerdown', pointer);
    await expect(menu).toBeVisible(); await image.dispatchEvent('pointerup', pointer);
    await image.dispatchEvent('click'); await expect(page.locator('#image-lightbox-overlay')).not.toHaveClass(/is-open/);
    await page.keyboard.press('Escape');
    for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 844 });
        await image.press('Shift+F10'); await expect(menu).toBeVisible();
        const box = await menu.boundingBox(); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
        for (const button of await menu.getByRole('menuitem').all()) expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(44);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.keyboard.press('Escape');
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await image.click(); await expect(page.locator('#image-lightbox-overlay')).toHaveClass(/is-open/);
    await expect(page.locator('#image-lightbox-overlay .image-lightbox-toolbar')).toBeHidden();
    const preview = page.locator('#image-lightbox-img');
    await expect.poll(() => preview.evaluate(element => element.complete && element.naturalWidth > 0 && !element.closest('[inert]'))).toBe(true);
    await preview.focus(); await expect(preview).toBeFocused();
    await preview.press('Shift+F10'); await expect(menu).toBeVisible();
    await page.keyboard.press('Escape'); await expect(menu).toBeHidden();
    await expect(page.locator('#image-lightbox-overlay')).toHaveClass(/is-open/);
    await page.keyboard.press('Escape'); await expect(page.locator('#image-lightbox-overlay')).not.toHaveClass(/is-open/);
    await image.focus();
    await image.press('Shift+F10');
    await page.screenshot({ path: info.outputPath('free-image-mobile.png'), fullPage: true });
});

test('capacity errors use a compact status and respect the server cooldown without automatic retries', async ({ page }, info) => {
    const submissions = [];
    await page.route('https://aihorde.net/api/v2/**', route => {
        if (route.request().url().endsWith('/async')) {
            submissions.push(route.request().postDataJSON());
            if (submissions.length === 1) return route.fulfill({ status: 429, headers: { 'Retry-After': '2', 'Access-Control-Expose-Headers': 'Retry-After' }, json: { message: 'Busy' } });
            return route.fulfill({ json: { id: '12345678-1234-1234-1234-123456789abc' } });
        }
        return route.fulfill({ json: route.request().url().includes('/check/') ? { done: true } : { generations: [{ img: png.toString('base64') }] } });
    });
    await page.waitForFunction(() => window.JarvisCapabilities.isAvailable('images'));
    await page.evaluate(() => { window.__capacityTask = window.handleImageGenerationRequest('Draw Times Square'); });
    const card = page.locator('.free-image-card').last();
    await expect(card).toHaveAttribute('data-image-state', 'error');
    await expect(card).toContainText('Image creation is busy right now.');
    await expect(card.getByRole('button', { name: 'Retry shortly', exact: true })).toBeDisabled();
    for (const width of [320, 390, 1440]) {
        await page.setViewportSize({ width, height: 844 });
        const box = await card.locator('.image-gen-viewport').boundingBox();
        expect(box.height).toBeLessThan(180);
        expect(await card.locator('.image-gen-viewport').evaluate(element => getComputedStyle(element).borderTopWidth)).toBe('0px');
    }
    expect(submissions).toHaveLength(1);
    const retry = card.getByRole('button', { name: 'Retry', exact: true });
    await expect(retry).toBeEnabled();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: info.outputPath('capacity-status-mobile.png'), fullPage: true });
    await retry.click(); await expect(page.locator('.free-image-card').last().locator('img')).toBeVisible();
    expect(submissions).toHaveLength(2); expect(submissions[1].prompt).toBe(submissions[0].prompt);
});
