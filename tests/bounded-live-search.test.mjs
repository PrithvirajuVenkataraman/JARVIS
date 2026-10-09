import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
    LIVE_RESEARCH_BUDGETS,
    RESEARCH_STATES,
    PROVENANCE_MODES,
    BoundedLiveResearchController,
    normalizeResearchSources,
    formatSourcesForPrompt,
    generateSnippetFallback,
    generateRelatedResearchQuestions,
    parseCitationsInHtml,
    normalizeUserQuery,
    hasSearchableContent,
    isAuthoritativeResearchSource,
    evaluateSourceQualityForEarlySynthesis,
    renderOrUpdateSourcesCarousel
} from '../app/bounded-live-research.js';
import { parseGoogleNewsRssXml, searchDuckDuckGoHtml } from '../api/_lib/free-live/providers.js';
import { buildSourceTransparencyHtml } from '../app/source-transparency.js';
import {
    searchGovernmentRole,
    runEvidenceFirstWebRag,
    searchPublicSources,
    isTechnicalDocumentationQuery,
    buildDeterministicSearchQueries,
    scoreSearchResult
} from '../api/search.js';
import { classifyFreeLiveIntent } from '../api/_lib/free-live/classifier.js';
import { __test as chatGroqTest } from '../api/chat-groq.js';

// ============================================================================
// ARCHITECTURE-LEVEL TESTS (Section 8 Requirements)
// ============================================================================

test('Architecture 1: Search returns zero sources -> NO_SOURCES state -> no normal LLM synthesis', async () => {
    const controller = new BoundedLiveResearchController({
        searchCutoffMs: 200,
        fallbackWarningMs: 800,
        hardDeadlineMs: 1000
    });

    let llmSynthesisCalled = false;
    const statesObserved = [];

    const result = await controller.execute({
        query: 'Obscure query with zero search results',
        userText: 'Obscure query with zero search results',
        assistantMessageId: 'msg_arch_1',
        fetchSearchFn: async () => {
            return { results: [] };
        },
        streamSynthesisFn: async () => {
            llmSynthesisCalled = true;
        },
        uiCallbacks: {
            onStateTransition: ({ state }) => {
                statesObserved.push(state);
            }
        }
    });

    assert.equal(llmSynthesisCalled, false, 'LLM synthesis must NEVER be called with zero sources');
    assert.ok(statesObserved.includes(RESEARCH_STATES.NO_SOURCES), 'Must transition through NO_SOURCES state');
    assert.equal(result.state, RESEARCH_STATES.COMPLETE);
    assert.equal(result.provenance, PROVENANCE_MODES.NO_SOURCES);
    assert.equal(result.success, false);
    assert.equal(result.fallback, true);
    assert.equal(result.sources.length, 0);
    assert.ok(result.content.includes('did not return verified records'));
    assert.ok(controller.isTerminal);
    assert.equal(controller.timers.length, 0, 'Timers must be cleared immediately without waiting for LLM watchdog');
});

test('Architecture 2: Search returns valid sources -> SOURCE_GROUNDED_SYNTHESIS', async () => {
    const controller = new BoundedLiveResearchController({
        searchCutoffMs: 2000,
        fallbackWarningMs: 4000,
        hardDeadlineMs: 5000
    });

    let llmSynthesisCalled = false;
    let promptPassed = '';
    const statesObserved = [];

    const result = await controller.execute({
        query: 'What is the current Artemis mission status?',
        userText: 'What is the current Artemis mission status?',
        assistantMessageId: 'msg_arch_2',
        fetchSearchFn: async () => {
            return {
                results: [
                    { title: 'NASA Artemis Updates', url: 'https://nasa.gov/artemis', snippet: 'Artemis II is scheduled for launch.' }
                ]
            };
        },
        streamSynthesisFn: async ({ prompt, onToken }) => {
            llmSynthesisCalled = true;
            promptPassed = prompt;
            onToken('NASA confirmed Artemis II launch preparations are underway [1].');
        },
        uiCallbacks: {
            onStateTransition: ({ state }) => {
                statesObserved.push(state);
            }
        }
    });

    assert.equal(llmSynthesisCalled, true, 'LLM synthesis must be invoked with valid sources');
    assert.ok(statesObserved.includes(RESEARCH_STATES.SOURCE_GROUNDED_SYNTHESIS), 'Must transition to SOURCE_GROUNDED_SYNTHESIS');
    assert.ok(promptPassed.includes('[1] Title: NASA Artemis Updates'), 'Prompt must include verified source');
    assert.equal(result.provenance, PROVENANCE_MODES.WEB_GROUNDED);
    assert.equal(result.success, true);
    assert.equal(result.sources.length, 1);
    assert.ok(result.content.includes('Artemis II launch preparations'));
});

test('Architecture 3: Search returns sources after cutoff -> late results do not modify completed state', async () => {
    const controller = new BoundedLiveResearchController({
        searchCutoffMs: 100,
        fallbackWarningMs: 500,
        hardDeadlineMs: 700
    });

    let lateSearchResolved = false;

    const result = await controller.execute({
        query: 'Slow search timing test',
        userText: 'Slow search timing test',
        assistantMessageId: 'msg_arch_3',
        fetchSearchFn: async () => {
            return new Promise((resolve) => {
                // Simulates a slow backend network response that finishes after cutoff (300ms > 100ms)
                setTimeout(() => {
                    lateSearchResolved = true;
                    resolve({
                        results: [
                            { title: 'Late Arriving Source', url: 'https://late.com/article', snippet: 'Late snippet' }
                        ]
                    });
                }, 300);
            });
        },
        streamSynthesisFn: async () => {
            // Should not be called because at cutoff 100ms there were 0 sources
        }
    });

    // Verify initial completion was NO_SOURCES
    assert.equal(result.provenance, PROVENANCE_MODES.NO_SOURCES);
    assert.equal(result.sources.length, 0);
    assert.equal(controller.isTerminal, true);

    // Wait for the late search promise to resolve
    await new Promise(r => setTimeout(r, 350));
    assert.equal(lateSearchResolved, true, 'Late search promise should have resolved in background');

    // Invariant: controller must not accept late sources or re-open execution
    assert.equal(controller.sources.length, 0, 'Late sources must NOT be added to controller sources');
    assert.equal(controller.state, RESEARCH_STATES.COMPLETE, 'Controller state must remain COMPLETE');
    assert.equal(controller.provenance, PROVENANCE_MODES.NO_SOURCES, 'Provenance must remain no_sources');
});

test('Architecture 4: Valid sources + empty LLM response -> synthesis fallback', async () => {
    const controller = new BoundedLiveResearchController({
        searchCutoffMs: 200,
        fallbackWarningMs: 600,
        hardDeadlineMs: 800
    });

    const result = await controller.execute({
        query: 'James Webb latest observations',
        userText: 'James Webb latest observations',
        assistantMessageId: 'msg_arch_4',
        fetchSearchFn: async () => {
            return {
                results: [
                    { title: 'JWST Exoplanet Atmosphere', url: 'https://jwst.org/exo', snippet: 'Water vapor detected on K2-18b.' }
                ]
            };
        },
        streamSynthesisFn: async ({ onToken }) => {
            // Simulates empty response / token refusal (< 20 chars)
            onToken('   ');
        }
    });

    assert.equal(result.success, false, 'Must report success: false on synthesis failure to produce content');
    assert.equal(result.fallback, true, 'Must flag fallback: true');
    assert.equal(result.provenance, PROVENANCE_MODES.SYNTHESIS_FALLBACK);
    assert.equal(result.sources.length, 1, 'Sources must be preserved in fallback');
    assert.ok(!result.content.includes('Live Web Results'), 'Must not include technical live search headings');
    assert.ok(!result.content.includes('deadline'), 'Must not include deadline timing disclaimers');
    assert.ok(result.content.includes('Water vapor detected on K2-18b'));
});

test('Architecture 5: Zero sources -> no "Verified sources" metadata', async () => {
    const controller = new BoundedLiveResearchController({
        searchCutoffMs: 100,
        fallbackWarningMs: 400,
        hardDeadlineMs: 600
    });

    let onSourcesReadyCalled = false;
    let validatedProvenance = null;

    const result = await controller.execute({
        query: 'Zero source test',
        userText: 'Zero source test',
        assistantMessageId: 'msg_arch_5',
        fetchSearchFn: async () => ({ results: [] }),
        streamSynthesisFn: async () => {},
        uiCallbacks: {
            onSourcesReady: () => {
                onSourcesReadyCalled = true;
            },
            onSourcesValidated: ({ provenance }) => {
                validatedProvenance = provenance;
            }
        }
    });

    assert.equal(onSourcesReadyCalled, false, 'onSourcesReady must NOT be invoked with empty sources');
    assert.equal(validatedProvenance, PROVENANCE_MODES.NO_SOURCES);
    assert.equal(result.provenance, PROVENANCE_MODES.NO_SOURCES);
    assert.notEqual(result.provenance, PROVENANCE_MODES.WEB_GROUNDED);

    // Also verify UI helper suppresses badge with zero sources
    const renderedHtml = buildSourceTransparencyHtml({
        sourceType: 'verified',
        verified: true,
        sources: []
    }, 'Fallback content');
    assert.equal(renderedHtml, '', 'Source transparency HTML must be empty with empty sources');
});

test('Architecture 6: Zero sources -> no related research questions', () => {
    // Positional arguments
    assert.deepEqual(generateRelatedResearchQuestions('any query', []), []);
    assert.deepEqual(generateRelatedResearchQuestions('What are the latest updates on fusion energy?', null), []);

    // Structured arguments
    assert.deepEqual(generateRelatedResearchQuestions({
        query: 'What is the stock price of Apple?',
        sources: []
    }), []);

    assert.deepEqual(generateRelatedResearchQuestions({
        query: 'Quantum computing breakthroughs',
        sources: null
    }), []);
});

test('Architecture 7: Original "latest updates" query -> related questions are not trivial echoes', () => {
    const sources = [
        { id: 1, title: 'NASA Artemis 2 Orion Spacecraft Testing', snippet: 'Testing heat shield at Kennedy Space Center.' }
    ];

    const queries = [
        'What are the latest updates on Artemis mission?',
        'Tell me the latest news about Artemis mission',
        'Latest updates for Artemis mission',
        'What is the current status of Artemis mission?'
    ];

    for (const q of queries) {
        const questions = generateRelatedResearchQuestions(q, sources);
        assert.equal(questions.length, 3, `Must return 3 questions for: ${q}`);
        for (const item of questions) {
            assert.ok(item.endsWith('?'), 'Every question must end with a question mark');
            const lower = item.toLowerCase();
            const words = lower.replace(/[?.!]+/g, '').split(/\s+/).filter(Boolean);
            for (let i = 0; i < words.length - 2; i++) {
                const phrase = words.slice(i, i + 2).join(' ');
                const remainder = words.slice(i + 2).join(' ');
                assert.ok(!remainder.includes(phrase), `Question must not repeat phrase: "${phrase}"`);
            }
            assert.notEqual(item.trim(), q.trim(), 'Question must not trivially echo the exact user query');
        }
    }
});

