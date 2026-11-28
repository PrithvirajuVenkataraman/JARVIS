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
            emit(text, isFinal = true) {
                this.results ||= [];
                const index = this.results.at(-1)?.isFinal ? this.results.length : Math.max(0, this.results.length - 1);
                const result = [{ transcript: text }]; result.isFinal = isFinal; this.results[index] = result;
                this.onresult?.({ resultIndex: index, results: this.results });
            }
        }
        window.SpeechRecognition = window.webkitSpeechRecognition = localStorage.getItem('__test_recorder_only') === 'true' ? undefined : Recognition;
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
    await expect(input).toBeVisible(); await expect(input).toBeEditable();
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

test('rapid Stop and restart preserves late native final words without duplicating the draft', async ({ page }) => {
    const input = page.locator('#text-input'), mic = page.locator('#voice-to-text-btn');
    await input.fill('Keep this:'); await mic.click();
    await page.evaluate(() => window.__recognitions[0].emit('first', false));
    const stop = await page.evaluate(async () => {
        const start = performance.now(); await window.toggleVoiceToText();
        return { elapsed: performance.now() - start, pressed: document.getElementById('voice-to-text-btn').getAttribute('aria-pressed') };
    });
    expect(stop.elapsed).toBeLessThan(100); expect(stop.pressed).toBe('false');
    await mic.click(); await expect(input).toHaveValue('Keep this: First');
    await page.evaluate(() => { window.__recognitions[0].emit('first thought.', true); window.__recognitions[0].onend?.(); });
    await expect.poll(() => page.evaluate(() => window.__recognitions.length)).toBe(2);
    await page.evaluate(() => window.__recognitions[1].emit('second thought.', true));
    await expect(input).toHaveValue('Keep this: First thought. Second thought.');
    await mic.click(); await page.evaluate(() => window.__recognitions[1].onend?.());
    await expect(page.locator('.chat-row')).toHaveCount(0);
});

test('Stop retains the unfinished tail when no final recognition result arrives', async ({ page }) => {
    const input = page.locator('#text-input'), mic = page.locator('#voice-to-text-btn');
    await mic.click();
    await page.evaluate(() => { const rec = window.__recognitions[0]; rec.emit('First thought.', true); rec.emit('second thought', false); });
    await expect(input).toHaveValue('First thought. Second thought');
    await mic.click(); await expect(mic).toHaveAttribute('aria-busy', 'false');
    await expect(input).toHaveValue('First thought. Second thought');
});

test('an older Whisper response inserts before newer native words and never replaces them', async ({ page }) => {
    let release; const pending = new Promise(resolve => { release = resolve; }); let calls = 0;
    await page.route('**/api/stt', async route => { calls++; await pending; await route.fulfill({ json: { success: true, text: 'First thought.' } }).catch(() => {}); });
    const input = page.locator('#text-input'), mic = page.locator('#voice-to-text-btn');
    await input.fill('Keep this:'); await mic.click();
    await page.evaluate(() => window.__recognitions[0].onerror({ error: 'network' }));
    await expect.poll(() => page.evaluate(() => window.__recorders.length)).toBe(1);
    await mic.click(); await expect.poll(() => calls).toBe(1);
    await mic.click(); await page.evaluate(() => window.__recognitions.at(-1).emit('second thought.', true));
    await expect(input).toHaveValue('Keep this: Second thought.');
    release(); await expect(input).toHaveValue('Keep this: First thought. Second thought.');
    await expect(mic).toHaveAttribute('aria-pressed', 'true');
    await page.evaluate(() => window.JarvisSpeechInput.stop({ cancelled: true }));
});

test('recorder-only browsers retain both recordings when their transcripts finish in reverse order', async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('__test_recorder_only', 'true'));
    await page.reload(); await page.waitForFunction(() => window.__jarvisModernReady);
    const requests = [], release = [];
    await page.route('**/api/stt', async route => {
        const index = requests.length; requests.push(route.request());
        await new Promise(resolve => { release[index] = resolve; });
        await route.fulfill({ json: { success: true, text: index === 0 ? 'First thought.' : 'Second thought.' } }).catch(() => {});
    });
    const input = page.locator('#text-input'), mic = page.locator('#voice-to-text-btn');
    await input.fill('Draft:');
    await mic.click(); await mic.click(); await expect.poll(() => requests.length).toBe(1);
    await mic.click(); await mic.click(); await expect.poll(() => requests.length).toBe(2);
    release[1](); await expect(input).toHaveValue('Draft: Second thought.');
    release[0](); await expect(input).toHaveValue('Draft: First thought. Second thought.');
    await expect(mic).toHaveAttribute('aria-busy', 'false');
    expect(await page.evaluate(() => window.JarvisSpeechInput.getState().pendingCount)).toBe(0);
});

