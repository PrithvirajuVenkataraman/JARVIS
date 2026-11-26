import test from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import { permissionStates, requestPermissions } from '../app/permission-controller.js';
import { resolveDeviceLocation, formatLocation } from '../app/location-controller.js';
import { shouldAttachPaste } from '../app/paste-controller.js';
import { chunkText, selectDocumentText } from '../app/text-chunks.js';
import { hasCredentials } from '../app/text-safety.js';
import { selectExchanges, buildContext, cancel } from '../app/context-retrieval.js';
import { cacheOperation, saveSource } from '../app/recall-cache.js';
import { verifiedModelFetch, MODEL_ID, MODEL_REVISION } from '../app/recall-model.js';
import { evaluateArithmetic, verifyArithmeticClaims } from '../api/_lib/arithmetic.js';
import { verifyAndRepairMathClaims } from '../api/_lib/code-math-validator.js';
import { createAnswerFilter, publicAnswer } from '../api/_lib/answer-visibility.js';
import { normalizeUserInstructions, userPreferenceDirective } from '../api/_lib/answer-preferences.js';
import { filterCommands } from '../app/slash-command-controller.js';

test('slash names filter locally with capability isolation and deterministic ranking', () => {
    assert.deepEqual(filterCommands('SuM').map(row => row.id), ['summarize']);
    assert.deepEqual(filterCommands('pro').map(row => row.id), ['professional']);
    assert.deepEqual(filterCommands('mar').map(row => row.id), ['summarize']);
    assert.deepEqual(filterCommands('unavailable'), []);
    assert.deepEqual(filterCommands('image'), []);
    assert.equal(filterCommands('').length, 5);
});

test('permission setup reports partial grants, skips blocked devices, and releases every temporary track', async () => {
    const requested = [], changes = []; let stops = 0;
    const nav = {
        permissions: { query: async ({ name }) => ({ state: name === 'camera' ? 'denied' : 'prompt' }) },
        mediaDevices: { getUserMedia: async constraints => { requested.push(constraints); return { getTracks: () => [{ stop: () => stops++ }] }; } },
        geolocation: { getCurrentPosition: (_resolve, reject) => reject({ code: 1 }) }
    };
    const result = await requestPermissions({ nav, onState: (...args) => changes.push(args) });
    assert.deepEqual(result, { microphone: 'granted', camera: 'denied', geolocation: 'denied' });
    assert.deepEqual(requested, [{ audio: true }]); assert.equal(stops, 1);
    assert.ok(!changes.some(([name, state]) => name === 'geolocation' && state === 'granted'));
    assert.deepEqual(await permissionStates({}), { microphone: 'unavailable', camera: 'unavailable', geolocation: 'unavailable' });
});

test('dismissal releases a late stream and does not request the next permission', async () => {
    let active = true, finish, calls = 0, stopped = 0;
    const nav = { mediaDevices: { getUserMedia: () => { calls++; return new Promise(resolve => finish = resolve); } }, permissions: { query: async () => ({ state: 'prompt' }) } };
    const pending = requestPermissions({ nav, active: () => active });
    await new Promise(resolve => setTimeout(resolve, 0)); active = false;
    finish({ getTracks: () => [{ stop: () => stopped++ }] }); await pending;
    assert.equal(calls, 1); assert.equal(stopped, 1);
});

test('location uses one device fix and one name lookup; failure retains coordinates without IP fallback', async () => {
    let calls = 0, options;
    const nav = { geolocation: { getCurrentPosition: (success, _error, opts) => { options = opts; success({ coords: { latitude: 12.97, longitude: 77.59, accuracy: 20 } }); } } };
    const value = await resolveDeviceLocation({ nav, reverseUrl: 'https://example.test/reverse', fetchFn: async () => { calls++; throw new Error('Offline'); } });
    assert.equal(calls, 1); assert.equal(options.maximumAge, 30000);
    assert.equal(formatLocation(value), 'Location name unavailable.\nLatitude 12.97000, Longitude 77.59000');
    await assert.rejects(resolveDeviceLocation({ nav: { geolocation: { getCurrentPosition: (_ok, fail) => fail({ code: 1 }) } }, fetchFn: () => { throw new Error('No network call expected'); } }));
});

test('canceled location callbacks cannot provide a late result', async () => {
    let finish; const controller = new AbortController();
    const result = resolveDeviceLocation({ nav: { geolocation: { getCurrentPosition: success => finish = success } }, signal: controller.signal });
    controller.abort(); finish({ coords: { latitude: 1, longitude: 2 } });
    await assert.rejects(result, { name: 'AbortError' });
});

test('paste thresholds and chunking preserve Unicode, code, and math verbatim', () => {
    assert.equal(shouldAttachPaste('a'.repeat(7999)), false); assert.equal(shouldAttachPaste('a'.repeat(8000)), true);
    assert.equal(shouldAttachPaste(Array(80).fill('line').join('\n')), true);
    const source = 'தமிழ்\n'.repeat(1000) + '\n```js\n    const x = 42;\n```\n' + String.raw`\[\frac{1+x}{1+x^2}\]`;
    const chunks = chunkText(source);
    assert.equal(chunks.map(row => row.text).join(''), source);
    assert.ok(chunks.some(row => row.text.includes('```js\n    const x = 42;\n```')));
});

