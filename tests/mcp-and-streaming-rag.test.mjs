import test from 'node:test';
import assert from 'node:assert/strict';
import handler, {
    MCP_TOOL_DEFINITIONS,
    planDynamicSearchQueries,
    handleStreamingWebRag
} from '../api/search.js';

function createMockRes() {
    let statusCode = 200;
    let headers = {};
    let body = null;
    let chunks = [];
    let isEnded = false;

    return {
        writeHead(code, h) {
            statusCode = code;
            headers = { ...headers, ...h };
            return this;
        },
        status(code) {
            statusCode = code;
            return this;
        },
        setHeader(name, val) {
            headers[name] = val;
            return this;
        },
        json(data) {
            body = data;
            isEnded = true;
            return this;
        },
        write(chunk) {
            chunks.push(chunk);
            return true;
        },
        end(data) {
            if (data) chunks.push(data);
            isEnded = true;
            return this;
        },
        get statusCode() { return statusCode; },
        get headers() { return headers; },
        get body() { return body; },
        get chunks() { return chunks; },
        get isEnded() { return isEnded; },
        get emittedText() { return chunks.join(''); }
    };
}

test('MCP: Tool definitions exist and conform to MCP standard schema', () => {
    assert.ok(Array.isArray(MCP_TOOL_DEFINITIONS));
    assert.equal(MCP_TOOL_DEFINITIONS.length, 2);

    const names = MCP_TOOL_DEFINITIONS.map(t => t.name);
    assert.ok(names.includes('web_search'));
    assert.ok(names.includes('web_fetch'));

    for (const tool of MCP_TOOL_DEFINITIONS) {
        assert.ok(typeof tool.name === 'string');
        assert.ok(typeof tool.description === 'string');
        assert.ok(typeof tool.inputSchema === 'object');
        assert.equal(tool.inputSchema.type, 'object');
        assert.ok(Array.isArray(tool.inputSchema.required));
    }
});

test('MCP: tools/list discovery endpoint via handler', async () => {
    const req = {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: { method: 'tools/list' }
    };
    const res = createMockRes();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.body?.tools));
    assert.equal(res.body.tools.length, 2);
    assert.equal(res.body.tools[0].name, 'web_search');
    assert.equal(res.body.tools[1].name, 'web_fetch');
});

test('MCP: tools/call web_search executes and returns valid content', async () => {
    const req = {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: {
            method: 'tools/call',
            params: {
                name: 'web_search',
                arguments: {
                    query: 'Steam refund policy 2026',
                    limit: 3
                }
            }
        }
    };
    const res = createMockRes();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.isError, false);
    assert.ok(Array.isArray(res.body?.content));
    assert.equal(res.body.content[0].type, 'text');
    const parsedResults = JSON.parse(res.body.content[0].text);
    assert.ok(Array.isArray(parsedResults));
});

test('MCP: tools/call web_fetch extracts content without crashing', async () => {
    const req = {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: {
            method: 'tools/call',
            params: {
                name: 'web_fetch',
                arguments: {
                    url: 'https://help.steampowered.com/en/faqs/view/4F84-B4F2-487E-F08C'
                }
            }
        }
    };
    const res = createMockRes();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.body?.content));
    assert.equal(res.body.content[0].type, 'text');
    assert.ok(typeof res.body.content[0].text === 'string');
});

test('Dynamic Query Planner: Decomposes complex prompt into clean search targets', async () => {
    const complexPrompt = `Compare the official refund policies and developer revenue-split models of Steam, Epic Games Store, and the PlayStation Network as of 2026.`;
    const queries = await planDynamicSearchQueries(complexPrompt);

    assert.ok(Array.isArray(queries));
    assert.ok(queries.length >= 1 && queries.length <= 10);
    for (const q of queries) {
        assert.ok(typeof q === 'string');
        assert.ok(q.trim().length > 3);
        // Ensure no canned rejection text is returned
        assert.ok(!q.includes('did not return verified records'));
    }
});

test('Streaming Web RAG: Emits ChatGPT-style SSE events and terminates with done', async () => {
    const req = {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: {
            stream: true,
            query: 'Steam refund policy playtime limit',
            limit: 4
        }
    };
    const res = createMockRes();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.isEnded, true);
    assert.ok(res.headers['Content-Type'].includes('text/event-stream'));

    const text = res.emittedText;
    assert.ok(text.includes('event: status'));
    assert.ok(text.includes('event: sources'));
    assert.ok(text.includes('event: done'));
    assert.ok(!text.includes('Please try rephrasing your search query'));
});