test('a failed older clip reports its error without switching off the current microphone', async ({ page }) => {
    let release, calls = 0; const pending = new Promise(resolve => { release = resolve; });
    await page.route('**/api/stt', async route => { calls++; await pending; await route.fulfill({ status: 503, json: { success: false, fallbackToBrowser: true } }).catch(() => {}); });
    const mic = page.locator('#voice-to-text-btn'), input = page.locator('#text-input');
    await mic.click(); await page.evaluate(() => window.__recognitions[0].onerror({ error: 'network' }));
    await expect.poll(() => page.evaluate(() => window.__recorders.length)).toBe(1);
    await mic.click(); await expect.poll(() => calls).toBe(1); await mic.click();
    await page.evaluate(() => window.__recognitions.at(-1).emit('Keep recording.', true));
    release(); await expect(page.locator('#speech-input-status')).toContainText('temporarily unavailable');
    await expect(mic).toHaveAttribute('aria-pressed', 'true'); await expect(input).toHaveValue('Keep recording.');
    await page.evaluate(() => window.JarvisSpeechInput.stop({ cancelled: true }));
});

test('editing the draft cancels both an old upload and the new native capture', async ({ page }) => {
    let release, calls = 0; const pending = new Promise(resolve => { release = resolve; });
    await page.route('**/api/stt', async route => { calls++; await pending; await route.fulfill({ json: { success: true, text: 'Obsolete first thought.' } }).catch(() => {}); });
    const mic = page.locator('#voice-to-text-btn'), input = page.locator('#text-input');
    await mic.click(); await page.evaluate(() => window.__recognitions[0].onerror({ error: 'network' }));
    await expect.poll(() => page.evaluate(() => window.__recorders.length)).toBe(1);
    await mic.click(); await expect.poll(() => calls).toBe(1); await mic.click();
    await page.evaluate(() => window.__recognitions.at(-1).emit('Temporary words.', true));
    await input.fill('My edited draft'); release();
    await page.evaluate(() => window.__recognitions.at(-1).emit('Obsolete final words.', true));
    await expect(input).toHaveValue('My edited draft'); await expect(mic).toHaveAttribute('aria-pressed', 'false');
    expect(await page.evaluate(() => window.JarvisSpeechInput.getState().pendingCount)).toBe(0);
});

test('sending typed text while transcription is pending cannot leak the late transcript into the next draft', async ({ page }) => {
    let release, calls = 0; const pending = new Promise(resolve => { release = resolve; });
    await page.route('**/api/stt', async route => { calls++; await pending; await route.fulfill({ json: { success: true, text: 'Obsolete recording.' } }).catch(() => {}); });
    const mic = page.locator('#voice-to-text-btn'), input = page.locator('#text-input');
    await mic.click(); await page.evaluate(() => window.__recognitions[0].onerror({ error: 'network' }));
    await expect.poll(() => page.evaluate(() => window.__recorders.length)).toBe(1);
    await mic.click(); await expect.poll(() => calls).toBe(1);
    await input.fill('Explain how to use substitution to evaluate integrals');
    await page.locator('#send-message-btn').click(); await expect(page.locator('.assistant-message-text')).toHaveCount(1);
    await input.fill('Fresh unsent draft'); release();
    await expect(input).toHaveValue('Fresh unsent draft');
    expect(await page.evaluate(() => window.JarvisSpeechInput.getState().pendingCount)).toBe(0);
});