test('large-source selection discloses partial coverage and includes beginning, matching evidence, and end', () => {
    const text = 'BEGINNING\n' + Array.from({ length: 150 }, (_, i) => `${i === 80 ? 'UNIQUE contract termination evidence' : 'Section ' + i}\n${'Explanation '.repeat(200)}\n`).join('') + 'ENDING\n';
    const result = selectDocumentText(text, 'contract termination', 14000);
    assert.equal(result.partial, true); assert.ok(result.coverage < 1);
    assert.ok(result.text.includes('BEGINNING')); assert.ok(result.text.includes('ENDING')); assert.ok(result.text.includes('UNIQUE contract termination evidence'));
});

test('credentials beyond the DLP per-scan window and across slice boundaries are blocked', () => {
    const key = 'gsk_' + 'AbCdEf1234567890'.repeat(4);
    assert.equal(hasCredentials('Ordinary text.\n'.repeat(30000) + key), true);
    assert.equal(hasCredentials(' '.repeat(29990) + key + ' end'), true);
    assert.equal(hasCredentials('The API key must remain on the server.'), false);
});

test('earlier-exchange retrieval keeps evidence pairs and does not substitute arbitrary foundational turns', () => {
    const turns = [{ id: 'a', role: 'user', text: 'Discuss gardening' }, { role: 'assistant', text: 'Use healthy soil.' }, { id: 'b', role: 'user', text: 'Which database did we choose?' }, { role: 'assistant', text: 'We selected PostgreSQL for its relational constraints.' }];
    const result = selectExchanges(turns, 'database relational constraints');
    assert.equal(result.length, 2); assert.equal(result[0].id, 'b'); assert.match(result[1].text, /PostgreSQL/);
    assert.deepEqual(selectExchanges(turns, 'unrelated astrophysics'), []);
});

test('document cache uses session keys; clearing vectors preserves original sources', async () => {
    const original = globalThis.indexedDB; globalThis.indexedDB = indexedDB;
    try {
        await saveSource({ id: 'one:doc', sessionId: 'one', text: 'Private source one', updatedAt: 1 });
        await saveSource({ id: 'two:doc', sessionId: 'two', text: 'Private source two', updatedAt: 2 });
        await cacheOperation('vectors', 'put', { id: 'derived', vector: [1, 0] }); await cacheOperation('vectors', 'clear');
        const rows = await cacheOperation('sources', 'getAll', IDBKeyRange.bound('one:', 'one:\uffff'));
        assert.deepEqual(rows.map(row => row.text), ['Private source one']);
    } finally { globalThis.indexedDB = original; }
});

test('model asset fetch refuses arbitrary URLs and corrupted model bytes', async () => {
    let calls = 0;
    await assert.rejects(verifiedModelFetch('https://attacker.test/model.onnx', {}, { fetchFn: () => calls++ }), /Unexpected model source/);
    assert.equal(calls, 0);
    await assert.rejects(verifiedModelFetch(`https://huggingface.co/${MODEL_ID}/resolve/${MODEL_REVISION}/config.json`, {}, { fetchFn: async () => new Response('corrupted'), cache: null }), /verification failed/);
});

test('bounded arithmetic rejects executable expressions and reports unsupported proofs honestly', () => {
    assert.equal(evaluateArithmetic('2^3^2'), 512); assert.equal(evaluateArithmetic('-2^2'), -4);
    assert.equal(evaluateArithmetic(String.raw`\frac{1+2}{4} + \sqrt{9}`), 3.75);
    assert.equal(evaluateArithmetic('15% of 80'), 12);
    for (const expression of ['globalThis.process.exit()', 'Math.constructor(1)', 'sqrt(-1)', '1/0', '('.repeat(200)]) assert.equal(evaluateArithmetic(expression), null);
    assert.equal(verifyArithmeticClaims('$12 * 15 = 175$').status, 'failed');
    assert.equal(verifyArithmeticClaims('```js\n12 * 15 = 175\n```').status, 'unavailable');
    assert.equal(verifyArithmeticClaims(String.raw`\int x dx = x^2/2`).status, 'unavailable');
    const wrong = '$12 * 15 = 175$'; assert.equal(verifyAndRepairMathClaims(wrong).text, wrong);
});

test('split private-reasoning tags never enter visible answer deltas or final metadata', () => {
    const filter = createAnswerFilter();
    const output = ['<th', 'ink>private premises', '</thi', 'nk>Answer ', '42'].map(chunk => filter.push(chunk)).join('');
    assert.equal(output, 'Answer 42');
    const result = publicAnswer({ response: '<think>private</think>2 + 2 = 4', thought: 'private', reasoning_content: 'private' });
    assert.equal(result.response, '2 + 2 = 4'); assert.equal(result.verification.status, 'passed'); assert.equal(result.thought, undefined);
});

test('custom instructions are bounded preferences and credentials are excluded', () => {
    assert.equal(normalizeUserInstructions('a'.repeat(1500)).length, 1200);
    assert.match(userPreferenceDirective({ customSystemPrompt: 'Answer in Tamil, with concise steps.' }), /current explicit user request takes precedence/);
    assert.equal(normalizeUserInstructions('gsk_' + 'AbCdEf1234567890'.repeat(4)), '');
});

test('stopping during context preparation rejects the canceled turn before sending', async () => {
    const original = globalThis.Worker;
    globalThis.Worker = class { postMessage() {} terminate() {} };
    try {
        const result = buildContext({ getState: () => ({ turns: [] }), buildMultiTierContext: () => ({}) }, { message: 'Read the earlier context' });
        cancel();
        await assert.rejects(result, { name: 'AbortError' });
    } finally { globalThis.Worker = original; }
});