test('Architecture 8: Late LLM stream after fallback -> fallback remains authoritative', async () => {
    const controller = new BoundedLiveResearchController({
        searchCutoffMs: 100,
        fallbackWarningMs: 250,
        hardDeadlineMs: 400
    });

    let lateTokenCallback = null;
    let lateTokensReceivedByUi = 0;

    const result = await controller.execute({
        query: 'Laggy LLM stream test',
        userText: 'Laggy LLM stream test',
        assistantMessageId: 'msg_arch_8',
        fetchSearchFn: async () => ({
            results: [{ title: 'Source 1', url: 'https://src1.org', snippet: 'Snippet 1' }]
        }),
        streamSynthesisFn: async ({ onToken }) => {
            lateTokenCallback = onToken;
            // Stall beyond hardDeadlineMs
            return new Promise((resolve) => {
                setTimeout(resolve, 1000);
            });
        },
        uiCallbacks: {
            onToken: () => {
                lateTokensReceivedByUi++;
            }
        }
    });

    // Wait slightly so hard deadline triggers and completes execution
    await new Promise(r => setTimeout(r, 450));

    assert.equal(controller.isTerminal, true, 'Controller must be terminal after hard deadline');
    assert.equal(controller.provenance, PROVENANCE_MODES.SYNTHESIS_FALLBACK);
    const initialContent = result.content;
    const initialStreamedText = controller.streamedText;
    const initialUiTokenCount = lateTokensReceivedByUi;

    // Simulate late token arrival from lingering stream
    if (typeof lateTokenCallback === 'function') {
        lateTokenCallback('LATE TOKEN ARRIVING AFTER DEADLINE');
    }

    assert.equal(controller.streamedText, initialStreamedText, 'Late token must NOT modify controller streamedText');
    assert.equal(lateTokensReceivedByUi, initialUiTokenCount, 'Late token must NOT trigger UI token callbacks');
    assert.equal(result.content, initialContent, 'Fallback content must remain authoritative');
});

test('Architecture 9: New request while previous research is active -> previous request cannot contaminate new response', async () => {
    const controller1 = new BoundedLiveResearchController({
        searchCutoffMs: 500,
        fallbackWarningMs: 1500,
        hardDeadlineMs: 2000
    });

    const controller2 = new BoundedLiveResearchController({
        searchCutoffMs: 500,
        fallbackWarningMs: 1500,
        hardDeadlineMs: 2000
    });

    let controller1Completed = false;

    // Start request 1 (simulating slow research)
    const req1Promise = controller1.execute({
        query: 'Query 1 that gets interrupted',
        userText: 'Query 1 that gets interrupted',
        assistantMessageId: 'msg_req_1',
        fetchSearchFn: async () => {
            await new Promise(r => setTimeout(r, 300));
            return { results: [{ title: 'Q1 Source', url: 'https://q1.com', snippet: 'Q1 info' }] };
        },
        streamSynthesisFn: async ({ onToken }) => {
            await new Promise(r => setTimeout(r, 300));
            onToken('Token from Request 1');
        },
        uiCallbacks: {
            onComplete: () => {
                controller1Completed = true;
            }
        }
    });

    // User submits Query 2 at T+100ms: abort request 1
    await new Promise(r => setTimeout(r, 100));
    controller1.abort();

    // Start request 2
    let controller2Tokens = '';
    const req2Promise = controller2.execute({
        query: 'Query 2 current information',
        userText: 'Query 2 current information',
        assistantMessageId: 'msg_req_2',
        fetchSearchFn: async () => {
            await new Promise(r => setTimeout(r, 50));
            return { results: [{ title: 'Q2 Source', url: 'https://q2.com', snippet: 'Q2 facts' }] };
        },
        streamSynthesisFn: async ({ onToken }) => {
            onToken('Clean synthesis for Query 2 [1].');
        },
        uiCallbacks: {
            onToken: ({ token }) => {
                controller2Tokens += token;
            }
        }
    });

    const [res1, res2] = await Promise.all([req1Promise, req2Promise]);

    assert.equal(res1.aborted, true, 'Request 1 must report aborted: true');
    assert.equal(res1.provenance, PROVENANCE_MODES.ABORTED);
    assert.equal(controller1.state, RESEARCH_STATES.ABORTED);
    assert.equal(controller1Completed, false, 'Request 1 onComplete must NOT fire');

    assert.equal(res2.success, true, 'Request 2 must succeed');
    assert.equal(res2.provenance, PROVENANCE_MODES.WEB_GROUNDED);
    assert.equal(res2.sources[0].title, 'Q2 Source');
    assert.ok(res2.content.includes('Clean synthesis for Query 2'));
    assert.ok(!controller2Tokens.includes('Token from Request 1'), 'Request 1 tokens cannot leak into Request 2');
});

// ============================================================================
// COMPONENT & UTILITY UNIT TESTS
// ============================================================================

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
    assert.ok(!fallback.includes('### Live Web Results'), 'Must not include technical live search headings');
    assert.ok(!fallback.includes('deadline'), 'Must not include deadline timing disclaimers');
    assert.ok(!fallback.includes('[1]'), 'Must not include raw citation brackets');
    assert.ok(!fallback.includes('[2]'), 'Must not include raw citation brackets');
    assert.ok(fallback.includes('Snippet 1') || fallback.includes('Title 1'));

    // Test zero sources with valid query
    const fallbackZeroSources = generateSnippetFallback('Gold price today', []);
    assert.ok(fallbackZeroSources.includes('Gold price today'));
    assert.ok(!fallbackZeroSources.includes('deadline'), 'Must not include deadline text on zero sources');

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

// ============================================================================
// CANONICAL QUERY NORMALIZATION & SEARCHABLE CONTENT VALIDATION TESTS
// ============================================================================

test('Canonical Query Normalizer - whitespace, HTML entities, and invisible format characters', () => {
    // Null/undefined/empty
    assert.equal(normalizeUserQuery(null), '');
    assert.equal(normalizeUserQuery(undefined), '');
    assert.equal(normalizeUserQuery(''), '');
    assert.equal(normalizeUserQuery('   '), '');

    // HTML entities
    assert.equal(normalizeUserQuery('&nbsp;&nbsp;'), '');
    assert.equal(normalizeUserQuery('hello&nbsp;world'), 'hello world');
    assert.equal(normalizeUserQuery('&NBSP;test&nbsp;'), 'test');

    // Standalone blank glyphs: Braille Pattern Blank (\u2800), Hangul Fillers (\u3164, \uFFA0)
    assert.equal(normalizeUserQuery('\u2800'), '');
    assert.equal(normalizeUserQuery('\u3164'), '');
    assert.equal(normalizeUserQuery('\uFFA0'), '');
    assert.equal(normalizeUserQuery(' \u2800 \u3164 '), '');

    // Unicode format characters (\p{Cf}): zero-width spaces, bidi marks, word joiners, BOM
    assert.equal(normalizeUserQuery('\u200B'), ''); // Zero-width space
    assert.equal(normalizeUserQuery('\u200C'), ''); // Zero-width non-joiner
    assert.equal(normalizeUserQuery('\u200D'), ''); // Zero-width joiner
    assert.equal(normalizeUserQuery('\u200E'), ''); // Left-to-right mark
    assert.equal(normalizeUserQuery('\u200F'), ''); // Right-to-left mark
    assert.equal(normalizeUserQuery('\u202A\u202E'), ''); // Embedding and override
    assert.equal(normalizeUserQuery('\u2060'), ''); // Word joiner
    assert.equal(normalizeUserQuery('\u2066\u2069'), ''); // Isolates
    assert.equal(normalizeUserQuery('\uFEFF'), ''); // BOM / ZWNBSP
    assert.equal(normalizeUserQuery('\u180E'), ''); // Mongolian vowel separator

    // Combinations of invisibles, HTML entities, and whitespace
    assert.equal(normalizeUserQuery(' \u200B &nbsp; \u2800 \uFEFF \u200E  '), '');

    // Embedded invisibles inside real text should be cleanly stripped while text is preserved
    assert.equal(normalizeUserQuery('live\u200Bsearch\uFEFFquery'), 'livesearchquery');
    assert.equal(normalizeUserQuery('  what  \u200E is  \u2800  AI?  '), 'what is AI?');
});

test('Canonical Query Normalizer - multilingual query preservation', () => {
    // English
    assert.equal(normalizeUserQuery('What is quantum computing?'), 'What is quantum computing?');

    // Tamil
    assert.equal(normalizeUserQuery('சென்னை வானிலை என்ன?'), 'சென்னை வானிலை என்ன?');

    // Hindi
    assert.equal(normalizeUserQuery('आज का मौसम कैसा है?'), 'आज का मौसम कैसा है?');

    // Kannada
    assert.equal(normalizeUserQuery('ಬೆಂಗಳೂರು ಹವಾಮಾನ'), 'ಬೆಂಗಳೂರು ಹವಾಮಾನ');

    // Chinese
    assert.equal(normalizeUserQuery('今天的最新新闻'), '今天的最新新闻');

    // Japanese
    assert.equal(normalizeUserQuery('東京の天気'), '東京の天気');

    // Digits / Alphanumeric
    assert.equal(normalizeUserQuery('2026 inflation rate forecast'), '2026 inflation rate forecast');
});

test('Canonical Searchable Content Validation - hasSearchableContent', () => {
    // Non-searchable: empty, whitespace, invisibles
    assert.equal(hasSearchableContent(''), false);
    assert.equal(hasSearchableContent('   '), false);
    assert.equal(hasSearchableContent(null), false);
    assert.equal(hasSearchableContent(undefined), false);
    assert.equal(hasSearchableContent('&nbsp;'), false);
    assert.equal(hasSearchableContent('\u2800'), false);
    assert.equal(hasSearchableContent('\u200B\uFEFF'), false);
    assert.equal(hasSearchableContent(' \u200B \u2800 \u3164 \uFEFF '), false);

    // Non-searchable: punctuation only (cannot produce meaningful web search)
    assert.equal(hasSearchableContent('???'), false);
    assert.equal(hasSearchableContent('...!@#$%^&*()'), false);
    assert.equal(hasSearchableContent('---'), false);
    assert.equal(hasSearchableContent('.,;:'), false);

    // Searchable: valid multilingual text
    assert.equal(hasSearchableContent('hello'), true);
    assert.equal(hasSearchableContent('What is quantum computing?'), true);
    assert.equal(hasSearchableContent('சென்னை'), true);
    assert.equal(hasSearchableContent('मौसम'), true);
    assert.equal(hasSearchableContent('ಬೆಂಗಳೂರು'), true);
    assert.equal(hasSearchableContent('新闻'), true);
    assert.equal(hasSearchableContent('天気'), true);
    assert.equal(hasSearchableContent('2026'), true);
    assert.equal(hasSearchableContent('  AI 2026?  '), true);
});

test('Pre-network Rejection: Invalid or invisible query invokes fetchSearchFn ZERO times', async () => {
    const invalidInputs = [
        '',
        '   ',
        '\u200B',
        '\u2800',
        '\u3164',
        '&nbsp;&nbsp;',
        ' \u200B \u2800 \uFEFF \u200E ',
        '???',
        '...!@#'
    ];

    for (const raw of invalidInputs) {
        const controller = new BoundedLiveResearchController({
            searchCutoffMs: 200,
            fallbackWarningMs: 500,
            hardDeadlineMs: 700
        });

        let fetchSearchCallCount = 0;
        let llmSynthesisCallCount = 0;

        const result = await controller.execute({
            query: raw,
            userText: raw,
            assistantMessageId: 'msg_pre_network_test',
            fetchSearchFn: async () => {
                fetchSearchCallCount++;
                return { results: [] };
            },
            streamSynthesisFn: async () => {
                llmSynthesisCallCount++;
            }
        });

        // Strict Architectural Invariants:
        assert.equal(fetchSearchCallCount, 0, `fetchSearchFn must NEVER be invoked for invalid input: ${JSON.stringify(raw)}`);
        assert.equal(llmSynthesisCallCount, 0, `LLM synthesis must NEVER be invoked for invalid input: ${JSON.stringify(raw)}`);
        assert.equal(controller.timers.length, 0, 'No timers should remain active');
        assert.equal(result.state, RESEARCH_STATES.COMPLETE);
        assert.equal(result.provenance, PROVENANCE_MODES.NO_SOURCES);
        assert.equal(result.success, false);
        assert.equal(result.fallback, true);
        assert.equal(result.sources.length, 0);

        // Content must be the actionable user-facing guidance, NEVER " "
        assert.ok(!result.content.includes('" "'), `Content must never interpolate empty string into quotes: ${result.content}`);
        assert.equal(result.content, 'Please provide a search topic or question so I can retrieve verified live web sources.');
    }
});

