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

