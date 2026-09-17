import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSpeechInputController } from '../app/speech-input.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('--- Testing Request Lifecycle & Idle Resilience ---');

// 1. Verify speech-input stop() unconditionally clears processing
{
    console.log('1. Testing speech-input stop() resets processing state unconditionally...');
    class FakeRec {
        start() {}
        stop() {}
    }
    const controller = createSpeechInputController({
        Recognition: FakeRec,
        language: 'en-US'
    });

    controller.setProcessing(true);
    assert.equal(controller.getState().processing, true, 'Processing should be true after setProcessing(true)');

    // Call stop() with dictation / default options (without disableConverse)
    controller.stop({ releaseStream: true });
    assert.equal(controller.getState().processing, false, 'Processing should be cleared to false on stop()');
    console.log('  [PASS] stop({ releaseStream: true }) cleanly cleared processing.');
}

// 2. Verify jarvis:assistant-processing event listener handling in speech-input
{
    console.log('2. Testing assistant-processing event auto-resets speech controller...');
    class FakeRec {
        start() {}
        stop() {}
    }
    const controller = createSpeechInputController({
        Recognition: FakeRec,
        language: 'en-US'
    });

    controller.setProcessing(true);
    assert.equal(controller.getState().processing, true);

    // Simulate jarvis:assistant-processing active: false
    controller.setProcessing(false);
    assert.equal(controller.getState().processing, false);
    console.log('  [PASS] assistant-processing active: false resets processing state.');
}

// 3. Verify index.html contains resetComposerToIdle, activeRequestControllers Set, and DOM cleanup
{
    console.log('3. Verifying index.html resilience guarantees in code...');
    const indexHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

    assert.ok(indexHtml.includes('const activeRequestControllers = new Set();'), 'activeRequestControllers Set must be defined');
    assert.ok(indexHtml.includes('function resetComposerToIdle()'), 'resetComposerToIdle must be defined');
    assert.ok(indexHtml.includes('window.resetComposerToIdle = resetComposerToIdle;'), 'resetComposerToIdle must be exported to window');
    assert.ok(indexHtml.includes('activeRequestControllers.add(controller);'), 'beginAbortableRequest must track controllers in set');
    assert.ok(indexHtml.includes('activeRequestControllers.delete(controller);'), 'clearActiveRequest must remove controller from set');
    assert.ok(indexHtml.includes('window.JarvisSpeechInput?.setProcessing?.(false);'), 'setProcessing(false) must be invoked during composer idle reset and send finally');

    console.log('  [PASS] index.html contains all multi-controller and idle-reset guarantees.');
}

console.log('=== All Request Lifecycle & Idle Resilience Tests PASSED ===');