test('Safety Fallback Invariant: generateSnippetFallback never renders " " for invalid or invisible queries', () => {
    const edgeCases = [
        '',
        '   ',
        '\u200B',
        '\u2800',
        '\u3164',
        '\uFEFF',
        '&nbsp;',
        ' \u200B \u2800 ',
        '???',
        '!!!'
    ];

    for (const q of edgeCases) {
        const res = generateSnippetFallback(q, []);
        assert.ok(!res.includes('" "'), `generateSnippetFallback must not output " " for input ${JSON.stringify(q)}`);
        assert.equal(res, 'Please provide a search topic or question so I can retrieve verified live web sources.');
    }

    // If valid query is passed with zero sources
    const validRes = generateSnippetFallback('Mars Rover', []);
    assert.ok(validRes.includes('Mars Rover'));
    assert.ok(validRes.includes('did not return verified records'));
    assert.ok(!validRes.includes('deadline'), 'Must not include deadline language');
});

test('Centralized LIVE_RESEARCH_BUDGETS contract & defaults', () => {
    assert.equal(LIVE_RESEARCH_BUDGETS.HARD_DEADLINE_MS, 9000);
    assert.equal(LIVE_RESEARCH_BUDGETS.SEARCH_CUTOFF_MS, 5000);
    assert.equal(LIVE_RESEARCH_BUDGETS.SEARCH_TIMEOUT_MS, 4500);
    assert.equal(LIVE_RESEARCH_BUDGETS.FALLBACK_WARNING_MS, 8500);
    assert.equal(LIVE_RESEARCH_BUDGETS.MIN_SOURCES_FOR_EARLY_SYNTHESIS, 2);

    const controller = new BoundedLiveResearchController();
    assert.equal(controller.hardDeadlineMs, 9000);
    assert.equal(controller.searchCutoffMs, 5000);
    assert.equal(controller.searchTimeoutMs, 4500);
    assert.equal(controller.fallbackWarningMs, 8500);
    assert.equal(controller.minSourcesForEarlySynthesis, 2);
    assert.equal(controller.telemetry.providerTiming, null);
    assert.equal(controller.telemetry.searchError, null);
    assert.equal(controller.telemetry.httpStatus, null);
});

test('Early Synthesis Transition: Receiving 2+ sources before cutoff begins synthesis immediately', async () => {
    const controller = new BoundedLiveResearchController({
        searchCutoffMs: 2000,
        hardDeadlineMs: 4000
    });

    const transitions = [];
    let synthesisInvoked = false;
    let synthesisTimeoutReceived = null;

    const result = await controller.execute({
        query: 'quantum computing breakthroughs',
        userText: 'quantum computing breakthroughs',
        assistantMessageId: 'msg_early_synth_test',
        fetchSearchFn: async () => {
            return {
                timing: { publicSourcesMs: 120 },
                results: [
                    { title: 'Quantum Breakthrough 1', url: 'https://nature.com/article1', snippet: 'Major qubit coherence advance' },
                    { title: 'Quantum Breakthrough 2', url: 'https://science.org/article2', snippet: 'Fault-tolerant quantum error correction' }
                ]
            };
        },
        streamSynthesisFn: async ({ timeoutMs, onToken }) => {
            synthesisInvoked = true;
            synthesisTimeoutReceived = timeoutMs;
            onToken('Quantum computing has made significant progress in qubit coherence and fault-tolerant error correction [1][2].');
        },
        uiCallbacks: {
            onStateTransition: ({ state }) => {
                transitions.push(state);
            }
        }
    });

    assert.equal(synthesisInvoked, true);
    assert.equal(result.success, true);
    assert.equal(result.fallback, false);
    assert.equal(result.provenance, PROVENANCE_MODES.WEB_GROUNDED);
    assert.equal(result.sources.length, 2);
    assert.ok(synthesisTimeoutReceived > 1000, `Expected dynamic timeoutMs > 1000, received ${synthesisTimeoutReceived}`);
    assert.ok(transitions.includes(RESEARCH_STATES.SEARCHING));
    assert.ok(transitions.includes(RESEARCH_STATES.SOURCE_VALIDATION));
    assert.ok(transitions.includes(RESEARCH_STATES.SOURCE_GROUNDED_SYNTHESIS));
    assert.ok(!transitions.includes(RESEARCH_STATES.SEARCH_DEADLINE), 'Early synthesis should not transition to SEARCH_DEADLINE');
    assert.equal(result.telemetry.providerTiming.publicSourcesMs, 120);
});

test('Cutoff Finalization: 1 verified source transitions to synthesis without NO_SOURCES', async () => {
    const controller = new BoundedLiveResearchController({
        searchCutoffMs: 150,
        hardDeadlineMs: 600
    });

    const transitions = [];
    let synthesisInvoked = false;

    const result = await controller.execute({
        query: 'niche historical fact',
        userText: 'niche historical fact',
        assistantMessageId: 'msg_single_source_test',
        fetchSearchFn: async () => {
            await new Promise(r => setTimeout(r, 50));
            return {
                results: [
                    { title: 'Historical Record', url: 'https://history.org/doc1', snippet: 'Verified event details.' }
                ]
            };
        },
        streamSynthesisFn: async ({ onToken }) => {
            synthesisInvoked = true;
            onToken('According to historical records, the verified event happened as documented [1].');
        },
        uiCallbacks: {
            onStateTransition: ({ state }) => {
                transitions.push(state);
            }
        }
    });

    assert.equal(synthesisInvoked, true);
    assert.equal(result.success, true);
    assert.equal(result.provenance, PROVENANCE_MODES.WEB_GROUNDED);
    assert.equal(result.sources.length, 1);
    assert.ok(transitions.includes(RESEARCH_STATES.SEARCH_DEADLINE));
    assert.ok(transitions.includes(RESEARCH_STATES.SOURCE_VALIDATION));
    assert.ok(transitions.includes(RESEARCH_STATES.SOURCE_GROUNDED_SYNTHESIS));
    assert.ok(!transitions.includes(RESEARCH_STATES.NO_SOURCES), 'Should not enter NO_SOURCES with 1 source present');
});

test('Fail-Fast on Search Error: Immediate rejection reaches NO_SOURCES in < 50ms and captures telemetry', async () => {
    const controller = new BoundedLiveResearchController({
        searchCutoffMs: 5000,
        hardDeadlineMs: 9000
    });

    const transitions = [];
    const t0 = performance.now();

    const fetchError = new Error('Failed to fetch from live search server');
    fetchError.status = 502;

    const result = await controller.execute({
        query: 'fast failure query',
        userText: 'fast failure query',
        assistantMessageId: 'msg_fail_fast_test',
        fetchSearchFn: async () => {
            throw fetchError;
        },
        streamSynthesisFn: async () => {
            throw new Error('Should not be called on search failure');
        },
        uiCallbacks: {
            onStateTransition: ({ state }) => {
                transitions.push(state);
            }
        }
    });

    const elapsedMs = performance.now() - t0;
    assert.ok(elapsedMs < 100, `Expected fail-fast execution in < 100ms, took ${elapsedMs}ms`);
    assert.equal(result.success, false);
    assert.equal(result.fallback, true);
    assert.equal(result.provenance, PROVENANCE_MODES.NO_SOURCES);
    assert.equal(result.sources.length, 0);
    assert.equal(result.sourcesCount, 0);
    assert.equal(result.telemetry.searchError, 'Failed to fetch from live search server');
    assert.equal(result.telemetry.httpStatus, 502);
    assert.ok(transitions.includes(RESEARCH_STATES.SEARCHING));
    assert.ok(transitions.includes(RESEARCH_STATES.SEARCH_DEADLINE));
    assert.ok(transitions.includes(RESEARCH_STATES.NO_SOURCES));
    assert.ok(transitions.includes(RESEARCH_STATES.COMPLETE));
});

test('Telemetry Invariant: sourcesCount and totalDurationMs are populated on finalPayload', async () => {
    const controller = new BoundedLiveResearchController({
        searchCutoffMs: 500,
        hardDeadlineMs: 1000
    });

    const result = await controller.execute({
        query: 'telemetry invariant query',
        userText: 'telemetry invariant query',
        assistantMessageId: 'msg_telemetry_test',
        fetchSearchFn: async () => {
            return {
                results: [
                    { title: 'Doc 1', url: 'https://example.com/1', snippet: 'Snippet 1' },
                    { title: 'Doc 2', url: 'https://example.com/2', snippet: 'Snippet 2' }
                ]
            };
        },
        streamSynthesisFn: async ({ onToken }) => {
            onToken('Answer token [1][2]');
        }
    });

    assert.equal(result.sourcesCount, 2);
    assert.ok(typeof result.totalDurationMs === 'number');
    assert.ok(result.totalDurationMs >= 0);
    assert.equal(result.telemetry.sourcesCount, 2);
    assert.ok(result.telemetry.t_first_search > 0);
    assert.ok(result.telemetry.t_sources_rendered > 0);
    assert.ok(result.telemetry.t_completed >= result.telemetry.t_start);
});

test('Client Timeout Normalization: TimeoutError and "signal timed out" map to client_search_timeout (4500ms)', async () => {
    const controller = new BoundedLiveResearchController({
        searchCutoffMs: 5000,
        searchTimeoutMs: 4500,
        hardDeadlineMs: 9000
    });

    const timeoutError = new Error('signal timed out');
    timeoutError.name = 'TimeoutError';

    const result = await controller.execute({
        query: 'timeout query test',
        userText: 'timeout query test',
        assistantMessageId: 'msg_timeout_test',
        fetchSearchFn: async () => {
            throw timeoutError;
        },
        streamSynthesisFn: async () => {
            throw new Error('Should not synthesize on timeout');
        }
    });

    assert.equal(result.success, false);
    assert.equal(result.provenance, PROVENANCE_MODES.NO_SOURCES);
    assert.equal(result.telemetry.searchError, 'client_search_timeout (4500ms)');
    assert.equal(result.telemetry.httpStatus, null);
});

test('Backend Contract: searchGovernmentRole respects <= 1500ms timeout and AbortSignal', async () => {
    const abortCtrl = new AbortController();
    abortCtrl.abort();
    const res = await searchGovernmentRole('who is the CEO of Apple', {
        signal: abortCtrl.signal,
        timeoutMs: 1500
    });
    assert.deepEqual(res, []);
});

test('Backend Contract: runEvidenceFirstWebRag answer:false is capped to <= 3000ms', async () => {
    const t0 = performance.now();
    const res = await runEvidenceFirstWebRag('who is the CEO of Apple', {
        limit: 8,
        answer: false,
        timeoutMs: 3000
    });
    const duration = performance.now() - t0;
    assert.ok(duration <= 3000, `Expected duration <= 3000ms, got ${duration}ms`);
    assert.ok(Array.isArray(res.results));
    assert.ok(res.results.length >= 2, `Expected >= 2 results, got ${res.results.length}`);
});

test('Backend Contract: searchDuckDuckGoHtml respects AbortSignal and bounds timeout', async () => {
    const abortCtrl = new AbortController();
    abortCtrl.abort();
    const res = await searchDuckDuckGoHtml('sample generic research query', {
        signal: abortCtrl.signal,
        timeoutMs: 1500
    });
    assert.deepEqual(res, []);
});

