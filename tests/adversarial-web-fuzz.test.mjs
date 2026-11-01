import test from 'node:test';
import assert from 'node:assert/strict';
import {
    BoundedLiveResearchController,
    generateSnippetFallback,
    isSubstantiveLiveAnswer,
    extractDynamicPublisherBlocklist,
    PROVENANCE_MODES,
    RESEARCH_STATES
} from '../app/bounded-live-research.js';

// ============================================================================
// ADVERSARIAL WEB FUZZ & DIRTY SNIPPET TEST SUITE
// ============================================================================

test('Fuzz Archetype 1: Interrogative Clickbait Teasers ("Who are they?", "Can you guess?") never pass into fallback', () => {
    const dirtySources = [
        {
            title: 'Passport Free Travel Around The World',
            domain: 'travel-gazette.com',
            snippet: 'Only three people in the world can travel without a passport. Who are they? TengriNews.'
        },
        {
            title: 'World Travel Secrets',
            domain: 'insider-explores.org',
            snippet: 'Did you know some world leaders never need passports? Can you guess who they are? Read more.'
        }
    ];

    const fallback = generateSnippetFallback('3 persons in the world can travel without the passport. Who are they?', dirtySources);

    // Negative assertions: Teasers, interrogative questions, and publisher names must NEVER appear
    assert.ok(!fallback.includes('Who are they'), 'Must not include interrogative question "Who are they"');
    assert.ok(!fallback.includes('Can you guess'), 'Must not include clickbait teaser "Can you guess"');
    assert.ok(!fallback.includes('Did you know'), 'Must not include rhetorical question "Did you know"');
    assert.ok(!fallback.includes('TengriNews'), 'Must not include publisher name TengriNews');
    assert.ok(!fallback.includes('Read more'), 'Must not include call-to-action Read more');
    assert.ok(!fallback.includes('?'), 'Fallback facts must never end in or contain question marks');
});

test('Fuzz Archetype 2: Dynamic Publisher & Brand Suffix Stripping without hardcoding', () => {
    // Generate randomized arbitrary domains to guarantee zero hardcoding
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    const domainA = `portal-${randomSuffix}.net`;
    const domainB = `news-hub-${randomSuffix}.org`;
    const publisherA = `Portal${randomSuffix.toUpperCase()}`;
    const publisherB = `NewsHub${randomSuffix.toUpperCase()}`;

    const sources = [
        {
            title: `Breaking Updates - ${publisherA}`,
            domain: domainA,
            publisher: publisherA,
            snippet: `Autonomous solar drone completed its 48-hour continuous flight test across the desert. ${publisherA}.`
        },
        {
            title: `Aviation Today | ${publisherB}`,
            domain: domainB,
            publisher: publisherB,
            snippet: `The lightweight composite airframe maintained steady telemetry throughout turbulence. ${domainB}.`
        }
    ];

    const blocklist = extractDynamicPublisherBlocklist(sources);
    assert.ok(blocklist.has(publisherA.toLowerCase()));
    assert.ok(blocklist.has(publisherB.toLowerCase()));
    assert.ok(blocklist.has(domainA));

    const fallback = generateSnippetFallback('solar drone continuous flight test results', sources);

    assert.ok(fallback.includes('Autonomous solar drone completed its 48-hour continuous flight test'), 'Must preserve substantive facts');
    assert.ok(fallback.includes('lightweight composite airframe'), 'Must preserve secondary substantive facts');
    assert.ok(!fallback.includes(publisherA), 'Must strip dynamic publisher A');
    assert.ok(!fallback.includes(domainB), 'Must strip dynamic domain B');
});

test('Fuzz Archetype 3: Query Echoes & Premise Repeaters rejected as non-informative', () => {
    const userQuery = 'How does photosynthetic water oxidation produce oxygen gas in plants?';
    const echoingSources = [
        {
            title: 'Plant Photosynthesis Guide',
            domain: 'biology-primer.edu',
            // Echoes query premise almost verbatim without answering
            snippet: 'Photosynthetic water oxidation produces oxygen gas in plants. Learn more about biology below.'
        },
        {
            title: 'Water Splitting Complex Overview',
            domain: 'science-archive.org',
            // Contains substantive chemical mechanism answer
            snippet: 'The oxygen-evolving complex contains a manganese-calcium cluster that catalyzes the four-electron oxidation of water into molecular oxygen and protons.'
        }
    ];

    const fallback = generateSnippetFallback(userQuery, echoingSources);

    // Substantive mechanism must be present, echoing sentence must not dominate
    assert.ok(fallback.includes('manganese-calcium cluster'), 'Must extract substantive scientific detail');
    assert.ok(fallback.includes('four-electron oxidation'), 'Must extract substantive chemical mechanism');
    assert.ok(!fallback.includes('Learn more about biology below'), 'Must drop promotional sentence');
});

