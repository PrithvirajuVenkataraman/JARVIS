import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

test('Safari & iOS Support 1: isAbortError catches WebKit "Fetch is aborted", TimeoutError, and cancellations', () => {
    // Extract isAbortError from index.html
    const isAbortErrorMatch = indexHtml.match(/function isAbortError\(error\)\s*\{([\s\S]*?)\n\s*\}/);
    assert.ok(isAbortErrorMatch, 'isAbortError must be defined in index.html');
    const isAbortError = new Function('error', isAbortErrorMatch[1]);

    // 1. WebKit / Safari iOS exact error format:
    const webkitFetchAborted = new Error('Fetch is aborted');
    webkitFetchAborted.name = 'AbortError';
    assert.equal(isAbortError(webkitFetchAborted), true, 'Must identify WebKit "Fetch is aborted"');

    // 2. Safari operation was aborted:
    const safariAborted = new Error('The operation was aborted.');
    safariAborted.name = 'AbortError';
    assert.equal(isAbortError(safariAborted), true, 'Must identify Safari "The operation was aborted."');

    // 3. Native TimeoutError (Safari 16+ AbortSignal.timeout):
    const timeoutErr = new Error('The operation timed out.');
    timeoutErr.name = 'TimeoutError';
    assert.equal(isAbortError(timeoutErr), true, 'Must identify TimeoutError');

    // 4. Custom isTimeout/timedOut flags:
    assert.equal(isAbortError({ isTimeout: true }), true, 'Must identify error.isTimeout');
    assert.equal(isAbortError({ timedOut: true }), true, 'Must identify error.timedOut');

    // 5. Cancelled variations (iOS network loss / app switch):
    assert.equal(isAbortError(new Error('Request cancelled by user')), true, 'Must identify cancelled');
    assert.equal(isAbortError(new Error('Connection canceled')), true, 'Must identify canceled');

    // 6. Non-abort errors must NOT be false positives:
    assert.equal(isAbortError(new Error('Failed to parse JSON')), false, 'Must not falsely flag parse errors');
    assert.equal(isAbortError(null), false, 'Must handle null cleanly');
    assert.equal(isAbortError(undefined), false, 'Must handle undefined cleanly');
});

test('Safari & iOS Support 2: createSafeTimeoutSignal runs without AbortSignal.any or AbortSignal.timeout', async () => {
    // Extract createSafeTimeoutSignal from index.html
    const fnMatch = indexHtml.match(/function createSafeTimeoutSignal\(timeoutMs,\s*externalSignal\)\s*\{([\s\S]*?)\n\}\s*\nasync function fetchLiveSearchJson/);
    assert.ok(fnMatch, 'createSafeTimeoutSignal must be defined in index.html');
    const createSafeTimeoutSignal = new Function('timeoutMs', 'externalSignal', fnMatch[1]);

    // Case A: Basic timeout triggers abort when timer fires
    const { signal: sig1, cleanup: clean1 } = createSafeTimeoutSignal(50, null);
    assert.equal(sig1.aborted, false, 'Signal must be active initially');
    await new Promise(r => setTimeout(r, 80));
    assert.equal(sig1.aborted, true, 'Signal must be aborted after timeout');
    clean1();

    // Case B: Cleanup cancels timer before timeout occurs
    const { signal: sig2, cleanup: clean2 } = createSafeTimeoutSignal(150, null);
    assert.equal(sig2.aborted, false);
    clean2(); // Cancel timer
    await new Promise(r => setTimeout(r, 200));
    assert.equal(sig2.aborted, false, 'Signal must remain non-aborted after cleanup cancelled timer');

    // Case C: External signal abort forwards cleanly (Safari 16/17 compatibility without AbortSignal.any)
    const parentController = new AbortController();
    const { signal: sig3, cleanup: clean3 } = createSafeTimeoutSignal(500, parentController.signal);
    assert.equal(sig3.aborted, false);
    parentController.abort('user_stopped');
    assert.equal(sig3.aborted, true, 'Signal must be aborted when parent controller aborts');
    clean3();

    // Case D: Already aborted external signal aborts immediately
    const preAborted = new AbortController();
    preAborted.abort('already_aborted');
    const { signal: sig4, cleanup: clean4 } = createSafeTimeoutSignal(500, preAborted.signal);
    assert.equal(sig4.aborted, true, 'Signal must be immediately aborted for already-aborted parent');
    clean4();
});

test('Safari & iOS Support 3: fetchLiveSearchJson defaults provide at least 7.5s - 9.5s budget', () => {
    // Verify fetchLiveSearchJson implementation in index.html
    assert.ok(
        indexHtml.includes('defaultTimeout = Boolean(options.answer) ? 9500 : 7500'),
        'fetchLiveSearchJson must provide 9500ms when answer synthesis requested, 7500ms otherwise'
    );
    assert.ok(
        indexHtml.includes('Math.max(Number(options.timeoutMs) || defaultTimeout, 6000)'),
        'searchTimeout must ensure at least 6000ms minimum floor on mobile networks'
    );
    assert.ok(
        indexHtml.includes('const { signal, cleanup } = createSafeTimeoutSignal(searchTimeout, options.signal)'),
        'fetchLiveSearchJson must use createSafeTimeoutSignal for iOS Safari WebKit safety'
    );
    assert.ok(
        indexHtml.includes('cleanup();'),
        'fetchLiveSearchJson must always clean up timers in finally block'
    );
});

test('Safari & iOS Support 4: handleLiveRetrievalQuery does NOT re-throw search abort errors', () => {
    // Verify handleLiveRetrievalQuery does not have the old bug: `if (!didBudgetTimeout) throw searchErr;`
    assert.ok(
        !indexHtml.includes('if (!didBudgetTimeout) throw searchErr;'),
        'Must NOT re-throw searchErr when search times out or aborts'
    );
    assert.ok(
        indexHtml.includes('logRoutingDebug(\'handler fallback: search_timeout_reached\''),
        'Must log search_timeout_reached and set answerData = null for smooth fallback'
    );
});

test('Safari & iOS Support 5: BoundedLiveResearchController recognizes AbortError and abort strings as timeouts', () => {
    const boundedSrc = fs.readFileSync(path.join(__dirname, '../app/bounded-live-research.js'), 'utf8');
    assert.ok(
        boundedSrc.includes("err?.name === 'AbortError'"),
        'BoundedLiveResearchController must recognize AbortError as timeout'
    );
    assert.ok(
        boundedSrc.includes("errStr.includes('abort')"),
        'BoundedLiveResearchController must recognize abort message as timeout'
    );
});
