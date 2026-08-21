import assert from 'node:assert/strict';
import {
    DataTracker,
    FactVerifier,
    IntegrityMonitor,
    JarvisDataVerification
} from '../app/data-tracking-verification.js';

console.log('--- Testing DataTracker ---');

// 1. Basic event tracking
const tracker = new DataTracker(10);
const ev1 = tracker.track('query_dispatched', { query: 'calculate flight travel time to tokyo' });
assert.ok(ev1.id.startsWith('tr_'));
assert.equal(ev1.name, 'query_dispatched');
assert.equal(ev1.payload.query, 'calculate flight travel time to tokyo');
assert.ok(ev1.timestamp > 0);

// 2. Timed span tracking
const endSpan = tracker.startSpan('retrieval_latency', { provider: 'duckduckgo' });
const ev2 = endSpan({ resultsCount: 4 });
assert.equal(ev2.name, 'retrieval_latency');
assert.equal(ev2.payload.provider, 'duckduckgo');
assert.equal(ev2.payload.resultsCount, 4);
assert.ok(typeof ev2.durationMs === 'number' && ev2.durationMs >= 0);

// 3. Pub/Sub subscription
let receivedEvents = [];
const unsubscribe = tracker.subscribe('model_synthesis', (event) => {
    receivedEvents.push(event);
});

tracker.track('other_event', { x: 1 });
assert.equal(receivedEvents.length, 0);

tracker.track('model_synthesis', { model: 'gemini-2.5-flash', tokens: 120 });
assert.equal(receivedEvents.length, 1);
assert.equal(receivedEvents[0].payload.model, 'gemini-2.5-flash');

// Wildcard subscriber
let allEvents = [];
const unsubWildcard = tracker.subscribe('all', (event) => {
    allEvents.push(event);
});

tracker.track('test_event_1', {});
tracker.track('test_event_2', {});
assert.equal(allEvents.length, 2);

unsubWildcard();
tracker.track('test_event_3', {});
assert.equal(allEvents.length, 2); // No new events after unsubscribe

unsubscribe();
tracker.track('model_synthesis', { model: 'llama-3.3-70b-versatile' });
assert.equal(receivedEvents.length, 1); // No new events after unsubscribe

// 4. Bounded buffer ring
for (let i = 0; i < 20; i++) {
    tracker.track(`flood_event_${i}`, { idx: i });
}
assert.ok(tracker.getRecentEvents(100).length <= 10);

console.log('--- Testing FactVerifier ---');

// 5. Empty response verification
const resEmpty = FactVerifier.verify('');
assert.equal(resEmpty.verified, false);
assert.equal(resEmpty.confidenceScore, 0.0);
assert.equal(resEmpty.confidenceTier, 'unverified');
assert.ok(resEmpty.riskFlags.includes('empty_response'));

// 6. Grounded response with trusted sources
const trustedSources = [
    { title: 'Reference', url: 'https://state.gov/leaders', sourceType: 'official_source' },
    { title: 'Review Source', url: 'https://en.wikipedia.org/wiki/State_Government' }
];
const resGrounded = FactVerifier.verify(
    'The council report outlines district budget allocations for the year.',
    trustedSources
);
assert.equal(resGrounded.verified, true);
assert.ok(resGrounded.confidenceScore >= 0.85);
assert.equal(resGrounded.confidenceTier, 'high');
assert.equal(resGrounded.sourceCount, 2);
assert.ok(resGrounded.verifiedDomains.includes('state.gov'));
assert.ok(resGrounded.verifiedDomains.includes('en.wikipedia.org'));

// 7. Ungrounded / uncertain response
const resUncertain = FactVerifier.verify(
    'I cannot verify the current standings at this moment.',
    []
);
assert.equal(resUncertain.verified, false);
assert.ok(resUncertain.confidenceScore < 0.50);
assert.ok(resUncertain.riskFlags.includes('model_uncertainty_declared'));
assert.ok(resUncertain.riskFlags.includes('no_citations_attached'));

// 8. Deterministic fact without sources
const resDeterministic = FactVerifier.verify(
    'The capital of France is Paris.',
    [],
    { isDeterministicFact: true }
);
assert.equal(resDeterministic.verified, true);
assert.equal(resDeterministic.confidenceTier, 'high');
assert.ok(resDeterministic.confidenceScore >= 0.90);

console.log('--- Testing IntegrityMonitor & Diagnostics ---');

// 9. Schema validation
const validObj = { userId: 'u1', action: 'click', timestamp: 12345 };
const valCheck1 = IntegrityMonitor.validatePayload(validObj, ['userId', 'action', 'timestamp']);
assert.equal(valCheck1.valid, true);
assert.equal(valCheck1.missing.length, 0);

const valCheck2 = IntegrityMonitor.validatePayload({ userId: 'u1' }, ['userId', 'action']);
assert.equal(valCheck2.valid, false);
assert.deepEqual(valCheck2.missing, ['action']);

// 10. Diagnostics Snapshot
const snapshot = JarvisDataVerification.getSnapshot();
assert.equal(snapshot.status, 'healthy');
assert.ok(typeof snapshot.totalEventsRecorded === 'number');
assert.ok(Array.isArray(snapshot.recentEvents));

console.log('data-tracking-verification-tests-ok');
