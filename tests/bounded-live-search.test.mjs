import test from 'node:test';
import assert from 'node:assert/strict';
import {
    BoundedLiveResearchController,
    normalizeResearchSources,
    formatSourcesForPrompt,
    generateSnippetFallback,
    generateRelatedResearchQuestions,
    parseCitationsInHtml
} from '../app/bounded-live-research.js';
import { parseGoogleNewsRssXml } from '../api/_lib/free-live/providers.js';
import { buildSourceTransparencyHtml } from '../app/source-transparency.js';

test('BoundedLiveResearchController - Normal Fast Completion', async () => {
    const controller = new BoundedLiveResearchController({
        searchCutoffMs: 2500,
        fallbackWarningMs: 8500,
        hardDeadlineMs: 9000
    });

    let sourcesReceived = null;
    let streamCompleted = null;

    await controller.execute({
        query: 'What is the current Artemis mission status?',
        userText: 'What is the current Artemis mission status?',
        assistantMessageId: 'msg_test_1',
        fetchSearchFn: async () => {
            await new Promise(r => setTimeout(r, 100));
            return {
                results: [
                    { title: 'NASA Artemis Updates', url: 'https://nasa.gov/artemis', snippet: 'Artemis II is scheduled for launch.' }
                ]
            };
        },
        streamSynthesisFn: async ({ onToken }) => {
            await new Promise(r => setTimeout(r, 150));
            onToken('NASA has confirmed ');
            await new Promise(r => setTimeout(r, 100));
            onToken('Artemis II launch preparations are underway [1].');
        },
        uiCallbacks: {
            onSourcesReady: ({ sources }) => {
                sourcesReceived = sources;
            },
            onStreamComplete: ({ content, sources, telemetry }) => {
                streamCompleted = { content, sources, telemetry };
            }
        }
    });

    assert.ok(sourcesReceived, 'Sources should have been emitted');
    assert.equal(sourcesReceived.length, 1);
    assert.equal(sourcesReceived[0].id, 1);
    assert.ok(streamCompleted, 'Stream should have completed');
    assert.ok(streamCompleted.content.includes('Artemis II launch preparations'));
    assert.ok(controller.isTerminal, 'Controller must be terminal');
    assert.equal(controller.timers.length, 0, 'All timers must be cleared');
    assert.ok(controller.telemetry.t_completed > 0, 'Completion timestamp must be recorded');
});

test('BoundedLiveResearchController - Search Cutoff at T+2500ms when Search Stalls', async () => {
    const controller = new BoundedLiveResearchController({
        searchCutoffMs: 300,
        fallbackWarningMs: 1200,
        hardDeadlineMs: 1500
    });

    let sourcesReadyCalled = false;
    let cutoffFiredBeforeSearchFinished = false;

    await controller.execute({
        query: 'Slow query test',
        userText: 'Slow query test',
        assistantMessageId: 'msg_test_2',
        fetchSearchFn: async ({ signal }) => {
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    resolve({ results: [{ title: 'Late result', url: 'https://late.com', snippet: 'Too late' }] });
                }, 5000);
                signal.addEventListener('abort', () => {
                    clearTimeout(timeout);
                    cutoffFiredBeforeSearchFinished = true;
                    reject(new Error('Search aborted by cutoff'));
                });
            });
        },
        streamSynthesisFn: async ({ onToken }) => {
            onToken('Answer generated from available sources.');
        },
        uiCallbacks: {
            onSourcesReady: () => {
                sourcesReadyCalled = true;
            }
        }
    });

    assert.ok(sourcesReadyCalled, 'onSourcesReady must be invoked at cutoff');
    assert.ok(cutoffFiredBeforeSearchFinished, 'Search must have been aborted by cutoff timer');
    assert.ok(controller.isTerminal, 'Controller should have terminated');
});