test('New chat cancels pending dictation rather than inserting it into the new conversation', async ({ page }) => {
    let release, calls = 0; const pending = new Promise(resolve => { release = resolve; });
    await page.route('**/api/stt', async route => { calls++; await pending; await route.fulfill({ json: { success: true, text: 'Words from the previous chat.' } }).catch(() => {}); });
    const mic = page.locator('#voice-to-text-btn'), input = page.locator('#text-input');
    await mic.click(); await page.evaluate(() => window.__recognitions[0].onerror({ error: 'network' }));
    await expect.poll(() => page.evaluate(() => window.__recorders.length)).toBe(1);
    await mic.click(); await expect.poll(() => calls).toBe(1);
    await page.getByRole('button', { name: 'Open sidebar', exact: true }).click();
    await page.getByRole('button', { name: 'New chat', exact: true }).click(); release();
    await expect(input).toHaveValue(''); await expect(page.locator('.chat-row')).toHaveCount(0);
    expect(await page.evaluate(() => window.JarvisSpeechInput.getState().pendingCount)).toBe(0);
});

test.describe('touch dictation', () => {
    test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
    test('phone taps stop and resume dictation while preserving an editable draft', async ({ page }) => {
        const input = page.locator('#text-input'), mic = page.locator('#voice-to-text-btn');
        await mic.tap(); await page.evaluate(() => window.__recognitions[0].emit('First thought.', true));
        await expect(input).toBeVisible(); await mic.tap();
        await page.evaluate(() => window.__recognitions[0].onend?.());
        await mic.tap(); await page.evaluate(() => window.__recognitions.at(-1).emit('Second thought.', true));
        await expect(input).toHaveValue('First thought. Second thought.');
        await mic.tap(); await page.evaluate(() => window.__recognitions.at(-1).onend?.());
        await expect(mic).toHaveAttribute('aria-pressed', 'false');
        await expect(input).toBeEditable();
    });
});

test('Send waits for the complete voice draft and sends it exactly once', async ({ page }) => {
    let release, calls = 0; const pending = new Promise(resolve => { release = resolve; });
    await page.route('**/api/stt', async route => { calls++; await pending; await route.fulfill({ json: { success: true, text: 'Also include error handling.' } }).catch(() => {}); });
    const sent = [];
    page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/chat-groq')) sent.push(request.postDataJSON()); });
    const input = page.locator('#text-input'), mic = page.locator('#voice-to-text-btn');
    await mic.click();
    await page.evaluate(() => { const rec = window.__recognitions[0]; rec.emit('Explain how to write a parser.', true); rec.onerror({ error: 'network' }); });
    await expect.poll(() => page.evaluate(() => window.__recorders.length)).toBe(1);
    await mic.click(); await expect.poll(() => calls).toBe(1);
    await page.locator('#send-message-btn').click();
    await expect(page.locator('#send-message-btn')).toBeDisabled();
    await expect(page.locator('#send-message-btn')).toHaveAttribute('aria-label', 'Finishing voice input');
    await input.press('Enter'); expect(sent).toHaveLength(0);
    release(); await expect.poll(() => sent.filter(body => body.stream).length).toBe(1);
    expect(sent.find(body => body.stream).message).toBe('Explain how to write a parser. Also include error handling.');
    await expect(input).toHaveValue('');
});

test('editing while Send waits cancels that submission and preserves the corrected draft', async ({ page }) => {
    let release, calls = 0; const pending = new Promise(resolve => { release = resolve; });
    await page.route('**/api/stt', async route => { calls++; await pending; await route.fulfill({ json: { success: true, text: 'Obsolete words.' } }).catch(() => {}); });
    const sent = []; page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/chat-groq')) sent.push(request); });
    const input = page.locator('#text-input'), mic = page.locator('#voice-to-text-btn');
    await input.fill('Keep this draft:'); await mic.click();
    await page.evaluate(() => window.__recognitions[0].onerror({ error: 'network' }));
    await expect.poll(() => page.evaluate(() => window.__recorders.length)).toBe(1);
    await mic.click(); await expect.poll(() => calls).toBe(1); await page.locator('#send-message-btn').click();
    await expect(page.locator('#send-message-btn')).toBeDisabled();
    await input.fill('My corrected unsent draft'); release();
    await expect(input).toHaveValue('My corrected unsent draft');
    await expect(page.locator('#send-message-btn')).toBeEnabled();
    expect(sent).toHaveLength(0);
});