test('Fuzz Archetype 4: SEO, Paywalls, Shutterstock, and Social Call-to-Actions stripped', () => {
    const noisySources = [
        {
            title: 'Space Telescope Science Release',
            domain: 'deepspace-today.com',
            snippet: 'Photo: Shutterstock / NASA. Subscribe to our daily newsletter for more updates. Telegram channel: t.me/deepspace. The observatory detected high-density atmospheric carbon monoxide on WASP-121b.'
        }
    ];

    const fallback = generateSnippetFallback('WASP-121b atmospheric carbon monoxide observations', noisySources);

    assert.ok(!fallback.includes('Shutterstock'), 'Must strip Shutterstock photo credits');
    assert.ok(!fallback.includes('newsletter'), 'Must strip newsletter solicitations');
    assert.ok(!fallback.includes('Telegram'), 'Must strip social media/telegram promos');
    assert.ok(fallback.includes('high-density atmospheric carbon monoxide'), 'Must retain valid astronomical discovery');
});

test('Fuzz Archetype 5: Malformed Punctuation (?., ?!, ellipsis, unicode zero-width characters)', () => {
    const malformedSources = [
        {
            title: 'Quantum Computing Milestones',
            domain: 'physics-insider.io',
            snippet: 'Can superconducting qubits scale to 10,000 gates?!. Error 500.\u200B The novel cryo-CMOS controller reduced thermal dissipation by 35 percent at 20 millikelvin.... Details inside.'
        }
    ];

    const fallback = generateSnippetFallback('cryo-CMOS controller thermal dissipation quantum computing', malformedSources);

    assert.ok(!fallback.includes('?!'), 'Must not contain double/malformed punctuation');
    assert.ok(!fallback.includes('Error 500'), 'Must not contain server error codes');
    assert.ok(!fallback.includes('Details inside'), 'Must not contain clickbait call to action');
    assert.ok(fallback.includes('thermal dissipation by 35 percent'), 'Must cleanly capture verified factual metric');
});

test('Fuzz Archetype 6: Pure-Teaser sources cleanly trigger limitation without emitting teasers', () => {
    const pureTeaserSources = [
        {
            title: 'Secret Passport Rules',
            domain: 'clicky-travel.com',
            snippet: 'Only 3 persons in the world can travel without a passport. Who are they? Find out here!'
        },
        {
            title: 'Passport Privileges Unveiled',
            domain: 'viral-hub.net',
            snippet: 'Did you know this shocking travel fact? Click here to read full article.'
        }
    ];

    const fallback = generateSnippetFallback('3 persons in the world can travel without the passport. Who are they?', pureTeaserSources);

    // When snippets only have clickbait teasers with zero declarative facts, fallback must state clean limitation
    assert.ok(!fallback.includes('Who are they?. TengriNews'), 'Must NEVER emit the teaser fragment');
    assert.ok(!fallback.startsWith('Only 3 persons in the world can travel without a passport'), 'Must not emit premise as answer');
    assert.ok(!fallback.includes('shocking travel fact'), 'Must NEVER emit clickbait phrase');
    assert.ok(!fallback.includes('Click here'), 'Must NEVER emit clickbait action');
    assert.ok(fallback.includes('did not contain sufficient substantive detail') || fallback.includes('carousel above'),
        'Must return transparent limitation notice rather than stitched teaser garbage');
});

// ============================================================================
// SUBSTANTIVE ANSWER EVALUATION CONTRACT TESTS
// ============================================================================

test('Substantive Invariant: isSubstantiveLiveAnswer validates declarative depth and rejects incomplete fragments', () => {
    // Valid substantive web answers
    assert.equal(isSubstantiveLiveAnswer('The three individuals permitted international travel without passports are the reigning British monarch (King Charles III), the Emperor of Japan (Naruhito), and the Empress of Japan (Masako).', PROVENANCE_MODES.WEB_GROUNDED), true);
    assert.equal(isSubstantiveLiveAnswer('Python 3.14 introduces template strings, major interpreter optimizations, and security enhancements for cryptographic protocols.', PROVENANCE_MODES.WEB_GROUNDED), true);

    // Invalid non-substantive fragments (must be rejected)
    assert.equal(isSubstantiveLiveAnswer('Who are they?. TengriNews.', PROVENANCE_MODES.WEB_GROUNDED), false, 'Teasers must fail substantive check');
    assert.equal(isSubstantiveLiveAnswer('Who are they?', PROVENANCE_MODES.WEB_GROUNDED), false, 'Interrogative questions must fail check');
    assert.equal(isSubstantiveLiveAnswer('Too short', PROVENANCE_MODES.WEB_GROUNDED), false, 'Short fragments under 40 chars must fail');
    assert.equal(isSubstantiveLiveAnswer('Verified live sources were gathered regarding "topic", but they did not contain sufficient substantive detail to construct an answer.', PROVENANCE_MODES.WEB_GROUNDED), false, 'Limitation disclaimers must fail check');
    assert.equal(isSubstantiveLiveAnswer('Some valid text', PROVENANCE_MODES.SYNTHESIS_FALLBACK), false, 'Non web_grounded provenance must fail check');
    assert.equal(isSubstantiveLiveAnswer('', PROVENANCE_MODES.WEB_GROUNDED), false, 'Empty string must fail check');
    assert.equal(isSubstantiveLiveAnswer(null, PROVENANCE_MODES.WEB_GROUNDED), false, 'Null must fail check');
});

