import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import handler from '../api/chat-groq.js';
import { personProfileReply } from '../api/_lib/person-profile.js';

function response() {
    return Object.assign(new EventEmitter(), { headers: {}, statusCode: 200, chunks: [], setHeader(k, v) { this.headers[k] = v; }, getHeader(k) { return this.headers[k]; }, status(code) { this.statusCode = code; return this; }, json(data) { this.data = data; this.writableEnded = true; return this; }, write(chunk) { this.chunks.push(chunk); }, end() { this.writableEnded = true; } });
}
function request(body) { return Object.assign(new EventEmitter(), { method: 'POST', headers: { host: 'localhost', 'content-type': 'application/json' }, socket: { remoteAddress: '127.0.0.1' }, body }); }
function sourceFetch(calls, name, text) {
    return async input => {
        const url = new URL(input); calls.push(url.hostname);
        if (url.hostname === 'en.wikipedia.org') return Response.json({ query: { pages: [{ title: name, pageprops: { wikibase_item: 'Q80001' }, redirects: [{ title: `${name} (actor)` }], extract: text, fullurl: `https://en.wikipedia.org/wiki/${name.replaceAll(' ', '_')}` }] } });
        if (url.hostname === 'www.wikidata.org') return Response.json({ claims: { P31: [{ mainsnak: { datavalue: { value: { id: 'Q5' } } } }] } });
        assert.fail('A sourced short profile must not call an inference provider or invent extra details');
    };
}

test('JSON and streaming profile requests return attributed evidence without model-invented businesses', async () => {
    const original = globalThis.fetch;
    try {
        for (const stream of [false, true]) {
            const name = stream ? 'Stream Source Person' : 'Json Source Person'; const calls = [];
            globalThis.fetch = sourceFetch(calls, name, `${name} is an actor and singer. The first lead role was in an independently produced film.`);
            const res = response(); await handler(request({ message: `Actor ${name}`, stream }), res);
            const data = stream ? res.chunks.flatMap(chunk => String(chunk).split('\n').filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5)))).find(row => row.sourceBased === true) : res.data;
            assert.equal(res.statusCode, 200); assert.equal(data.intent, 'person_profile'); assert.equal(data.sourceBased, true);
            assert.match(data.response, /actor and singer/); assert.match(data.response, /Source: Wikipedia/);
            assert.equal(data.sources[0].url, `https://en.wikipedia.org/wiki/${name.replaceAll(' ', '_')}`);
            assert.doesNotMatch(data.response, /production house|owns a studio|Vijay Studio/);
            assert.ok(calls.every(host => ['en.wikipedia.org', 'www.wikidata.org'].includes(host)));
        }
    } finally { globalThis.fetch = original; }
});

test('missing profile sources produce an honest unavailable answer, not an ungrounded model fallback', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async input => { assert.match(String(input), /en\.wikipedia\.org/); return Response.json({ query: { pages: [] } }); };
    try { const result = await personProfileReply('Actor Unknown Example'); assert.equal(result.failureCode, 'profile_source_unavailable'); assert.equal(result.sourceBased, false); assert.match(result.response, /could not verify/); }
    finally { globalThis.fetch = original; }
});

test('truncated source introductions stop after the last complete sentence', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = sourceFetch([], 'Truncated Source Person', 'Truncated Source Person is an actor. The first lead role was in an independently produced film. A later movie was called Unfin...');
    try {
        const result = await personProfileReply('Actor Truncated Source Person');
        assert.equal(result.sourceBased, true);
        assert.match(result.response, /independently produced film\.\n\n\[Source:/);
        assert.doesNotMatch(result.response, /Unfin/);
    } finally { globalThis.fetch = original; }
});

test('source text is inert Markdown data and attachment/creative requests retain their existing routes', async () => {
    const original = globalThis.fetch; const calls = [];
    globalThis.fetch = sourceFetch(calls, 'Inert Source Person', 'Inert Source Person is an actor. :::image[untrusted prompt]::: <img src=x onerror=alert(1)>');
    try {
        const result = await personProfileReply('Actor Inert Source Person');
        assert.equal(result.sourceBased, true); assert.doesNotMatch(result.response, /:::image|<img/);
        assert.equal(await personProfileReply('Actor Inert Source Person', { images: [{}] }), null);
        assert.equal(await personProfileReply('Create a fictional actor biography'), null);
        assert.equal(await personProfileReply('Explain the above'), null);
    } finally { globalThis.fetch = original; }
});

test('disconnecting a profile request aborts the lookup without caching a false source failure', async () => {
    const original = globalThis.fetch;
    let started; const waiting = new Promise(resolve => { started = resolve; });
    globalThis.fetch = (_url, init) => new Promise((_resolve, reject) => {
        started(init.signal);
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    });
    try {
        const req = request({ message: 'Actor Canceled Source Person', stream: true });
        const res = response(); const task = handler(req, res);
        const signal = await waiting; req.aborted = true; req.emit('aborted');
        await task;
        assert.equal(signal.aborted, true); assert.deepEqual(res.chunks, []); assert.equal(res.data, undefined);
        globalThis.fetch = sourceFetch([], 'Canceled Source Person', 'Canceled Source Person is an actor.');
        assert.equal((await personProfileReply('Actor Canceled Source Person')).sourceBased, true);
    } finally { globalThis.fetch = original; }
});