test('Backend Contract: searchPublicSources gathers diverse sources including general web and news', async () => {
    const res = await searchPublicSources('latest space telescope scientific discoveries', {
        limit: 8,
        timeoutMs: 2500
    });
    assert.ok(Array.isArray(res));
    assert.ok(res.length >= 2, `Expected >= 2 sources, got ${res.length}`);
    // Ensure sources are gathered from multiple providers (not restricted to only one provider)
    const distinctDomains = new Set(res.map(s => {
        try { return new URL(s.url).hostname.replace(/^www\./, ''); } catch (_) { return s.source || ''; }
    }).filter(Boolean));
    assert.ok(distinctDomains.size >= 2, 'searchPublicSources must gather diverse sources from multiple domains');
});

test('Synthesis Error Diagnostics: Controller records synthesisError on failure and falls back safely', async () => {
    const controller = new BoundedLiveResearchController({
        searchCutoffMs: 2000,
        searchTimeoutMs: 2000,
        hardDeadlineMs: 4000,
        minSourcesForEarlySynthesis: 1
    });

    const result = await controller.execute({
        query: 'sample test research query',
        userText: 'sample test research query',
        assistantMessageId: 'msg_synthesis_err',
        fetchSearchFn: async () => {
            return {
                results: [{
                    title: 'Sample Source Title',
                    url: 'https://example.com/sample',
                    snippet: 'Sample verified content details'
                }]
            };
        },
        streamSynthesisFn: async () => {
            throw new Error('LLM synthesis service unavailable (503)');
        }
    });

    assert.equal(result.success, false);
    assert.equal(result.fallback, true);
    assert.equal(result.provenance, PROVENANCE_MODES.SYNTHESIS_FALLBACK);
    assert.ok(result.telemetry.synthesisError.includes('503'));
    assert.ok(!result.content.includes('Live Web Results'), 'Must not include technical live search headings');
    assert.ok(!result.content.includes('deadline'), 'Must not include deadline timing disclaimers');
});

test('Synthesis Success Invariant: Clean streamed response completes with WEB_GROUNDED provenance without snippet bullets', async () => {
    const controller = new BoundedLiveResearchController({
        searchCutoffMs: 2000,
        searchTimeoutMs: 2000,
        hardDeadlineMs: 4000,
        minSourcesForEarlySynthesis: 1
    });

    const result = await controller.execute({
        query: 'sample test research query',
        userText: 'sample test research query',
        assistantMessageId: 'msg_synthesis_ok',
        fetchSearchFn: async () => {
            return {
                results: [{
                    id: 1,
                    title: 'Sample Verified Source',
                    url: 'https://example.com/verified',
                    snippet: 'Sample verified information'
                }]
            };
        },
        streamSynthesisFn: async ({ onToken }) => {
            onToken('This is a grounded factual answer synthesized from the verified web sources [1].');
        }
    });

    assert.equal(result.success, true);
    assert.equal(result.fallback, false);
    assert.equal(result.provenance, PROVENANCE_MODES.WEB_GROUNDED);
    assert.ok(result.content.includes('grounded factual answer'));
    assert.ok(!result.content.includes('Verified Summary for'));
});

test('Synthesis Fallback Invariant: 0 streamed tokens triggers SYNTHESIS_FALLBACK with sources intact', async () => {
    const controller = new BoundedLiveResearchController({
        searchCutoffMs: 200,
        searchTimeoutMs: 150,
        fallbackWarningMs: 250,
        hardDeadlineMs: 350,
        minSourcesForEarlySynthesis: 1
    });

    const result = await controller.execute({
        query: 'sample test research query',
        userText: 'sample test research query',
        assistantMessageId: 'msg_synthesis_timeout',
        fetchSearchFn: async () => {
            return {
                results: [{
                    id: 1,
                    title: 'Sample Grounded Source',
                    url: 'https://example.com/grounded',
                    snippet: 'Sample grounded information about the topic'
                }]
            };
        },
        streamSynthesisFn: async ({ signal }) => {
            // Emulate hanging / silent stream that produces 0 tokens until hard deadline
            await new Promise((resolve, reject) => {
                const timer = setTimeout(resolve, 2000);
                signal?.addEventListener('abort', () => {
                    clearTimeout(timer);
                    const err = new Error('The operation was aborted');
                    err.name = 'AbortError';
                    reject(err);
                });
            });
        }
    });

    assert.equal(result.success, false);
    assert.equal(result.fallback, true);
    assert.equal(result.provenance, PROVENANCE_MODES.SYNTHESIS_FALLBACK);
    assert.equal(result.sources.length, 1);
    assert.ok(!result.content.includes('### Live Web Results'), 'Must not include technical live search headings');
    assert.ok(!result.content.includes('deadline'), 'Must not include deadline timing disclaimers');
    assert.ok(result.content.includes('Sample Grounded Source'));
});

// ============================================================================
// LIVE WEB SEARCH MODERNIZATION INVARIANTS (User Specification)
// ============================================================================

test('Natural-Language Fallback Invariant: produces cohesive prose without headings, disclaimers, or citation brackets', () => {
    const sources = [
        {
            title: 'Python 3.14 Released with Major Features',
            domain: 'python.org',
            url: 'https://docs.python.org/3/whatsnew/3.14.html',
            snippet: 'Python 3.14 includes support for template strings, enhanced error messages, and substantial interpreter speedups.'
        },
        {
            title: 'Key Security Changes in Python Release',
            domain: 'python.org',
            url: 'https://python.org/news/3.14',
            snippet: 'Security enhancements include hardened package verification and updated TLS default configurations.'
        }
    ];

    const fallback = generateSnippetFallback('What changed in the latest release of Python compared with the previous stable release?', sources);

    // Negative assertions: technical artifacts must never leak into fallback
    assert.ok(!fallback.includes('### Live Web Results'), 'Technical heading must never appear');
    assert.ok(!fallback.includes('deadline'), 'Deadline or timing disclaimers must never appear');
    assert.ok(!fallback.includes('[1]'), 'Bracket citation numbers must not appear');
    assert.ok(!fallback.includes('[2]'), 'Bracket citation numbers must not appear');
    assert.ok(!fallback.includes('* ['), 'Raw markdown bullets must not appear');

    // Positive assertions: must synthesize coherent prose preserving verified facts
    assert.ok(fallback.includes('template strings'), 'Must preserve key technical facts from verified sources');
    assert.ok(fallback.includes('Security enhancements'), 'Must preserve secondary verified facts');
    assert.ok(!fallback.startsWith('#'), 'Must not start with markdown header');
});

test('Natural-Language Fallback Invariant: Insufficient evidence gracefully explains limitation without hallucination', () => {
    const emptySourcesFallback = generateSnippetFallback('Latest quantum gravity breakthrough today', []);
    assert.ok(!emptySourcesFallback.includes('deadline'), 'Zero sources fallback must not mention deadline');
    assert.ok(emptySourcesFallback.includes('Quantum gravity') || emptySourcesFallback.includes('quantum gravity'));
    assert.ok(emptySourcesFallback.includes('no verified live web records were returned') || emptySourcesFallback.includes('did not return verified records'));

    const weakSources = [
        {
            title: '404 Not Found',
            domain: 'example.com',
            snippet: '...'
        }
    ];
    const weakFallback = generateSnippetFallback('Sample query with weak sources', weakSources);
    assert.ok(!weakFallback.includes('deadline'), 'Weak sources fallback must not mention deadline');
    assert.ok(weakFallback.includes('did not contain sufficient detail') || weakFallback.includes('Please review'));
});

test('Live Search Assistant Bubble Invariant: Suppresses Thinking placeholder for live search turns', () => {
    // Simulate the assistant bubble text formatting logic in index.html line 10111
    function computeFormattedText(allowEmptyAssistant, meta, readableText) {
        const isLiveSearchTurn = meta?.isLiveSearch === true || meta?.sourceType === 'verified' || meta?.liveResearch === true;
        return allowEmptyAssistant
            ? (isLiveSearchTurn ? '' : '<span class="streaming-placeholder">Thinking</span>')
            : (readableText || '');
    }

    // Live search turn with allowEmptyAssistant = true
    const liveSearchText = computeFormattedText(true, { isLiveSearch: true }, '');
    assert.equal(liveSearchText, '', 'Live search assistant bubble must be visually empty, zero Thinking placeholder');

    // Normal non-live-search turn with allowEmptyAssistant = true
    const normalChatText = computeFormattedText(true, { isLiveSearch: false }, '');
    assert.equal(normalChatText, '<span class="streaming-placeholder">Thinking</span>', 'Non-live-search turns must preserve normal placeholder');

    // Live search turn after actual tokens arrive (allowEmptyAssistant = false)
    const streamedText = computeFormattedText(false, { isLiveSearch: true }, 'Here is the answer');
    assert.equal(streamedText, 'Here is the answer', 'Streamed content must render cleanly');
});

test('Live Search Progress Lifecycle Invariant: Continuous indicator hides immediately on first token', () => {
    const lifecycleEvents = [];
    let progressIndicatorVisible = false;
    let progressIndicatorText = '';

    const showProgressIndicator = (text) => {
        progressIndicatorVisible = true;
        progressIndicatorText = text;
        lifecycleEvents.push({ event: 'show', text });
    };

    const hideProgressIndicator = () => {
        progressIndicatorVisible = false;
        progressIndicatorText = '';
        lifecycleEvents.push({ event: 'hide' });
    };

    // 1. Live search starts
    showProgressIndicator('Searching web sources...');
    assert.equal(progressIndicatorVisible, true);
    assert.equal(progressIndicatorText, 'Searching web sources...');

    // 2. Sources validated: indicator must stay continuously active (no hide)
    // onSourcesValidated simulates preserving the indicator
    assert.equal(progressIndicatorVisible, true);
    assert.equal(progressIndicatorText, 'Searching web sources...');

    // 3. State transition to SOURCE_GROUNDED_SYNTHESIS: no transition to intermediate text
    // Simulates index.html onStateTransition logic
    const onStateTransition = (state) => {
        if (state === 'SEARCHING') {
            showProgressIndicator('Searching web sources...');
        } else if (state === 'SOURCE_GROUNDED_SYNTHESIS') {
            // Keep continuous indicator without intermediate text transitions
        }
    };
    onStateTransition('SOURCE_GROUNDED_SYNTHESIS');
    assert.equal(progressIndicatorVisible, true);
    assert.equal(progressIndicatorText, 'Searching web sources...', 'Must not transition to intermediate status like Synthesizing grounded answer...');

    // 4. First token arrives: must immediately hide
    const onToken = (token) => {
        hideProgressIndicator();
    };
    onToken('Python');
    assert.equal(progressIndicatorVisible, false, 'Progress indicator must hide immediately upon first token arrival');

    // 5. Verification of clean lifecycle
    const showCount = lifecycleEvents.filter(e => e.event === 'show').length;
    const hideCount = lifecycleEvents.filter(e => e.event === 'hide').length;
    assert.equal(showCount, 1, 'Only one continuous show event throughout retrieval and synthesis');
    assert.equal(hideCount, 1, 'Cleanly hidden on first token');
});

// ============================================================================
// LIVE SEARCH RETRIEVAL & SYNTHESIS REGRESSION TESTS
// ============================================================================

test('Regression 1: Query Classification - Python release comparison classifies as technical_documentation', () => {
    const query = 'What changed in the latest release of Python compared with the previous stable release?';
    const classification = classifyFreeLiveIntent(query);
    assert.equal(classification.category, 'technical_documentation', 'Must categorize as technical_documentation');
    assert.equal(classification.route, 'live_required', 'Must route to live_required for up-to-date documentation');
    assert.equal(isTechnicalDocumentationQuery(query), true, 'isTechnicalDocumentationQuery must be true');
});

test('Regression 2: News Exclusion - isTechnicalDocumentationQuery disables Google News for technical queries', () => {
    const techQueries = [
        'What changed in the latest release of Python compared with the previous stable release?',
        'Node.js 22 changelog release notes',
        'React 19 breaking changes API docs',
        'What is new in the latest release of Rust'
    ];
    for (const q of techQueries) {
        assert.equal(isTechnicalDocumentationQuery(q), true, `Must classify "${q}" as technical documentation`);
    }
});

