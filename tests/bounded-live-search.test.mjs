import test from 'node:test';
import assert from 'node:assert/strict';
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
    hasSearchableContent
} from '../app/bounded-live-research.js';
import { parseGoogleNewsRssXml } from '../api/_lib/free-live/providers.js';
import { buildSourceTransparencyHtml } from '../app/source-transparency.js';

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

    assert.equal(llmSynthesisCalled, false, 'LLM synthesis must NEVER be called when zero sources exist');
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

    assert.equal(llmSynthesisCalled, true, 'LLM synthesis must be invoked when valid sources exist');
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

    assert.equal(result.success, false, 'Must report success: false when synthesis fails to produce content');
    assert.equal(result.fallback, true, 'Must flag fallback: true');
    assert.equal(result.provenance, PROVENANCE_MODES.SYNTHESIS_FALLBACK);
    assert.equal(result.sources.length, 1, 'Sources must be preserved in fallback');
    assert.ok(result.content.includes('Verified Summary for "James Webb latest observations"'));
    assert.ok(result.content.includes('Water vapor detected on K2-18b. [1]'));
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

    assert.equal(onSourcesReadyCalled, false, 'onSourcesReady must NOT be invoked when sources are empty');
    assert.equal(validatedProvenance, PROVENANCE_MODES.NO_SOURCES);
    assert.equal(result.provenance, PROVENANCE_MODES.NO_SOURCES);
    assert.notEqual(result.provenance, PROVENANCE_MODES.WEB_GROUNDED);

    // Also verify UI helper suppresses badge when zero sources
    const renderedHtml = buildSourceTransparencyHtml({
        sourceType: 'verified',
        verified: true,
        sources: []
    }, 'Fallback content');
    assert.equal(renderedHtml, '', 'Source transparency HTML must be empty when sources list is empty');
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
            assert.ok(!lower.includes('what are the latest updates on what are the latest updates'), 'Must not duplicate prefix');
            assert.ok(!lower.includes('tell me the latest news about tell me the latest news'), 'Must not duplicate prefix');
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

    // When valid query is passed with zero sources
    const validRes = generateSnippetFallback('Mars Rover', []);
    assert.ok(validRes.includes('Mars Rover'));
    assert.ok(validRes.includes('did not return verified records before the deadline'));
});

test('Centralized LIVE_RESEARCH_BUDGETS contract & defaults', () => {
    assert.equal(LIVE_RESEARCH_BUDGETS.HARD_DEADLINE_MS, 9000);
    assert.equal(LIVE_RESEARCH_BUDGETS.SEARCH_CUTOFF_MS, 5000);
    assert.equal(LIVE_RESEARCH_BUDGETS.SEARCH_TIMEOUT_MS, 4800);
    assert.equal(LIVE_RESEARCH_BUDGETS.FALLBACK_WARNING_MS, 8500);
    assert.equal(LIVE_RESEARCH_BUDGETS.MIN_SOURCES_FOR_EARLY_SYNTHESIS, 2);

    const controller = new BoundedLiveResearchController();
    assert.equal(controller.hardDeadlineMs, 9000);
    assert.equal(controller.searchCutoffMs, 5000);
    assert.equal(controller.searchTimeoutMs, 4800);
    assert.equal(controller.fallbackWarningMs, 8500);
    assert.equal(controller.minSourcesForEarlySynthesis, 2);
    assert.equal(controller.telemetry.providerTiming, null);
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
    assert.ok(!transitions.includes(RESEARCH_STATES.NO_SOURCES), 'Should not enter NO_SOURCES when 1 source is present');
});