test('BoundedLiveResearchController - Hard Application Deadline at T+9000ms with Fallback', async () => {
    const controller = new BoundedLiveResearchController({
        searchCutoffMs: 150,
        fallbackWarningMs: 400,
        hardDeadlineMs: 600
    });

    let fallbackCompleted = null;
    let fallbackWarningFired = false;

    await controller.execute({
        query: 'Super slow LLM test',
        userText: 'Super slow LLM test',
        assistantMessageId: 'msg_test_3',
        fetchSearchFn: async () => {
            return {
                results: [
                    { title: 'Verified Fact Alpha', url: 'https://alpha.org/fact', snippet: 'Alpha discovery was confirmed in 2026.' },
                    { title: 'Verified Fact Beta', url: 'https://beta.com/news', snippet: 'Beta confirmed independent validation.' }
                ]
            };
        },
        streamSynthesisFn: async ({ signal }) => {
            return new Promise((resolve, reject) => {
                signal.addEventListener('abort', () => {
                    reject(new Error('LLM stream aborted by hard deadline'));
                });
            });
        },
        uiCallbacks: {
            onFallbackWarning: () => {
                fallbackWarningFired = true;
            },
            onFallbackComplete: (result) => {
                fallbackCompleted = result;
            }
        }
    });

    // Wait slightly to let the hard deadline timer execute
    await new Promise(r => setTimeout(r, 650));

    assert.ok(fallbackWarningFired, 'Fallback warning must fire before hard deadline');
    assert.ok(fallbackCompleted, 'Hard deadline must trigger onFallbackComplete');
    assert.ok(controller.isFallbackRendered, 'isFallbackRendered must be true');
    assert.ok(controller.isTerminal, 'Controller must be terminal');
    assert.ok(fallbackCompleted.content.includes('Verified Summary'), 'Must render verified summary fallback');
    assert.ok(fallbackCompleted.content.includes('Alpha discovery was confirmed'), 'Must include verified snippet content');
    assert.ok(fallbackCompleted.content.includes('[1]'), 'Must cite source [1]');
});

test('Source Normalization & Deduplication', () => {
    const raw = [
        { title: 'Article 1', url: 'https://example.com/art1', snippet: 'Snippet 1', domain: 'example.com' },
        { title: 'Article 1 Duplicate', url: 'https://example.com/art1#section', snippet: 'Dup', domain: 'example.com' },
        { title: 'Article 2', url: 'https://news.bbc.co.uk/news', snippet: 'Snippet 2' },
        { title: 'Invalid URL', url: 'not-a-url', snippet: 'Ignore' },
        null
    ];

    const sources = normalizeResearchSources(raw, 'test query', 5);
    assert.equal(sources.length, 2, 'Must deduplicate same URLs and ignore invalid URLs');
    assert.equal(sources[0].id, 1, 'First source must have ID 1');
    assert.equal(sources[1].id, 2, 'Second source must have ID 2');
    assert.ok(sources[0].favicon.includes('example.com'), 'Must generate favicon link');
    assert.equal(sources[1].domain, 'news.bbc.co.uk', 'Must extract domain accurately');
});

test('Prompt Formatting & Snippet Fallback', () => {
    const sources = [
        { id: 1, title: 'Title 1', domain: 'foo.com', url: 'https://foo.com', snippet: 'Fact 1' },
        { id: 2, title: 'Title 2', domain: 'bar.com', url: 'https://bar.com', snippet: 'Fact 2' }
    ];

    const formattedPrompt = formatSourcesForPrompt(sources);
    assert.ok(formattedPrompt.includes('[1] Title: Title 1'));
    assert.ok(formattedPrompt.includes('[2] Title: Title 2'));

    const fallback = generateSnippetFallback('Test Topic', sources);
    assert.ok(fallback.includes('### Verified Summary for "Test Topic"'));
    assert.ok(fallback.includes('• Fact 1 [1]'));
    assert.ok(fallback.includes('• Fact 2 [2]'));

    // Test zero sources with valid query
    const fallbackZeroSources = generateSnippetFallback('Gold price today', []);
    assert.ok(fallbackZeroSources.includes('Gold price today'));
    assert.ok(fallbackZeroSources.includes('did not return verified records'));

    // Test zero sources with whitespace / zero-width query (should never render " ")
    const fallbackEmptyQuery = generateSnippetFallback('   ', []);
    assert.ok(!fallbackEmptyQuery.includes('" "'));
    assert.ok(fallbackEmptyQuery.includes('Please provide a search topic'));

    const fallbackZeroWidth = generateSnippetFallback('\u200B\uFEFF', []);
    assert.ok(!fallbackZeroWidth.includes('" "'));
    assert.ok(fallbackZeroWidth.includes('Please provide a search topic'));
});

test('Inline Citation HTML Parsing', () => {
    const markdown1 = 'According to research [1], the result is verified [2].';
    const parsed1 = parseCitationsInHtml(markdown1);
    assert.ok(parsed1.includes('data-source-id="1"'));
    assert.ok(parsed1.includes('data-source-id="2"'));
    assert.ok(parsed1.includes('<sup>[1]</sup>'));
    assert.ok(parsed1.includes('<sup>[2]</sup>'));

    const markdown2 = 'Multi-source confirmation [1, 2].';
    const parsed2 = parseCitationsInHtml(markdown2);
    assert.ok(parsed2.includes('data-source-id="1"'));
    assert.ok(parsed2.includes('data-source-id="2"'));

    const markdown3 = 'Markdown link [1](https://example.com) citation.';
    const parsed3 = parseCitationsInHtml(markdown3);
    assert.ok(parsed3.includes('<a href="https://example.com"'));
    assert.ok(parsed3.includes('data-source-id="1"'));
});