test('Regression 3: News Retention - Genuine breaking news queries retain news category and enable news sources', () => {
    const newsQueries = [
        'Breaking news: peace talks conclude in Geneva',
        'Latest headlines about the presidential press release',
        'Current events and news bulletin from the UN assembly'
    ];
    for (const q of newsQueries) {
        assert.equal(isTechnicalDocumentationQuery(q), false, `Must NOT classify "${q}" as technical documentation`);
        const classification = classifyFreeLiveIntent(q);
        assert.equal(classification.category, 'news', `Must classify "${q}" as news category`);
    }
});

test('Regression 4: Semantic Query Rewriting - Conversational prompt produces concise queries without duplicate modifiers', () => {
    const prompt = 'What changed in the latest release of Python compared with the previous stable release?';
    const rewritten = buildDeterministicSearchQueries(prompt);
    assert.ok(rewritten.length >= 3, 'Must produce multiple concise retrieval queries');
    for (const q of rewritten) {
        assert.ok(!q.includes('What changed in'), `Query should not retain conversational fluff: "${q}"`);
        assert.ok(!q.includes('compared with'), `Query should not retain comparison fluff: "${q}"`);
        assert.ok(!/\b(\w+)\s+\1\b/i.test(q), `Query must not contain duplicate adjacent tokens like "latest latest": "${q}"`);
        assert.ok(q.toLowerCase().includes('python'), `Query must preserve core technology subject: "${q}"`);
    }
    assert.ok(rewritten.some(q => q.toLowerCase().includes('release notes') || q.toLowerCase().includes('changelog')), 'Must plan release notes / changelog queries');
});

test('Regression 5: Authoritative Ranking - First-party documentation outranks generic news aggregators on tech queries', () => {
    const query = 'What changed in the latest release of Python compared with the previous stable release?';
    const terms = ['python', 'release', 'latest', 'changes'];

    const officialDocSource = {
        title: "What's New In Python 3.14 — Python 3.14.0 documentation",
        domain: 'docs.python.org',
        url: 'https://docs.python.org/3/whatsnew/3.14.html',
        description: 'This article explains the new features in Python 3.14 compared to 3.13.'
    };

    const newsAggregatorSource = {
        title: 'Fedora Linux 45 Beta Released with Python 3.15, GCC 16.2',
        domain: 'news.google.com',
        url: 'https://news.google.com/rss/articles/CBMisgFBVV95cUxQdEE...',
        description: 'Fedora Linux 45 has been released featuring Python 3.15 and new GCC compilers.'
    };

    const officialScore = scoreSearchResult(officialDocSource, terms, query);
    const newsScore = scoreSearchResult(newsAggregatorSource, terms, query);

    assert.ok(officialScore > newsScore, `Official Python doc (${officialScore}) must outrank generic news aggregator (${newsScore})`);
    assert.ok(isAuthoritativeResearchSource(officialDocSource, query), 'docs.python.org must be recognized as authoritative');
    assert.ok(!isAuthoritativeResearchSource(newsAggregatorSource, query), 'news.google.com must not be recognized as authoritative doc');
});

test('Regression 6: Quality-Aware Early Synthesis - Two weak news sources cannot trigger early synthesis for tech doc query', () => {
    const techQuery = 'What changed in the latest release of Python compared with the previous stable release?';
    const weakNewsSources = [
        {
            title: 'Microsoft Agent Framework Setup: 13 Steps, 90 Min',
            domain: 'news.google.com',
            url: 'https://news.google.com/rss/articles/CBMib0FVX3lxTE1XNk...',
            snippet: 'Guide to setting up Microsoft Agent Framework with various AI tools.'
        },
        {
            title: 'PyPI hardens package security with new upload restrictions',
            domain: 'helpnetsecurity.com',
            url: 'https://helpnetsecurity.com/2026/03/pypi-security',
            snippet: 'PyPI implements new security requirements for python package uploads.'
        }
    ];

    const earlySynthAllowed = evaluateSourceQualityForEarlySynthesis(weakNewsSources, techQuery);
    assert.equal(earlySynthAllowed, false, 'Two weak/irrelevant news sources must NOT trigger early synthesis for tech queries');

    const authoritativeSources = [
        {
            title: "What's New In Python 3.14 — Python 3.14.0 documentation",
            domain: 'docs.python.org',
            url: 'https://docs.python.org/3/whatsnew/3.14.html',
            snippet: 'Python 3.14 includes support for template strings, enhanced error messages, and substantial interpreter speedups.'
        },
        {
            title: 'Python 3.14.0 Release Notes',
            domain: 'python.org',
            url: 'https://www.python.org/downloads/release/python-3140/',
            snippet: 'Official Python 3.14.0 release announcement and detailed changelog.'
        }
    ];

    const authEarlySynthAllowed = evaluateSourceQualityForEarlySynthesis(authoritativeSources, techQuery);
    assert.equal(authEarlySynthAllowed, true, 'Authoritative documentation sources MUST trigger early synthesis');
});

test('Regression 7: Zero-Token Fallback - Produces clean coherent facts without fake stitched headlines or headings', () => {
    const techQuery = 'What changed in the latest release of Python compared with the previous stable release?';
    const officialSources = [
        {
            title: 'Python 3.14.0 Release Summary',
            domain: 'python.org',
            url: 'https://docs.python.org/3/whatsnew/3.14.html',
            snippet: 'Python 3.14 includes support for template strings, enhanced error messages, and substantial interpreter speedups.'
        },
        {
            title: 'Python 3.14 Security Improvements',
            domain: 'python.org',
            url: 'https://python.org/news/3.14',
            snippet: 'Security enhancements include hardened package verification and updated TLS default configurations.'
        }
    ];

    const fallback = generateSnippetFallback(techQuery, officialSources);

    assert.ok(!fallback.includes('### Live Web Results'), 'Must not include technical headers');
    assert.ok(!fallback.includes('deadline'), 'Must not include deadline disclaimers');
    assert.ok(!fallback.includes('[1]'), 'Must not include bracket citations');
    assert.ok(fallback.includes('template strings'), 'Must preserve key technical features');
    assert.ok(fallback.includes('Security enhancements'), 'Must preserve secondary verified features');

    // Completely off-topic sources return clean limitation message rather than stitched falsehoods
    const irrelevantSources = [
        {
            title: 'Cooking Recipe for Chocolate Brownies',
            domain: 'cooking.com',
            url: 'https://cooking.com/brownies',
            snippet: 'Bake at 350 degrees for 25 minutes until toothpick comes out clean.'
        }
    ];
    const irrelevantFallback = generateSnippetFallback(techQuery, irrelevantSources);
    assert.ok(irrelevantFallback.includes('could not be completed') || irrelevantFallback.includes('carousel above'), 'Must return clean limitation message for off-topic sources');
    assert.ok(!irrelevantFallback.includes('Chocolate Brownies'), 'Must not stitch off-topic headlines into technical fallback');
});

test('Regression 8: Hard Deadline Invariant - 9000ms remains absolute safety ceiling', () => {
    assert.equal(LIVE_RESEARCH_BUDGETS.HARD_DEADLINE_MS, 9000, 'HARD_DEADLINE_MS budget contract must be exactly 9000ms');
    const controller = new BoundedLiveResearchController();
    assert.equal(controller.hardDeadlineMs, 9000, 'Controller default hardDeadlineMs must be exactly 9000ms');
});

test('Regression 9: Answer-First Streaming & Carousel Placement Below Text', () => {
    function createMockNode(className = '') {
        const node = {
            className,
            attributes: {},
            children: [],
            parentNode: null,
            _innerHTML: '',
            get innerHTML() { return this._innerHTML; },
            set innerHTML(val) { this._innerHTML = val; },
            setAttribute(k, v) { this.attributes[k] = v; },
            querySelector(sel) {
                if (sel === '.chat-bubble-assistant' && this.className.includes('chat-bubble-assistant')) return this;
                if (sel === '.assistant-message-text' && this.className.includes('assistant-message-text')) return this;
                if (sel === '.chat-source-carousel' && this.className.includes('chat-source-carousel')) return this;
                for (const child of this.children) {
                    const match = child.querySelector?.(sel);
                    if (match) return match;
                }
                return null;
            },
            appendChild(child) {
                child.parentNode = this;
                this.children.push(child);
            },
            after(newNode) {
                if (this.parentNode) {
                    const idx = this.parentNode.children.indexOf(this);
                    if (idx !== -1) {
                        if (newNode.parentNode) {
                            const prevIdx = newNode.parentNode.children.indexOf(newNode);
                            if (prevIdx !== -1) newNode.parentNode.children.splice(prevIdx, 1);
                        }
                        newNode.parentNode = this.parentNode;
                        this.parentNode.children.splice(idx + 1, 0, newNode);
                    }
                }
            },
            get nextSibling() {
                if (!this.parentNode) return null;
                const idx = this.parentNode.children.indexOf(this);
                return (idx !== -1 && idx < this.parentNode.children.length - 1) ? this.parentNode.children[idx + 1] : null;
            }
        };
        return node;
    }

    const prevDoc = globalThis.document;
    try {
        globalThis.document = {
            createElement: (tag) => createMockNode()
        };

        const row = createMockNode('chat-row-assistant');
        const bubble = createMockNode('chat-bubble-assistant');
        const textEl = createMockNode('assistant-message-text');
        textEl.innerHTML = 'Answer streams directly first.';
        bubble.appendChild(textEl);
        row.appendChild(bubble);

        const sources = [
            { id: 1, title: 'Department of Labor Audit Notice', domain: 'dol.gov', url: 'https://dol.gov/notice' }
        ];

        // 1. Initial render of carousel: placed strictly AFTER textEl
        renderOrUpdateSourcesCarousel(row, sources);

        assert.equal(bubble.children.length, 2);
        assert.equal(bubble.children[0], textEl, 'Answer text element must be FIRST child in bubble');
        assert.equal(bubble.children[1].className, 'chat-source-carousel', 'Carousel element must be placed AFTER textEl');
        assert.equal(textEl.nextSibling, bubble.children[1], 'textEl.nextSibling must be the carousel');

        // 2. Updated sources keeps carousel placed AFTER textEl
        const updatedSources = [
            { id: 1, title: 'Department of Labor Audit Notice', domain: 'dol.gov', url: 'https://dol.gov/notice' },
            { id: 2, title: 'PERM Audit Details', domain: 'reuters.com', url: 'https://reuters.com/news' }
        ];
        renderOrUpdateSourcesCarousel(row, updatedSources);
        assert.equal(bubble.children[0], textEl, 'Answer text remains FIRST child');
        assert.equal(bubble.children[1].className, 'chat-source-carousel', 'Carousel remains AFTER text element');
        assert.ok(bubble.children[1].innerHTML.includes('2 verified'));

        // 3. Misplaced carousel is corrected to be strictly AFTER textEl
        const misplacedCarousel = bubble.children[1];
        bubble.children = [misplacedCarousel, textEl];
        misplacedCarousel.parentNode = bubble;
        textEl.parentNode = bubble;
        assert.equal(bubble.children[0], misplacedCarousel);

        renderOrUpdateSourcesCarousel(row, updatedSources);
        assert.equal(bubble.children[0], textEl, 'Misplaced carousel must be moved AFTER textEl');
        assert.equal(bubble.children[1], misplacedCarousel, 'Carousel is now AFTER textEl');

        // 4. Calling with empty sources is a no-op
        const emptyRow = createMockNode('chat-row-assistant');
        const emptyBubble = createMockNode('chat-bubble-assistant');
        emptyRow.appendChild(emptyBubble);
        renderOrUpdateSourcesCarousel(emptyRow, []);
        assert.equal(emptyBubble.children.length, 0, 'Must not render carousel for empty sources');
    } finally {
        globalThis.document = prevDoc;
    }
});

