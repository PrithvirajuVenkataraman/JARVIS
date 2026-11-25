import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import handler from '../api/chat-groq.js';
import { upstreamAttemptSummary } from '../api/_lib/model-failure.js';

function response() {
    return Object.assign(new EventEmitter(), { headers: {}, chunks: [], statusCode: 200, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; }, json(data) { this.data = data; this.writableEnded = true; return this; }, write(chunk) { this.chunks.push(chunk); }, end() { this.writableEnded = true; } });
}

test('chat reserves both model attempts for the answer instead of consuming them on search planning', async () => {
    const names = ['GROQ_API_KEY', 'GEMINI_API_KEY', 'LIVE_RETRIEVAL_ENABLED', 'CHAT_ROUTER_MODE', 'SEARCH_GEMINI_GROUNDING_FREE_ALLOWANCE'];
    const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
    const original = globalThis.fetch;
    Object.assign(process.env, { GROQ_API_KEY: 'test-groq', GEMINI_API_KEY: 'test-gemini', LIVE_RETRIEVAL_ENABLED: 'true', CHAT_ROUTER_MODE: 'adaptive', SEARCH_GEMINI_GROUNDING_FREE_ALLOWANCE: 'true' });
    try {
        for (const [stream, webMode] of [[false, 'off'], [true, 'off'], [false, 'auto'], [false, 'force']]) {
            const generations = [], lookups = [];
            globalThis.fetch = async (input, init = {}) => {
                const url = new URL(input);
                if (/generativelanguage\.googleapis\.com|api\.groq\.com/.test(url.hostname)) {
                    generations.push({ host: url.hostname, body: JSON.parse(init.body), path: url.pathname });
                    if (url.hostname === 'generativelanguage.googleapis.com') return Response.json({ error: { message: 'temporarily unavailable' } }, { status: 503 });
                    return JSON.parse(init.body).stream
                        ? new Response('data: {"choices":[{"delta":{"content":"ready"}}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
                        : Response.json({ choices: [{ message: { content: 'ready' } }] });
                }
                lookups.push(url.hostname);
                return Response.json({});
            };
            const req = Object.assign(new EventEmitter(), { method: 'POST', headers: { host: 'localhost', 'content-type': 'application/json' }, socket: { remoteAddress: '127.0.0.1' }, body: { message: 'Reply with the single word ready.', intent: 'fast_simple', stream, webMode, preferences: { selectedModel: 'auto' } } });
            const res = response(); await handler(req, res);
            assert.equal(res.statusCode, 200);
            if (webMode === 'force') {
                assert.equal(generations.length, 0, 'Empty retrieval cannot consume generation quota or fall back to unsupported knowledge');
                assert.equal(res.data.answerStatus, 'unavailable');
                assert.equal(res.data.verified, false);
                assert.ok(lookups.length > 0, 'Forced search still retrieves public evidence');
                continue;
            }
            assert.equal(generations.length, 3, `Two Gemini attempts plus one Groq failover for ${webMode}/${stream}`);
            assert.match(generations[0].path, /gemini-4-hydrogen/);
            assert.match(generations[1].path, /gemini-3\.8-flash/);
            assert.equal(generations[2].host, 'api.groq.com');
            assert.equal(generations[0].body.tools, undefined, 'Chat retrieval must not spend quota on Google Search grounding');
            if (webMode === 'off') assert.ok(!lookups.some(host => /news\.|duckduckgo|searx|gdelt/.test(host)), 'Web off must disable live-first as well as search routes');
            if (webMode === 'force') assert.ok(lookups.length > 0, 'Forced search still retrieves public evidence');
            const payload = stream ? res.chunks.flatMap(chunk => String(chunk).split('\n').filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5)))).find(row => row.provider === 'groq') : res.data;
            assert.equal(payload.provider, 'groq'); assert.match(payload.response, /ready/i);
            assert.equal(payload.upstreamAttempts[0].status, 503);
        }
    } finally {
        globalThis.fetch = original;
        for (const name of names) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; }
    }
});

test('an exhausted application budget is never reported as an upstream network failure', () => {
    assert.deepEqual(upstreamAttemptSummary([{ code: 'attempt_budget_exhausted' }]), [{ status: 0, reasonCode: 'attempt_budget_exhausted' }]);
});