// ============================================================================
// END-TO-END LATENCY CHAOS & CUTOFF RACES
// ============================================================================

test('Chaos 1: Slow search near cutoff + empty LLM response -> Clean fallback without teasers', async () => {
    const controller = new BoundedLiveResearchController({
        searchCutoffMs: 200,
        fallbackWarningMs: 400,
        hardDeadlineMs: 600
    });

    const dirtySources = [
        {
            title: 'Passport Free Travel Around The World',
            domain: 'travel-gazette.com',
            url: 'https://travel-gazette.com/passport-free',
            snippet: 'Only three people in the world can travel without a passport. Who are they? TengriNews.'
        }
    ];

    const result = await controller.execute({
        query: '3 persons in the world can travel without the passport. Who are they?',
        userText: '3 persons in the world can travel without the passport. Who are they?',
        assistantMessageId: 'msg_chaos_1',
        fetchSearchFn: async () => {
            // Simulates search completing right before cutoff
            await new Promise(r => setTimeout(r, 80));
            return { results: dirtySources };
        },
        streamSynthesisFn: async ({ onToken }) => {
            // Simulates empty response / token refusal
            onToken('   ');
        }
    });

    assert.equal(result.success, false);
    assert.equal(result.fallback, true);
    assert.equal(result.provenance, PROVENANCE_MODES.SYNTHESIS_FALLBACK);
    assert.equal(result.sources.length, 1);
    assert.ok(result.telemetry.degradedAnomaly === true, 'Telemetry must flag degradedAnomaly on synthesis fallback');

    // Content must NEVER contain interrogative questions or publisher names
    assert.ok(!result.content.includes('Who are they?'), 'Fallback content must not contain teaser question');
    assert.ok(!result.content.includes('TengriNews'), 'Fallback content must not contain publisher name');
});

test('Chaos 2: Mobile 4G jitter simulation (aborted token stream at 9.0s deadline)', async () => {
    const controller = new BoundedLiveResearchController({
        searchCutoffMs: 100,
        fallbackWarningMs: 250,
        hardDeadlineMs: 350
    });

    const result = await controller.execute({
        query: 'Latest advancements in solid state batteries 2026',
        userText: 'Latest advancements in solid state batteries 2026',
        assistantMessageId: 'msg_chaos_2',
        fetchSearchFn: async () => {
            return {
                results: [
                    {
                        title: 'Solid State Battery Progress',
                        domain: 'battery-tech.org',
                        url: 'https://battery-tech.org/solid-state',
                        snippet: 'Silicon-composite solid state cells reached 450 Wh/kg with over 1000 charge cycles in recent lab validation.'
                    }
                ]
            };
        },
        streamSynthesisFn: async ({ onToken, signal }) => {
            // Emits very few tokens (< 30 chars) and hangs until hard deadline aborts it
            onToken('Solid-state: ');
            await new Promise((_, reject) => {
                signal.addEventListener('abort', () => reject(new Error('AbortError')));
            });
        }
    });

    assert.equal(result.fallback, true);
    assert.equal(result.provenance, PROVENANCE_MODES.SYNTHESIS_FALLBACK);
    assert.ok(result.content.includes('Silicon-composite solid state cells reached 450 Wh/kg'),
        'Fallback must preserve verified battery metric from sources');
    assert.ok(!result.content.includes('deadline'), 'Must not include deadline timing disclaimers');
    assert.ok(!result.content.includes('### Live Web Results'), 'Must not include technical markdown headings');
});

test('Chaos 3: Mixed sources with clean facts and clickbait preserves clean facts and drops clickbait', () => {
    const mixedSources = [
        {
            title: 'Voyager Mission Telemetry Status',
            domain: 'spaceflight-now.com',
            snippet: 'Will Voyager 1 survive into 2027? TengriNews. NASA engineers successfully switched the probe to its secondary thruster branch located 24 billion kilometers from Earth.'
        },
        {
            title: 'Deep Space Communication Network',
            domain: 'aerospace-weekly.org',
            snippet: 'Can you guess how long radio signals take to reach interstellar space? Subscribe now for breaking news. Two-way light time to Voyager 1 currently exceeds 45 hours.'
        }
    ];

    const fallback = generateSnippetFallback('Voyager 1 thruster status and signal communication time', mixedSources);

    // Negative assertions: clickbait must be excised
    assert.ok(!fallback.includes('Will Voyager 1 survive'), 'Must drop teaser question');
    assert.ok(!fallback.includes('TengriNews'), 'Must drop publisher name');
    assert.ok(!fallback.includes('Can you guess'), 'Must drop clickbait opener');
    assert.ok(!fallback.includes('Subscribe now'), 'Must drop subscription prompt');

    // Positive assertions: substantive facts must be retained
    assert.ok(fallback.includes('NASA engineers successfully switched the probe to its secondary thruster branch'), 'Must preserve thruster fact');
    assert.ok(fallback.includes('Two-way light time to Voyager 1 currently exceeds 45 hours'), 'Must preserve light time fact');
});