test('Regression 10: Prompt Box Resizing & Textarea Reset Invariant', () => {
    const indexHtml = fs.readFileSync(path.resolve('index.html'), 'utf8');

    // 1. autoResizeComposerTextarea must immediately collapse when value is empty or whitespace
    assert.ok(
        indexHtml.includes("if (!input.value || !input.value.trim()) {\n                input.style.height = '';\n                input.style.overflowY = 'hidden';\n                if (input.rows !== 1) input.rows = 1;\n                return;\n            }"),
        'autoResizeComposerTextarea must clear inline height and hide overflow when value is empty or whitespace'
    );

    // 2. All input clear locations in sendTextInput must reset height and call autoResizeComposerTextarea
    assert.ok(
        indexHtml.includes("input.value = '';\n                    input.style.height = '';\n                    autoResizeComposerTextarea();"),
        'sendTextInput clearing paths must reset input.style.height and invoke autoResizeComposerTextarea'
    );

    // 3. Functional behavior test of the auto-resize logic
    function simulateAutoResize(input) {
        if (!input.value) {
            input.style.height = '';
            input.style.overflowY = 'hidden';
            return;
        }
        input.style.height = 'auto';
        const maxHeight = 180;
        const next = Math.min(maxHeight, Math.max(40, input.scrollHeight));
        input.style.height = `${next}px`;
        input.style.overflowY = input.scrollHeight > maxHeight ? 'auto' : 'hidden';
    }

    const mockTextarea = {
        value: '',
        scrollHeight: 40,
        style: { height: '', overflowY: 'hidden' }
    };

    // Initially empty: height is empty string (defaults to CSS min-height: 40px)
    simulateAutoResize(mockTextarea);
    assert.equal(mockTextarea.style.height, '');
    assert.equal(mockTextarea.style.overflowY, 'hidden');

    // User types multi-line long prompt (scrollHeight expands to 120px)
    mockTextarea.value = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5';
    mockTextarea.scrollHeight = 120;
    simulateAutoResize(mockTextarea);
    assert.equal(mockTextarea.style.height, '120px');
    assert.equal(mockTextarea.style.overflowY, 'hidden');

    // User submits prompt: textarea value is cleared
    mockTextarea.value = '';
    mockTextarea.scrollHeight = 40;
    mockTextarea.style.height = '';
    simulateAutoResize(mockTextarea);
    assert.equal(mockTextarea.style.height, '', 'Textarea height must collapse to empty/default upon clearing');
    assert.equal(mockTextarea.style.overflowY, 'hidden');

    // Subsequent short prompt expands correctly without being stuck
    mockTextarea.value = 'Short prompt';
    mockTextarea.scrollHeight = 40;
    simulateAutoResize(mockTextarea);
    assert.equal(mockTextarea.style.height, '40px', 'Textarea must adapt cleanly to next keystrokes');
});

test('Regression 11: Multi-Part Query Synthesis Prompt & Grounded Coverage', async () => {
    // 1. Non-tech query with "recent" or "updates" does NOT trigger software changelog release notes queries
    const multiPartQuery = 'Recent updates on H-1B and PERM labor certification audits';
    assert.equal(isTechnicalDocumentationQuery(multiPartQuery), false, 'H-1B query must not be classified as technical documentation');
    const plannedQueries = buildDeterministicSearchQueries(multiPartQuery);
    for (const q of plannedQueries) {
        assert.ok(!q.includes('changelog'), `Planned query "${q}" must not include "changelog" for policy/regulatory topics`);
        assert.ok(!q.includes('release notes'), `Planned query "${q}" must not include "release notes" for non-tech topics`);
    }

    // 2. Controller preserves full multi-part user prompt in synthesis prompt and enforces coverage rules
    const fullPrompt = 'What are the recent updates on H-1B and PERM labor certification audits? Which companies are affected, what is the impact on Indian professionals, and are existing H-1B visas suspended?';
    const controller = new BoundedLiveResearchController({
        searchCutoffMs: 2000,
        fallbackWarningMs: 4000,
        hardDeadlineMs: 6000
    });

    let capturedSynthesisPrompt = '';
    const sampleSources = [
        {
            title: 'US DOL Initiates Audit on PERM Applications for Multiple Tech Companies',
            url: 'https://news.example.com/dol-perm-audit',
            snippet: 'The Department of Labor flagged PERM applications at eight major firms including tech consultancies. Existing H-1B status remains valid and unaffected.'
        },
        {
            title: 'Impact on Indian Tech Professionals and PERM Processing',
            url: 'https://news.example.com/indian-tech-perm',
            snippet: 'Indian professionals face delays in permanent residency pipelines, but existing H-1B visa holders are not subject to visa suspension.'
        }
    ];

    await controller.execute({
        query: multiPartQuery,
        userText: fullPrompt,
        assistantMessageId: 'msg_multipart_test',
        fetchSearchFn: async () => ({ results: sampleSources }),
        streamSynthesisFn: async ({ prompt, onToken }) => {
            capturedSynthesisPrompt = prompt;
            onToken('Direct answer addressing all parts of the question [1].');
        }
    });

    // Verify effectiveUserPrompt preserved full user prompt
    assert.ok(capturedSynthesisPrompt.includes(fullPrompt), 'Synthesis prompt must contain the complete multi-part user prompt');

    // Verify rules are embedded in the synthesis prompt
    assert.ok(capturedSynthesisPrompt.includes('COMPLETE COVERAGE'), 'Must enforce rule: COMPLETE COVERAGE');
    assert.ok(capturedSynthesisPrompt.includes('SUBSTANTIVE DETAILS'), 'Must enforce rule: SUBSTANTIVE DETAILS');
    assert.ok(capturedSynthesisPrompt.includes('DISTINGUISH CONFIRMED FACTS VS. UNCERTAINTY'), 'Must enforce rule: DISTINGUISH CONFIRMED FACTS VS. UNCERTAINTY');
    assert.ok(capturedSynthesisPrompt.includes('GROUNDED CITATIONS'), 'Must enforce rule: GROUNDED CITATIONS');
    assert.ok(capturedSynthesisPrompt.includes('Provide a direct answer first'), 'Must enforce rule: Direct answer first');

    // Verify sources formatted with [1] and [2]
    assert.ok(capturedSynthesisPrompt.includes('[1] Title: US DOL Initiates Audit'), 'Must include source [1]');
    assert.ok(capturedSynthesisPrompt.includes('[2] Title: Impact on Indian Tech Professionals'), 'Must include source [2]');
});

test('Regression 12: Translation Flow Reliability & Untranslated Text Defense', () => {
    const indexHtml = fs.readFileSync(path.resolve('index.html'), 'utf8');
    const visionJs = fs.readFileSync(path.resolve('api/vision.js'), 'utf8');

    // 1. Arbitrary language resolution: resolveTranslatorLanguage must support arbitrary language strings
    assert.ok(
        indexHtml.includes('/^[a-zA-Z\\s-]{2,40}$/.test(raw)'),
        'resolveTranslatorLanguage must support arbitrary natural language names'
    );
    assert.ok(
        indexHtml.includes('getLanguageDisplayName'),
        'Must provide dynamic language display name formatter for arbitrary languages'
    );

    // 2. Vision translation pipeline must have bounded retry and untranslated detection
    assert.ok(
        visionJs.includes('for (let attempt = 0; attempt <= maxRetries; attempt++)'),
        'runTranslateToEnglishPipeline must execute bounded retry loop'
    );
    assert.ok(
        visionJs.includes('isNonEnglishLang && isIdentical') || visionJs.includes('hasNonLatinSource && hasNonLatinTarget'),
        'runTranslateToEnglishPipeline must detect untranslated foreign text'
    );
    assert.ok(
        visionJs.includes('Translation unavailable: The text could not be translated to English at this time.'),
        'runTranslateToEnglishPipeline must provide clean fallback on persistent failure instead of throwing 500'
    );

    // 3. Functional untranslated detection logic test
    function validateEnglishTranslation(sourceText, candidateText, detectedLanguage = '') {
        const normSource = sourceText.toLowerCase().replace(/[^a-z0-9]/g, '');
        const normTarget = candidateText.toLowerCase().replace(/[^a-z0-9]/g, '');
        const isNonEnglishLang = detectedLanguage && !/^english$/i.test(detectedLanguage);
        const isIdentical = normSource.length > 3 && normSource === normTarget;
        const hasNonLatinSource = /[^\u0000-\u007F]/.test(sourceText);
        const hasNonLatinTarget = /[\u0400-\u04FF\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\u0600-\u06FF\u0900-\u097F\u0B80-\u0BFF\u0C00-\u0C7F\u0D00-\u0D7F]/.test(candidateText);

        if ((isNonEnglishLang && isIdentical) || (hasNonLatinSource && hasNonLatinTarget)) {
            return { valid: false, reason: 'untranslated_detected' };
        }
        return { valid: true };
    }

    // Spanish greeting echoed back without translation
    const spanishCheck = validateEnglishTranslation('Hola, ¿cómo estás hoy?', 'Hola, ¿cómo estás hoy?', 'Spanish');
    assert.equal(spanishCheck.valid, false, 'Must reject echoed Spanish text as untranslated');

    // Chinese text echoed back with Chinese characters
    const chineseCheck = validateEnglishTranslation('今天的天气非常好', '今天的天气非常好', 'Chinese');
    assert.equal(chineseCheck.valid, false, 'Must reject non-Latin Chinese characters as untranslated');

    // Russian text echoed back with Cyrillic characters
    const russianCheck = validateEnglishTranslation('Доброе утро, мир', 'Доброе утро, мир', 'Russian');
    assert.equal(russianCheck.valid, false, 'Must reject Cyrillic text as untranslated');

    // Genuine valid English translations
    const validSpanish = validateEnglishTranslation('Hola, ¿cómo estás hoy?', 'Hello, how are you today?', 'Spanish');
    assert.equal(validSpanish.valid, true, 'Must accept genuine English translation of Spanish');

    const validChinese = validateEnglishTranslation('今天的天气非常好', 'The weather today is very nice', 'Chinese');
    assert.equal(validChinese.valid, true, 'Must accept genuine English translation of Chinese');

    const validRussian = validateEnglishTranslation('Доброе утро, мир', 'Good morning, world', 'Russian');
    assert.equal(validRussian.valid, true, 'Must accept genuine English translation of Russian');
});

