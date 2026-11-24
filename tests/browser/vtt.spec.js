import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
        localStorage.setItem('jarvis_permission_intro_v1', 'true');
        window.__recognitions = []; window.__recorders = []; window.__micRequests = 0;
        class Recognition {
            constructor() { window.__recognitions.push(this); }
            start() { this.onstart?.(); }
            stop() { this.stopped = true; }
            abort() { this.onend?.(); }
            emit(text, isFinal = true) { const result = [{ transcript: text }]; result.isFinal = isFinal; this.onresult?.({ resultIndex: 0, results: [result] }); }
        }
        window.SpeechRecognition = window.webkitSpeechRecognition = Recognition;
        Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => {
            window.__micRequests++;
            const track = { enabled: true, readyState: 'live', stop() { this.readyState = 'ended'; } };
            window.__lastTrack = track;
            return { active: true, getTracks: () => [track], getAudioTracks: () => [track] };
        } } });
        window.MediaRecorder = class {
            static isTypeSupported(type) { return type === 'audio/webm'; }
            constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm'; window.__recorders.push(this); }
            start() { this.state = 'recording'; }
            stop() { this.state = 'inactive'; queueMicrotask(() => { this.ondataavailable?.({ data: new Blob(['test audio'], { type: this.mimeType }) }); this.onstop?.(); }); }
        };
    });
    await page.route('https://**/*', route => route.abort());
    await page.goto('/'); await page.waitForFunction(() => window.__jarvisModernReady);
});

test('native dictation preserves the typed prefix and final words after Stop without auto-sending', async ({ page }) => {
    const calls = []; page.on('request', request => { if (request.url().endsWith('/api/chat-groq')) calls.push(request); });
    const prefix = 'keep f(x) [1, 2], ill and ID:';
    const input = page.locator('#text-input'), mic = page.locator('#voice-to-text-btn');
    await input.fill(prefix); await mic.click();
    await expect(mic).toHaveAttribute('aria-pressed', 'true');
    await page.evaluate(() => window.__recognitions.at(-1).emit('um hello', false));
    await expect(input).toHaveValue(`${prefix} Hello`);
    await mic.click(); await expect(mic).toHaveAttribute('aria-pressed', 'false');
    await page.evaluate(() => { const rec = window.__recognitions.at(-1); rec.emit('hello there', true); rec.onend?.(); });
    await expect(input).toHaveValue(`${prefix} Hello there`);
    expect(calls).toHaveLength(0); await expect(page.locator('.chat-row')).toHaveCount(0);
    expect(await page.evaluate(() => window.__recognitions.at(-1).lang)).toBe('en-US');
});

test('manual edits cancel a pending native final result', async ({ page }) => {
    const input = page.locator('#text-input'), mic = page.locator('#voice-to-text-btn');
    await mic.click(); await page.evaluate(() => window.__recognitions.at(-1).emit('temporary words', false));
    await mic.click(); await input.fill('My edited text');
    await page.evaluate(() => { const rec = window.__recognitions.at(-1); rec.emit('obsolete final words', true); rec.onend?.(); });
    await expect(input).toHaveValue('My edited text');
});

test('denied microphone permission leaves an honest status and permits a single-click retry', async ({ page }) => {
    const mic = page.locator('#voice-to-text-btn');
    await mic.click(); await page.evaluate(() => window.__recognitions.at(-1).onerror({ error: 'not-allowed' }));
    await expect(mic).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#speech-input-status')).toContainText('permission was denied');
    expect(await page.evaluate(() => window.__micRequests)).toBe(0);
    await mic.click(); await expect(mic).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => window.__recognitions.length)).toBe(2);
    await page.evaluate(() => window.JarvisSpeechInput.stop({ disableConverse: true, cancelled: true }));
});

test('fallback recording releases the mic and writes the transcript only after completion', async ({ page }) => {
    const requests = []; let release;
    const pending = new Promise(resolve => { release = resolve; });
    await page.route('**/api/stt', async route => { requests.push(route.request().postDataJSON()); await pending; await route.fulfill({ json: { success: true, text: 'whisper recognized voice full stop' } }).catch(() => {}); });
    const mic = page.locator('#voice-to-text-btn'), input = page.locator('#text-input');
    await input.fill('Typed prefix:'); await mic.click();
    await page.evaluate(() => window.__recognitions.at(-1).onerror({ error: 'network' }));
    await expect.poll(() => page.evaluate(() => window.__recorders.length)).toBe(1);
    expect(await page.evaluate(() => window.JarvisSpeechInput.getState().mode)).toBe('dictation');
    await mic.click(); await expect.poll(() => requests.length).toBe(1);
    await expect(page.locator('#speech-input-status')).toHaveText('Transcribing voice...');
    expect(await page.evaluate(() => window.__lastTrack.readyState)).toBe('ended');
    expect(requests[0].mimeType).toBe('audio/webm'); expect(requests[0].audioBase64).toBeTruthy();
    release(); await expect(input).toHaveValue('Typed prefix: Whisper recognized voice.');
    await expect(page.locator('.chat-row')).toHaveCount(0);
});

test('typing while a fallback transcript is pending preserves the edit and ignores the stale response', async ({ page }) => {
    let release, finished; const pending = new Promise(resolve => { release = resolve; }), done = new Promise(resolve => { finished = resolve; });
    let calls = 0;
    await page.route('**/api/stt', async route => { calls++; await pending; try { await route.fulfill({ json: { success: true, text: 'Obsolete transcript.' } }); } catch {} finally { finished(); } });
    const mic = page.locator('#voice-to-text-btn'), input = page.locator('#text-input');
    await mic.click(); await page.evaluate(() => window.__recognitions.at(-1).onerror({ error: 'network' }));
    await expect.poll(() => page.evaluate(() => window.__recorders.length)).toBe(1);
    await mic.click(); await expect.poll(() => calls).toBe(1);
    await input.fill('Keep this new draft'); release(); await done;
    await expect(input).toHaveValue('Keep this new draft');
    expect(await page.evaluate(() => window.JarvisSpeechInput.getState().transcribing)).toBe(false);
});

test('recognized Unicode is retained without claiming a different recognition language', async ({ page }) => {
    await page.locator('#voice-to-text-btn').click();
    await page.evaluate(() => window.__recognitions.at(-1).emit('வணக்கம் நண்பரே', true));
    await expect(page.locator('#text-input')).toHaveValue('வணக்கம் நண்பரே');
    expect(await page.evaluate(() => window.__recognitions.at(-1).lang)).toBe('en-US');
    await page.evaluate(() => window.JarvisSpeechInput.stop({ disableConverse: true, cancelled: true }));
});

test('Escape and leaving the page cancel capture without sending final recorder chunks', async ({ page }) => {
    const requests = []; page.on('request', request => { if (request.url().endsWith('/api/stt')) requests.push(request); });
    const mic = page.locator('#voice-to-text-btn');
    await mic.click(); await page.keyboard.press('Escape');
    await expect(mic).toHaveAttribute('aria-pressed', 'false');
    await mic.click(); await page.evaluate(() => window.__recognitions.at(-1).onerror({ error: 'network' }));
    await expect.poll(() => page.evaluate(() => window.__recorders.length)).toBe(1);
    await page.evaluate(() => dispatchEvent(new Event('pagehide')));
    await expect(mic).toHaveAttribute('aria-pressed', 'false');
    expect(await page.evaluate(() => window.__lastTrack.readyState)).toBe('ended');
    expect(requests).toHaveLength(0);
});
