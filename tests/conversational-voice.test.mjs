import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import handler, { __test as chat } from '../api/chat-groq.js';
import { conversationalVoiceDirective } from '../api/_lib/answer-preferences.js';

test('normal and fast replies share one grounded voice policy without canned jokes', () => {
    for (const intent of ['chat', 'fast_simple']) {
        const prompt = chat.buildServerSystemPrompt({}, intent);
        assert.equal(prompt.split('CONVERSATIONAL VOICE:').length, 2);
        assert.match(prompt, /AI disclaimers/);
        assert.match(prompt, /one short aside|brief self-directed wit/);
        assert.match(prompt, /recent dialogue/);
        assert.match(prompt, /Never invent|Do not invent/);
        assert.match(prompt, /[Ss]erious for distress/);
        assert.match(prompt, /claimed feelings\/experience|Never claim consciousness, emotions/);
        if (intent === 'fast_simple') assert.ok(prompt.length < 800, 'The fast path retains its latency budget');
        else assert.match(prompt, /Do not invent biography, businesses/);
        assert.doesNotMatch(prompt, /gut feeling|even have a gut|are you even serious/i);
    }
});

test('witty style is optional and formal custom instructions remain explicit in both reply paths', () => {
    assert.match(conversationalVoiceDirective({ responseStyle: 'witty' }), /user selected a witty style/);
    assert.match(conversationalVoiceDirective({ responseStyle: 'witty' }), /playful, low-stakes opinions/);
    assert.match(conversationalVoiceDirective({ responseStyle: 'witty' }, { compact: true }), /one contextual joke/);
    assert.match(conversationalVoiceDirective({ responseStyle: 'supportive' }), /selected supportive or analytical style/);
    for (const intent of ['chat', 'fast_simple']) {
        assert.ok(chat.buildServerSystemPrompt({ responseStyle: 'witty' }, intent).length < (intent === 'fast_simple' ? 800 : 4600));
        const prompt = chat.buildServerSystemPrompt({ responseStyle: 'witty', customSystemPrompt: 'Reply in formal Tamil. No jokes or slang.' }, intent);
        assert.match(prompt, /Honour requests for formality or no jokes|tone\/no-jokes instructions win/);
        assert.ok(prompt.indexOf('Reply in formal Tamil. No jokes or slang.') > prompt.indexOf('CONVERSATIONAL VOICE:'));
        assert.match(prompt, /current explicit user request takes precedence/);
    }
});

test('JSON and streaming opinion follow-ups receive their real context, voice and saved instructions without extra model calls', async () => {
    const names = ['GROQ_API_KEY', 'GROQ_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'JARVIS_QUALITY_CRITIC_ENABLED'];
    const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
    const original = globalThis.fetch;
    process.env.GROQ_API_KEY = 'test-groq';
    delete process.env.GROQ_KEY; delete process.env.GEMINI_API_KEY; delete process.env.GOOGLE_API_KEY;
    process.env.JARVIS_QUALITY_CRITIC_ENABLED = 'false';
    try {
        for (const stream of [false, true]) {
            const generations = [];
            globalThis.fetch = async (input, init) => {
                if (!String(input).includes('api.groq.com')) return Response.json({});
                const body = JSON.parse(init.body); generations.push(body);
                const text = 'Given your description, Seabrook suits quiet walks and cafes more than nightlife.';
                return body.stream ? new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } }) : Response.json({ choices: [{ message: { content: text } }] });
            };
            const question = 'What do you think of that place, bro?';
            const context = [{ role: 'user', text: 'Seabrook is a fictional town I am writing: quiet cafes, walkable streets, no nightlife.' }, { role: 'assistant', text: 'We are discussing your fictional Seabrook setting.' }];
            const req = Object.assign(new EventEmitter(), { method: 'POST', headers: { host: 'localhost', 'content-type': 'application/json' }, socket: { remoteAddress: '127.0.0.1' }, body: { message: question, intent: 'chat', webMode: 'off', stream, context, structuredMessages: [...context.map(row => ({ role: row.role, content: row.text })), { role: 'user', content: question }], contextReference: { status: 'resolved', candidates: [{ id: 'setting', label: 'Seabrook' }] }, preferences: { responseStyle: 'witty', customSystemPrompt: 'Use a formal tone. No jokes.' } } });
            const res = Object.assign(new EventEmitter(), { headers: {}, chunks: [], statusCode: 200, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; }, json(data) { this.data = data; this.writableEnded = true; return this; }, write(chunk) { this.chunks.push(chunk); }, end() { this.writableEnded = true; } });
            await handler(req, res);
            assert.equal(res.statusCode, 200); assert.equal(generations.length, 1);
            const messages = generations[0].messages;
            assert.match(messages[0].content, /CONVERSATIONAL VOICE:/);
            assert.match(messages[0].content, /Use a formal tone\. No jokes\./);
            assert.match(messages[0].content, /"status":"resolved"/);
            assert.ok(messages.some(row => /quiet cafes, walkable streets, no nightlife/.test(row.content)));
            assert.ok(messages.some(row => row.role === 'assistant' && /fictional Seabrook/.test(row.content)));
            assert.ok(messages.some(row => row.role === 'user' && row.content.includes(question)));
            assert.match(stream ? res.chunks.join('') : res.data.response, /Seabrook/);
        }
    } finally {
        globalThis.fetch = original;
        for (const name of names) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; }
    }
});