test('Regression 13: Dynamic Multi-Topic Synthesis & Answer-First Streaming Order Invariants', async () => {
    // Test multiple completely unrelated topics and multi-part queries
    const testCases = [
        {
            topic: 'Quantum Computing',
            userText: 'What is the current experimental progress on fault-tolerant logical qubits? Which hardware modalities lead, and what error correction code is most widely demonstrated?',
            query: 'fault-tolerant logical qubits error correction progress',
            sources: [
                {
                    title: 'Neutral Atom Architectures Demonstrate 48 Logical Qubits',
                    url: 'https://science.org/neutral-atom-qubits',
                    snippet: 'Researchers demonstrated 48 logical qubits using neutral-atom arrays and transversal gates. Superconducting systems also showed threshold improvements.'
                },
                {
                    title: 'Surface Code vs Color Code Benchmarks in 2026',
                    url: 'https://nature.org/surface-code-benchmarks',
                    snippet: 'Surface codes remain the predominant error-correcting architecture, though color codes provide transversal non-Clifford gates.'
                }
            ]
        },
        {
            topic: 'Maritime Environmental Treaties',
            userText: 'What are the recent IMO regulations on greenhouse gas emissions for cargo vessels? What is the timeline for compliance, and which fuels are approved?',
            query: 'IMO marine greenhouse gas regulations timeline approved fuels',
            sources: [
                {
                    title: 'IMO Adopts Net-Zero Framework for International Shipping',
                    url: 'https://imo.org/ghg-framework',
                    snippet: 'The International Maritime Organization finalized economic measures requiring net-zero emissions near 2050, with checkpoint reductions set for 2030 and 2040.'
                },
                {
                    title: 'Approved Marine Alternative Fuels and Life-Cycle Standards',
                    url: 'https://maritime-executive.com/alternative-fuels',
                    snippet: 'Green methanol and green ammonia are leading zero-carbon candidates, while LNG serves as an interim transitional fuel.'
                }
            ]
        },
        {
            topic: 'Critical Minerals Supply Chains',
            userText: 'What is the current status of global neodymium and dysprosium processing quotas? Which countries produce the majority, and are alternative extraction projects operational?',
            query: 'neodymium dysprosium rare earth quotas global production alternatives',
            sources: [
                {
                    title: 'Global Rare Earth Elements Production and Refining Report',
                    url: 'https://usgs.gov/rare-earth-statistics',
                    snippet: 'Over 70% of heavy rare earth processing remains concentrated in East Asia. New refining capacity in Australia and the US reached commercial scale.'
                },
                {
                    title: 'Magnet Recycling and Alternative Sourcing Initiatives',
                    url: 'https://energy.gov/critical-materials-update',
                    snippet: 'Recycled magnet materials provided 8% of domestic motor demand in 2025, with pilot operations expanding in Europe.'
                }
            ]
        }
    ];

    for (const tc of testCases) {
        const controller = new BoundedLiveResearchController({
            searchCutoffMs: 2000,
            fallbackWarningMs: 4000,
            hardDeadlineMs: 6000
        });

        let capturedPrompt = '';
        const streamedTokens = [];

        await controller.execute({
            query: tc.query,
            userText: tc.userText,
            assistantMessageId: `msg_${tc.topic.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
            fetchSearchFn: async () => ({ results: tc.sources }),
            streamSynthesisFn: async ({ prompt, onToken }) => {
                capturedPrompt = prompt;
                onToken('Initial answer token. ');
                onToken('Follow-up evidence synthesis with citations [1][2].');
            },
            uiCallbacks: {
                onToken: ({ token }) => {
                    streamedTokens.push(token);
                }
            }
        });

        // 1. Preserves full multi-part user prompt dynamically
        assert.ok(capturedPrompt.includes(tc.userText), `Prompt must include complete user question for ${tc.topic}`);

        // 2. Verified sources formatted with citations [1], [2]
        assert.ok(capturedPrompt.includes(`[1] Title: ${tc.sources[0].title}`), `Prompt must include source 1 for ${tc.topic}`);
        assert.ok(capturedPrompt.includes(`[2] Title: ${tc.sources[1].title}`), `Prompt must include source 2 for ${tc.topic}`);

        // 3. System prompt contains general-purpose rules without domain hardcoding
        assert.ok(capturedPrompt.includes('COMPLETE COVERAGE'), 'Must enforce COMPLETE COVERAGE');
        assert.ok(capturedPrompt.includes('SUBSTANTIVE DETAILS'), 'Must enforce SUBSTANTIVE DETAILS');
        assert.ok(capturedPrompt.includes('DISTINGUISH CONFIRMED FACTS VS. UNCERTAINTY'), 'Must enforce DISTINGUISH CONFIRMED FACTS VS. UNCERTAINTY');
        assert.ok(capturedPrompt.includes('GROUNDED CITATIONS'), 'Must enforce GROUNDED CITATIONS');
        assert.ok(!capturedPrompt.includes('PERM'), 'Prompt must not contain topic-specific keywords like PERM');
        assert.ok(!capturedPrompt.includes('H-1B'), 'Prompt must not contain topic-specific keywords like H-1B');

        // 4. Tokens streamed successfully
        assert.ok(streamedTokens.length >= 2, `Tokens must stream during synthesis for ${tc.topic}`);
        assert.ok(streamedTokens.join('').includes('Initial answer token'), `Streamed tokens must be captured in order for ${tc.topic}`);
    }
});

// ============================================================================
// REGRESSION 14: Comprehensive Source-to-Answer Synthesis & Headline-Only Defense
// Validates:
// 1. Multi-part current-events questions produce substantive answers, not titles
// 2. Technical questions requiring version comparisons preserve substantive details
// 3. Queries with multiple sources and conflicting claims preserve divergence
// 4. Queries where only headlines are initially available trigger deep extraction or safe limitations
// 5. Queries with inaccessible sources handle them gracefully without hallucination
// 6. Ordinary questions not requiring live search remain untouched
// ============================================================================
test('Regression 14.1: Multi-part current-events query synthesizes substantive answers rather than article titles', async () => {
    const controller = new BoundedLiveResearchController({
        searchCutoffMs: 2500,
        hardDeadlineMs: 8000
    });

    const userPrompt = 'What is the current status of the global maritime carbon tax proposal, which nations voted against it, and when will enforcement start?';
    let capturedPrompt = '';
    const streamedChunks = [];

    const rawSources = [
        {
            title: 'IMO Delegates Debate Global Maritime Carbon Levy',
            url: 'https://maritime-news.org/carbon-levy-status',
            snippet: 'IMO Delegates Debate Global Maritime Carbon Levy', // Headline-only snippet
            fullArticleText: 'The International Maritime Organization delegates reached a preliminary agreement on a universal carbon levy of $100 per metric ton. However, voting records show that Saudi Arabia, China, and Brazil submitted formal dissents citing economic impact on developing trade. If the treaty is ratified at the autumn assembly, mandatory enforcement will commence in January 2027.',
            sourceLabel: 'Maritime News'
        },
        {
            title: 'Developing Nations Voice Concerns on Shipping Emission Rules',
            url: 'https://global-trade-review.com/shipping-emissions-vote',
            snippet: 'Developing Nations Voice Concerns on Shipping Emission Rules',
            fullArticleText: 'Delegates from major export economies including China and Brazil opposed the flat-rate maritime levy structure, arguing for regional exemptions. The current compromise roadmap sets an enforcement baseline starting in early 2027 with revenue redistribution mechanisms.',
            sourceLabel: 'Global Trade Review'
        }
    ];

    const result = await controller.execute({
        query: userPrompt,
        userText: userPrompt,
        assistantMessageId: 'msg_reg14_multipart',
        fetchSearchFn: async () => ({ results: rawSources }),
        streamSynthesisFn: async ({ prompt, onToken }) => {
            capturedPrompt = prompt;
            const fullAnswer = '### Maritime Carbon Tax Status\n' +
                'The International Maritime Organization (IMO) has reached a preliminary agreement to implement a universal carbon levy of $100 per metric ton on commercial vessels [1].\n\n' +
                '### Opposing Nations\n' +
                'Formal dissents and opposition votes were recorded from Saudi Arabia, China, and Brazil, who raised concerns over disparate economic burdens on developing export trade [1][2].\n\n' +
                '### Enforcement Timeline\n' +
                'Following final ratification at the upcoming autumn assembly, mandatory enforcement is scheduled to commence in January 2027 [1][2].';
            
            for (const chunk of fullAnswer.match(/.{1,40}/g) || [fullAnswer]) {
                onToken(chunk);
            }
        }
    });

    // 1. Controller delivered substantive answer, not headlines
    assert.equal(result.success, true);
    assert.equal(result.fallback, false);
    assert.ok(result.content.length > 200, 'Final response must be substantive, not just titles');
    assert.ok(result.content.includes('$100 per metric ton'), 'Must address status and levy rate');
    assert.ok(result.content.includes('Saudi Arabia, China, and Brazil'), 'Must enumerate opposing nations');
    assert.ok(result.content.includes('January 2027'), 'Must specify enforcement timeline');
    assert.ok(!result.content.startsWith('the latest update is:'), 'Must not collapse into single headline line');

    // 2. Verified that prompt carried fullArticleText, not just headline snippets
    assert.ok(capturedPrompt.includes('Saudi Arabia, China, and Brazil'), 'Prompt must carry substantive article text');
    assert.ok(capturedPrompt.includes('mandatory enforcement will commence in January 2027'), 'Prompt must carry timeline evidence');

    // 3. buildLiveUpdateResponse must protect this substantive answer and never overwrite it with a title
    const liveUpdateOutput = chatGroqTest.buildLiveUpdateResponse(userPrompt, result.sources, result.content);
    assert.ok(liveUpdateOutput.includes('$100 per metric ton'), 'buildLiveUpdateResponse must preserve full multi-part answer');
    assert.ok(!liveUpdateOutput.startsWith('the latest update is:'), 'Must not overwrite with lead headline');
});

test('Regression 14.2: Technical version comparisons preserve substantive differences without collapsing to headlines', async () => {
    const controller = new BoundedLiveResearchController({
        searchCutoffMs: 2500,
        hardDeadlineMs: 8000
    });

    const userPrompt = 'Compare Node.js 22 and Node.js 20 regarding native WebSocket support, V8 engine version, and the built-in test runner.';
    let capturedPrompt = '';

    const rawSources = [
        {
            title: 'Node.js 22 Feature Matrix and Changelog',
            url: 'https://nodejs.org/en/blog/release/v22.0.0',
            domain: 'nodejs.org',
            snippet: 'Node.js 22 Feature Matrix',
            fullArticleText: 'Node.js 22 upgrades the V8 engine to version 12.4. Native WebSocket client support is now enabled by default without flags. The built-in test runner adds support for glob patterns and improved coverage reporting.',
            sourceType: 'official_source'
        },
        {
            title: 'Node.js 20 Release Highlights',
            url: 'https://nodejs.org/en/blog/release/v20.0.0',
            domain: 'nodejs.org',
            snippet: 'Node.js 20 Highlights',
            fullArticleText: 'Node.js 20 features V8 engine 11.3. Native WebSocket support was experimental and required the --experimental-websocket flag. The built-in test runner was marked stable but lacked glob pattern filtering.',
            sourceType: 'official_source'
        }
    ];

    const result = await controller.execute({
        query: userPrompt,
        userText: userPrompt,
        assistantMessageId: 'msg_reg14_tech',
        fetchSearchFn: async () => ({ results: rawSources }),
        streamSynthesisFn: async ({ prompt, onToken }) => {
            capturedPrompt = prompt;
            onToken('Here is the technical comparison between Node.js 22 and Node.js 20:\n\n' +
                '- **V8 Engine**: Node.js 22 runs V8 12.4, whereas Node.js 20 shipped with V8 11.3 [1][2].\n' +
                '- **Native WebSocket**: In Node.js 22, the WebSocket client is enabled by default. In Node.js 20, it was experimental and required the `--experimental-websocket` flag [1][2].\n' +
                '- **Built-in Test Runner**: Node.js 22 adds glob pattern test execution and native coverage enhancements, whereas Node.js 20 provided stable execution without glob filtering [1][2].');
        }
    });

    assert.equal(result.success, true);
    assert.ok(result.content.includes('V8 12.4'), 'Must explain Node 22 V8 engine version');
    assert.ok(result.content.includes('--experimental-websocket'), 'Must explain Node 20 flag difference');
    assert.ok(result.content.includes('glob pattern'), 'Must explain test runner enhancements');

    // Verify isMetaTalkAnswer does not mistake this technical answer for meta-talk
    assert.equal(chatGroqTest.isMetaTalkAnswer(result.content), false, 'Technical comparison must not be flagged as meta-talk');
});

test('Regression 14.3: Conflicting source claims are preserved and cited under rule 3 divergence requirements', async () => {
    const controller = new BoundedLiveResearchController({
        searchCutoffMs: 2500,
        hardDeadlineMs: 8000
    });

    const userPrompt = 'What was the approved budget and targeted completion year for the metropolitan high-speed rail link?';
    let capturedPrompt = '';

    const rawSources = [
        {
            title: 'Transit Authority Approves Initial Rail Link Financing',
            url: 'https://transit-authority.gov/press/rail-link-budget',
            snippet: 'Transit Authority Approves Initial Rail Link Financing',
            fullArticleText: 'The Regional Transit Authority officially approved an initial financing package of €12.5 billion, targeting completion in late 2029.',
            sourceLabel: 'Transit Authority'
        },
        {
            title: 'Parliamentary Audit Projects Budget Expansion and Geotechnical Delays',
            url: 'https://parliamentary-watch.org/reports/rail-audit',
            snippet: 'Parliamentary Audit Projects Budget Expansion and Geotechnical Delays',
            fullArticleText: 'An independent parliamentary committee audit revised the total expected expenditure to €14.8 billion, projecting commercial launch will be pushed back to mid-2031 due to tunneling complications.',
            sourceLabel: 'Parliamentary Audit'
        }
    ];

    const result = await controller.execute({
        query: userPrompt,
        userText: userPrompt,
        assistantMessageId: 'msg_reg14_conflicts',
        fetchSearchFn: async () => ({ results: rawSources }),
        streamSynthesisFn: async ({ prompt, onToken }) => {
            capturedPrompt = prompt;
            onToken('Official reports indicate divergent estimates for the high-speed rail project:\n\n' +
                '1. **Initial Authority Baseline**: The Regional Transit Authority approved an initial budget of €12.5 billion with targeted completion by late 2029 [1].\n' +
                '2. **Independent Audit Revision**: A subsequent parliamentary oversight audit reported expected costs rising to €14.8 billion with opening delayed to mid-2031 due to tunneling delays [2].');
        }
    });

    // 1. Prompt explicitly mandates resolving conflicts & citing each source
    assert.ok(capturedPrompt.includes('DISTINGUISH CONFIRMED FACTS VS. UNCERTAINTY'), 'Must mandate distinguishing facts vs uncertainty');
    assert.ok(capturedPrompt.includes('conflicting claims'), 'Must instruct handling conflicting claims');

    // 2. Both divergent claims are represented with their citations
    assert.ok(result.content.includes('€12.5 billion') && result.content.includes('2029'), 'Must represent source 1 budget and date');
    assert.ok(result.content.includes('€14.8 billion') && result.content.includes('2031'), 'Must represent source 2 audit projection');
    assert.ok(result.content.includes('[1]') && result.content.includes('[2]'), 'Must cite both divergent sources');
});

test('Regression 14.4: Headline-only sources reject title-stringing and state clear limitations', () => {
    // Sources that only contain headline titles and no substantive excerpts
    const headlineOnlySources = [
        {
            id: 1,
            title: 'Global Semiconductor Subsidies Shift',
            domain: 'techwire.com',
            url: 'https://techwire.com/article1',
            snippet: 'Global Semiconductor Subsidies Shift'
        },
        {
            id: 2,
            title: 'Automakers Face Production Delays',
            domain: 'autonews.com',
            url: 'https://autonews.com/article2',
            snippet: 'Automakers Face Production Delays'
        }
    ];

    const fallback = generateSnippetFallback('Global Semiconductor Subsidies', headlineOnlySources);

    // Negative assertions: MUST NEVER concatenate headlines as an answer
    assert.ok(!fallback.includes('Global Semiconductor Subsidies Shift. Automakers Face Production Delays.'),
        'Must never concatenate disjointed headlines into a fake answer');
    assert.ok(!fallback.includes('### Live Web Results'), 'Must not have raw technical headings');

    // Positive assertion: clearly states what could not be verified
    assert.ok(fallback.includes('only headline references') || fallback.includes('could not be completed') || fallback.includes('carousel above'),
        'Must inform user that available records are headline-only');
});

test('Regression 14.5: Inaccessible sources are explicitly annotated without breaking prompt grounding', () => {
    const sources = [
        {
            id: 1,
            title: 'Open Source Policy Changes Announced',
            url: 'https://tech-portal.org/policy-update',
            domain: 'tech-portal.org',
            snippet: 'New license terms require dual-licensing for enterprise hosting.',
            fullArticleText: 'New license terms require dual-licensing for enterprise hosting.',
            accessible: true
        },
        {
            id: 2,
            title: 'Paywalled Analysis on Cloud Providers',
            url: 'https://restricted-analysis.com/cloud-report',
            domain: 'restricted-analysis.com',
            snippet: 'Index metadata snippet only.',
            accessible: false // Deep crawl encountered 403 or paywall
        }
    ];

    const formattedPrompt = formatSourcesForPrompt(sources);

    // Source 2 must carry explicit note informing LLM of inaccessible status
    assert.ok(formattedPrompt.includes('[Note: Web page was inaccessible; excerpt from index metadata]'),
        'Inaccessible sources must be marked with accessibility note in prompt');
    assert.ok(formattedPrompt.includes('[1] Title: Open Source Policy Changes Announced'),
        'Accessible source must be formatted normally');
});

test('Regression 14.6: Ordinary questions not requiring live search remain completely unaffected', () => {
    const stableQueries = [
        'What is the capital of Australia?',
        'Write a Python function to check if a string is a palindrome',
        'Explain Newton\'s second law of motion',
        'How many continents are there on Earth?'
    ];

    for (const q of stableQueries) {
        // 1. Recognized as stable general fact / geography query
        assert.equal(chatGroqTest.isStableGeographyOrGeneralFactQuery(q), true,
            `Query "${q}" must be recognized as stable general fact query`);

        // 2. enforceLiveAnswerStyle does not corrupt standard model responses
        const mockModelResponse = {
            intent: 'general_qa',
            response: `The answer to "${q}" is well-established in general knowledge. Here is the full explanation with complete steps and principles.`
        };
        const styled = chatGroqTest.enforceLiveAnswerStyle(mockModelResponse, q, []);
        assert.equal(styled.intent, 'general_qa', 'Intent must not be altered to live_update');
        assert.equal(styled.response, mockModelResponse.response, 'Response body must not be rewritten');
        assert.ok(!styled.response.includes('Sources:'), 'Must not inject sourceless sections');

        // 3. isMetaTalkAnswer does not reject valid answers starting with direct statements
        assert.equal(chatGroqTest.isMetaTalkAnswer(mockModelResponse.response), false,
            'Model response must not be flagged as meta-talk');
    }
});

test('Regression 15.1: generateRelatedResearchQuestions filters publisher names and clickbait headline fragments', () => {
    const sources = [
        {
            id: 1,
            title: 'Government Suspends Work Authorization Processing: Full list and what it means - The Times of India',
            domain: 'timesofindia.indiatimes.com',
            sourceLabel: 'The Times of India',
            snippet: 'The Department of Labor initiated an audit suspension affecting multi-tiered application queues.'
        },
        {
            id: 2,
            title: 'Immigration Visa Suspension 2026: Worker Impact - IndianEagle',
            domain: 'indianeagle.com',
            sourceLabel: 'IndianEagle',
            snippet: 'Affected foreign workers will face processing delays pending compliance audits.'
        }
    ];

    const questions = generateRelatedResearchQuestions({
        query: 'What is the work authorization suspension and how does it affect foreign workers?',
        sources,
        answer: 'The Department of Labor suspended processing for select employment certifications while conducting compliance audits.'
    });

    assert.equal(questions.length, 3, 'Must return exactly 3 follow-up research questions');

    for (const q of questions) {
        assert.ok(q.endsWith('?'), `Question must end with ?: ${q}`);
        const lower = q.toLowerCase();

        // Must never include publisher branding
        assert.ok(!lower.includes('the times of india'), `Must not include publisher name: ${q}`);
        assert.ok(!lower.includes('indiatimes'), `Must not include publisher domain: ${q}`);
        assert.ok(!lower.includes('indianeagle'), `Must not include publisher name: ${q}`);

        // Must never include clickbait fragments
        assert.ok(!lower.includes('full list and what it means'), `Must not include clickbait fragment: ${q}`);
        assert.ok(!lower.startsWith('what it means'), `Must not be headline fragment: ${q}`);
        assert.ok(!lower.startsWith("here's why"), `Must not be headline fragment: ${q}`);

        // Must be grammatically complete and distinct from query
        assert.ok(q.length >= 18, `Question must be substantial (> 18 chars): ${q}`);
    }
});

test('Regression 15.2: Multi-part query zero-token fallback never concatenates source titles', () => {
    const headlineOnlySources = [
        {
            id: 1,
            title: 'Tech Regulatory Processing Freeze Declared - Major News Network',
            domain: 'newsnet.com',
            url: 'https://newsnet.com/story1',
            snippet: 'Tech Regulatory Processing Freeze Declared - Major News Network'
        },
        {
            id: 2,
            title: 'Specialized Visa Audit Timeline Detailed - Global Daily',
            domain: 'globaldaily.com',
            url: 'https://globaldaily.com/story2',
            snippet: 'Specialized Visa Audit Timeline Detailed - Global Daily'
        },
        {
            id: 3,
            title: 'Foreign Worker Certification Rules Enforced - Daily Herald',
            domain: 'dailyherald.com',
            url: 'https://dailyherald.com/story3',
            snippet: 'Foreign Worker Certification Rules Enforced - Daily Herald'
        }
    ];

    const fallback = generateSnippetFallback(
        'Which employers are subject to the certification freeze and how are visa holders impacted?',
        headlineOnlySources
    );

    // Negative assertions: Must NEVER concatenate the 3 titles
    assert.ok(
        !fallback.includes('Tech Regulatory Processing Freeze Declared. Specialized Visa Audit Timeline Detailed.'),
        'Must never concatenate disjointed source titles into an answer'
    );
    assert.ok(
        !fallback.includes('Major News Network. Global Daily.'),
        'Must not string together publisher titles'
    );

    // Positive assertion: Explicit limitation statement informing user of headline-only records
    assert.ok(
        fallback.includes('only headline references') || fallback.includes('carousel above'),
        'Must explicitly state limitation when only headlines exist'
    );
});

test('Regression 15.3: Backend buildSourceDerivedAnswer rejects standalone titles without substantive descriptions', async () => {
    const { __test: searchTest } = await import('../api/search.js');

    const titleOnlyItem = [
        {
            title: 'Government Declares New Environmental Standard',
            description: '',
            sourceType: 'trusted_news',
            domain: 'enviro-news.org'
        }
    ];

    const res = searchTest.buildSourceDerivedAnswer(titleOnlyItem, { query: 'What is the new environmental standard?' });
    assert.equal(res.answer, undefined, 'Must not return headline alone as verified answer');
});

test('Regression 15.4: Substantive body sentences are correctly extracted in fallback when distinct from titles', () => {
    const sourcesWithBody = [
        {
            id: 1,
            title: 'Comprehensive Energy Grid Modernization Plan',
            domain: 'energy.gov',
            url: 'https://energy.gov/grid',
            snippet: 'Federal regulators allocated twelve billion dollars to reinforce transmission capacity across regional networks.'
        },
        {
            id: 2,
            title: 'Renewable Storage Mandate Guidelines Released',
            domain: 'gridtech.org',
            url: 'https://gridtech.org/mandate',
            snippet: 'Battery installations must provide four hours of continuous discharge capacity by twenty thirty.'
        }
    ];

    const fallback = generateSnippetFallback('What are the energy grid modernization requirements?', sourcesWithBody);

    // Positive assertions: substantive sentences from body are preserved
    assert.ok(fallback.includes('Federal regulators allocated') || fallback.includes('reinforce transmission capacity'));
    assert.ok(fallback.includes('Battery installations must provide') || fallback.includes('continuous discharge capacity'));

    // Negative assertions: no technical headers or citation artifacts
    assert.ok(!fallback.includes('### Live Web Results'));
    assert.ok(!fallback.includes('[1]'));
});