test('Dynamic Related Research Questions Generation', () => {
    const sources = [{ title: 'James Webb Space Telescope finds new exoplanet atmosphere' }];
    const questions = generateRelatedResearchQuestions('James Webb discoveries 2026', sources);
    assert.equal(questions.length, 3, 'Must return exactly 3 questions');
    assert.ok(questions.every(q => q.endsWith('?')), 'Every question must end with a question mark');
});

test('Google News RSS XML Parser', () => {
    const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0">
        <channel>
            <title>Google News</title>
            <item>
                <title>SpaceX Starship Completes Key Test - Reuters</title>
                <link>https://news.google.com/rss/articles/CBMiZGh0dHBzOi8vd3d3LnJldXRlcnMuY29tL3NwYWNleC1zdGFyc2hpcC10ZXN00gEA</link>
                <pubDate>Tue, 22 Sep 2026 14:00:00 GMT</pubDate>
                <description>&lt;a href="https://reuters.com"&gt;Reuters&lt;/a&gt; SpaceX conducted a successful static fire test.</description>
                <source url="https://www.reuters.com">Reuters</source>
            </item>
        </channel>
    </rss>`;

    const items = parseGoogleNewsRssXml(sampleXml, 'SpaceX Starship', 5);
    assert.equal(items.length, 1);
    assert.equal(items[0].title, 'SpaceX Starship Completes Key Test - Reuters');
    assert.ok(items[0].url.includes('news.google.com'));
    assert.equal(items[0].sourceLabel, 'Google News / Reuters');
    assert.ok(items[0].trusted);
});

test('BoundedLiveResearchController - Empty Synthesis Triggers Snippet Fallback', async () => {
    const controller = new BoundedLiveResearchController({
        searchCutoffMs: 200,
        fallbackWarningMs: 800,
        hardDeadlineMs: 1200
    });

    let fallbackPayload = null;

    const result = await controller.execute({
        query: 'Latest Artemis lunar rover updates',
        userText: 'Latest Artemis lunar rover updates',
        assistantMessageId: 'msg_test_empty_stream',
        fetchSearchFn: async () => {
            return { results: [] };
        },
        streamSynthesisFn: async () => {
            // Simulates empty stream / refusal / token failure
        },
        uiCallbacks: {
            onFallbackComplete: (payload) => {
                fallbackPayload = payload;
            }
        }
    });

    assert.equal(result.success, false, 'Must report non-success when synthesis is empty');
    assert.equal(result.fallback, true, 'Must report fallback: true');
    assert.ok(result.content.length > 20, 'Content must not be empty or blank');
    assert.ok(result.content.includes('did not return verified records'), 'Must render polite fallback explanation');
    assert.ok(fallbackPayload, 'onFallbackComplete must have fired');
    assert.equal(fallbackPayload.sources.length, 0);
});

test('generateRelatedResearchQuestions - Guards & Topic Deduplication', () => {
    // 1. Empty sources must return zero questions
    assert.deepEqual(generateRelatedResearchQuestions('Anything', []), []);

    // 2. Query starting with latest updates should not generate a tautological question
    const sources = [{ title: 'NASA Artemis Rover Tests Mobility' }];
    const questions = generateRelatedResearchQuestions('What are the latest updates on Artemis mission?', sources);
    assert.equal(questions.length, 3);
    for (const q of questions) {
        assert.ok(!q.toLowerCase().includes('what are the latest updates on what are the latest updates'), 'Must not duplicate question prefix');
        assert.ok(q.endsWith('?'));
    }
});

test('Source Transparency - Suppressed When Zero Sources', () => {
    const htmlWithZeroSources = buildSourceTransparencyHtml({
        sourceType: 'verified',
        verified: true,
        sources: []
    }, 'Some text');

    assert.equal(htmlWithZeroSources, '', 'Must not render "Verified sources" badge when sources list is empty');

    const htmlWithActualSources = buildSourceTransparencyHtml({
        sourceType: 'verified',
        verified: true,
        sources: [{ title: 'NASA Article', url: 'https://nasa.gov' }]
    }, 'Some text');

    assert.ok(htmlWithActualSources.includes('Verified sources'), 'Must render badge when verified sources actually exist');
});

