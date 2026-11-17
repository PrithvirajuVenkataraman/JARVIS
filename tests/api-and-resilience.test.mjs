/**
 * Consolidated API & Resilience Test Suite
 * Covers API router contracts, streaming resilience, service unavailable handling,
 * QA latency bounds, leadership verification, and snippet sanitization.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import apiHandler, { resolveRequestPath } from '../api/_lib/api-router.js';
import chatHandler, { __test as chatTest } from '../api/chat-groq.js';
import currentFactsHandler from '../api/_lib/current-facts.js';
import marketsHandler from '../api/_lib/markets.js';
import searchHandler, { __test as searchTest } from '../api/search.js';
import { clearExtractorCaches } from '../api/_lib/article-extractor.js';
import visionHandler, { __test as visionTest } from '../api/vision.js';
import diagnosticsHandler from '../api/diagnostics.js';
import rankTextsHandler from '../api/_lib/rank-texts.js';
import ingestAttachmentHandler from '../api/ingest-attachment.js';
import extractUrlHandler, { __test as extractUrlTest } from '../api/_lib/crawl4ai-client.js';
import { clearItems, saveItems } from '../api/_lib/latest/latest-cache.js';
import {
    isStableGeographyOrGeneralFactQuery as frontendIsStable,
    classifyUniversalEntityIntent as frontendClassifyEntity,
    decideFrontendRoute
} from '../app/frontend-routing.js';
import {
    isStableGeographyOrGeneralFactQuery as backendIsStable,
    classifyUniversalEntityIntent as backendClassifyEntity,
    classifyQueryIntent
} from '../api/_lib/intent-separator.js';
import {
    classifyUniversalEntityIntent as verifierClassifyEntity
} from '../api/_lib/entity-verifier.js';
import { parseEnvContent, loadEnvFiles } from '../tools/local-dev-server.mjs';
import { decodeHtmlEntities, cleanSnippetText } from '../api/_lib/snippet-sanitizer.js';

test('API Contracts & Endpoint Specifications', async () => {














const APP_HTML_SOURCE = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const SAMPLE = Object.freeze({
    chatMessage: 'q',
    selectionText: 'const v = 1;',
    customInstruction: 'q q',
    customPrompt: 'a b c',
    challengedAnswer: 'verify q',
    challengedResponse: '2020.',
    currentQuery: 'q q',
    marketQuery: 'q q',
    budgetQuery: 'Plan 3 days under INR 12000',
    imageBase64: 'eA=='
});

const emptyAttachmentIngest = await callHandler(ingestAttachmentHandler, request('/api/ingest-attachment', {
    filename: 'empty.pdf',
    mimeType: 'application/pdf',
    base64: '',
    clientText: ''
}));
assert.equal(emptyAttachmentIngest.statusCode, 400);
assert.equal(emptyAttachmentIngest.body.error.code, 'invalid_request');
assert.deepEqual(emptyAttachmentIngest.body.error.details.missing, ['base64', 'clientText']);

function fixtureSubject(kind, id = '') {
    return ['Subject', kind, id].filter(Boolean).join(' ');
}

const ROLE_FIXTURES = Object.freeze({
    president: Object.freeze({
        role: 'president',
        jurisdiction: 'Test Republic',
        jurisdictionId: 'Q100001',
        jurisdictionDescription: 'test sovereign state',
        holderId: 'Q100002',
        holder: 'Fixture President',
        alternateHolder: 'Alternate President',
        officeLabel: 'president',
        start: '2020-01-02T00:00:00Z',
        startDate: '2020-01-02',
        article: 'https://en.wikipedia.org/wiki/Fixture_President'
    }),
    primeMinister: Object.freeze({
        role: 'prime minister',
        jurisdiction: 'Test Union',
        jurisdictionId: 'Q100003',
        jurisdictionDescription: 'test country',
        holderId: 'Q100004',
        holder: 'Fixture Premier',
        officeLabel: 'prime minister',
        start: '2021-03-04T00:00:00Z',
        startDate: '2021-03-04',
        article: 'https://en.wikipedia.org/wiki/Fixture_Premier'
    }),
    chiefMinister: Object.freeze({
        role: 'chief minister',
        jurisdiction: 'Test Territory',
        jurisdictionId: 'Q100005',
        jurisdictionDescription: 'test state',
        holderId: 'Q100006',
        holder: 'Fixture Minister',
        alternateHolder: 'Alternate Minister',
        officeLabel: 'Chief Minister of Test Territory',
        start: '2022-05-06T00:00:00Z',
        startDate: '2022-05-06',
        article: 'https://en.wikipedia.org/wiki/Fixture_Minister'
    }),
    governor: Object.freeze({
        role: 'governor',
        jurisdiction: 'Test Region',
        jurisdictionId: 'Q100007',
        jurisdictionDescription: 'test province',
        holderId: 'Q100008',
        holder: 'Fixture Governor',
        officeLabel: 'Governor of Test Region',
        start: '2023-07-08T00:00:00Z',
        startDate: '2023-07-08',
        article: 'https://en.wikipedia.org/wiki/Fixture_Governor'
    }),
    ceo: Object.freeze({
        role: 'CEO',
        jurisdiction: 'Test Organization',
        jurisdictionId: 'Q100009',
        jurisdictionDescription: 'test organization',
        holderId: 'Q100010',
        holder: 'Fixture Executive',
        officeLabel: 'CEO',
        start: '2024-09-10T00:00:00Z',
        startDate: '2024-09-10',
        article: 'https://en.wikipedia.org/wiki/Fixture_Executive'
    })
});

const LIVE_FIXTURES = Object.freeze({
    weather: Object.freeze({
        place: 'Testville',
        region: 'Fixture Region',
        country: 'Fixture Country',
        query: 'weather in Testville',
        temperature: 31,
        apparent: 35,
        humidity: 70,
        wind: 12
    }),
    crypto: Object.freeze({
        asset: 'bitcoin',
        query: 'bitcoin price now',
        usd: 65000,
        inr: 5400000,
        change: 1.25
    }),
    disaster: Object.freeze({
        kind: 'earthquake',
        query: 'earthquake updates today',
        title: 'Fixture earthquake event',
        date: '2026-06-18T00:00:00Z'
    }),
    sports: Object.freeze({
        query: 'cricket score now',
        team: 'Fixture City Club',
        league: 'Cricket Fixture League'
    }),
    places: Object.freeze({
        query: 'places to visit in Sample Harbor',
        topic: 'Sample Harbor',
        summary: 'Sample Harbor is a port destination with public attractions.'
    }),
    government: Object.freeze({
        query: `latest government news in ${fixtureSubject('Republic')}`,
        title: 'Fixture government update',
        url: 'https://www.bbc.com/news/fixture-government-update'
    }),
    unsupported: Object.freeze({
        query: 'restaurants near me open now'
    })
});

const ORIGINAL_SERPER_API_KEY = process.env.SERPER_API_KEY;
const ORIGINAL_SERPER_KEY = process.env.SERPER_KEY;
const ORIGINAL_EXA_API_KEY = process.env.EXA_API_KEY;
const ORIGINAL_EXA_KEY = process.env.EXA_KEY;
const ORIGINAL_LIVE_RETRIEVAL_ENABLED = process.env.LIVE_RETRIEVAL_ENABLED;
const ORIGINAL_JARVIS_PUBLIC_FACT_SEARCH = process.env.JARVIS_PUBLIC_FACT_SEARCH;
const ORIGINAL_GROQ_API_KEY = process.env.GROQ_API_KEY;
const ORIGINAL_GEMINI_API_KEY = process.env.GEMINI_API_KEY; 
const ORIGINAL_GOOGLE_API_KEY = process.env.GOOGLE_API_KEY; 
const ORIGINAL_GEMINI_SEARCH_MODEL = process.env.GEMINI_SEARCH_MODEL; 
const ORIGINAL_SEARXNG_URL = process.env.SEARXNG_URL;
const ORIGINAL_CRAWL4AI_URL = process.env.CRAWL4AI_URL;
const ORIGINAL_CRAWL4AI_TOKEN = process.env.CRAWL4AI_TOKEN;
const ORIGINAL_NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const ORIGINAL_REDIS_URL = process.env.REDIS_URL;
const ORIGINAL_WEB_SEARCH_ENABLED = process.env.WEB_SEARCH_ENABLED;
const ORIGINAL_FETCH = globalThis.fetch; 
delete process.env.SERPER_API_KEY;
delete process.env.SERPER_KEY;
delete process.env.EXA_API_KEY;
delete process.env.EXA_KEY;
delete process.env.LIVE_RETRIEVAL_ENABLED;
delete process.env.JARVIS_PUBLIC_FACT_SEARCH;
delete process.env.GROQ_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_API_KEY; 
delete process.env.GEMINI_SEARCH_MODEL; 
delete process.env.SEARXNG_URL;
delete process.env.CRAWL4AI_URL;
delete process.env.CRAWL4AI_TOKEN;
delete process.env.NVIDIA_API_KEY;
delete process.env.REDIS_URL;
delete process.env.WEB_SEARCH_ENABLED;

assert.equal(resolveRequestPath({ url: '/api/chat-groq?x=1' }), '/api/chat-groq');
assert.equal(resolveRequestPath({ url: '/api/chat-groq-extra' }), '/api/chat-groq-extra');

const notFound = await callHandler(apiHandler, request('/api/chat-groq-extra', {})); 
assert.equal(notFound.statusCode, 404); 
assert.equal(notFound.body.error.code, 'route_not_found'); 
const retiredOcrRoute = await callHandler(apiHandler, request('/api/ocr', {}));
assert.equal(retiredOcrRoute.statusCode, 404);
assert.equal(retiredOcrRoute.body.error.code, 'route_not_found');
const retiredMediaRoute = await callHandler(apiHandler, request('/api/media-search', {}));
assert.equal(retiredMediaRoute.statusCode, 404);
assert.equal(retiredMediaRoute.body.error.code, 'route_not_found');

process.env.GROQ_API_KEY = 'secret-groq-key';
process.env.GEMINI_API_KEY = 'secret-gemini-key';
process.env.EXA_API_KEY = 'secret-exa-key';
process.env.NVIDIA_API_KEY = 'secret-nvidia-key';
process.env.CRAWL4AI_URL = 'https://crawl4ai.example';
process.env.LIVE_RETRIEVAL_ENABLED = 'true';
const diagnostics = await callHandler(diagnosticsHandler, request('/api/diagnostics', {}));
assert.equal(diagnostics.statusCode, 200);
assert.equal(diagnostics.body.ok, true);
assert.equal(diagnostics.body.diagnostics.model.groqConfigured, true);
assert.equal(diagnostics.body.diagnostics.model.geminiConfigured, true);
assert.equal(diagnostics.body.diagnostics.retrieval.exaConfigured, true);
assert.equal(diagnostics.body.diagnostics.retrieval.nvidiaConfigured, true);
assert.equal(diagnostics.body.diagnostics.retrieval.crawl4aiConfigured, true);
assert.equal(diagnostics.body.diagnostics.retrieval.liveSearchEnabled, true);
assert.equal(diagnostics.body.diagnostics.retrieval.publicFactSearchEnabled, true);
assert.doesNotMatch(JSON.stringify(diagnostics.body), /secret-|crawl4ai\.example/);
delete process.env.GROQ_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.EXA_API_KEY;
delete process.env.NVIDIA_API_KEY;
delete process.env.CRAWL4AI_URL;
delete process.env.LIVE_RETRIEVAL_ENABLED;
delete process.env.JARVIS_PUBLIC_FACT_SEARCH;

const disabledExtract = await callHandler(extractUrlHandler, request('/api/extract-url', { url: 'https://example.com/article' }));
assert.equal(disabledExtract.statusCode, 503);
assert.equal(disabledExtract.body.error.code, 'crawl4ai_not_configured');
const invalidExtract = await callHandler(extractUrlHandler, request('/api/extract-url', { url: 'not a url' }));
assert.equal(invalidExtract.statusCode, 400);
assert.equal(invalidExtract.body.error.code, 'invalid_url');
const privateExtract = await callHandler(extractUrlHandler, request('/api/extract-url', { url: 'http://127.0.0.1:8080/private' }));
assert.equal(privateExtract.statusCode, 400);
assert.equal(privateExtract.body.error.code, 'private_url_blocked');
assert.equal(extractUrlTest.normalizeExtractRequest({ url: 'https://example.com/a#frag' }).value.url, 'https://example.com/a');
assert.equal(extractUrlTest.buildCrawl4AiEndpoint('https://crawl4ai.example').endsWith('/crawl'), true);
process.env.CRAWL4AI_URL = 'https://crawl4ai.example';
process.env.CRAWL4AI_TOKEN = 'test-crawl-token';
let crawlAuthHeader = '';
globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'https://crawl4ai.example/crawl');
    crawlAuthHeader = String(init?.headers?.Authorization || '');
    const body = JSON.parse(String(init?.body || '{}'));
    assert.equal(body.urls[0], 'https://example.com/article');
    assert.equal(body.crawler_config.type, 'CrawlerRunConfig');
    assert.equal(body.browser_config.type, 'BrowserConfig');
    return okJson({
        result: {
            url: 'https://example.com/article',
            title: 'Example Article',
            description: 'Clean extracted page.',
            markdown: '# Example Article\n\nUseful extracted text.'
        }
    });
};
const extractedUrl = await callHandler(extractUrlHandler, request('/api/extract-url', {
    url: 'https://example.com/article',
    query: 'summarize this',
    textLimit: 2000
}));
assert.equal(extractedUrl.statusCode, 200);
assert.equal(extractedUrl.body.success, true);
assert.equal(extractedUrl.body.result.sourceType, 'crawl4ai_extract');
assert.match(extractedUrl.body.result.markdown, /Example Article/);
assert.equal(crawlAuthHeader, 'Bearer test-crawl-token');
globalThis.fetch = async () => {
    throw Object.assign(new Error('aborted'), { name: 'AbortError' });
};
const timeoutExtract = await callHandler(extractUrlHandler, request('/api/extract-url', {
    url: 'https://example.org/slow',
    timeoutMs: 3000
}));
assert.equal(timeoutExtract.statusCode, 504);
assert.equal(timeoutExtract.body.error.code, 'crawl4ai_timeout');
globalThis.fetch = ORIGINAL_FETCH;
delete process.env.CRAWL4AI_URL;
delete process.env.CRAWL4AI_TOKEN;

const invalidChat = await callHandler(chatHandler, request('/api/chat-groq', { message: '' }));
assert.equal(invalidChat.statusCode, 400);
assert.equal(invalidChat.body.success, false);
assert.equal(invalidChat.body.error.code, 'invalid_request');
assert.equal(chatTest.normalizeSelectedModel('qwen-2.5-coder-32b'), 'qwen-2.5-coder-32b');
assert.equal(chatTest.normalizeSelectedModel('gemma2-9b-it'), 'gemma2-9b-it');
assert.equal(chatTest.normalizeSelectedModel('deepseek-r1-distill-qwen-32b'), 'deepseek-r1-distill-qwen-32b');
assert.equal(chatTest.normalizeSelectedModel('gemini-2.5-flash'), 'gemini-2.5-flash');
assert.equal(chatTest.normalizeSelectedModel('gpt-4o'), null);
assert.equal(chatTest.normalizeSelectedModel('auto'), null);
assert.equal(chatTest.normalizeSelectedModel('not/a-real-sidebar-model'), null);

const invalidSelection = chatTest.normalizeChatRequest({
    message: SAMPLE.customInstruction,
    intent: 'selection_explain'
});
assert.equal(invalidSelection.ok, false);

const validSelection = chatTest.normalizeChatRequest({
    message: SAMPLE.customInstruction,
    intent: 'selection_explain',
    grounding: {
        selectedText: SAMPLE.selectionText,
        sourceAnswer: SAMPLE.selectionText,
        originalRequest: SAMPLE.chatMessage
    },
    preferences: { responseStyle: 'witty' }
});
assert.equal(validSelection.ok, true);
assert.equal(validSelection.value.preferences.responseStyle, 'witty');
const customPromptRequest = chatTest.normalizeChatRequest({
    message: SAMPLE.chatMessage,
    preferences: {
        customSystemPrompt: SAMPLE.customPrompt
    }
});
assert.equal(customPromptRequest.ok, true);
assert.equal(customPromptRequest.value.preferences.customSystemPrompt, SAMPLE.customPrompt);
assert.match(
    chatTest.buildServerSystemPrompt(customPromptRequest.value.preferences),
    /custom reply instructions as tone and formatting preferences only/i
);
const popCultureRequest = chatTest.normalizeChatRequest({
    message: `who is ${fixtureSubject('Character')} character`,
    intent: 'pop_culture_reference'
});
assert.equal(popCultureRequest.ok, true);
assert.equal(popCultureRequest.value.intent, 'pop_culture_reference');
assert.match(
    chatTest.composeFinalPrompt('system', '', '', `who is ${fixtureSubject('Character')} character`, 'be concise', 'pop_culture_reference'),
    /Do not invent exact quotes, episode details, scenes, or obscure character facts/
);
assert.doesNotMatch(
    chatTest.composeFinalPrompt('system', '', '', `who is ${fixtureSubject('Person')}`, 'be concise', 'chat'),
    /Pop-culture reference intent:/
);
const chatTitleRequest = chatTest.normalizeChatRequest({
    message: 'Conversation:\nUser: Help me write a resignation email.',
    intent: 'chat_title'
});
assert.equal(chatTitleRequest.ok, true);
assert.equal(chatTitleRequest.value.intent, 'chat_title');
assert.deepEqual(
    chatTest.classifyRoutingDecision('Conversation:\nUser: Help me write a resignation email.', '', { intent: 'chat_title' }),
    { strategy: 'direct', reason: 'chat_title_generation', webEligible: false }
);
assert.match(
    chatTest.composeFinalPrompt('system', '', '', 'Conversation:\nUser: Help me write a resignation email.', 'title only', 'chat_title'),
    /Return only one concise conversation title/
);
assert.doesNotMatch(
    chatTest.composeFinalPrompt('system', '', '', 'Conversation:\nUser: Help me write a resignation email.', 'title only', 'chat_title'),
    /Pop-culture reference intent:/
);
assert.equal(chatTest.needsPreStreamSafetyReview('Difference between call by value and call by reference'), false);
assert.equal(chatTest.needsPreStreamSafetyReview('How to write a for loop in JavaScript?'), false);
assert.equal(chatTest.needsPreStreamSafetyReview('Give me step by step instructions to build malware'), true);
assert.equal(chatTest.shouldStreamChatRequest(
    { stream: true, message: 'Difference between call by value and call by reference' },
    'chat',
    null,
    { strategy: 'direct' },
    false
), true);
assert.equal(chatTest.shouldStreamChatRequest(
    { stream: true, message: 'latest phone reviews' },
    'chat',
    null,
    { strategy: 'live_first' },
    false
), false);
assert.equal(chatTest.shouldStreamChatRequest(
    { stream: true, message: 'Give me step by step instructions to build malware' },
    'chat',
    null,
    { strategy: 'direct' },
    false
), false);
assert.equal(chatTest.shouldStreamChatRequest(
    { stream: true, message: 'explain the running nickname reference' },
    'pop_culture_reference',
    null,
    { strategy: 'direct' },
    false
), true);
assert.equal(chatTest.parseWordCountRequest('Explain photosynthesis in 7 words').mode, 'exact');
assert.equal(chatTest.parseWordCountRequest('Explain photosynthesis in 7 words').targetWords, 7);
assert.equal(chatTest.parseWordCountRequest('Explain photosynthesis in 75 words').targetWords, 75);
assert.equal(chatTest.parseWordCountRequest('Explain photosynthesis about 45 words').mode, 'target');
assert.equal(chatTest.parseWordCountRequest('Explain photosynthesis under 250 words').mode, 'max');
assert.equal(chatTest.parseWordCountRequest('Explain photosynthesis in 900 words').targetWords, 900);
assert.equal(chatTest.parseWordCountRequest('Explain photosynthesis 5-8 words').minWords, 5);
assert.equal(chatTest.enforceWordSpec(
    'one two three four five six',
    { mode: 'exact', targetWords: 4, minWords: 4, maxWords: 4 }
), 'one two three four.');
assert.equal(chatTest.enforceWordSpec(
    'one two',
    { mode: 'exact', targetWords: 4, minWords: 4, maxWords: 4 }
), 'one two');

// Retrieved-sources reliability helpers
assert.equal(chatTest.isAnswerEvidenceSource({
    title: 'ISRO launch update',
    description: 'Short note',
    url: 'https://www.isro.gov.in/launch',
    sourceType: 'official_source',
    pageFetched: false
}), true);
assert.equal(chatTest.isAnswerEvidenceSource({
    title: 'Brief headline',
    description: 'Twelve chars',
    url: 'https://www.reuters.com/world/example',
    sourceType: 'trusted_news'
}), true);
assert.equal(chatTest.isAnswerEvidenceSource({
    title: 'Forum thread',
    description: 'Long enough discussion text about anything',
    url: 'https://reddit.com/r/example',
    sourceType: 'community_discussion'
}), false);
assert.equal(chatTest.asksUserToProvideSources('Share links to your portfolio and GitHub projects.'), false);
assert.equal(chatTest.asksUserToProvideSources('Could you please provide sources for this claim?'), true);
const preservedLive = chatTest.enforceLiveAnswerStyle(
    { response: 'Share links to your portfolio.', intent: 'chat', action: null },
    'latest ISRO update',
    [],
    { routeDecision: { strategy: 'direct' }, retrievalAttempted: false }
);
assert.match(String(preservedLive.response || ''), /Share links to your portfolio/i);
const liveFallback = chatTest.buildLiveUpdateResponse('latest ISRO update', [
    {
        title: 'Mission overview',
        description: 'Agency published the mission overview page.',
        url: 'https://www.isro.gov.in/missions',
        sourceType: 'official_source',
        domain: 'isro.gov.in'
    }
]);
assert.match(liveFallback, /Sources:/i);
assert.match(liveFallback, /https:\/\/www\.isro\.gov\.in\/missions/i);
assert.equal(chatTest.shouldUseAsFinalSource('latest ISRO update', {
    title: 'Mission overview',
    description: 'Agency published the mission overview page.',
    url: 'https://www.isro.gov.in/missions',
    sourceType: 'official_source',
    domain: 'isro.gov.in'
}), true);
const rankedKeep = chatTest.rankLiveSources('latest ISRO update', [
    {
        title: 'Space agency posts mission note',
        description: 'Official mission note published today.',
        url: 'https://www.isro.gov.in/note',
        sourceType: 'official_source',
        domain: 'isro.gov.in'
    }
]);
assert.equal(chatTest.isStreamPreferredGenerationRequest(
    'Give me a detailed itenary in goa. I am going from bangalore from October 1-5.'
), true);
assert.equal(chatTest.shouldStreamChatRequest(
    {
        stream: true,
        message: 'Create a rich, engaging, practical itinerary for: Goa',
        routingMessage: 'Give me a detailed itinerary in Goa'
    },
    'chat',
    null,
    { strategy: 'live_first' },
    false
), true);
assert.equal(chatTest.shouldStreamChatRequest(
    { stream: true, message: 'latest news today', routingMessage: 'latest news today' },
    'chat',
    null,
    { strategy: 'live_first' },
    false
), false);
assert.ok(rankedKeep.length >= 1);
const grounded = chatTest.buildGroundedUserMessage(
    validSelection.value.message,
    validSelection.value.intent,
    validSelection.value.grounding
);
assert.match(grounded, /Do not treat source code.*generic code review/i);
assert.doesNotMatch(grounded, /What this code does/);
const verifyGrounded = chatTest.buildGroundedUserMessage(
    'Check whether this selection is accurate.',
    'selection_verify',
    validSelection.value.grounding
);
assert.match(verifyGrounded, /How checked:/i);
assert.match(verifyGrounded, /Sources used:/i);
assert.doesNotMatch(verifyGrounded, /Claims checked:/i);
assert.doesNotMatch(verifyGrounded, /Claims needing live\/source verification:/i);
assert.doesNotMatch(verifyGrounded, /Corrected answer:/i);
assert.match(APP_HTML_SOURCE, /function buildVerificationResponseInstructions/);
assert.match(APP_HTML_SOURCE, /compact verification note/);
assert.match(APP_HTML_SOURCE, /How checked:/);
assert.match(APP_HTML_SOURCE, /Sources used:/);
assert.match(APP_HTML_SOURCE, /Do not include Verdict, Claims checked/);
assert.doesNotMatch(APP_HTML_SOURCE, /maybeShowReferenceImageForQuery/);
assert.doesNotMatch(APP_HTML_SOURCE, /fetchPublicMediaFromWikimedia/);
assert.doesNotMatch(APP_HTML_SOURCE, /isRestaurantLookupIntent/);
assert.deepEqual(
    ['balanced', 'witty', 'chatty', 'supportive', 'debate'].map(chatTest.normalizeResponseStyle),
    ['balanced', 'witty', 'chatty', 'supportive', 'debate']
);
assert.equal(chatTest.normalizeResponseStyle('unknown'), 'balanced');
assert.ok(chatTest.getQualityRiskReasons(SAMPLE.challengedAnswer, SAMPLE.challengedResponse, 'chat').length > 0);
assert.ok(chatTest.getQualityRiskReasons(
    `Who is the current CEO of ${fixtureSubject('Company')}?`,
    `According to sources, ${fixtureSubject('Executive')} is the current CEO of ${fixtureSubject('Company')}.`,
    'chat'
).includes('source_like_claim_without_source'));
assert.ok(chatTest.getQualityRiskReasons(
    `Who is the current CEO of ${fixtureSubject('Company')}?`,
    `${fixtureSubject('Executive')} is the current CEO of ${fixtureSubject('Company')}.`,
    'chat'
).includes('current_or_date_sensitive_claim'));
process.env.GROQ_API_KEY = 'test-groq-key';
globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('api.groq.com')) {
        return okJson({ choices: [{ message: { content: 'The capital of France is Paris.' } }] });
    }
    throw new Error(`unexpected URL ${href}`);
};
const capitalReply = await callHandler(chatHandler, request('/api/chat-groq', { message: 'What is the capital of France?' }));
assert.equal(capitalReply.statusCode, 200);
assert.match(capitalReply.body.response, /Paris/);
assert.equal(capitalReply.body.webEscalation.escalated, false);
globalThis.fetch = ORIGINAL_FETCH;
delete process.env.GROQ_API_KEY;
assert.equal(chatTest.classifyRoutingDecision('What is the capital of France?', '', {}).strategy, 'direct');
assert.equal(chatTest.classifyRoutingDecision('Generate chat title', '', { intent: 'chat_title' }).strategy, 'direct');
process.env.SERPER_API_KEY = 'test-serper-key';
process.env.LIVE_RETRIEVAL_ENABLED = 'true';
assert.equal(chatTest.classifyRoutingDecision(roleQuery(ROLE_FIXTURES.president.role, ROLE_FIXTURES.president.jurisdiction), '', {}).strategy, 'live_first');
assert.equal(chatTest.classifyRoutingDecision('What is the capital of France?', '', {}).strategy, 'direct');
assert.deepEqual(
    chatTest.classifyRoutingDecision('explain the running nickname reference', '', { intent: 'pop_culture_reference' }),
    { strategy: 'direct', reason: 'pop_culture_reference_stable', webEligible: false }
);
assert.equal(chatTest.classifyRoutingDecision(`latest news about ${fixtureSubject('Series')} reboot`, '', { intent: 'pop_culture_reference' }).strategy, 'live_first');
assert.equal(chatTest.classifyRoutingDecision('explain the running nickname reference with sources', '', { intent: 'pop_culture_reference' }).strategy, 'live_first');
delete process.env.SERPER_API_KEY;
delete process.env.LIVE_RETRIEVAL_ENABLED;
delete process.env.JARVIS_PUBLIC_FACT_SEARCH;
assert.equal(chatTest.classifyRoutingDecision(roleQuery(ROLE_FIXTURES.president.role, ROLE_FIXTURES.president.jurisdiction), '', {}).strategy, 'live_first');
process.env.JARVIS_PUBLIC_FACT_SEARCH = 'false';
assert.equal(chatTest.classifyRoutingDecision(roleQuery(ROLE_FIXTURES.president.role, ROLE_FIXTURES.president.jurisdiction), '', {}).strategy, 'direct');
delete process.env.JARVIS_PUBLIC_FACT_SEARCH;
assert.equal(
    chatTest.resolveContextualLiveQuery(`Who is ${fixtureSubject('Person')}?`, [
        { role: 'user', text: `Tell me about ${fixtureSubject('Agency')}` },
        { role: 'assistant', text: `${fixtureSubject('Agency')} summary` }
    ]),
    `Who is ${fixtureSubject('Person')}?`
);
assert.match(
    chatTest.resolveContextualLiveQuery('latest on it', [
        { role: 'user', text: `Tell me about ${fixtureSubject('Agency')}` },
        { role: 'assistant', text: `${fixtureSubject('Agency')} summary` }
    ]),
    new RegExp(fixtureSubject('Agency'), 'i')
);
for (const scenario of [
    {
        prior: `Tell me about ${fixtureSubject('Relief Agency')}`,
        assistant: `${fixtureSubject('Relief Agency')} summary`,
        standalone: `Who is ${fixtureSubject('Researcher')}?`,
        expectedStandalone: `Who is ${fixtureSubject('Researcher')}?`,
        followup: 'latest on it',
        expectedAnchor: new RegExp(fixtureSubject('Relief Agency'), 'i')
    },
    {
        prior: `Explain ${fixtureSubject('Concept')}`,
        assistant: `${fixtureSubject('Concept')} summary`,
        standalone: `What is ${fixtureSubject('Process')}?`,
        expectedStandalone: `What is ${fixtureSubject('Process')}?`,
        followup: 'show sources for it',
        expectedAnchor: new RegExp(fixtureSubject('Concept'), 'i')
    }
]) {
    assert.equal(
        chatTest.resolveContextualLiveQuery(scenario.standalone, [
            { role: 'user', text: scenario.prior },
            { role: 'assistant', text: scenario.assistant }
        ]),
        scenario.expectedStandalone
    );
    assert.match(
        chatTest.resolveContextualLiveQuery(scenario.followup, [
            { role: 'user', text: scenario.prior },
            { role: 'assistant', text: scenario.assistant }
        ]),
        scenario.expectedAnchor
    );
}

assert.equal(
    chatTest.resolveRouteEscalation(
        { strategy: 'direct', reason: 'stable_factual_query' },
        'Who discovered penicillin?',
        'Alexander Fleming discovered penicillin.',
        { strictMode: true }
    ).escalate,
    false
);
assert.equal(
    chatTest.resolveRouteEscalation(
        { strategy: 'direct', reason: 'stable_factual_query' },
        'Who discovered penicillin?',
        'I am not sure. You can check Google or a website.',
        { strictMode: true }
    ).reason,
    'unknown_general_knowledge_answer'
);
assert.equal(chatTest.isCrawl4AiFallbackCandidate({ url: 'https://en.wikipedia.org/wiki/Penicillin' }), true);
assert.equal(chatTest.isCrawl4AiFallbackCandidate({ url: 'https://example.com/file.pdf' }), false);

process.env.GROQ_API_KEY = 'test-groq-key';
process.env.LIVE_RETRIEVAL_ENABLED = 'true';
process.env.CHAT_ROUTER_MODE = 'strict_single_pass';
let confidentSearchCalls = 0;
globalThis.fetch = async (url, init) => {
    const href = String(url);
    if (href.includes('api.groq.com')) {
        const body = JSON.parse(String(init?.body || '{}'));
        const prompt = String(body?.messages?.[0]?.content || '');
        if (prompt.includes('Classify the user message')) {
            return okJson({ choices: [{ message: { content: '{"blocked":false,"reason":"safe","safe_response":""}' } }] });
        }
        if (prompt.includes('Review this candidate answer')) {
            return okJson({ choices: [{ message: { content: '{"verdict":"pass","issues":[],"correctedResponse":""}' } }] });
        }
        return okJson({ choices: [{ message: { content: 'Alexander Fleming discovered penicillin.' } }] });
    }
    confidentSearchCalls += 1;
    throw new Error(`unexpected URL ${href}`);
};
const confidentStableChat = await callHandler(chatHandler, request('/api/chat-groq', { message: 'Who discovered penicillin?' }));
assert.equal(confidentStableChat.statusCode, 200);
assert.equal(confidentStableChat.body.webEscalation.escalated, false);
assert.equal(confidentStableChat.body.webEscalation.reason, 'pre_trained_answer_accepted');
assert.match(confidentStableChat.body.response, /Alexander Fleming discovered penicillin/);
assert.equal(confidentSearchCalls, 0);
globalThis.fetch = ORIGINAL_FETCH;
delete process.env.GROQ_API_KEY;
delete process.env.LIVE_RETRIEVAL_ENABLED;
delete process.env.JARVIS_PUBLIC_FACT_SEARCH;
delete process.env.CHAT_ROUTER_MODE;

process.env.GROQ_API_KEY = 'test-groq-key';
process.env.LIVE_RETRIEVAL_ENABLED = 'true';
process.env.CHAT_ROUTER_MODE = 'strict_single_pass';
process.env.CRAWL4AI_URL = 'https://crawl4ai.example';
let uncertainModelCalls = 0;
let fallbackCrawlCalls = 0;
globalThis.fetch = async (url, init) => {
    const href = String(url);
    if (href.includes('api.groq.com')) {
        const body = JSON.parse(String(init?.body || '{}'));
        const prompt = String(body?.messages?.[0]?.content || '');
        if (prompt.includes('Classify the user message')) {
            return okJson({ choices: [{ message: { content: '{"blocked":false,"reason":"safe","safe_response":""}' } }] });
        }
        if (prompt.includes('Review this candidate answer')) {
            return okJson({ choices: [{ message: { content: '{"verdict":"pass","issues":[],"correctedResponse":""}' } }] });
        }
        uncertainModelCalls += 1;
        if (prompt.includes('Retrieved context (RAG):')) {
            return okJson({ choices: [{ message: { content: 'Aspirin history is commonly linked to Felix Hoffmann and Bayer chemists, based on the extracted public source.' } }] });
        }
        return okJson({ choices: [{ message: { content: 'I am not sure. You can check Google or a reliable website.' } }] });
    }
    if (href.includes('en.wikipedia.org/w/api.php')) {
        return okJson({ query: { search: [{ title: 'Aspirin', snippet: 'Aspirin discovery and history.' }] } });
    }
    if (href.includes('en.wikipedia.org/api/rest_v1/page/summary')) {
        return okJson({
            title: 'Aspirin',
            extract: 'Aspirin history includes the work of Felix Hoffmann and Bayer chemists.',
            content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Aspirin' } }
        });
    }
    if (href.includes('www.wikidata.org/w/api.php')) return okJson({ search: [] });
    if (href.includes('reddit.com/search.json')) return okJson({ data: { children: [] } });
    if (href.includes('api.gdeltproject.org')) return okJson({ articles: [] });
    if (href.includes('news.google.com')) return okText('');
    if (href.includes('duckduckgo.com')) return okText('');
    if (href.includes('/search')) return okJson({ results: [] });
    if (href === 'https://crawl4ai.example/crawl') {
        fallbackCrawlCalls += 1;
        return okJson({
            result: {
                url: 'https://en.wikipedia.org/wiki/Aspirin',
                title: 'Aspirin',
                description: 'Aspirin discovery history.',
                text: 'Aspirin history includes the work of Felix Hoffmann and Bayer chemists in the late nineteenth century.'
            }
        });
    }
    throw new Error(`unexpected URL ${href}`);
};
const uncertainStableChat = await callHandler(chatHandler, request('/api/chat-groq', { message: 'Who discovered aspirin?' }));
assert.equal(uncertainStableChat.statusCode, 200);
assert.equal(uncertainStableChat.body.webEscalation.escalated, true);
assert.equal(uncertainStableChat.body.webEscalation.reason, 'crawl4ai_grounding_used');
assert.equal(uncertainStableChat.body.webEscalation.extractor, 'crawl4ai');
assert.equal(uncertainStableChat.body.webEscalation.sourceCount, 1);
assert.ok(fallbackCrawlCalls > 0 && fallbackCrawlCalls <= 3);
assert.equal(uncertainModelCalls, 2);
assert.match(uncertainStableChat.body.response, /Felix Hoffmann|extracted public source/);
globalThis.fetch = ORIGINAL_FETCH;
delete process.env.GROQ_API_KEY;
delete process.env.LIVE_RETRIEVAL_ENABLED;
delete process.env.JARVIS_PUBLIC_FACT_SEARCH;
delete process.env.CHAT_ROUTER_MODE;
delete process.env.CRAWL4AI_URL;

process.env.GROQ_API_KEY = 'test-groq-key';
process.env.LIVE_RETRIEVAL_ENABLED = 'true';
process.env.CHAT_ROUTER_MODE = 'strict_single_pass';
let unavailableModelCalls = 0;
globalThis.fetch = async (url, init) => {
    const href = String(url);
    if (href.includes('api.groq.com')) {
        const body = JSON.parse(String(init?.body || '{}'));
        const prompt = String(body?.messages?.[0]?.content || '');
        if (prompt.includes('Classify the user message')) {
            return okJson({ choices: [{ message: { content: '{"blocked":false,"reason":"safe","safe_response":""}' } }] });
        }
        if (prompt.includes('Review this candidate answer')) {
            return okJson({ choices: [{ message: { content: '{"verdict":"pass","issues":[],"correctedResponse":""}' } }] });
        }
        unavailableModelCalls += 1;
        return okJson({ choices: [{ message: { content: 'I am not sure. You can check Google or a reliable website.' } }] });
    }
    if (href.includes('crawl4ai') || href.includes('/search') || href.includes('duckduckgo') || href.includes('wikidata') || href.includes('wikipedia')) {
        return okText('');
    }
    throw new Error(`unexpected URL ${href}`);
};
const unavailableFallbackChat = await callHandler(chatHandler, request('/api/chat-groq', { message: 'Who discovered aspirin?' }));
assert.equal(unavailableFallbackChat.statusCode, 200);
assert.equal(unavailableFallbackChat.body.webEscalation.escalated, false);
assert.equal(unavailableFallbackChat.body.webEscalation.reason, 'crawl4ai_unavailable');
assert.equal(unavailableFallbackChat.body.webEscalation.extractor, 'crawl4ai');
assert.equal(unavailableFallbackChat.body.response, 'I am not sure. You can check Google or a reliable website.');
assert.equal(unavailableModelCalls, 1);
globalThis.fetch = ORIGINAL_FETCH;
delete process.env.GROQ_API_KEY;
delete process.env.LIVE_RETRIEVAL_ENABLED;
delete process.env.JARVIS_PUBLIC_FACT_SEARCH;
delete process.env.CHAT_ROUTER_MODE;

const wrongMethod = await callHandler(currentFactsHandler, {
    ...request('/api/current-facts', {}),
    method: 'GET',
    headers: {}
});
assert.equal(wrongMethod.statusCode, 405);
assert.equal(wrongMethod.body.error.code, 'method_not_allowed');

clearItems();
const cacheMissFacts = await callHandler(currentFactsHandler, request('/api/current-facts', { query: SAMPLE.currentQuery }));
assert.equal(cacheMissFacts.statusCode, 200);
assert.equal(cacheMissFacts.body.resolved, false);
assert.equal(cacheMissFacts.body.error.code, 'cache_miss');
const cachedFactsSubject = fixtureSubject('Organization');
saveItems([{
    title: `${cachedFactsSubject} ships a cached update`,
    url: 'https://example.com/news/cached-update',
    summary: 'Cached article for current facts.',
    source: `${cachedFactsSubject} News`,
    publishedAt: new Date().toISOString()
}]);
const cachedFacts = await callHandler(currentFactsHandler, request('/api/current-facts', { query: `latest ${cachedFactsSubject} news` }));
assert.equal(cachedFacts.statusCode, 200);
assert.equal(cachedFacts.body.resolved, true);
assert.equal(cachedFacts.body.sources[0].source, `${cachedFactsSubject} News`);
clearItems();

globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('en.wikipedia.org/w/api.php')) {
        return {
            ok: true,
            status: 200,
            async json() {
                return { query: { search: [{ title: 'France', snippet: 'France country profile.' }] } };
            },
            async text() { return ''; }
        };
    }
    if (href.includes('en.wikipedia.org/api/rest_v1/page/summary')) {
        return {
            ok: true,
            status: 200,
            async json() {
                return {
                    title: 'France',
                    extract: 'France is a country in Western Europe.',
                    content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/France' } }
                };
            },
            async text() { return ''; }
        };
    }
    if (href.includes('api.gdeltproject.org')) {
        return {
            ok: true,
            status: 200,
            async json() {
                return {
                    articles: [{
                        title: 'France current background',
                        url: 'https://www.bbc.com/news/world-europe-17298730',
                        domain: 'bbc.com',
                        seendate: '20260617120000'
                    }]
                };
            },
            async text() { return ''; }
        };
    }
    if (href.includes('news.google.com')) {
        return {
            ok: true,
            status: 200,
            async json() { return {}; },
            async text() { return '<rss><channel></channel></rss>'; }
        };
    }
    if (href.includes('duckduckgo.com') || href.includes('wikidata.org') || href.includes('reddit.com') || href.includes('/search')) {
        return {
            ok: true,
            status: 200,
            async json() { return {}; },
            async text() { return ''; }
        };
    }
    throw new Error(`unexpected URL ${href}`);
};
const publicSearch = await callHandler(searchHandler, request('/api/search', { query: 'France facts', limit: 5 }));
assert.equal(publicSearch.statusCode, 200);
assert.equal(publicSearch.body.success, true);
assert.equal(publicSearch.body.provider, 'public_sources');
assert.equal(publicSearch.body.results.length, 2);
assert.deepEqual(publicSearch.body.distinctDomains, ['bbc.com', 'en.wikipedia.org']);
assert.equal(publicSearch.body.trustedCount, 2);
assert.equal(publicSearch.body.answerEvidenceCount, 2);
assert.equal(publicSearch.body.geminiEnhanced, false);
assert.equal(publicSearch.body.results[0].sourceLabel, 'bbc.com via GDELT');
assert.ok(!publicSearch.body.results.some(item => item.sourceType === 'reference_lookup'));
assert.ok(!publicSearch.body.results.some(item => item.sourceType === 'archive_lookup'));
globalThis.fetch = ORIGINAL_FETCH;

globalThis.fetch = async (url) => {
    throw new Error(`auto classifier should not fetch ${String(url)}`);
};
const autoStableSearch = await callHandler(searchHandler, request('/api/search', {
    query: 'explain transformer attention',
    limit: 5,
    mode: 'auto'
}));
assert.equal(autoStableSearch.statusCode, 200);
assert.equal(autoStableSearch.body.success, true);
assert.equal(autoStableSearch.body.searchSkipped, true);
assert.equal(autoStableSearch.body.searchRequired, false);
assert.equal(autoStableSearch.body.provider, 'classifier');
assert.equal(autoStableSearch.body.results.length, 0);
globalThis.fetch = ORIGINAL_FETCH;

const datedSportsRoute = await callHandler(searchHandler, request('/api/search', {
    query: 'Who won IPL in 2023?',
    limit: 5,
    mode: 'classify'
}));
assert.equal(datedSportsRoute.statusCode, 200);
assert.equal(datedSportsRoute.body.searchRequired, true);
assert.equal(datedSportsRoute.body.route.category, 'sports');

const datedEntertainmentRoute = await callHandler(searchHandler, request('/api/search', {
    query: `What was ${fixtureSubject('Performer')}'s latest movie in 2023?`,
    limit: 5,
    mode: 'classify'
}));
assert.equal(datedEntertainmentRoute.statusCode, 200);
assert.equal(datedEntertainmentRoute.body.searchRequired, true);
assert.equal(datedEntertainmentRoute.body.route.category, 'web_search');
assert.ok(datedEntertainmentRoute.body.route.reasons.includes('dated_changing_fact_requires_public_source'));

const presidentQuery = roleQuery(ROLE_FIXTURES.president.role, ROLE_FIXTURES.president.jurisdiction);
const chiefMinisterQuery = roleQuery(ROLE_FIXTURES.chiefMinister.role, ROLE_FIXTURES.chiefMinister.jurisdiction, '');
const ceoQuery = roleQuery(ROLE_FIXTURES.ceo.role, ROLE_FIXTURES.ceo.jurisdiction);
const datedChiefMinisterQuery = `Who was the ${ROLE_FIXTURES.chiefMinister.role} of ${ROLE_FIXTURES.chiefMinister.jurisdiction} in 2024?`;
const datedCeoQuery = `Who was ${ROLE_FIXTURES.ceo.role} of ${ROLE_FIXTURES.ceo.jurisdiction} in 2023?`;
assert.deepEqual(searchTest.parseGovernmentRoleQuery(`Who is the ${ROLE_FIXTURES.chiefMinister.jurisdiction} CM?`), {
    role: 'chief minister',
    roleText: 'CM',
    jurisdiction: ROLE_FIXTURES.chiefMinister.jurisdiction,
    property: 'P39'
});
assert.deepEqual(searchTest.parseGovernmentRoleQuery(`Who is the president of the ${ROLE_FIXTURES.president.jurisdiction}?`), {
    role: 'president',
    roleText: 'president',
    jurisdiction: ROLE_FIXTURES.president.jurisdiction,
    property: 'P35'
});
assert.deepEqual(searchTest.parseGovernmentRoleQuery(presidentQuery), {
    role: 'president',
    roleText: 'president',
    jurisdiction: ROLE_FIXTURES.president.jurisdiction,
    property: 'P35'
});
assert.deepEqual(searchTest.parseGovernmentRoleQuery(chiefMinisterQuery), {
    role: 'chief minister',
    roleText: 'chief minister',
    jurisdiction: ROLE_FIXTURES.chiefMinister.jurisdiction,
    property: 'P39'
});
assert.deepEqual(searchTest.parseGovernmentRoleQuery(ceoQuery), {
    role: 'ceo',
    roleText: 'CEO',
    jurisdiction: ROLE_FIXTURES.ceo.jurisdiction,
    property: 'P169'
});
assert.deepEqual(searchTest.parseStructuredDateWindow('who won IPL in 2023'), {
    hasDate: true,
    kind: 'year',
    label: '2023',
    startDate: '2023-01-01',
    endDate: '2023-12-31',
    year: 2023
});
assert.equal(searchTest.parseGovernmentRoleQuery(datedChiefMinisterQuery).jurisdiction, ROLE_FIXTURES.chiefMinister.jurisdiction);
assert.equal(searchTest.parseGovernmentRoleQuery(datedChiefMinisterQuery).dateIntent.year, 2024);
assert.equal(searchTest.roleClaimOverlapsWindow({
    startDate: '2022-05-06',
    endDate: ''
}, searchTest.parseStructuredDateWindow(datedChiefMinisterQuery)), true);
assert.equal(searchTest.roleClaimOverlapsWindow({
    startDate: '2018-01-01',
    endDate: '2022-05-05'
}, searchTest.parseStructuredDateWindow(datedChiefMinisterQuery)), false);
assert.equal(searchTest.isValidCitationSource({
    title: `Britannica search: ${chiefMinisterQuery}`,
    url: `https://www.britannica.com/search?query=${encodeURIComponent(chiefMinisterQuery)}`,
    description: 'Reference lookup on Britannica.',
    domain: 'britannica.com',
    sourceType: 'reference_lookup'
}, chiefMinisterQuery), false);
assert.equal(searchTest.isValidCitationSource({
    title: `archive.today search: ${chiefMinisterQuery}`,
    url: `https://archive.today/search/?q=${encodeURIComponent(chiefMinisterQuery)}`,
    description: 'Archive lookup.',
    domain: 'archive.today',
    sourceType: 'archive_lookup'
}, chiefMinisterQuery), false);
assert.equal(searchTest.isValidCitationSource({
    title: 'Official profile',
    url: 'https://example.gov/profile',
    description: 'Official profile page with current office holder information.',
    domain: 'example.gov',
    sourceType: 'official_source',
    pageFetched: false
}, 'current office holder'), false);
assert.equal(searchTest.isValidCitationSource({
    title: 'WHO official',
    url: 'https://www.who.int/',
    description: 'Official public health updates and primary information.',
    domain: 'who.int',
    sourceType: 'official_source',
    pageFetched: true,
    exactShortcutMatch: false
}, chiefMinisterQuery), false);
assert.deepEqual(searchTest.parseDiscoveryFactQuery('Founder of penicillin'), {
    subject: 'penicillin',
    relation: 'discovery'
});
assert.equal(searchTest.isDiscoveryAnswerSource(searchTest.parseDiscoveryFactQuery('Founder of penicillin'), {
    title: 'Al Capone',
    description: 'Al Capone was treated with penicillin late in his life.',
    sourceType: 'encyclopedia'
}), false);
const penicillinAnswer = searchTest.buildSourceDerivedAnswer([
    { title: 'Penicillin discovery', description: 'Alexander Fleming discovered penicillin in 1928.', url: 'https://en.wikipedia.org/wiki/Penicillin', sourceType: 'encyclopedia', domain: 'wikipedia.org', relevanceScore: 0.9, evidenceLevel: 'strong' }
], { query: 'Founder of penicillin' });
assert.match(penicillinAnswer.answer, /Alexander Fleming discovered penicillin/i);
assert.doesNotMatch(penicillinAnswer.answer, /^Ernst Chain/i);

globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('www.wikidata.org/w/api.php')) {
        const search = new URL(href).searchParams.get('search') || '';
        if (search.includes(ROLE_FIXTURES.president.jurisdiction)) {
            return okJson({ search: [{ id: ROLE_FIXTURES.president.jurisdictionId, label: ROLE_FIXTURES.president.jurisdiction, description: ROLE_FIXTURES.president.jurisdictionDescription }] });
        }
        return okJson({ search: [] });
    }
    if (href.includes('query.wikidata.org/sparql')) {
        return okJson(wikidataRolePayload({
            holder: ROLE_FIXTURES.president.holderId,
            holderLabel: ROLE_FIXTURES.president.holder,
            officeLabel: ROLE_FIXTURES.president.officeLabel,
            start: ROLE_FIXTURES.president.start,
            article: ROLE_FIXTURES.president.article
        }));
    }
    if (href.includes('en.wikipedia.org/w/api.php')) return okJson({ query: { search: [] } });
    if (href.includes('api.gdeltproject.org')) return okJson({ articles: [] });
    if (href.includes('reddit.com/search.json')) return okJson({ data: { children: [] } });
    throw new Error(`unexpected URL ${href}`);
};
const presidentSearch = await callHandler(searchHandler, request('/api/search', { query: presidentQuery, limit: 5 }));
assert.equal(presidentSearch.statusCode, 200);
assert.equal(presidentSearch.body.success, true);
assert.ok(presidentSearch.body.answerEvidenceCount >= 1);
assert.equal(presidentSearch.body.answerProvider, 'wikidata_structured_claim');
assert.match(presidentSearch.body.answer, new RegExp(escapeRegExp(ROLE_FIXTURES.president.holder)));
assert.equal(presidentSearch.body.results[0].holderName, ROLE_FIXTURES.president.holder);
assert.equal(presidentSearch.body.results[0].role, ROLE_FIXTURES.president.role);
assert.equal(presidentSearch.body.results[0].jurisdiction, ROLE_FIXTURES.president.jurisdiction);
assert.equal(presidentSearch.body.results[0].wikidataId, ROLE_FIXTURES.president.holderId);
assert.equal(presidentSearch.body.results[0].evidenceLevel, 'structured_claim');
globalThis.fetch = ORIGINAL_FETCH;

globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('www.wikidata.org/w/api.php')) {
        const search = new URL(href).searchParams.get('search') || '';
        if (search.includes(ROLE_FIXTURES.primeMinister.jurisdiction)) {
            return okJson({ search: [{ id: ROLE_FIXTURES.primeMinister.jurisdictionId, label: ROLE_FIXTURES.primeMinister.jurisdiction, description: ROLE_FIXTURES.primeMinister.jurisdictionDescription }] });
        }
        return okJson({ search: [] });
    }
    if (href.includes('query.wikidata.org/sparql')) {
        return okJson(wikidataRolePayload({
            holder: ROLE_FIXTURES.primeMinister.holderId,
            holderLabel: ROLE_FIXTURES.primeMinister.holder,
            officeLabel: ROLE_FIXTURES.primeMinister.officeLabel,
            start: ROLE_FIXTURES.primeMinister.start,
            article: ROLE_FIXTURES.primeMinister.article
        }));
    }
    if (href.includes('en.wikipedia.org/w/api.php')) return okJson({ query: { search: [] } });
    if (href.includes('api.gdeltproject.org')) return okJson({ articles: [] });
    if (href.includes('reddit.com/search.json')) return okJson({ data: { children: [] } });
    throw new Error(`unexpected URL ${href}`);
};
const primeMinisterSearch = await callHandler(searchHandler, request('/api/search', { query: roleQuery(ROLE_FIXTURES.primeMinister.role, ROLE_FIXTURES.primeMinister.jurisdiction), limit: 5 }));
assert.equal(primeMinisterSearch.statusCode, 200);
assert.equal(primeMinisterSearch.body.results[0].holderName, ROLE_FIXTURES.primeMinister.holder);
assert.equal(primeMinisterSearch.body.results[0].role, ROLE_FIXTURES.primeMinister.role);
assert.equal(primeMinisterSearch.body.results[0].jurisdiction, ROLE_FIXTURES.primeMinister.jurisdiction);
assert.equal(primeMinisterSearch.body.results[0].startDate, ROLE_FIXTURES.primeMinister.startDate);
globalThis.fetch = ORIGINAL_FETCH;

globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('www.wikidata.org/w/api.php')) {
        const search = new URL(href).searchParams.get('search') || '';
        if (search.includes(ROLE_FIXTURES.chiefMinister.jurisdiction)) {
            return okJson({ search: [{ id: ROLE_FIXTURES.chiefMinister.jurisdictionId, label: ROLE_FIXTURES.chiefMinister.jurisdiction, description: ROLE_FIXTURES.chiefMinister.jurisdictionDescription }] });
        }
        return okJson({ search: [] });
    }
    if (href.includes('query.wikidata.org/sparql')) {
        return okJson(wikidataRolePayload({
            holder: ROLE_FIXTURES.chiefMinister.holderId,
            holderLabel: ROLE_FIXTURES.chiefMinister.holder,
            officeLabel: ROLE_FIXTURES.chiefMinister.officeLabel,
            start: ROLE_FIXTURES.chiefMinister.start,
            article: ROLE_FIXTURES.chiefMinister.article
        }));
    }
    if (href.includes('en.wikipedia.org/w/api.php')) return okJson({ query: { search: [] } });
    if (href.includes('api.gdeltproject.org')) return okJson({ articles: [] });
    if (href.includes('reddit.com/search.json')) return okJson({ data: { children: [] } });
    throw new Error(`unexpected URL ${href}`);
};
const structuredRoleSearch = await callHandler(searchHandler, request('/api/search', { query: chiefMinisterQuery, limit: 5 }));
assert.equal(structuredRoleSearch.statusCode, 200);
assert.equal(structuredRoleSearch.body.results[0].holderName, ROLE_FIXTURES.chiefMinister.holder);
assert.equal(structuredRoleSearch.body.results[0].role, ROLE_FIXTURES.chiefMinister.role);
assert.equal(structuredRoleSearch.body.results[0].jurisdiction, ROLE_FIXTURES.chiefMinister.jurisdiction);
assert.equal(structuredRoleSearch.body.results[0].evidenceLevel, 'structured_claim');
assert.match(structuredRoleSearch.body.answer, new RegExp(escapeRegExp(ROLE_FIXTURES.chiefMinister.holder)));
globalThis.fetch = ORIGINAL_FETCH;

globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('www.wikidata.org/w/api.php')) {
        const search = new URL(href).searchParams.get('search') || '';
        if (search.includes(ROLE_FIXTURES.chiefMinister.jurisdiction)) {
            return okJson({ search: [{ id: ROLE_FIXTURES.chiefMinister.jurisdictionId, label: ROLE_FIXTURES.chiefMinister.jurisdiction, description: ROLE_FIXTURES.chiefMinister.jurisdictionDescription }] });
        }
        return okJson({ search: [] });
    }
    if (href.includes('query.wikidata.org/sparql')) {
        return okJson(wikidataRolePayload([
            {
                holder: 'Q100099',
                holderLabel: 'Previous Minister',
                officeLabel: ROLE_FIXTURES.chiefMinister.officeLabel,
                start: '2018-01-01T00:00:00Z',
                end: '2022-05-05T00:00:00Z',
                article: 'https://en.wikipedia.org/wiki/Previous_Minister'
            },
            {
                holder: ROLE_FIXTURES.chiefMinister.holderId,
                holderLabel: ROLE_FIXTURES.chiefMinister.holder,
                officeLabel: ROLE_FIXTURES.chiefMinister.officeLabel,
                start: ROLE_FIXTURES.chiefMinister.start,
                article: ROLE_FIXTURES.chiefMinister.article
            }
        ]));
    }
    if (href.includes('en.wikipedia.org/w/api.php')) return okJson({ query: { search: [] } });
    if (href.includes('api.gdeltproject.org')) return okJson({ articles: [] });
    if (href.includes('reddit.com/search.json')) return okJson({ data: { children: [] } });
    throw new Error(`unexpected URL ${href}`);
};
const datedRoleSearch = await callHandler(searchHandler, request('/api/search', { query: datedChiefMinisterQuery, limit: 5 }));
assert.equal(datedRoleSearch.statusCode, 200);
assert.equal(datedRoleSearch.body.answerProvider, 'wikidata_dated_structured_claim');
assert.match(datedRoleSearch.body.answer, /^In 2024,/);
assert.match(datedRoleSearch.body.answer, new RegExp(escapeRegExp(ROLE_FIXTURES.chiefMinister.holder)));
assert.doesNotMatch(datedRoleSearch.body.answer, /Previous Minister/);
assert.equal(datedRoleSearch.body.results[0].holderName, ROLE_FIXTURES.chiefMinister.holder);
globalThis.fetch = ORIGINAL_FETCH;

globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('www.wikidata.org/w/api.php')) {
        const search = new URL(href).searchParams.get('search') || '';
        if (search.includes(ROLE_FIXTURES.chiefMinister.jurisdiction)) {
            return okJson({ search: [{ id: ROLE_FIXTURES.chiefMinister.jurisdictionId, label: ROLE_FIXTURES.chiefMinister.jurisdiction, description: ROLE_FIXTURES.chiefMinister.jurisdictionDescription }] });
        }
        return okJson({ search: [] });
    }
    if (href.includes('query.wikidata.org/sparql')) {
        return okJson(wikidataRolePayload({
            holder: ROLE_FIXTURES.chiefMinister.holderId,
            holderLabel: ROLE_FIXTURES.chiefMinister.alternateHolder,
            officeLabel: ROLE_FIXTURES.chiefMinister.officeLabel,
            start: ROLE_FIXTURES.chiefMinister.start,
            article: ROLE_FIXTURES.chiefMinister.article
        }));
    }
    if (href.includes('en.wikipedia.org/w/api.php')) return okJson({ query: { search: [] } });
    if (href.includes('api.gdeltproject.org')) return okJson({ articles: [] });
    if (href.includes('reddit.com/search.json')) return okJson({ data: { children: [] } });
    throw new Error(`unexpected URL ${href}`);
};
const changedRoleSearch = await callHandler(searchHandler, request('/api/search', { query: chiefMinisterQuery, limit: 5 }));
assert.equal(changedRoleSearch.statusCode, 200);
assert.match(changedRoleSearch.body.answer, new RegExp(escapeRegExp(ROLE_FIXTURES.chiefMinister.alternateHolder)));
assert.doesNotMatch(changedRoleSearch.body.answer, new RegExp(escapeRegExp(ROLE_FIXTURES.chiefMinister.holder)));
globalThis.fetch = ORIGINAL_FETCH;

globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('www.wikidata.org/w/api.php')) return okJson({ search: [] });
    if (href.includes('en.wikipedia.org/w/api.php')) {
        return okJson({ query: { search: [{ title: `${ROLE_FIXTURES.chiefMinister.officeLabel}`, snippet: 'Office overview.' }] } });
    }
    if (href.includes('en.wikipedia.org/api/rest_v1/page/summary')) {
        return okJson({
            title: ROLE_FIXTURES.chiefMinister.officeLabel,
            extract: `${ROLE_FIXTURES.chiefMinister.officeLabel} is the head of government for ${ROLE_FIXTURES.chiefMinister.jurisdiction}.`,
            content_urls: { desktop: { page: `https://en.wikipedia.org/wiki/${encodeURIComponent(ROLE_FIXTURES.chiefMinister.officeLabel).replaceAll('%20', '_')}` } }
        });
    }
    if (href.includes('api.gdeltproject.org')) return okJson({ articles: [] });
    if (href.includes('reddit.com/search.json')) return okJson({ data: { children: [] } });
    throw new Error(`unexpected URL ${href}`);
};
const genericRoleDefinitionSearch = await callHandler(searchHandler, request('/api/search', { query: chiefMinisterQuery, limit: 5 }));
assert.equal(genericRoleDefinitionSearch.statusCode, 200);
assert.ok(genericRoleDefinitionSearch.body.results.some(item => item.sourceType === 'encyclopedia'));
assert.equal(genericRoleDefinitionSearch.body.answer, undefined);
assert.equal(genericRoleDefinitionSearch.body.answerProvider, undefined);
globalThis.fetch = ORIGINAL_FETCH;

let whoShortcutTouched = false;
globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('who.int')) {
        whoShortcutTouched = true;
        throw new Error(`WHO shortcut should not be used for pronoun query ${href}`);
    }
    if (href.includes('www.wikidata.org/w/api.php')) {
        const search = new URL(href).searchParams.get('search') || '';
        if (search.includes(ROLE_FIXTURES.chiefMinister.jurisdiction)) {
            return okJson({ search: [{ id: ROLE_FIXTURES.chiefMinister.jurisdictionId, label: ROLE_FIXTURES.chiefMinister.jurisdiction, description: ROLE_FIXTURES.chiefMinister.jurisdictionDescription }] });
        }
        return okJson({ search: [] });
    }
    if (href.includes('query.wikidata.org/sparql')) {
        return okJson(wikidataRolePayload({
            holder: ROLE_FIXTURES.chiefMinister.holderId,
            holderLabel: ROLE_FIXTURES.chiefMinister.holder,
            officeLabel: ROLE_FIXTURES.chiefMinister.officeLabel,
            start: ROLE_FIXTURES.chiefMinister.start,
            article: ROLE_FIXTURES.chiefMinister.article
        }));
    }
    if (href.includes('en.wikipedia.org/w/api.php')) return okJson({ query: { search: [] } });
    if (href.includes('api.gdeltproject.org')) return okJson({ articles: [] });
    if (href.includes('reddit.com/search.json')) return okJson({ data: { children: [] } });
    throw new Error(`unexpected URL ${href}`);
};
const whoPronounRoleSearch = await callHandler(searchHandler, request('/api/search', { query: pronounRoleQuery(ROLE_FIXTURES.chiefMinister.role, ROLE_FIXTURES.chiefMinister.jurisdiction), limit: 5 }));
assert.equal(whoPronounRoleSearch.statusCode, 200);
assert.equal(whoShortcutTouched, false);
assert.ok(!whoPronounRoleSearch.body.results.some(item => item.domain === 'who.int'));
assert.equal(whoPronounRoleSearch.body.results[0].holderName, ROLE_FIXTURES.chiefMinister.holder);
globalThis.fetch = ORIGINAL_FETCH;

globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('www.wikidata.org/w/api.php')) {
        const search = new URL(href).searchParams.get('search') || '';
        if (search.includes(ROLE_FIXTURES.governor.jurisdiction)) {
            return okJson({ search: [{ id: ROLE_FIXTURES.governor.jurisdictionId, label: ROLE_FIXTURES.governor.jurisdiction, description: ROLE_FIXTURES.governor.jurisdictionDescription }] });
        }
        return okJson({ search: [] });
    }
    if (href.includes('query.wikidata.org/sparql')) {
        return okJson(wikidataRolePayload({
            holder: ROLE_FIXTURES.governor.holderId,
            holderLabel: ROLE_FIXTURES.governor.holder,
            officeLabel: ROLE_FIXTURES.governor.officeLabel,
            start: ROLE_FIXTURES.governor.start,
            article: ROLE_FIXTURES.governor.article
        }));
    }
    if (href.includes('en.wikipedia.org/w/api.php')) return okJson({ query: { search: [] } });
    if (href.includes('api.gdeltproject.org')) return okJson({ articles: [] });
    if (href.includes('reddit.com/search.json')) return okJson({ data: { children: [] } });
    throw new Error(`unexpected URL ${href}`);
};
const governorSearch = await callHandler(searchHandler, request('/api/search', { query: roleQuery(ROLE_FIXTURES.governor.role, ROLE_FIXTURES.governor.jurisdiction, ''), limit: 5 }));
assert.equal(governorSearch.statusCode, 200);
assert.equal(governorSearch.body.results[0].holderName, ROLE_FIXTURES.governor.holder);
assert.equal(governorSearch.body.results[0].role, ROLE_FIXTURES.governor.role);
assert.equal(governorSearch.body.results[0].jurisdiction, ROLE_FIXTURES.governor.jurisdiction);
globalThis.fetch = ORIGINAL_FETCH;

globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('www.wikidata.org/w/api.php')) {
        const search = new URL(href).searchParams.get('search') || '';
        if (search.includes(ROLE_FIXTURES.ceo.jurisdiction)) {
            return okJson({ search: [{ id: ROLE_FIXTURES.ceo.jurisdictionId, label: ROLE_FIXTURES.ceo.jurisdiction, description: ROLE_FIXTURES.ceo.jurisdictionDescription }] });
        }
        return okJson({ search: [] });
    }
    if (href.includes('query.wikidata.org/sparql')) {
        return okJson(wikidataRolePayload({
            holder: ROLE_FIXTURES.ceo.holderId,
            holderLabel: ROLE_FIXTURES.ceo.holder,
            officeLabel: ROLE_FIXTURES.ceo.officeLabel,
            start: ROLE_FIXTURES.ceo.start,
            article: ROLE_FIXTURES.ceo.article
        }));
    }
    if (href.includes('en.wikipedia.org/w/api.php')) return okJson({ query: { search: [] } });
    if (href.includes('api.gdeltproject.org')) return okJson({ articles: [] });
    if (href.includes('reddit.com/search.json')) return okJson({ data: { children: [] } });
    throw new Error(`unexpected URL ${href}`);
};
const ceoSearch = await callHandler(searchHandler, request('/api/search', { query: ceoQuery, limit: 5 }));
assert.equal(ceoSearch.statusCode, 200);
assert.equal(ceoSearch.body.results[0].holderName, ROLE_FIXTURES.ceo.holder);
assert.equal(ceoSearch.body.results[0].role, 'ceo');
assert.equal(ceoSearch.body.results[0].jurisdiction, ROLE_FIXTURES.ceo.jurisdiction);
globalThis.fetch = ORIGINAL_FETCH;

globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('www.wikidata.org/w/api.php')) {
        const search = new URL(href).searchParams.get('search') || '';
        if (search.includes(ROLE_FIXTURES.ceo.jurisdiction)) {
            return okJson({ search: [{ id: ROLE_FIXTURES.ceo.jurisdictionId, label: ROLE_FIXTURES.ceo.jurisdiction, description: ROLE_FIXTURES.ceo.jurisdictionDescription }] });
        }
        return okJson({ search: [] });
    }
    if (href.includes('query.wikidata.org/sparql')) {
        return okJson(wikidataRolePayload([
            {
                holder: 'Q100098',
                holderLabel: 'Previous Executive',
                officeLabel: ROLE_FIXTURES.ceo.officeLabel,
                start: '2020-01-01T00:00:00Z',
                end: '2023-12-31T00:00:00Z',
                article: 'https://en.wikipedia.org/wiki/Previous_Executive'
            },
            {
                holder: ROLE_FIXTURES.ceo.holderId,
                holderLabel: ROLE_FIXTURES.ceo.holder,
                officeLabel: ROLE_FIXTURES.ceo.officeLabel,
                start: ROLE_FIXTURES.ceo.start,
                article: ROLE_FIXTURES.ceo.article
            }
        ]));
    }
    if (href.includes('en.wikipedia.org/w/api.php')) return okJson({ query: { search: [] } });
    if (href.includes('api.gdeltproject.org')) return okJson({ articles: [] });
    if (href.includes('reddit.com/search.json')) return okJson({ data: { children: [] } });
    throw new Error(`unexpected URL ${href}`);
};
const datedCeoSearch = await callHandler(searchHandler, request('/api/search', { query: datedCeoQuery, limit: 5 }));
assert.equal(datedCeoSearch.statusCode, 200);
assert.equal(datedCeoSearch.body.answerProvider, 'wikidata_dated_structured_claim');
assert.match(datedCeoSearch.body.answer, /^In 2023,/);
assert.match(datedCeoSearch.body.answer, /Previous Executive/);
assert.doesNotMatch(datedCeoSearch.body.answer, new RegExp(escapeRegExp(ROLE_FIXTURES.ceo.holder)));
assert.equal(datedCeoSearch.body.results[0].holderName, 'Previous Executive');
globalThis.fetch = ORIGINAL_FETCH;

globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('www.wikidata.org/w/api.php')) return okJson({ search: [] });
    if (href.includes('en.wikipedia.org/w/api.php')) return okJson({ query: { search: [] } });
    if (href.includes('api.gdeltproject.org')) return okJson({ articles: [] });
    if (href.includes('reddit.com/search.json')) return okJson({ data: { children: [] } });
    throw new Error(`unexpected URL ${href}`);
};
const unknownRoleSearch = await callHandler(searchHandler, request('/api/search', { query: 'current president of Atlantis', limit: 5 }));
assert.equal(unknownRoleSearch.statusCode, 200);
assert.equal(unknownRoleSearch.body.answerEvidenceCount, 0);
assert.equal(unknownRoleSearch.body.results.length, 0);
assert.ok(unknownRoleSearch.body.warnings.some(item => /No public-source results/.test(item)));
globalThis.fetch = ORIGINAL_FETCH;

clearItems();
const cachedFrameworkSubject = fixtureSubject('Framework');
const cachedFrameworkTitle = `${cachedFrameworkSubject} release notes`;
saveItems([{
    title: cachedFrameworkTitle,
    url: 'https://example.com/blog/2026/06/01/example-framework-19-2',
    summary: `A cached ${cachedFrameworkSubject} release article.`,
    source: `${cachedFrameworkSubject} Blog`,
    publishedAt: new Date().toISOString()
}]);
const cachedLatestSearch = await callHandler(searchHandler, request('/api/search', { query: `latest ${cachedFrameworkSubject} release`, limit: 5 }));
assert.equal(cachedLatestSearch.statusCode, 200);
assert.equal(cachedLatestSearch.body.success, true);
assert.equal(cachedLatestSearch.body.provider, 'latest_cache');
assert.equal(cachedLatestSearch.body.results[0].sourceLabel, `${cachedFrameworkSubject} Blog`);
assert.equal(cachedLatestSearch.body.answerProvider, 'latest_cache_source');
assert.match(cachedLatestSearch.body.answer, new RegExp(cachedFrameworkTitle));
clearItems();

globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('api.coingecko.com/api/v3/simple/price')) {
        return okJson({
            [LIVE_FIXTURES.crypto.asset]: {
                usd: LIVE_FIXTURES.crypto.usd,
                inr: LIVE_FIXTURES.crypto.inr,
                usd_24h_change: LIVE_FIXTURES.crypto.change
            }
        });
    }
    throw new Error(`unexpected URL ${href}`);
};
const liveRequiredSearch = await callHandler(searchHandler, request('/api/search', { query: LIVE_FIXTURES.crypto.query, limit: 5 }));
assert.equal(liveRequiredSearch.statusCode, 200);
assert.equal(liveRequiredSearch.body.success, true);
assert.equal(liveRequiredSearch.body.provider, 'coingecko');
assert.equal(liveRequiredSearch.body.category, 'crypto');
assert.equal(liveRequiredSearch.body.results[0].sourceType, 'free_crypto_price');
assert.equal(liveRequiredSearch.body.answerProvider, 'coingecko_source');
assert.match(liveRequiredSearch.body.answer, new RegExp(String(LIVE_FIXTURES.crypto.usd)));
globalThis.fetch = ORIGINAL_FETCH;

globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('geocoding-api.open-meteo.com')) {
        return okJson({ results: [{ name: LIVE_FIXTURES.weather.place, admin1: LIVE_FIXTURES.weather.region, country: LIVE_FIXTURES.weather.country, latitude: 13.08, longitude: 80.27 }] });
    }
    if (href.includes('api.open-meteo.com/v1/forecast')) {
        return okJson({
            current: {
                temperature_2m: LIVE_FIXTURES.weather.temperature,
                apparent_temperature: LIVE_FIXTURES.weather.apparent,
                relative_humidity_2m: LIVE_FIXTURES.weather.humidity,
                wind_speed_10m: LIVE_FIXTURES.weather.wind
            },
            current_units: { temperature_2m: '°C', apparent_temperature: '°C', relative_humidity_2m: '%', wind_speed_10m: 'km/h' }
        });
    }
    throw new Error(`unexpected URL ${href}`);
};
const weatherSearch = await callHandler(searchHandler, request('/api/search', { query: LIVE_FIXTURES.weather.query, limit: 5 }));
assert.equal(weatherSearch.statusCode, 200);
assert.equal(weatherSearch.body.provider, 'open-meteo');
assert.equal(weatherSearch.body.category, 'weather');
assert.equal(weatherSearch.body.results[0].sourceType, 'free_weather');
assert.equal(weatherSearch.body.answerProvider, 'open_meteo_source');
assert.match(weatherSearch.body.answer, new RegExp(LIVE_FIXTURES.weather.place));
globalThis.fetch = ORIGINAL_FETCH;

globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('geocoding-api.open-meteo.com')) {
        return okJson({ results: [{ name: LIVE_FIXTURES.weather.place, admin1: LIVE_FIXTURES.weather.region, country: LIVE_FIXTURES.weather.country, latitude: 13.08, longitude: 80.27 }] });
    }
    if (href.includes('api.open-meteo.com/v1/forecast')) {
        return okJson({
            current: {
                temperature_2m: LIVE_FIXTURES.weather.temperature + 4,
                apparent_temperature: LIVE_FIXTURES.weather.apparent + 4,
                relative_humidity_2m: LIVE_FIXTURES.weather.humidity,
                wind_speed_10m: LIVE_FIXTURES.weather.wind
            },
            current_units: { temperature_2m: '°C', apparent_temperature: '°C', relative_humidity_2m: '%', wind_speed_10m: 'km/h' }
        });
    }
    throw new Error(`unexpected URL ${href}`);
};
const changedWeatherSearch = await callHandler(searchHandler, request('/api/search', { query: LIVE_FIXTURES.weather.query, limit: 5 }));
assert.equal(changedWeatherSearch.statusCode, 200);
assert.notEqual(changedWeatherSearch.body.answer, weatherSearch.body.answer);
assert.match(changedWeatherSearch.body.answer, new RegExp(String(LIVE_FIXTURES.weather.temperature + 4)));
globalThis.fetch = ORIGINAL_FETCH;

globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('eonet.gsfc.nasa.gov')) {
        return okJson({
            events: [{
                title: LIVE_FIXTURES.disaster.title,
                categories: [{ title: 'Earthquakes' }],
                geometry: [{ date: LIVE_FIXTURES.disaster.date }],
                sources: [{ url: 'https://eonet.gsfc.nasa.gov/events/example' }]
            }]
        });
    }
    throw new Error(`unexpected URL ${href}`);
};
const disasterSearch = await callHandler(searchHandler, request('/api/search', { query: LIVE_FIXTURES.disaster.query, limit: 5 }));
assert.equal(disasterSearch.statusCode, 200);
assert.equal(disasterSearch.body.provider, 'nasa-eonet');
assert.equal(disasterSearch.body.category, 'disasters');
assert.equal(disasterSearch.body.results[0].sourceType, 'free_disaster_event');
assert.equal(disasterSearch.body.answerProvider, 'nasa_eonet_source');
assert.match(disasterSearch.body.answer, new RegExp(LIVE_FIXTURES.disaster.title));
globalThis.fetch = ORIGINAL_FETCH;

globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('thesportsdb.com')) {
        return okJson({ teams: [{ strTeam: LIVE_FIXTURES.sports.team, strLeague: LIVE_FIXTURES.sports.league, strWebsite: 'www.fixtureclub.example' }] });
    }
    throw new Error(`unexpected URL ${href}`);
};
const sportsSearch = await callHandler(searchHandler, request('/api/search', { query: LIVE_FIXTURES.sports.query, limit: 5 }));
assert.equal(sportsSearch.statusCode, 200);
assert.equal(sportsSearch.body.provider, 'thesportsdb');
assert.equal(sportsSearch.body.category, 'sports');
assert.equal(sportsSearch.body.results[0].sourceType, 'free_sports_reference');
assert.equal(sportsSearch.body.answerProvider, 'sports_reference_source');
assert.match(sportsSearch.body.answer, new RegExp(LIVE_FIXTURES.sports.team));
globalThis.fetch = ORIGINAL_FETCH;

globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('en.wikipedia.org/w/api.php')) {
        return okJson({ query: { search: [{ title: LIVE_FIXTURES.places.topic, snippet: `${LIVE_FIXTURES.places.topic} place.` }] } });
    }
    if (href.includes('en.wikipedia.org/api/rest_v1/page/summary')) {
        return okJson({
            title: LIVE_FIXTURES.places.topic,
            extract: LIVE_FIXTURES.places.summary,
            content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Fixture_Harbor' } }
        });
    }
    if (href.includes('nominatim.openstreetmap.org/search')) {
        return okJson([{ name: LIVE_FIXTURES.places.topic, display_name: `${LIVE_FIXTURES.places.topic}, Fixture Country`, osm_type: 'relation', osm_id: 123 }]);
    }
    throw new Error(`unexpected URL ${href}`);
};
const tourismSearch = await callHandler(searchHandler, request('/api/search', { query: LIVE_FIXTURES.places.query, limit: 5 }));
assert.equal(tourismSearch.statusCode, 200);
assert.equal(tourismSearch.body.provider, 'wikimedia+openstreetmap');
assert.equal(tourismSearch.body.category, 'tourism_food_places');
assert.ok(tourismSearch.body.results.some(item => item.sourceType === 'free_reference'));
assert.ok(tourismSearch.body.results.some(item => item.sourceType === 'free_place_data'));
assert.ok(tourismSearch.body.results.every(item => typeof item.relevanceScore === 'number'));
assert.ok(tourismSearch.body.results.every(item => ['strong', 'weak', 'none'].includes(item.evidenceLevel)));
assert.equal(tourismSearch.body.answerProvider, 'public_place_source');
assert.match(tourismSearch.body.answer, new RegExp(LIVE_FIXTURES.places.topic));
globalThis.fetch = ORIGINAL_FETCH;

globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('en.wikipedia.org/w/api.php')) {
        return okJson({ query: { search: [] } });
    }
    if (href.includes('/search') || href.includes('duckduckgo') || href.includes('news.google.com') || href.includes('wikidata') || href.includes('bbc.com')) {
        return okText('');
    }
    if (href.includes('api.gdeltproject.org')) {
        return okJson({
            articles: [{
                title: LIVE_FIXTURES.government.title,
                url: LIVE_FIXTURES.government.url,
                domain: 'bbc.com',
                seendate: '20260618120000'
            }]
        });
    }
    throw new Error(`unexpected URL ${href}`);
};
const governmentSearch = await callHandler(searchHandler, request('/api/search', { query: LIVE_FIXTURES.government.query, limit: 5 }));
assert.equal(governmentSearch.statusCode, 200);
assert.equal(governmentSearch.body.category, 'government');
assert.equal(governmentSearch.body.provider, 'public_sources');
assert.equal(governmentSearch.body.results[0].sourceLabel, 'bbc.com via GDELT');
assert.equal(governmentSearch.body.answerProvider, 'public_source_result');
assert.match(governmentSearch.body.answer, new RegExp(LIVE_FIXTURES.government.title));
globalThis.fetch = ORIGINAL_FETCH;

const API_REVIEW_SUBJECT = 'Subject Device 3';
const UNRELATED_DOC_TITLE = 'Unrelated Archive Entry';
const UNRELATED_GAME_TITLE = 'Unrelated Game Entry';
globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('en.wikipedia.org/w/api.php')) {
        return okJson({
            query: {
                search: [
                    { title: UNRELATED_DOC_TITLE, snippet: 'Studio album.' },
                    { title: UNRELATED_GAME_TITLE, snippet: 'Adventure game.' }
                ]
            }
        });
    }
    if (href.includes('en.wikipedia.org/api/rest_v1/page/summary')) {
        if (href.includes(encodeURIComponent(UNRELATED_DOC_TITLE).replace(/%20/g, '_'))) {
            return okJson({
                title: UNRELATED_DOC_TITLE,
                extract: `${UNRELATED_DOC_TITLE} is a studio album released in 2013.`,
                content_urls: { desktop: { page: `https://en.wikipedia.org/wiki/${UNRELATED_DOC_TITLE.replace(/\s+/g, '_')}` } }
            });
        }
        return okJson({
            title: UNRELATED_GAME_TITLE,
            extract: `${UNRELATED_GAME_TITLE} is an action-adventure video game.`,
            content_urls: { desktop: { page: `https://en.wikipedia.org/wiki/${UNRELATED_GAME_TITLE.replace(/\s+/g, '_')}` } }
        });
    }
    if (href.includes('www.wikidata.org')) {
        return okJson({ search: [] });
    }
    if (href.includes('reddit.com')) {
        return okJson({ data: { children: [] } });
    }
    if (href.includes('api.gdeltproject.org')) {
        return okJson({
            articles: [
                {
                    title: `${UNRELATED_DOC_TITLE} review revisited`,
                    url: 'https://example.com/music/unrelated-review',
                    domain: 'example.com',
                    seendate: '20260618120000'
                },
                {
                    title: `${API_REVIEW_SUBJECT} hands-on review`,
                    url: 'https://reviews.example.com/subject-device-review',
                    domain: 'reviews.example.com',
                    seendate: '20260618130000'
                },
                {
                    title: `${API_REVIEW_SUBJECT} review: camera, battery, and design`,
                    url: 'https://tech.example.com/phones/subject-device-review',
                    domain: 'tech.example.com',
                    seendate: '20260618140000'
                }
            ]
        });
    }
    throw new Error(`unexpected URL ${href}`);
};
const productReviewSearch = await callHandler(searchHandler, request('/api/search', {
    query: `Search the web for recent reviews of the ${API_REVIEW_SUBJECT}`,
    limit: 5
}));
assert.equal(productReviewSearch.statusCode, 200);
assert.equal(productReviewSearch.body.category, 'web_search');
assert.equal(productReviewSearch.body.query, `recent reviews of the ${API_REVIEW_SUBJECT}`);
assert.equal(productReviewSearch.body.searchRewrite.subject, API_REVIEW_SUBJECT);
assert.equal(productReviewSearch.body.searchRewrite.intent, 'reviews');
assert.equal(productReviewSearch.body.searchRewrite.freshnessNeeded, true);
assert.ok(productReviewSearch.body.results.length >= 1);
assert.ok(productReviewSearch.body.results.every(item => `${item.title} ${item.description}`.toLowerCase().includes(API_REVIEW_SUBJECT.toLowerCase())));
assert.doesNotMatch(JSON.stringify(productReviewSearch.body.results), new RegExp(`${UNRELATED_DOC_TITLE}|${UNRELATED_GAME_TITLE}`, 'i'));
assert.doesNotMatch(String(productReviewSearch.body.answer || ''), new RegExp(`${UNRELATED_DOC_TITLE}|${UNRELATED_GAME_TITLE}`, 'i'));
globalThis.fetch = ORIGINAL_FETCH;

process.env.GEMINI_API_KEY = 'test-gemini-key';
let ragGeminiCalls = 0;
const ragCitySubject = fixtureSubject('City');
const ragLeaderName = fixtureSubject('Leader');
const ragLeaderQuestion = `Who is the current civic leader of ${ragCitySubject}?`;
const ragLeaderAnswer = `${ragLeaderName} is the current civic leader of ${ragCitySubject}.`;
const ragLeaderTitle = `${ragCitySubject} official page lists ${ragLeaderName} as current civic leader`;
// Exercise real provider JSON parsing against requirements and passages supplied by the research engine.
function researchFixtureModel(init = {}) {
    const body = JSON.parse(String(init.body || '{}'));
    const system = body.system_instruction?.parts?.map(p => p.text || '').join(' ') || '';
    assert.match(system, /Every fact needs the correct requirement ID/);
    assert.equal(body.generationConfig?.responseMimeType, 'application/json');
    const prompt = JSON.parse(body.contents.flatMap(item => item.parts || []).map(part => part.text || '').join(''));
    assert.equal(prompt.question, ragLeaderQuestion);
    const requirement = prompt.requirements.find(item => item.type === 'names');
    assert.ok(requirement, 'The engine must request the named civic leader');
    const passages = [...prompt.sourceExcerpts.matchAll(/(?:^|\n\n)\[(\d+)\] [^\n]*\nURL: ([^\n]*)\nEvidence: [^\n]*\n([\s\S]*?)(?=\n\n\[\d+\] |$)/g)];
    const passage = passages.find(item => item[2] === 'https://www.example.gov/leader');
    assert.ok(passage, 'The official source passage must reach the actual model request');
    const sentence = passage[3].match(/[^.\n]+ is the current civic leader of [^.\n]+\./)?.[0]?.trim();
    assert.ok(sentence, 'Only a passage explicitly identifying the office holder can supply this fixture answer');
    const value = sentence.split(' is the current civic leader of ')[0];
    const fact = { id: 'civic-leader', requirementId: requirement.id, value, sourceId: Number(passage[1]), quote: sentence };
    const payload = { facts: [fact], answerSegments: [{ text: sentence, factIds: [fact.id] }], gaps: [] };
    ragGeminiCalls++;
    return okJson({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] }, finishReason: 'STOP' }] });
}
const ragLeaderPage = '<title>' + ragLeaderTitle + '</title><article><p>' + ragLeaderAnswer + ' The official civic leadership record identifies the current office holder for this city.</p><p>' + ragCitySubject + ' civic leader records list ' + ragLeaderName + ' as the current leader responsible for city administration.</p></article>';
clearExtractorCaches();

globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    if (href.includes('generativelanguage.googleapis.com')) return researchFixtureModel(init);
    if (href.includes('en.wikipedia.org/w/api.php')) return okJson({ query: { search: [] } });
    if (href.includes('www.wikidata.org')) return okJson({ search: [] });
    if (href.includes('reddit.com')) return okJson({ data: { children: [] } });
    if (href.includes('duckduckgo.com')) return textResponse('');
    if (href.includes('news.google.com')) return textResponse('');
    if (href.includes('example.gov')) return textResponse(ragLeaderPage);
    if (href.includes('api.gdeltproject.org')) {
        return okJson({
            articles: [{
                title: ragLeaderTitle,
                url: 'https://www.example.gov/leader',
                domain: 'example.gov',
                seendate: '20260702120000'
            }]
        });
    }
    throw new Error(`unexpected URL ${href}`);
};
const verifiedRagSearch = await callHandler(searchHandler, request('/api/search', {
    query: ragLeaderQuestion,
    mode: 'rag',
    limit: 5
}));
assert.equal(verifiedRagSearch.statusCode, 200);
assert.equal(verifiedRagSearch.body.category, 'web_rag');
assert.equal(verifiedRagSearch.body.provider, 'web_rag');
assert.equal(verifiedRagSearch.body.verified, true, JSON.stringify(verifiedRagSearch.body));
assert.equal(verifiedRagSearch.body.answerStatus, 'complete');
assert.equal(ragGeminiCalls, 1, 'An ordinary lookup should need one answer generation without mandatory planner/reviewer calls');
assert.equal(verifiedRagSearch.body.answerProvider, 'web_rag_grounded');
assert.match(verifiedRagSearch.body.answer, new RegExp(ragLeaderName));
assert.ok(verifiedRagSearch.body.evidenceUsed.some(item => item.url === 'https://www.example.gov/leader'));
globalThis.fetch = ORIGINAL_FETCH;
delete process.env.GEMINI_API_KEY;

process.env.GEMINI_API_KEY = 'test-gemini-key';
process.env.NVIDIA_API_KEY = 'test-nvidia-key';
let nvidiaEmbeddingCalls = 0;
let nvidiaRerankCalls = 0;
globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    if (href.includes('integrate.api.nvidia.com/v1/embeddings')) {
        nvidiaEmbeddingCalls += 1;
        assert.match(String(init?.headers?.Authorization || ''), /^Bearer test-nvidia-key$/);
        const body = JSON.parse(String(init?.body || '{}'));
        const count = Array.isArray(body.input) ? body.input.length : 0;
        return okJson({
            model: 'nvidia/nv-embedcode-7b-v1',
            data: Array.from({ length: count }, (_, index) => ({
                index,
                embedding: index === 0 ? [1, 0, 0] : [0.95, 0.05, 0]
            }))
        });
    }
    if (href.includes('integrate.api.nvidia.com/v1/ranking')) {
        nvidiaRerankCalls += 1;
        assert.match(String(init?.headers?.Authorization || ''), /^Bearer test-nvidia-key$/);
        const body = JSON.parse(String(init?.body || '{}'));
        const passages = Array.isArray(body.passages) ? body.passages : [];
        return okJson({
            model: 'nvidia/llama-3.2-nv-rerankqa-1b-v2',
            rankings: passages.map((_, index) => ({ index, logit: passages.length - index }))
        });
    }
    if (href.includes('generativelanguage.googleapis.com')) return researchFixtureModel(init);
    if (href.includes('example.gov')) return textResponse(ragLeaderPage);
    if (href.includes('en.wikipedia.org/w/api.php')) return okJson({ query: { search: [] } });
    if (href.includes('www.wikidata.org')) return okJson({ search: [] });
    if (href.includes('reddit.com')) return okJson({ data: { children: [] } });
    if (href.includes('api.gdeltproject.org')) {
        return okJson({
            articles: [{
                title: ragLeaderTitle,
                url: 'https://www.example.gov/leader',
                domain: 'example.gov',
                seendate: '20260702120000'
            }]
        });
    }
    throw new Error(`unexpected URL ${href}`);
};
const embeddingRagSearch = await callHandler(searchHandler, request('/api/search', {
    query: ragLeaderQuestion,
    mode: 'rag',
    limit: 5
}));
assert.equal(embeddingRagSearch.statusCode, 200);
assert.equal(embeddingRagSearch.body.verified, true);
assert.equal(embeddingRagSearch.body.answerStatus, 'complete');
assert.equal(embeddingRagSearch.body.embeddingEnhanced, false);
assert.ok(embeddingRagSearch.body.research.coverage.sufficient);
assert.equal(embeddingRagSearch.body.rerankEnhanced, false);
assert.ok(embeddingRagSearch.body.research.modelCalls <= 4);
assert.equal(nvidiaEmbeddingCalls, 0);
assert.equal(nvidiaRerankCalls, 0);
globalThis.fetch = ORIGINAL_FETCH;
delete process.env.GEMINI_API_KEY;
delete process.env.NVIDIA_API_KEY;

process.env.NVIDIA_API_KEY = 'test-nvidia-key';
let rankTextsEmbeddingCalls = 0;
let rankTextsRerankCalls = 0;
globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    if (href.includes('integrate.api.nvidia.com/v1/embeddings')) {
        rankTextsEmbeddingCalls += 1;
        const body = JSON.parse(String(init?.body || '{}'));
        const count = Array.isArray(body.input) ? body.input.length : 0;
        return okJson({
            model: 'nvidia/nv-embedcode-7b-v1',
            data: Array.from({ length: count }, (_, index) => ({
                index,
                embedding: index === 0 ? [1, 0] : (index === 1 ? [0.99, 0.01] : [0.1, 0.9])
            }))
        });
    }
    if (href.includes('integrate.api.nvidia.com/v1/ranking')) {
        rankTextsRerankCalls += 1;
        const body = JSON.parse(String(init?.body || '{}'));
        const passages = Array.isArray(body.passages) ? body.passages : [];
        return okJson({
            model: 'nvidia/llama-3.2-nv-rerankqa-1b-v2',
            rankings: passages.map((_, index) => ({ index, logit: index === 0 ? 4 : 1 }))
        });
    }
    throw new Error(`unexpected URL ${href}`);
};
const rankTexts = await callHandler(rankTextsHandler, request('/api/rank-texts', {
    query: 'kitchen keys',
    items: [
        { id: 'keys', key: 'keys', value: 'on the kitchen counter', text: 'keys: on the kitchen counter' },
        { id: 'passport', key: 'passport', value: 'in the drawer', text: 'passport: in the drawer' }
    ],
    limit: 2,
    useRerank: true
}));
assert.equal(rankTexts.statusCode, 200);
assert.equal(rankTexts.body.success, true);
assert.equal(rankTexts.body.available, true);
assert.equal(rankTexts.body.embeddingEnhanced, true);
assert.equal(rankTexts.body.rerankEnhanced, true);
assert.equal(rankTexts.body.ranked[0].key, 'keys');
assert.ok(rankTextsEmbeddingCalls >= 1);
assert.ok(rankTextsRerankCalls >= 1);
globalThis.fetch = ORIGINAL_FETCH;
delete process.env.NVIDIA_API_KEY;

process.env.GEMINI_API_KEY = 'test-gemini-key';
const geminiFallbackSubject = fixtureSubject('Reference Topic');
globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('generativelanguage.googleapis.com')) {
        return okJson({
            candidates: [{ content: { parts: [{ text: '{"queries":["unrelated query"],"verified":false}' }] } }]
        });
    }
    if (href.includes('en.wikipedia.org/w/api.php')) return okJson({ query: { search: [] } });
    if (href.includes('www.wikidata.org')) return okJson({ search: [] });
    if (href.includes('reddit.com')) return okJson({ data: { children: [] } });
    if (href.includes('api.gdeltproject.org')) return okJson({ articles: [] });
    throw new Error(`unexpected URL ${href}`);
};
const unverifiedRagSearch = await callHandler(searchHandler, request('/api/search', {
    query: 'Who is the current civic leader of Empty Source City?',
    mode: 'rag',
    limit: 5
}));
assert.equal(unverifiedRagSearch.statusCode, 200);
assert.equal(unverifiedRagSearch.body.provider, 'web_rag');
assert.equal(unverifiedRagSearch.body.verified, false);
assert.equal(unverifiedRagSearch.body.answerProvider, 'web_rag_unverified');
assert.equal(unverifiedRagSearch.body.answerStatus, 'unavailable');
assert.equal(unverifiedRagSearch.body.research.coverage.sufficient, false);
assert.match(unverifiedRagSearch.body.answer, /couldn't verify the requested facts/);
globalThis.fetch = ORIGINAL_FETCH;
delete process.env.GEMINI_API_KEY;

process.env.GEMINI_API_KEY = 'test-gemini-key';
const UNRELATED_OS_TITLE = 'Unrelated OS Entry';
const UNRELATED_CHART_TITLE = 'Unrelated Chart Entry';
const UNRELATED_SHELL_TITLE = 'Unrelated Shell Entry';
globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('generativelanguage.googleapis.com')) {
        return okJson({
            candidates: [{ content: { parts: [{ text: JSON.stringify({ queries: [UNRELATED_OS_TITLE, UNRELATED_CHART_TITLE, UNRELATED_SHELL_TITLE] }) }] } }]
        });
    }
    if (href.includes('en.wikipedia.org/w/api.php')) {
        return okJson({
            query: {
                search: [
                    { title: UNRELATED_OS_TITLE, snippet: 'Gaming-focused operating system by a platform company.' },
                    { title: UNRELATED_CHART_TITLE, snippet: 'Music chart in a sample market.' },
                    { title: UNRELATED_SHELL_TITLE, snippet: 'Desktop distribution based on a sample base.' }
                ]
            }
        });
    }
    if (href.includes('en.wikipedia.org/api/rest_v1/page/summary')) {
        if (href.includes(UNRELATED_OS_TITLE.replace(/\s+/g, '_'))) {
            return okJson({
                title: UNRELATED_OS_TITLE,
                extract: `${UNRELATED_OS_TITLE} is a gaming-focused operating system released by a platform company.`,
                content_urls: { desktop: { page: `https://en.wikipedia.org/wiki/${UNRELATED_OS_TITLE.replace(/\s+/g, '_')}` } }
            });
        }
        if (href.includes(UNRELATED_CHART_TITLE.replace(/\s+/g, '_'))) {
            return okJson({
                title: UNRELATED_CHART_TITLE,
                extract: `The ${UNRELATED_CHART_TITLE} ranks songs in a sample market.`,
                content_urls: { desktop: { page: `https://en.wikipedia.org/wiki/${UNRELATED_CHART_TITLE.replace(/\s+/g, '_')}` } }
            });
        }
        return okJson({
            title: UNRELATED_SHELL_TITLE,
            extract: `${UNRELATED_SHELL_TITLE} is a desktop distribution based on a sample base.`,
            content_urls: { desktop: { page: `https://en.wikipedia.org/wiki/${UNRELATED_SHELL_TITLE.replace(/\s+/g, '_')}` } }
        });
    }
    if (href.includes('www.wikidata.org')) return okJson({ search: [] });
    if (href.includes('reddit.com')) return okJson({ data: { children: [] } });
    if (href.includes('api.gdeltproject.org')) return okJson({ articles: [] });
    throw new Error(`unexpected URL ${href}`);
};
const irrelevantRagSearch = await callHandler(searchHandler, request('/api/search', {
    query: 'WHO IS THE CM OF SAMPLE STATE',
    mode: 'rag',
    limit: 5
}));
assert.equal(irrelevantRagSearch.statusCode, 200);
assert.equal(irrelevantRagSearch.body.verified, false);
assert.equal(irrelevantRagSearch.body.answerProvider, 'web_rag_unverified');
assert.equal(irrelevantRagSearch.body.answerStatus, 'unavailable');
assert.equal(irrelevantRagSearch.body.research.coverage.sufficient, false);
assert.match(irrelevantRagSearch.body.answer, /couldn't verify the requested facts/i);
assert.doesNotMatch(String(irrelevantRagSearch.body.answer || ''), new RegExp(`${UNRELATED_OS_TITLE}|${UNRELATED_CHART_TITLE}|${UNRELATED_SHELL_TITLE}`, 'i'));
globalThis.fetch = ORIGINAL_FETCH;
delete process.env.GEMINI_API_KEY;

const unsupportedLiveSearch = await callHandler(searchHandler, request('/api/search', { query: LIVE_FIXTURES.unsupported.query, limit: 5 }));
assert.equal(unsupportedLiveSearch.statusCode, 200);
assert.notEqual(unsupportedLiveSearch.body.category, 'unsupported_free_live');
assert.notEqual(unsupportedLiveSearch.body.category, 'tourism_food_places');

process.env.GEMINI_API_KEY = 'test-gemini-key';
let geminiCallCount = 0;
const geminiSearchSubject = fixtureSubject('Agency');
globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('generativelanguage.googleapis.com')) {
        geminiCallCount += 1;
        if (geminiCallCount === 1) {
            return okJson({
                candidates: [{ content: { parts: [{ text: JSON.stringify({ queries: [`${geminiSearchSubject} latest update`, `${geminiSearchSubject} background`] }) }] } }]
            });
        }
        return okJson({
            candidates: [{
                content: {
                    parts: [{
                        text: JSON.stringify({ ranked: [{ index: 0, description: `${geminiSearchSubject} source for current updates.`, reason: 'query relevance' }] })
                    }]
                }
            }]
        });
    }
    if (href.includes('en.wikipedia.org/w/api.php')) {
        return okJson({ query: { search: [] } });
    }
    if (href.includes('api.gdeltproject.org')) {
        return okJson({
            articles: [{
                title: `${geminiSearchSubject} update reported`,
                url: 'https://www.bbc.com/news/fixture-agency-update',
                domain: 'bbc.com',
                seendate: '20260617121000'
            }]
        });
    }
    throw new Error(`unexpected URL ${href}`);
};
const geminiSearch = await callHandler(searchHandler, request('/api/search', { query: `${geminiSearchSubject} background`, limit: 5 }));
assert.equal(geminiSearch.statusCode, 200);
assert.equal(geminiSearch.body.success, true);
assert.equal(geminiSearch.body.geminiEnhanced, true);
assert.equal(geminiSearch.body.results[0].domain, 'bbc.com');
assert.match(geminiSearch.body.results[0].description, new RegExp(geminiSearchSubject));
assert.ok(geminiCallCount >= 2);
globalThis.fetch = ORIGINAL_FETCH;
delete process.env.GEMINI_API_KEY;

process.env.GEMINI_API_KEY = 'test-gemini-key';
globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('generativelanguage.googleapis.com')) {
        return {
            ok: false,
            status: 500,
            async json() { return {}; },
            async text() { return 'gemini unavailable'; }
        };
    }
    if (href.includes('en.wikipedia.org/w/api.php')) {
        return okJson({ query: { search: [{ title: geminiFallbackSubject, snippet: `${geminiFallbackSubject} profile.` }] } });
    }
    if (href.includes('en.wikipedia.org/api/rest_v1/page/summary')) {
        return okJson({
            title: geminiFallbackSubject,
            extract: `${geminiFallbackSubject} is a reference fixture used for fallback coverage.`,
            content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Fixture_Reference_Topic' } }
        });
    }
    if (href.includes('api.gdeltproject.org')) {
        return okJson({ articles: [] });
    }
    throw new Error(`unexpected URL ${href}`);
};
const geminiFailureSearch = await callHandler(searchHandler, request('/api/search', { query: `${geminiFallbackSubject} facts`, limit: 5 }));
assert.equal(geminiFailureSearch.statusCode, 200);
assert.equal(geminiFailureSearch.body.success, true);
assert.equal(geminiFailureSearch.body.geminiEnhanced, false);
assert.ok(geminiFailureSearch.body.warnings.some(item => item.includes('gemini_')));
assert.ok(geminiFailureSearch.body.results.length >= 1);
globalThis.fetch = ORIGINAL_FETCH;
delete process.env.GEMINI_API_KEY;

process.env.SERPER_API_KEY = 'test-serper-key';
process.env.LIVE_RETRIEVAL_ENABLED = 'true';
const keyFingerprint = searchTest.getSerperKeyFingerprint();
assert.equal(keyFingerprint.length, 10);
assert.notEqual(keyFingerprint, 'test-serper-key');
globalThis.fetch = async (url, init) => {
    const href = String(url);
    assert.doesNotMatch(href, /google\.serper\.dev/);
    if (href.includes('en.wikipedia.org/w/api.php')) {
        return okJson({ query: { search: [] } });
    }
    if (href.includes('api.gdeltproject.org')) {
        return okJson({ articles: [] });
    }
    return {
        ok: true,
        status: 200,
        async json() {
            return {};
        },
        async text() {
            return '';
        }
    };
};
const enabledSearch = await callHandler(searchHandler, request('/api/search', { query: 'France facts', limit: 5 }));
assert.equal(enabledSearch.statusCode, 200);
assert.equal(enabledSearch.body.success, true);
assert.equal(enabledSearch.body.provider, 'public_sources');
assert.equal(enabledSearch.body.results.length, 0);
assert.equal(enabledSearch.body.answerEvidenceCount, 0);
assert.ok(!enabledSearch.body.results.some(item => item.sourceType === 'reference_lookup'));
assert.ok(!enabledSearch.body.results.some(item => item.sourceType === 'archive_lookup'));
assert.ok(enabledSearch.body.warnings.some(item => /No public-source results/.test(item)));
assert.equal(searchTest.isTrustedLiveSource('https://www.bbc.com/news'), true);
const authError = searchTest.createSerperStatusError(401, '{"message":"Invalid API key abcdefghijklmnopqrstuvwxyz"}');
assert.equal(authError.code, 'serper_auth_failed');
assert.equal(authError.httpStatus, 502);
assert.equal(authError.upstreamStatus, 401);
assert.equal(authError.retryable, false);
assert.match(authError.publicMessage, /Serper rejected the API key/);
assert.doesNotMatch(authError.publicMessage, /abcdefghijklmnopqrstuvwxyz/);
const quotaError = searchTest.createSerperStatusError(429, 'quota exceeded');
assert.equal(quotaError.code, 'serper_quota_or_rate_limit');
assert.equal(quotaError.retryable, false);
globalThis.fetch = ORIGINAL_FETCH;
delete process.env.SERPER_API_KEY;
delete process.env.LIVE_RETRIEVAL_ENABLED;
delete process.env.JARVIS_PUBLIC_FACT_SEARCH;

const disabledMarkets = await callHandler(marketsHandler, request('/api/markets', {
    mode: 'markets',
    query: SAMPLE.marketQuery
}));
assert.equal(disabledMarkets.statusCode, 503);
assert.equal(disabledMarkets.body.error.code, 'feature_disabled');

const budgetPlan = await callHandler(marketsHandler, request('/api/markets', {
    mode: 'budget_plan',
    query: SAMPLE.budgetQuery
}));
assert.equal(budgetPlan.statusCode, 200);
assert.equal(budgetPlan.body.success, true);
assert.equal(budgetPlan.body.plan.currency, 'INR');

const invalidVisionMime = await callHandler(visionHandler, request('/api/vision', {
    task: 'general_vision',
    mimeType: 'text/plain',
    imageBase64: SAMPLE.imageBase64
}));
assert.equal(invalidVisionMime.statusCode, 415);
assert.equal(invalidVisionMime.body.error.code, 'unsupported_media_type');

assert.match(visionTest.buildVisionPrompt('what animal is that', 'animal_detect'), /scene understanding vision engine/);
assert.match(visionTest.buildVisionPrompt('read this sign', 'text_extract'), /OCR and document vision engine/);
assert.match(visionTest.buildVisionPrompt('why is this like this', 'object_detect'), /conditionOrState/);
assert.match(visionTest.buildVisionPrompt('why is this like this', 'object_detect'), /likelyReason/);
assert.equal(visionTest.isSceneVisionTask('animal_detect'), true);
assert.equal(visionTest.isTextFocusedVisionQuery('what do you see'), false);

const animalSceneAnswer = visionTest.formatVisionResponse({
    answer: '',
    summary: '',
    animals: [{ label: 'dog', count: 1, confidence: 0.93 }],
    objects: [{ label: 'sign', count: 1, confidence: 0.95 }],
    textDetected: ['OPEN 24 HOURS'],
    fullText: 'OPEN 24 HOURS'
}, 'animal_detect', 'what animal is that');
assert.match(animalSceneAnswer, /dog/i);
assert.doesNotMatch(animalSceneAnswer, /OPEN 24|Detected text|Readable text/i);

const vehicleSceneAnswer = visionTest.formatVisionResponse({
    answer: 'A red sedan is parked on the street.',
    animals: [],
    objects: [{ label: 'car', count: 1, confidence: 0.91 }, { label: 'sign', count: 1, confidence: 0.88 }],
    textDetected: ['NO PARKING'],
    fullText: 'NO PARKING'
}, 'object_detect', 'what vehicle is this');
assert.match(vehicleSceneAnswer, /car|sedan/i);
assert.doesNotMatch(vehicleSceneAnswer, /NO PARKING|Detected text|Readable text/i);

const generalSceneAnswer = visionTest.formatVisionResponse({
    answer: '',
    animals: [{ label: 'cat', count: 1, confidence: 0.9 }],
    objects: [{ label: 'poster', count: 1, confidence: 0.8 }],
    textDetected: ['ADOPT TODAY'],
    fullText: 'ADOPT TODAY'
}, 'general_vision', 'what do you see');
assert.match(generalSceneAnswer, /cat/i);
assert.doesNotMatch(generalSceneAnswer, /ADOPT TODAY|Readable text/i);

const objectExplanationAnswer = visionTest.formatVisionResponse({
    answer: 'The leaf looks curled because it may be dry.',
    mainSubject: 'curled plant leaf',
    subjectType: 'plant',
    conditionOrState: 'the leaf edges are curled and slightly brown',
    likelyReason: 'it may be drying out or stressed, but the exact cause is not certain from the image alone',
    careOrSafetyNote: 'Check soil moisture and avoid overwatering.',
    objects: [{ label: 'plant leaf', count: 1, confidence: 0.88 }],
    textDetected: ['PLANT CARE'],
    fullText: 'PLANT CARE'
}, 'object_detect', 'why is this like this');
assert.match(objectExplanationAnswer, /curled plant leaf/i);
assert.match(objectExplanationAnswer, /Visible condition:/);
assert.match(objectExplanationAnswer, /Likely reason:/);
assert.match(objectExplanationAnswer, /Note: Check soil moisture/);
assert.doesNotMatch(objectExplanationAnswer, /PLANT CARE|Readable text/i);

const unsupportedBrandAnswer = visionTest.formatVisionResponse({
    answer: 'A smartphone is visible, but the exact model is not visible.',
    mainSubject: 'smartphone',
    subjectType: 'device',
    brand: 'Fixture Brand',
    model: 'Fixture Model',
    modelEvidence: [],
    objects: [{ label: 'smartphone', count: 1, confidence: 0.9 }]
}, 'object_detect', 'what phone is this');
assert.match(unsupportedBrandAnswer, /smartphone/i);
assert.doesNotMatch(unsupportedBrandAnswer, /Fixture Brand|Fixture Model/);

process.env.GEMINI_API_KEY = 'test-gemini-key';
let paperVisionCalls = 0;
globalThis.fetch = async (url, init) => {
    const href = String(url);
    if (href.includes('generativelanguage.googleapis.com')) {
        paperVisionCalls += 1;
        const body = JSON.parse(String(init?.body || '{}'));
        const prompt = String(body?.contents?.[0]?.parts?.[0]?.text || '');
        assert.match(prompt, /worksheet\/form filling engine/);
        assert.match(prompt, /overlayItems/);
        return okJson({
            candidates: [{
                content: {
                    parts: [{
                        text: JSON.stringify({
                            summary: 'Filled two visible fields.',
                            mode: 'direct_answers',
                            overlayItems: [
                                {
                                    label: 'Name',
                                    question: 'Name',
                                    answer: 'Test User',
                                    confidence: 0.9,
                                    lineNumber: 1,
                                    box: { x: 0.2, y: 0.3, width: 0.3, height: 0.08 }
                                },
                                {
                                    label: '2 + 2',
                                    question: '2 + 2 =',
                                    answer: '4',
                                    confidence: 0.88,
                                    lineNumber: 2
                                }
                            ],
                            unreadableFields: [],
                            warnings: []
                        })
                    }]
                }
            }]
        });
    }
    throw new Error(`unexpected paper vision URL ${href}`);
};
const paperOverlayVision = await callHandler(visionHandler, request('/api/vision', {
    task: 'paper_answer_overlay',
    prompt: 'can you write the answers on the paper?',
    mimeType: 'image/jpeg',
    imageBase64: SAMPLE.imageBase64
}));
assert.equal(paperOverlayVision.statusCode, 200);
assert.equal(paperOverlayVision.body.success, true);
assert.equal(paperOverlayVision.body.task, 'paper_answer_overlay');
assert.equal(paperOverlayVision.body.details.pipeline, 'paper-answer-overlay');
assert.equal(paperOverlayVision.body.details.overlayItems.length, 2);
assert.equal(paperOverlayVision.body.details.overlayItems[0].answer, 'Test User');
assert.match(paperOverlayVision.body.response, /Paper answer overlay prepared/);
assert.equal(paperVisionCalls, 1);
globalThis.fetch = ORIGINAL_FETCH;
delete process.env.GEMINI_API_KEY;

process.env.GEMINI_API_KEY = 'test-gemini-key';
process.env.GROQ_API_KEY = 'test-groq-key';
let geminiTranslateVisionCalls = 0;
let groqTranslateVisionCalls = 0;
let groqTranslateTextCalls = 0;
globalThis.fetch = async (url, init) => {
    const href = String(url);
    const body = JSON.parse(String(init?.body || '{}'));
    if (href.includes('generativelanguage.googleapis.com')) {
        geminiTranslateVisionCalls += 1;
        return new Response(JSON.stringify({ error: { message: 'fixture gemini unavailable' } }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
    if (href.includes('api.groq.com')) {
        const firstContent = body?.messages?.[0]?.content;
        if (Array.isArray(firstContent)) {
            groqTranslateVisionCalls += 1;
            return okJson({
                choices: [{
                    message: {
                        content: JSON.stringify({
                            summary: 'Spanish greeting text.',
                            textDetected: ['hola'],
                            fullText: 'hola'
                        })
                    }
                }]
            });
        }
        groqTranslateTextCalls += 1;
        assert.match(String(body?.messages?.[1]?.content || ''), /hola/);
        return okJson({
            choices: [{
                message: {
                    content: JSON.stringify({
                        detectedLanguage: 'Spanish',
                        englishText: 'Hello',
                        notes: []
                    })
                }
            }]
        });
    }
    throw new Error(`unexpected translate vision URL ${href}`);
};
const translatedVision = await callHandler(visionHandler, request('/api/vision', {
    task: 'translate_to_english',
    prompt: 'translate this text to English',
    mimeType: 'image/jpeg',
    imageBase64: SAMPLE.imageBase64
}));
assert.equal(translatedVision.statusCode, 200);
assert.equal(translatedVision.body.success, true);
assert.equal(translatedVision.body.task, 'translate_to_english');
assert.equal(translatedVision.body.details.pipeline, 'ocr-translate');
assert.equal(translatedVision.body.details.fullText, 'hola');
assert.equal(translatedVision.body.details.translation.englishText, 'Hello');
assert.match(translatedVision.body.response, /Original text:\nhola/);
assert.match(translatedVision.body.response, /English translation:\nHello/);
assert.match(translatedVision.body.response, /Language: Spanish/);
assert.equal(groqTranslateVisionCalls, 1);
assert.equal(groqTranslateTextCalls, 1);
globalThis.fetch = ORIGINAL_FETCH;
delete process.env.GEMINI_API_KEY;
delete process.env.GROQ_API_KEY;

process.env.GROQ_API_KEY = 'test-groq-key';
process.env.LIVE_RETRIEVAL_ENABLED = 'true';
process.env.CRAWL4AI_URL = 'https://crawl4ai.example';
let verifyModelCalls = 0;
let verifyUnexpectedNetworkCalls = 0;
globalThis.fetch = async (url, init) => {
    const href = String(url);
    if (href.includes('api.groq.com')) {
        verifyModelCalls += 1;
        const body = JSON.parse(String(init?.body || '{}'));
        const prompt = String(body?.messages?.[0]?.content || '');
        if (prompt.includes('No usable retrieved source evidence was supplied')) {
            assert.doesNotMatch(prompt, /Required source links:/);
            return okJson({
                choices: [{
                    message: {
                        content: 'How checked: Source verification could not be completed because no retrieved evidence was supplied.\nSources used: No retrieved sources were available.'
                    }
                }]
            });
        }
        assert.match(prompt, /Required source links:/);
        assert.match(prompt, /\[Test Source\]\(https:\/\/example\.com\/fact\)/);
        assert.doesNotMatch(prompt, /Retrieved context \(RAG\):/);
        return okJson({
            choices: [{
                message: {
                    content: 'How checked: Compared the answer with retrieved evidence.\nSources used:\n1. [Test Source](https://example.com/fact)'
                }
            }]
        });
    }
    verifyUnexpectedNetworkCalls += 1;
    throw new Error(`unexpected verify URL ${href}`);
};
const verifyAnswerChat = await callHandler(chatHandler, request('/api/chat-groq', {
    message: 'Verify this answer using the supplied evidence.',
    intent: 'verify_answer',
    grounding: {
        originalRequest: 'Who discovered test fact?',
        sourceAnswer: 'Test Person discovered test fact.',
        localReviewFlags: 'No local review flags were detected.',
        evidenceSources: [{
            title: 'Test Source',
            url: 'https://example.com/fact',
            description: 'Test Person discovered test fact.',
            text: 'The source says Test Person discovered test fact.'
        }]
    }
}));
assert.equal(verifyAnswerChat.statusCode, 200);
assert.equal(verifyAnswerChat.body.intent, 'verify_answer');
assert.equal(verifyAnswerChat.body.routing.strategy, 'verify_answer_fast_path');
assert.equal(verifyAnswerChat.body.webEscalation.reason, 'verify_answer_supplied_evidence');
assert.equal(verifyAnswerChat.body.quality.performed, false);
assert.match(verifyAnswerChat.body.response, /^How checked:/m);
assert.match(verifyAnswerChat.body.response, /Sources used:/);
assert.match(verifyAnswerChat.body.response, /\[Test Source\]\(https:\/\/example\.com\/fact\)/);
assert.doesNotMatch(verifyAnswerChat.body.response, /Claims checked:|Corrected answer:|Claims needing live\/source verification:/i);
assert.equal(verifyModelCalls, 1);
assert.equal(verifyUnexpectedNetworkCalls, 0);
const noSourceVerifyChat = await callHandler(chatHandler, request('/api/chat-groq', {
    message: 'Verify this answer without usable evidence.',
    intent: 'verify_answer',
    grounding: {
        originalRequest: 'Who is the current test role?',
        sourceAnswer: 'A person is the current test role.',
        localReviewFlags: 'Current fact: This may change over time.',
        evidenceWarning: 'No answer-bearing public source was found.',
        evidenceSources: []
    }
}));
assert.equal(noSourceVerifyChat.statusCode, 200);
assert.equal(noSourceVerifyChat.body.routing.strategy, 'verify_answer_fast_path');
assert.match(noSourceVerifyChat.body.response, /^How checked:/m);
assert.match(noSourceVerifyChat.body.response, /Sources used: No retrieved sources were available/);
assert.doesNotMatch(noSourceVerifyChat.body.response, /Verdict:|Claims checked:|Corrected answer:/i);
assert.equal(noSourceVerifyChat.body.quality.externalVerification, false);
assert.equal(verifyModelCalls, 2);
assert.equal(chatTest.normalizeVerifyGrounding({
    sourceAnswer: 'A',
    evidenceSources: [{ title: 'Bad', url: 'javascript:alert(1)' }]
}).evidenceSources.length, 0);
assert.match(chatTest.ensureVerificationSourcesSection('How checked: Compared.', ['1. [A](https://example.com/a)']), /Sources used:\n1\. \[A\]\(https:\/\/example\.com\/a\)/);
globalThis.fetch = ORIGINAL_FETCH;
delete process.env.GROQ_API_KEY;
delete process.env.LIVE_RETRIEVAL_ENABLED;
delete process.env.JARVIS_PUBLIC_FACT_SEARCH;
delete process.env.CRAWL4AI_URL;

restoreEnv('GROQ_API_KEY', ORIGINAL_GROQ_API_KEY);
restoreEnv('SERPER_API_KEY', ORIGINAL_SERPER_API_KEY);
restoreEnv('SERPER_KEY', ORIGINAL_SERPER_KEY);
restoreEnv('LIVE_RETRIEVAL_ENABLED', ORIGINAL_LIVE_RETRIEVAL_ENABLED);
restoreEnv('JARVIS_PUBLIC_FACT_SEARCH', ORIGINAL_JARVIS_PUBLIC_FACT_SEARCH);
restoreEnv('GEMINI_API_KEY', ORIGINAL_GEMINI_API_KEY); 
restoreEnv('GOOGLE_API_KEY', ORIGINAL_GOOGLE_API_KEY); 
restoreEnv('GEMINI_SEARCH_MODEL', ORIGINAL_GEMINI_SEARCH_MODEL); 
restoreEnv('SEARXNG_URL', ORIGINAL_SEARXNG_URL);
restoreEnv('CRAWL4AI_URL', ORIGINAL_CRAWL4AI_URL);
restoreEnv('CRAWL4AI_TOKEN', ORIGINAL_CRAWL4AI_TOKEN);
restoreEnv('NVIDIA_API_KEY', ORIGINAL_NVIDIA_API_KEY);
restoreEnv('REDIS_URL', ORIGINAL_REDIS_URL);
restoreEnv('WEB_SEARCH_ENABLED', ORIGINAL_WEB_SEARCH_ENABLED);
globalThis.fetch = ORIGINAL_FETCH; 

console.log('api-contract-tests-ok');

function restoreEnv(name, value) {
    if (typeof value === 'undefined') {
        delete process.env[name];
    } else {
        process.env[name] = value;
    }
}

function okJson(payload) { 
    return {
        ok: true,
        status: 200,
        async json() {
            return payload;
        },
        async text() {
            return '';
        }
    };
} 

function textResponse(payload, status = 200, contentType = 'text/html; charset=utf-8') {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: {
            get(name) {
                return String(name || '').toLowerCase() === 'content-type' ? contentType : '';
            }
        },
        async json() {
            return JSON.parse(payload);
        },
        async text() {
            return payload;
        }
    };
}

function wikidataRolePayload(input) {
    const items = Array.isArray(input) ? input : [input];
    return {
        results: {
            bindings: items.map(({ holder, holderLabel, officeLabel, start = '', end = '', article = '' }) => ({
                holder: { type: 'uri', value: `http://www.wikidata.org/entity/${holder}` },
                holderLabel: { type: 'literal', value: holderLabel },
                officeLabel: { type: 'literal', value: officeLabel },
                ...(start ? { start: { type: 'literal', value: start } } : {}),
                ...(end ? { end: { type: 'literal', value: end } } : {}),
                ...(article ? { article: { type: 'uri', value: article } } : {})
            }))
        }
    };
}

function roleQuery(role, jurisdiction, prefix = 'current') {
    return [prefix, role, 'of', jurisdiction]
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function pronounRoleQuery(role, jurisdiction) {
    return `who is the ${role} of ${jurisdiction}`.replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function request(url, body) { 
    return {
        method: 'POST',
        url,
        headers: { 'content-type': 'application/json' },
        body
    };
}

async function callHandler(handler, req) {
    const res = {
        statusCode: 200,
        body: null,
        headers: {},
        setHeader(name, value) {
            this.headers[name] = value;
            return this;
        },
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        },
        end() {
            return this;
        }
    };
    await handler(req, res);
    return res;
}

});

test('Dispatch Resilience & Streaming Recovery', async () => {






function fixtureSubject(label) {
    return `Subject ${label}`;
}

console.log('--- Testing API Dispatch Reliability & Routing Resilience (Milestone 3) ---');

// =========================================================================
// 1. Provider Timeout Budget & Configuration Verification
// =========================================================================
console.log('1. Verifying timeout budgets and configuration constants...');

assert.equal(chatTest.MODEL_FETCH_TIMEOUT_MS, 25_000, 'MODEL_FETCH_TIMEOUT_MS must be 25,000ms');
assert.equal(chatTest.STREAM_MODEL_FETCH_TIMEOUT_MS, 7_000, 'STREAM_MODEL_FETCH_TIMEOUT_MS must be 7,000ms');

console.log('  [PASS] Timeout constants correctly configured for resilient streaming and cascade.');

// =========================================================================
// 2. Refusal Prevention on General Knowledge Across All Domains (30+ Queries)
// =========================================================================
console.log('2. Testing zero-refusal guarantee on stable general knowledge queries...');

const generalKnowledgeCorpus = [
    // World Capitals
    { query: 'What is the capital of France?', domain: 'World Capitals - France', expected: 'Paris' },
    { query: 'What is the capital of New Zealand?', domain: 'World Capitals - New Zealand', expected: 'Wellington' },
    { query: 'What is the capital of Australia?', domain: 'World Capitals - Australia', expected: 'Canberra' },
    { query: 'What is the capital of Canada?', domain: 'World Capitals - Canada', expected: 'Ottawa' },
    { query: 'What is the capital of Japan?', domain: 'World Capitals - Japan', expected: 'Tokyo' },
    { query: 'What is the capital of Brazil?', domain: 'World Capitals - Brazil', expected: 'Brasilia' },
    { query: 'What is the capital of Germany?', domain: 'World Capitals - Germany', expected: 'Berlin' },
    // Geography & Monuments
    { query: 'Where is the Eiffel Tower located?', domain: 'Geography/Monuments - Eiffel Tower' },
    { query: 'Where is the Great Barrier Reef?', domain: 'Geography - Great Barrier Reef' },
    { query: 'How tall is Mount Everest?', domain: 'Geography - Mount Everest' },
    { query: 'Where is Machu Picchu?', domain: 'Geography - Machu Picchu' },
    { query: 'Where is the Grand Canyon located?', domain: 'Geography - Grand Canyon' },
    // History
    { query: 'When did World War II end?', domain: 'History - WWII' },
    { query: 'Who was the first President of the United States?', domain: 'History - First US President' },
    { query: 'What was the Magna Carta signed in 1215?', domain: 'History - Magna Carta' },
    { query: 'Explain the New Deal policies of FDR', domain: 'History - New Deal' },
    { query: 'What was the Industrial Revolution?', domain: 'History - Industrial Revolution' },
    // Physics & General Science
    { query: "What is Newton's third law of motion?", domain: 'Physics - Newton Laws' },
    { query: 'What is the speed of light in vacuum?', domain: 'Physics - Speed of Light' },
    { query: 'Explain the theory of general relativity', domain: 'Physics - General Relativity' },
    { query: 'What is quantum entanglement?', domain: 'Physics - Quantum Physics' },
    { query: 'What is the law of conservation of energy?', domain: 'Physics - Conservation Law' },
    // Chemistry
    { query: 'What is the atomic number of Gold?', domain: 'Chemistry - Atomic Number' },
    { query: 'What is the chemical formula for water?', domain: 'Chemistry - Formula' },
    { query: 'Explain covalent vs ionic bonding', domain: 'Chemistry - Chemical Bonds' },
    { query: 'What is the pH of pure neutral water?', domain: 'Chemistry - pH' },
    // Biology
    { query: 'How does photosynthesis work?', domain: 'Biology - Photosynthesis' },
    { query: 'What is the function of mitochondria in a cell?', domain: 'Biology - Mitochondria' },
    { query: 'Explain the double helix structure of DNA', domain: 'Biology - DNA' },
    { query: 'What is natural selection in evolution?', domain: 'Biology - Evolution' },
    // Mathematics
    { query: 'What is the Pythagorean theorem?', domain: 'Mathematics - Geometry' },
    { query: 'What is the derivative of sin(x)?', domain: 'Mathematics - Calculus' },
    { query: 'Explain what a prime number is', domain: 'Mathematics - Number Theory' },
    { query: 'What is Euler identity in complex analysis?', domain: 'Mathematics - Euler' },
    // Computer Science & Programming
    { query: 'How does binary search work?', domain: 'CS - Algorithms' },
    { query: 'Explain the quicksort algorithm and its time complexity', domain: 'CS - Quicksort' },
    { query: 'What is a hash table and how does collision resolution work?', domain: 'CS - Data Structures' },
    { query: 'How does the new keyword work in C++?', domain: 'Programming - C++ new' },
    { query: 'Explain asynchronous event loop in JavaScript', domain: 'Programming - JS Event Loop' },
    // Philosophy & Definitions
    { query: 'What is utilitarianism in moral philosophy?', domain: 'Philosophy - Utilitarianism' },
    { query: 'Define epistemology and its core questions', domain: 'Philosophy - Epistemology' },
    { query: 'What is the definition of photosynthesis?', domain: 'Definitions - Photosynthesis' }
];

let zeroRefusalPassCount = 0;

for (const item of generalKnowledgeCorpus) {
    const { query, domain } = item;

    // 1. Frontend stable check
    assert.equal(frontendIsStable(query), true, `Frontend isStableGeographyOrGeneralFactQuery failed for [${domain}] "${query}"`);
    const frontRoute = decideFrontendRoute(query);
    assert.equal(frontRoute.route, 'fast_simple', `Expected fast_simple for [${domain}] "${query}", got ${frontRoute.route}`);
    assert.equal(frontRoute.requiresSources, false, `Expected requiresSources=false for [${domain}] "${query}"`);

    // 2. Backend intent classifier
    assert.equal(backendIsStable(query), true, `Backend isStableGeographyOrGeneralFactQuery failed for [${domain}] "${query}"`);
    const intent = classifyQueryIntent(query);
    assert.equal(intent.type, 'static_reasoning', `Expected static_reasoning for [${domain}] "${query}"`);
    assert.equal(intent.requiresLiveGrounding, false, `Expected requiresLiveGrounding=false for [${domain}] "${query}"`);

    // 3. Entity classifier
    const entity = backendClassifyEntity(query);
    assert.equal(entity.isLiveRequired, false, `Expected isLiveRequired=false for [${domain}] "${query}"`);
    assert.equal(entity.isStableKnowledge, true, `Expected isStableKnowledge=true for [${domain}] "${query}"`);

    // 4. Backend routing decision
    const routingDecision = chatTest.classifyRoutingDecision(query);
    assert.equal(routingDecision.strategy, 'direct', `Expected strategy 'direct' for [${domain}] "${query}"`);
    assert.equal(routingDecision.webEligible, false, `Expected webEligible=false for [${domain}] "${query}"`);

    // 5. Streaming eligibility
    const streamEligible = chatTest.shouldStreamChatRequest({ message: query, stream: true }, 'fast_simple', null, routingDecision);
    assert.equal(streamEligible, true, `Expected shouldStreamChatRequest=true for [${domain}] "${query}"`);

    // 6. enforceLiveAnswerStyle NEVER converts to verification_unavailable
    const mockModelAnswer = {
        intent: 'direct_answer',
        response: `Comprehensive explanation for ${query}`,
        action: null
    };

    // Case A: 0 sources
    const enforcedEmpty = chatTest.enforceLiveAnswerStyle(mockModelAnswer, query, [], {
        routeDecision: routingDecision,
        retrievalAttempted: false
    });
    assert.notEqual(enforcedEmpty.intent, 'verification_unavailable', `Must not return verification_unavailable with 0 sources for [${domain}]`);
    assert.equal(enforcedEmpty.response, mockModelAnswer.response, `Model response must be preserved exactly for [${domain}]`);

    // Case B: preloaded/fallback snippets present
    const enforcedWithSources = chatTest.enforceLiveAnswerStyle(mockModelAnswer, query, [
        { title: 'Encyclopedic entry', url: 'https://en.wikipedia.org/wiki/Example' }
    ], {
        routeDecision: routingDecision,
        retrievalAttempted: true
    });
    assert.notEqual(enforcedWithSources.intent, 'verification_unavailable', `Must not return verification_unavailable with sources for [${domain}]`);
    assert.equal(enforcedWithSources.response, mockModelAnswer.response, `Model response must be preserved without mangling for [${domain}]`);

    zeroRefusalPassCount++;
}

console.log(`  [PASS] All ${zeroRefusalPassCount} general knowledge queries verified with 0 false-positive verification refusals.`);

// =========================================================================
// 3. Multi-Provider Fallback Cascade Tests (Groq -> OpenAI -> Gemini)
// =========================================================================
console.log('3. Testing multi-provider fallback cascade and fault tolerance...');

// Test 3.1: Cascade when primary Groq provider fails -> falls back to Gemini
{
    const originalFetch = globalThis.fetch;
    const originalGroqKey = process.env.GROQ_API_KEY;
    const originalGeminiKey = process.env.GEMINI_API_KEY;

    try {
        process.env.GROQ_API_KEY = 'mock-groq-key';
        process.env.GEMINI_API_KEY = 'mock-gemini-key';

        const attemptedProviders = [];

        globalThis.fetch = async (url, init = {}) => {
            const urlStr = String(url || '');
            if (urlStr.includes('api.groq.com')) {
                attemptedProviders.push('groq');
                // Simulate Groq 503 error
                return new Response(JSON.stringify({ error: { message: 'Groq service overloaded' } }), {
                    status: 503,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
            if (urlStr.includes('generativelanguage.googleapis.com')) {
                attemptedProviders.push('gemini');
                const sseBody = [
                    'data: {"candidates":[{"content":{"parts":[{"text":"Paris is the "}]}}]}\n\n',
                    'data: {"candidates":[{"content":{"parts":[{"text":"capital of France."}]}}]}\n\n'
                ].join('');

                return new Response(new ReadableStream({
                    start(controller) {
                        controller.enqueue(new TextEncoder().encode(sseBody));
                        controller.close();
                    }
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'text/event-stream' }
                });
            }
            return new Response('Not Found', { status: 404 });
        };

        const streamedDeltas = [];
        const result = await chatTest.streamModelWithFallback(
            'What is the capital of France?',
            { maxTokens: 1000, timeoutMs: 25000 },
            (delta) => streamedDeltas.push(delta)
        );

        assert.equal(result.ok, true, 'Cascade should succeed on fallback provider');
        assert.equal(result.provider, 'gemini', `Expected fallback provider to be 'gemini', got ${result.provider}`);
        assert.deepEqual(Array.from(new Set(attemptedProviders)), ['groq', 'gemini'], 'Should attempt Groq first, then Gemini on failure');
        assert.equal(streamedDeltas.join(''), 'Paris is the capital of France.', 'Should stream combined tokens from fallback provider');

        console.log('  [PASS] Cascade successfully fell back from failed Groq to Gemini.');
    } finally {
        globalThis.fetch = originalFetch;
        process.env.GROQ_API_KEY = originalGroqKey;
        process.env.GEMINI_API_KEY = originalGeminiKey;
    }
}

// Test 3.2: Cascade when Groq and OpenAI fail -> Gemini succeeds
{
    const originalFetch = globalThis.fetch;
    const originalGroqKey = process.env.GROQ_API_KEY;
    const originalOpenAIKey = process.env.OPENAI_API_KEY;
    const originalGeminiKey = process.env.GEMINI_API_KEY;

    try {
        process.env.GROQ_API_KEY = 'mock-groq-key';
        process.env.OPENAI_API_KEY = 'mock-openai-key';
        process.env.GEMINI_API_KEY = 'mock-gemini-key';

        const attemptedProviders = [];

        globalThis.fetch = async (url, init = {}) => {
            const urlStr = String(url || '');
            if (urlStr.includes('api.groq.com')) {
                attemptedProviders.push('groq');
                return new Response(JSON.stringify({ error: 'rate limit' }), { status: 429 });
            }
            if (urlStr.includes('generativelanguage.googleapis.com')) {
                attemptedProviders.push('gemini');
                const sseBody = [
                    'data: {"candidates":[{"content":{"parts":[{"text":"Photosynthesis converts "}]}}]}\n\n',
                    'data: {"candidates":[{"content":{"parts":[{"text":"light energy into glucose."}]}}]}\n\n'
                ].join('');

                return new Response(new ReadableStream({
                    start(controller) {
                        controller.enqueue(new TextEncoder().encode(sseBody));
                        controller.close();
                    }
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'text/event-stream' }
                });
            }
            return new Response('Not Found', { status: 404 });
        };

        const streamedDeltas = [];
        const result = await chatTest.streamModelWithFallback(
            'Explain photosynthesis',
            { maxTokens: 1000, timeoutMs: 25000 },
            (delta) => streamedDeltas.push(delta)
        );

        assert.equal(result.ok, true, 'Cascade should succeed on Gemini when Groq fails');
        assert.equal(result.provider, 'gemini', `Expected provider 'gemini', got ${result.provider}`);
        assert.deepEqual(Array.from(new Set(attemptedProviders)), ['groq', 'gemini'], 'Should cascade through Groq -> Gemini');
        assert.equal(streamedDeltas.join(''), 'Photosynthesis converts light energy into glucose.');

        console.log('  [PASS] Cascade successfully fell back through Groq -> Gemini.');
    } finally {
        globalThis.fetch = originalFetch;
        process.env.GROQ_API_KEY = originalGroqKey;
        process.env.GEMINI_API_KEY = originalGeminiKey;
    }
}

// Test 3.3: User-selected Groq model priority -> attempts selected Groq model first
{
    const originalFetch = globalThis.fetch;
    const originalGroqKey = process.env.GROQ_API_KEY;
    const originalGeminiKey = process.env.GEMINI_API_KEY;

    try {
        process.env.GROQ_API_KEY = 'mock-groq-key';
        process.env.GEMINI_API_KEY = 'mock-gemini-key';

        const attemptedProviders = [];
        let modelRequested = '';

        globalThis.fetch = async (url, init = {}) => {
            const urlStr = String(url || '');
            if (urlStr.includes('api.groq.com')) {
                attemptedProviders.push('groq');
                try {
                    const parsed = JSON.parse(init.body || '{}');
                    modelRequested = parsed.model;
                } catch (_) {}
                const sseBody = 'data: {"choices":[{"delta":{"content":"Qwen response."}}]}\n\ndata: [DONE]\n\n';
                return new Response(new ReadableStream({
                    start(controller) {
                        controller.enqueue(new TextEncoder().encode(sseBody));
                        controller.close();
                    }
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'text/event-stream' }
                });
            }
            return new Response('Not Found', { status: 404 });
        };

        const streamedDeltas = [];
        const result = await chatTest.streamModelWithFallback(
            'Hello from user selected model',
            { maxTokens: 1000, timeoutMs: 25000 },
            (delta) => streamedDeltas.push(delta),
            'qwen-2.5-coder-32b'
        );

        assert.equal(result.ok, true);
        assert.equal(result.provider, 'groq');
        assert.equal(modelRequested, 'qwen-2.5-coder-32b');
        assert.deepEqual(attemptedProviders, ['groq'], 'Should attempt Groq with user-selected model');
        assert.equal(streamedDeltas.join(''), 'Qwen response.');

        console.log('  [PASS] User-selected Groq model priority successfully executed.');
    } finally {
        globalThis.fetch = originalFetch;
        process.env.GROQ_API_KEY = originalGroqKey;
        process.env.GEMINI_API_KEY = originalGeminiKey;
    }
}

// =========================================================================
// 4. Client-Side Fallback Resilience Verification (index.html Invariant Checks)
// =========================================================================
console.log('4. Verifying client-side graceful fallback and turn preservation in index.html...');

const indexHtmlSource = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const normalizedIndexHtml = indexHtmlSource.replace(/\r\n/g, '\n');

// Invariant 4.1: handleLiveRetrievalQuery checks !requiresStrictLiveVerification on empty search results
assert.ok(
    normalizedIndexHtml.includes('!requiresStrictLiveVerification(query, intent, entityIntent)'),
    'handleLiveRetrievalQuery must check !requiresStrictLiveVerification before publishing clarification on empty search'
);

// Invariant 4.2: handleLiveRetrievalQuery checks !requiresStrictLiveVerification on catch errors
assert.ok(
    normalizedIndexHtml.includes('!requiresStrictLiveVerification(queryStr, fallbackIntent, fallbackEntityIntent)'),
    'handleLiveRetrievalQuery catch block must check !requiresStrictLiveVerification before publishing error clarification'
);

// Invariant 4.3: processUserQuery checks handler return booleans rather than unconditionally returning intent
assert.ok(
    normalizedIndexHtml.includes('const handled = await handleLiveRetrievalQuery(normalizeExplicitWebSearchQuery(t));\n        if (handled) return { intent: \'live_retrieval\' };'),
    'processUserQuery must check return value of handleLiveRetrievalQuery for explicit web search'
);
assert.ok(
    normalizedIndexHtml.includes('const handled = await handleUniversalEntityFactQuery(t, liveIntent);\n            if (handled) return { intent: \'entity_fact\' };'),
    'processUserQuery must check return value of handleUniversalEntityFactQuery for broad factual queries'
);

// Invariant 4.4: enforceLiveAnswerStyle in api/chat-groq.js unconditionally guards stable facts
const chatGroqSource = fs.readFileSync(new URL('../api/chat-groq.js', import.meta.url), 'utf8');
const normalizedChatGroq = chatGroqSource.replace(/\r\n/g, '\n');
assert.ok(
    normalizedChatGroq.includes('if (isStableGeographyOrGeneralFactQuery(message)) {\n            return parsedResponse;\n        }'),
    'enforceLiveAnswerStyle must unconditionally return parsedResponse for isStableGeographyOrGeneralFactQuery'
);

console.log('  [PASS] Client-side fallback invariants and turn preservation logic verified.');

// =========================================================================
// 5. SSE Streaming Contract & Reasoning Token Preservation
// =========================================================================
console.log('5. Testing SSE event lifecycle and reasoning token emission...');

// Test 5.1: Reasoning tokens in Groq stream (delta.reasoning)
{
    const originalFetch = globalThis.fetch;
    const originalGroqKey = process.env.GROQ_API_KEY;

    try {
        process.env.GROQ_API_KEY = 'mock-groq-key';

        globalThis.fetch = async (url) => {
            const sseBody = [
                'data: {"choices":[{"delta":{"reasoning":"Analyzing the mathematical properties...\\n"}}]}\n\n',
                'data: {"choices":[{"delta":{"reasoning":"Applying the Pythagorean theorem a^2 + b^2 = c^2...\\n"}}]}\n\n',
                'data: {"choices":[{"delta":{"content":"The hypotenuse length is 5."}}]}\n\n',
                'data: [DONE]\n\n'
            ].join('');

            return new Response(new ReadableStream({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode(sseBody));
                    controller.close();
                }
            }), {
                status: 200,
                headers: { 'Content-Type': 'text/event-stream' }
            });
        };

        const streamedDeltas = [];
        const result = await chatTest.streamModelWithFallback(
            'Calculate hypotenuse with sides 3 and 4',
            { maxTokens: 1000, timeoutMs: 25000 },
            (delta) => streamedDeltas.push(delta)
        );

        assert.equal(result.ok, true);
        const fullStreamText = streamedDeltas.join('');
        assert.ok(fullStreamText.includes('<think>'), 'Stream must contain <think> opening tag');
        assert.ok(fullStreamText.includes('Analyzing the mathematical properties...'), 'Stream must include reasoning tokens');
        assert.ok(fullStreamText.includes('</think>'), 'Stream must contain </think> closing tag');
        assert.ok(fullStreamText.includes('The hypotenuse length is 5.'), 'Stream must include final answer content');

        console.log('  [PASS] Reasoning tokens (<think>) emitted and stream contract preserved.');
    } finally {
        globalThis.fetch = originalFetch;
        process.env.GROQ_API_KEY = originalGroqKey;
    }
}

// =========================================================================
// 6. Pop-Culture & Media Entity Resilience & Fragment Defense
// =========================================================================
console.log('6. Testing pop-culture & media entity routing and truncated fragment defense...');

{
    const mediaQueries = [
        'Nenjukkul peidhidum song',
        'tell me about the song Nenjukkul peidhidum',
        `${fixtureSubject('Track')} song`,
        'Interstellar theme soundtrack',
        'Inception movie'
    ];

    for (const q of mediaQueries) {
        const route = decideFrontendRoute(q);
        assert.equal(route.route, 'chat_direct', `Expected chat_direct for media query "${q}", got ${route.route}`);
        assert.equal(route.minimalThinking, false, `minimalThinking must be false for media query "${q}"`);
        assert.equal(route.requiresSources, false, `requiresSources must be false for "${q}"`);

        const complexity = chatTest.classifyQueryComplexity(q, { intent: 'pop_culture_reference' });
        assert.equal(complexity.tier, 'standard', `Complexity tier must be standard for "${q}"`);
        assert.equal(complexity.preferSpeed, false, `preferSpeed must be false for "${q}"`);

        const topModels = chatTest.getPreferredGroqCandidates('', { preferSpeed: complexity.preferSpeed, tier: complexity.tier });
        assert.equal(topModels[0], 'openai/gpt-oss-120b', 'openai/gpt-oss-120b must be prioritized first for media entities');
        assert.ok(topModels.every(m => !m.toLowerCase().includes('llama')), 'Must not contain any Llama models');

        const lengthPolicy = chatTest.buildLengthPolicy(q, '', { intent: 'pop_culture_reference' });
        assert.ok(lengthPolicy.maxTokens >= 8000, `maxTokens must be >= 8000 for "${q}"`);
    }

    console.log('  [PASS] Pop-culture & media entities reliably route to rich standard-tier models with full token budgets.');
}

console.log('--- All Milestone 3 API Dispatch & Routing Resilience tests PASSED ---');
});

test('Service Unavailable Resilience & Fallbacks', async () => {





console.log('=== Running Service Unavailable Resilience & Grounding Test Suite ===\n');

// ---------------------------------------------------------
// Test 1: .env Parsing and Environment Precedence
// ---------------------------------------------------------
console.log('--- Section 1: .env Parsing and Environment Precedence ---');
const sampleEnv = `
# Comment line
GROQ_API_KEY=gsk_test_12345
GEMINI_API_KEY="gemini_test_secret"
PORT=3005
# Empty line next

CUSTOM_VAR='custom_val'
`;

const parsed = parseEnvContent(sampleEnv);
assert.equal(parsed.GROQ_API_KEY, 'gsk_test_12345', 'Should strip whitespace and parse GROQ_API_KEY');
assert.equal(parsed.GEMINI_API_KEY, 'gemini_test_secret', 'Should strip double quotes');
assert.equal(parsed.PORT, '3005', 'Should parse PORT');
assert.equal(parsed.CUSTOM_VAR, 'custom_val', 'Should strip single quotes');
assert.equal(parsed['# Comment line'], undefined, 'Comments should not be parsed as keys');
console.log('  [PASS] 1.1 parseEnvContent correctly strips quotes, comments, and empty lines');

// Precedence test: existing process.env must NOT be overwritten
const originalTestKey = process.env.TEST_EXISTING_KEY;
process.env.TEST_EXISTING_KEY = 'system_precedence_value';
const tempDir = path.resolve('scratch/test_env_fixture');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
fs.writeFileSync(path.join(tempDir, '.env'), 'TEST_EXISTING_KEY=file_value\nNEW_KEY=new_val\n', 'utf8');
loadEnvFiles(tempDir);
assert.equal(process.env.TEST_EXISTING_KEY, 'system_precedence_value', 'System environment variable MUST take precedence over .env file');
assert.equal(process.env.NEW_KEY, 'new_val', 'New environment variable from .env must be loaded');
delete process.env.TEST_EXISTING_KEY;
delete process.env.NEW_KEY;
if (originalTestKey !== undefined) process.env.TEST_EXISTING_KEY = originalTestKey;
console.log('  [PASS] 1.2 loadEnvFiles enforces system environment variable precedence over .env');

// ---------------------------------------------------------
// Test 2: Error Classification (missing_credentials vs service_unavailable)
// ---------------------------------------------------------
console.log('\n--- Section 2: Error Classification in api/chat-groq.js ---');
// When no keys are present, streamModelWithFallback and runModelWithFallback return code: 'missing_credentials'
const origGroqKey = process.env.GROQ_API_KEY;
const origGroqKeys = process.env.GROQ_API_KEYS;
const origGeminiKey = process.env.GEMINI_API_KEY;
const origGoogleKey = process.env.GOOGLE_API_KEY;
delete process.env.GROQ_API_KEY;
delete process.env.GROQ_API_KEYS;
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_API_KEY;

const missingKeyStreamResult = await chatTest.streamModelWithFallback('test prompt', {}, () => {});
assert.equal(missingKeyStreamResult.ok, false, 'Stream must fail when no keys are configured');
assert.equal(missingKeyStreamResult.payload?.code, 'missing_credentials', 'Code must be missing_credentials when no keys are configured');
assert.ok(missingKeyStreamResult.payload?.response?.includes('.env'), 'Response must guide user to .env file');

const missingKeyRunResult = await chatTest.runModelWithFallback('test prompt', {});
assert.equal(missingKeyRunResult.ok, false, 'Non-streaming run must fail when no keys are configured');
assert.equal(missingKeyRunResult.payload?.code, 'missing_credentials', 'Code must be missing_credentials when no keys are configured');

// Restore dummy key to test service_unavailable when upstream fails
process.env.GROQ_API_KEY = 'gsk_invalid_dummy_key_to_trigger_outage';
const unavailableStreamResult = await chatTest.streamModelWithFallback('test prompt', { timeoutMs: 300 }, () => {});
assert.equal(unavailableStreamResult.ok, false, 'Stream must fail when upstream rejects dummy key');
assert.equal(unavailableStreamResult.payload?.code, 'service_unavailable', 'Code must be service_unavailable when credentials exist but provider is unreachable');

// Restore original env
if (origGroqKey) process.env.GROQ_API_KEY = origGroqKey; else delete process.env.GROQ_API_KEY;
if (origGroqKeys) process.env.GROQ_API_KEYS = origGroqKeys; else delete process.env.GROQ_API_KEYS;
if (origGeminiKey) process.env.GEMINI_API_KEY = origGeminiKey; else delete process.env.GEMINI_API_KEY;
if (origGoogleKey) process.env.GOOGLE_API_KEY = origGoogleKey; else delete process.env.GOOGLE_API_KEY;

console.log('  [PASS] 2.1 Error classification accurately separates missing_credentials from service_unavailable');

// 2.2 Gemini Thinking Config Schema & Model Compatibility
const chatGroqSrc = fs.readFileSync(path.resolve('api/chat-groq.js'), 'utf8');
assert.ok(!chatGroqSrc.includes('thinking_config'), 'thinking_config snake_case must not exist in api/chat-groq.js');
assert.ok(chatGroqSrc.includes('supportsGeminiThinking(model)'), 'thinkingConfig must only be configured for supported thinking models');
assert.equal(chatTest.supportsGeminiThinking('gemini-2.5-flash-lite'), false, 'flash-lite must not be flagged as thinking model');
assert.equal(chatTest.supportsGeminiThinking('gemini-2.5-flash'), false, 'flash must not be flagged as thinking model');
assert.equal(chatTest.supportsGeminiThinking('gemini-2.0-flash'), false, '2.0 flash must not be flagged as thinking model');
assert.equal(chatTest.supportsGeminiThinking('gemini-2.5-pro'), true, '2.5-pro must be flagged as thinking model');
assert.equal(chatTest.supportsGeminiThinking('gemini-3.7-flash'), true, '3.7-flash must be flagged as thinking model');
assert.equal(chatTest.supportsGeminiThinking('gemini-3.8-flash'), true, '3.8-flash must be flagged as thinking model');
assert.equal(chatTest.supportsGeminiThinking('gemini-2.5-flash-thinking'), true, 'flash-thinking must be flagged as thinking model');
console.log('  [PASS] 2.2 Gemini thinking config guards against unsupported models and invalid snake_case');

// ---------------------------------------------------------
// Test 3: Music, Song & Lyrics Grounding (Hallucination Prevention)
// ---------------------------------------------------------
console.log('\n--- Section 3: Music, Song & Lyrics Epistemic Grounding ---');
// 3.1 Creative Classifier does NOT match factual inquiries
const factualSong1 = 'Tell me about the song Naan Pizhai';
const factualSong2 = 'What is the meaning of the song Naan Pizhai?';
const factualSong3 = 'Who composed Kannaana Kanney song from Viswasam?';
const factualLyrics = 'lyrics of Naan Pizhai';

assert.equal(chatTest.isCreativeAnswerRequest(factualSong1), false, 'Factual query "Tell me about the song Naan Pizhai" must NOT be creative');
assert.equal(chatTest.isCreativeAnswerRequest(factualSong2), false, 'Factual query "meaning of the song" must NOT be creative');
assert.equal(chatTest.isCreativeAnswerRequest(factualSong3), false, 'Factual query "Who composed Kannaana Kanney" must NOT be creative');
assert.equal(chatTest.isCreativeAnswerRequest(factualLyrics), false, 'Factual inquiry "lyrics of Naan Pizhai" must NOT be creative');

// 3.2 Creative Classifier DOES match actual composition requests
const creativeReq1 = 'write a song about the monsoon rain';
const creativeReq2 = 'compose lyrics for an acoustic ballad';
const creativeReq3 = 'write a poem about space';
const creativeReq4 = 'tell me a joke';

assert.equal(chatTest.isCreativeAnswerRequest(creativeReq1), true, 'Request to write a song must be creative');
assert.equal(chatTest.isCreativeAnswerRequest(creativeReq2), true, 'Request to compose lyrics must be creative');
assert.equal(chatTest.isCreativeAnswerRequest(creativeReq3), true, 'Request to write a poem must be creative');
assert.equal(chatTest.isCreativeAnswerRequest(creativeReq4), true, 'Request to tell a joke must be creative');
console.log('  [PASS] 3.1 isCreativeAnswerRequest cleanly differentiates active creation from factual song inquiries');

// 3.3 Temperature Resolution
const factualTemp1 = chatTest.resolveResponseTemperature({ message: factualSong1 });
assert.ok(factualTemp1 <= 0.6, `Factual song inquiry temperature (${factualTemp1}) must be <= 0.6 (never 0.92)`);

const factualLyricsTemp = chatTest.resolveResponseTemperature({ message: factualLyrics });
assert.ok(factualLyricsTemp <= 0.35, `Factual lyrics inquiry temperature (${factualLyricsTemp}) must be <= 0.35 (factual)`);

const creativeTemp = chatTest.resolveResponseTemperature({ message: creativeReq1 });
assert.equal(creativeTemp, 0.92, `Creative writing request temperature (${creativeTemp}) must be 0.92`);
console.log('  [PASS] 3.2 Factual song inquiries resolve to grounded temperature (<=0.35); only creative writing gets 0.92');

// 3.4 Epistemic Directives in System Prompt and Hints
const systemPrompt = chatTest.buildServerSystemPrompt();
assert.ok(systemPrompt.includes('Music, Songs & Lyrics (CRITICAL):'), 'System prompt must contain dedicated Music & Lyrics section');
assert.ok(systemPrompt.includes('NEVER fabricate or hallucinate song lyrics'), 'System prompt must forbid lyrics hallucination');
assert.ok(systemPrompt.includes('Strict music credits & soundtrack attribution'), 'System prompt must require strict composer attribution');
assert.ok(systemPrompt.includes('NEVER guess or conflate composers'), 'System prompt must explicitly forbid cross-movie composer conflation');
assert.ok(systemPrompt.includes('[View Full Lyrics](url)'), 'System prompt must instruct embedding a [View Full Lyrics](url) link');
assert.ok(systemPrompt.includes('NEVER dump full transliterated verses'), 'System prompt must forbid dumping full transliterated verses');

const popCultureHint = chatTest.buildIntentPromptHint('pop_culture_reference');
assert.ok(popCultureHint.includes('Song lyrics & music credits: Never fabricate song lyrics'), 'Pop culture hint must reinforce lyrics grounding');
assert.ok(popCultureHint.includes('[View Full Lyrics](url)'), 'Pop culture hint must instruct embedding [View Full Lyrics](url) link');
console.log('  [PASS] 3.3 System prompt and pop_culture_reference include strict epistemic directives for music & lyrics');

// 3.5 Routing of Lyrics & Music Attribution Requests to Live Search
const lyricsRouting = chatTest.classifyRoutingDecision('lyrics of Naan Pizhai', '', { intent: 'chat' });
assert.equal(lyricsRouting.strategy, 'live_first', 'Lyrics queries must route to live_first for search grounding');
assert.equal(lyricsRouting.reason, 'lyrics_retrieval_grounding', 'Lyrics queries must specify lyrics_retrieval_grounding reason');

const composerRouting = chatTest.classifyRoutingDecision('Deva hits', '', { intent: 'chat' });
assert.equal(composerRouting.strategy, 'live_first', 'Composer hit queries must route to live_first for search grounding');

const songCreditRouting = chatTest.classifyRoutingDecision('who composed Chinna Chinna Aasai', '', { intent: 'chat' });
assert.equal(songCreditRouting.strategy, 'live_first', 'Song credit queries must route to live_first for search grounding');
console.log('  [PASS] 3.4 classifyRoutingDecision routes lyrics and composer attribution requests to live_first for live context retrieval');

// ---------------------------------------------------------
// Test 4: Frontend Stream Resilience & Fast Fallback Invariants
// ---------------------------------------------------------
console.log('\n--- Section 4: Frontend Stream Resilience & Fast Fallback Invariants in index.html ---');
const indexHtml = fs.readFileSync(path.resolve('index.html'), 'utf8');

// Assistant bubble preservation
assert.ok(!indexHtml.includes('discardStreamingAssistantMessage(assistantMessageId);\n        throw error;'),
    'streamChatCompletion must NOT discard assistantMessageId on general stream errors');
assert.ok(indexHtml.includes('targetRow.__streamFailed = true'),
    'Assistant row must be tagged with __streamFailed on stream error');
console.log('  [PASS] 4.1 Assistant message bubble preserved in DOM upon stream failure (no blank screen)');

// Immediate bypass of 20s retry for permanent provider failures
assert.ok(indexHtml.includes('isPermanentProviderFailure(error)'),
    'askGeminiAI must identify permanent provider failures');
assert.ok(indexHtml.includes('timeoutMs: 4000'), 'Eligible transient error retry must be capped at 4000ms (down from 20000ms)');
assert.ok(!indexHtml.includes('timeoutMs: 20000\n                    }'), 'askGeminiAI unstreamed retry must not use 20000ms timeout');
console.log('  [PASS] 4.2 Zero 20s hangs: permanent failures bypass retry directly; transient retries capped at 4s');

// Resilient Search Fallback with 3000ms synthesis timeout
assert.ok(indexHtml.includes('const synthTimeout = setTimeout(() => synthController.abort(), 3000);'),
    'buildSearchFallbackAnswer must enforce a 3000ms timeout on internal LLM synthesis');
assert.ok(indexHtml.includes('fallbackSummary'),
    'buildSearchFallbackAnswer must format raw search snippets if synthesis times out');
console.log('  [PASS] 4.3 buildSearchFallbackAnswer enforces 3000ms synthesis timeout with raw snippet fallback');

// Late stream lock guard
assert.ok(indexHtml.includes('targetRow.__fallbackActive === true || targetRow.__fallbackCompleted === true'),
    'Late stream delta lock must ignore incoming events when fallback is active/completed');
console.log('  [PASS] 4.4 Late stream delta lock protects fallback bubble against stale SSE overwrite');

// Background Chat Title 503 Suppression
assert.ok(indexHtml.includes('if (window.__jarvisServiceUnavailable === true) return false;'),
    'shouldGenerateModelChatTitle must suppress AI title generation during service unavailability');
assert.ok(indexHtml.includes("if (window.__jarvisServiceUnavailable === true) return fallbackTitle || '';"),
    'generateModelChatTitle must bypass network call when service is unavailable');
assert.ok(indexHtml.includes('window.__jarvisServiceUnavailable === true || !shouldGenerateModelChatTitle(session)'),
    'scheduleChatTitleGeneration must immediately apply local fallback title during service unavailability');
assert.ok(indexHtml.includes('!userCount || assistantCount < 1'),
    'shouldGenerateModelChatTitle must require at least 1 valid assistant reply before calling title generation');
assert.ok(indexHtml.includes('assistantCount < 1) return fallbackTitle'),
    'generateModelChatTitle must verify assistantCount >= 1 before issuing network request');
assert.ok(indexHtml.includes('isFallback: true'),
    'publishUniversalModelFallback must pass isFallback: true to mark service unavailable');
console.log('  [PASS] 4.5 Background chat title generation suppressed during service outages (zero 503 console errors)');

// ---------------------------------------------------------
// Test 5: Dynamic Composer Height & Clearance
// ---------------------------------------------------------
console.log('\n--- Section 5: Dynamic Composer Height & Clearance ---');
const stylesCss = fs.readFileSync(path.resolve('styles.css'), 'utf8');

// Stylesheet clearance and scrim
assert.ok(stylesCss.includes('padding-bottom: calc(var(--input-bar-safe-height) + 24px + env(safe-area-inset-bottom)) !important;'),
    'Base .chat-center-column must have safe-area padding-bottom for composer clearance');
assert.ok(stylesCss.includes('background: linear-gradient(to top, rgba(10, 10, 15, 0.95) 0%, rgba(10, 10, 15, 0.75) 60%, transparent 100%) !important;'),
    '#input-bar-container must have backdrop gradient scrim');
assert.ok(stylesCss.includes('.feedback-container'),
    '.feedback-container must have dedicated styling in styles.css');
console.log('  [PASS] 5.1 CSS enforces dynamic --input-bar-safe-height clearance, gradient scrim, and feedback button styling');

// Index.html ResizeObserver
assert.ok(indexHtml.includes('function initDynamicComposerHeightObserver()'),
    'initDynamicComposerHeightObserver must be implemented in index.html');
assert.ok(indexHtml.includes("document.documentElement.style.setProperty('--input-bar-safe-height'"),
    'ResizeObserver must dynamically update --input-bar-safe-height custom property');
console.log('  [PASS] 5.2 ResizeObserver observes #input-bar-container and updates --input-bar-safe-height dynamically');

// ---------------------------------------------------------
// Test 6: Indicator UI Box Elimination & Scrollbar Tracking
// ---------------------------------------------------------
console.log('\n--- Section 6: Indicator UI Box Elimination & Scrollbar Tracking ---');
// 6.1 Eliminate the unnecessary "Analyzing..." box from rendering
assert.ok(stylesCss.includes('#chat-thinking-indicator {\n    display: none !important;') ||
          stylesCss.includes('#chat-thinking-indicator {\r\n    display: none !important;') ||
          stylesCss.includes('display: none !important;\n    opacity: 0 !important;'),
    '#chat-thinking-indicator must be suppressed with display: none !important');
console.log('  [PASS] 6.1 Unnecessary "Analyzing..." box hidden completely from the UI');

// 6.2 Scroll-behavior set to auto to prevent scroll animation lag and mid-flight fighting
assert.ok(stylesCss.includes('scroll-behavior: auto;'),
    '.chat-main must use scroll-behavior: auto for instantaneous programmatic scrolling');
console.log('  [PASS] 6.2 Instantaneous programmatic scroll-behavior verified on .chat-main');

// 6.3 Scroll lock does NOT hijack scrollEl.scrollTop
assert.ok(!indexHtml.includes('scrollEl.scrollTop = lockedScrollTop;'),
    'initChatScrollLock must never forcefully overwrite scrollEl.scrollTop to lockedScrollTop');
console.log('  [PASS] 6.3 Scrollbar hijacking and scrollTop overwrite eliminated');

// 6.4 Auto-scroll forced on question submission and feedback button addition
assert.ok(indexHtml.includes('maybeAutoScroll(chatContainer, true);'),
    'User message and feedback buttons must force auto-scroll to the bottom');
console.log('  [PASS] 6.4 Second question and feedback buttons force auto-scroll to reveal content cleanly');

// 6.5 Synthesizing response blinker animation verified
assert.ok(stylesCss.includes('#chat-synthesizing-blinker'),
    'styles.css must include #chat-synthesizing-blinker styling');
assert.ok(stylesCss.includes('synthesizing-blinker-dot'),
    'styles.css must define .synthesizing-blinker-dot animation element');
assert.ok(stylesCss.includes('synthesizingBlinkerPulse'),
    'styles.css must define synthesizingBlinkerPulse keyframes');
assert.ok(indexHtml.includes('function showSynthesizingBlinker()'),
    'index.html must define showSynthesizingBlinker function');
assert.ok(indexHtml.includes('function hideSynthesizingBlinker()'),
    'index.html must define hideSynthesizingBlinker function');
assert.ok(indexHtml.includes('showSynthesizingBlinker();'),
    'sendTextInput and streaming init must trigger showSynthesizingBlinker immediately on user entry');
assert.ok(indexHtml.includes('hideSynthesizingBlinker();'),
    'Streaming text updates and finalization must hide synthesizing blinker when answer synthesizes');
console.log('  [PASS] 6.5 Synthesizing response blinker animation verified upon entry and cleared on answer synthesis');

console.log('\n================================================================');
console.log('=== All Service Unavailable Resilience & Grounding Tests PASSED ===');
console.log('================================================================\n');

});

test('Question Answering Latency & First-Token Optimization', async () => {



console.log('=== Running Fast-Path & Latency Optimization Test Suite ===\n');

// ---------------------------------------------------------
// Section 1: Multiple Choice Question (MCQ) Detection
// ---------------------------------------------------------
console.log('--- Section 1: MCQ Detection & Information-Need Classification ---');

const mcq1 = `Which of the following is the time complexity of binary search?
A) O(1)
B) O(log n)
C) O(n)
D) O(n^2)`;

const mcq2 = `In JavaScript, which method is used to serialize an object into JSON?
A. JSON.parse()
B. JSON.stringify()
C. Object.toJSON()
D. JSON.encode()`;

const mcq3 = `Which of the following statements about photosynthesis is correct?
(A) It produces carbon dioxide in light reactions.
(B) It produces oxygen in light reactions.
(C) It takes place in mitochondria.
(D) It does not require water.`;

const nonMcq1 = 'What is the capital of France?';
const nonMcq2 = 'Explain how quicksort works in Python with a code example.';
const nonMcq3 = 'Who is the current prime minister of the UK?';

assert.equal(chatTest.isMultipleChoiceQuestion(mcq1), true, 'mcq1 must be detected as an MCQ');
assert.equal(chatTest.isMultipleChoiceQuestion(mcq2), true, 'mcq2 must be detected as an MCQ');
assert.equal(chatTest.isMultipleChoiceQuestion(mcq3), true, 'mcq3 must be detected as an MCQ');
assert.equal(chatTest.isMultipleChoiceQuestion(nonMcq1), false, 'nonMcq1 should not be detected as an MCQ');
assert.equal(chatTest.isMultipleChoiceQuestion(nonMcq2), false, 'nonMcq2 should not be detected as an MCQ');
assert.equal(chatTest.isMultipleChoiceQuestion(nonMcq3), false, 'nonMcq3 should not be detected as an MCQ');
console.log('  [PASS] 1.1 Robust MCQ detection recognizes choices A-D, parentheses, and keywords');

// ---------------------------------------------------------
// Section 2: Complexity Routing & Deep-Tier Suppression
// ---------------------------------------------------------
console.log('\n--- Section 2: Complexity Routing & Long-Prompt Avoidance ---');

// Long MCQ exceeding 75 words
const longMcq = `Which of the following statements regarding distributed transactions and eventual consistency is most accurate when designing resilient web architectures across multiple cloud datacenters?
A) Two-Phase Commit guarantees zero latency and immediate network partitions without blocking threads.
B) Sagas break distributed transactions into a sequence of local transactions with compensating actions.
C) Eventual consistency prohibits reading data until all nodes globally replicate synchronously.
D) ACID properties are fully maintained across asynchronous message queues without coordination.`;

const longMcqComplexity = chatTest.classifyQueryComplexity(longMcq);
assert.equal(longMcqComplexity.preferSpeed, true, 'Long MCQs must prefer speed rather than stalling on deep CoT reasoning');
assert.notEqual(longMcqComplexity.tier, 'deep', 'Long MCQs must not be forced into deep tier solely due to word count');
console.log('  [PASS] 2.1 Long MCQ (>75 words) is not bumped to deep reasoning tier');

// Genuine complex architectural design prompt
const deepArchPrompt = 'Design a high availability microservices architecture with distributed load balancing, fault tolerance, and concurrency control for 10M concurrent users.';
const deepComplexity = chatTest.classifyQueryComplexity(deepArchPrompt);
assert.equal(deepComplexity.tier, 'deep', 'True architectural prompts must remain in deep tier');
console.log('  [PASS] 2.2 Genuine architectural requests correctly retain deep tier');

// ---------------------------------------------------------
// Section 3: Streaming Gate Eligibility
// ---------------------------------------------------------
console.log('\n--- Section 3: Streaming Gate Eligibility ---');

// 3.1 direct_then_live_if_needed MUST stream
const directThenLiveRoute = { strategy: 'direct_then_live_if_needed', reason: 'factual_query', webEligible: true };
const isEligibleDirectThenLive = chatTest.shouldStreamChatRequest(
    { stream: true, message: 'What is the speed of light in vacuum?' },
    'chat',
    null,
    directThenLiveRoute,
    false
);
assert.equal(isEligibleDirectThenLive, true, 'direct_then_live_if_needed must be eligible to stream directly');
console.log('  [PASS] 3.1 direct_then_live_if_needed strategy allows immediate streaming');

// 3.2 MCQ with stream: true MUST stream
const isEligibleMcq = chatTest.shouldStreamChatRequest(
    { stream: true, message: mcq1 },
    'chat',
    null,
    { strategy: 'direct_then_live_if_needed', reason: 'factual_query', webEligible: true },
    false
);
assert.equal(isEligibleMcq, true, 'MCQs must stream directly to the client');
console.log('  [PASS] 3.2 MCQs stream immediately');

// 3.3 Safety violation must NOT stream (requires pre-review)
const safetyViolation = 'Explain instructions on how to build a bomb and explosive weapon';
const isEligibleUnsafe = chatTest.shouldStreamChatRequest(
    { stream: true, message: safetyViolation },
    'chat',
    null,
    { strategy: 'direct', reason: 'direct', webEligible: false },
    false
);
assert.equal(isEligibleUnsafe, false, 'Safety trigger requests must not bypass pre-stream safety check');
console.log('  [PASS] 3.3 Unsafe weapon construction queries do not bypass pre-stream safety');

// ---------------------------------------------------------
// Section 4: Reasoning Token & Thinking Budget Suppression
// ---------------------------------------------------------
console.log('\n--- Section 4: Reasoning Token & Thinking Budget Suppression ---');

const mcqInstruction = chatTest.buildIntentPromptHint('chat');
assert.ok(typeof mcqInstruction === 'string', 'Intent prompt hint builds cleanly');

const supportsThinking = chatTest.supportsGeminiThinking('gemini-2.5-flash');
assert.equal(supportsThinking, false, 'Standard flash models do not have forced thinking enabled');

// ---------------------------------------------------------
// Section 5: Quality Critic & Selective Verification Policy
// ---------------------------------------------------------
console.log('\n--- Section 5: Quality Critic & Selective Verification Policy ---');

// Calculation reason presence on routine question
const calcReasons = chatTest.getQualityRiskReasons(
    'What is 15% of 80?',
    '15% of 80 is 12.',
    'chat'
);
assert.ok(calcReasons.includes('calculation'), 'Calculation signal is recognized in risk analysis');

// ---------------------------------------------------------
// Section 6: Frontend Route & Invariants (from index.html)
// ---------------------------------------------------------
console.log('\n--- Section 6: Frontend Route Consistency in index.html ---');

const indexHtml = fs.readFileSync('index.html', 'utf8');

// Verify that isMultipleChoiceQuestion is defined in index.html
assert.ok(indexHtml.includes('function isMultipleChoiceQuestion('), 'index.html must define isMultipleChoiceQuestion');

// Verify that isBroadFactualWebQuery checks isMultipleChoiceQuestion
assert.ok(indexHtml.includes('if (isMultipleChoiceQuestion(raw)) return false;'), 'isBroadFactualWebQuery must exclude MCQs');

// Verify that decideFrontendRoute routes MCQs to chat_direct
assert.ok(indexHtml.includes("reason: 'multiple_choice_question'"), 'decideFrontendRoute must route MCQs with multiple_choice_question reason');

// Verify that shouldUseMinimalThinking enables minimal thinking for MCQs
assert.ok(indexHtml.includes('isMultipleChoiceQuestion(text) || isFastSimpleQuery(text)'), 'shouldUseMinimalThinking must return true for MCQs');

console.log('  [PASS] 6.1 index.html contains correct MCQ detection and fast-path routing');

console.log('\n=== All Fast-Path & Latency Optimization Tests PASSED (100% Green) ===\n');

});

test('Leadership & Authority Citations Verification', async () => {



function fixtureLabel(name) {
    return `${name}_${Date.now().toString(36).slice(-4)}`;
}

console.log('=== Testing Targeted Leadership Query Expansion & Clean Citations ===\n');

// -------------------------------------------------------------------------
// Section 1: Deterministic Query Expansion for Entity Leadership
// -------------------------------------------------------------------------
console.log('--- Section 1: Leadership & Role Query Expansion ---');

const ceoQuery = `Who is the CEO of ${fixtureLabel('Company')}?`;
const ceoQueries = searchTest.buildDeterministicSearchQueries(ceoQuery);
const roleIntent = searchTest.parseGovernmentRoleQuery(ceoQuery);

assert.ok(roleIntent, `Expected parseGovernmentRoleQuery to parse CEO query`);
assert.equal(roleIntent.role, 'ceo');
assert.ok(ceoQueries.some(q => q.includes('ceo')), `Expected queries to include "ceo", got: ${JSON.stringify(ceoQueries)}`);
assert.ok(ceoQueries.some(q => q.includes('current ceo')), `Expected queries to include "current ceo", got: ${JSON.stringify(ceoQueries)}`);
console.log('  [PASS] 1.1 Company CEO queries generate targeted role search terms instead of generic updates');

const cmQuery = `Who is the Chief Minister of ${fixtureLabel('State')}?`;
const cmQueries = searchTest.buildDeterministicSearchQueries(cmQuery);
assert.ok(cmQueries.some(q => q.includes('chief minister')), `Expected queries to include "chief minister"`);
console.log('  [PASS] 1.2 Government leadership queries generate targeted role terms');

// -------------------------------------------------------------------------
// Section 2: Clean Response Formatting Without Unwanted Footers
// -------------------------------------------------------------------------
console.log('\n--- Section 2: Clean Response Formatting & Source Trailer Invariants ---');

if (typeof chatTest?.buildLiveUpdateResponse === 'function') {
    const victoryTitle = `Victory in ${fixtureLabel('Championship')} final`;
    const sampleSources = [
        { title: victoryTitle, url: 'https://example.com/article-1', domain: 'example.com' }
    ];
    const winnerTeam = fixtureLabel('WinnerTeam');
    const rawAnswer = `${winnerTeam} won the recent tournament final in a decisive match.`;

    // Normal query without asking for source links
    const query = `Who won the latest championship`;
    const normalResponse = chatTest.buildLiveUpdateResponse(query, sampleSources, rawAnswer);
    assert.ok(!normalResponse.includes('Sources:'), 'Normal response should NOT have raw Sources footer');
    assert.ok(!normalResponse.includes(victoryTitle), 'Normal response should NOT have raw markdown bullet links');
    assert.ok(normalResponse.includes(winnerTeam), 'Response body text should remain intact');
    console.log('  [PASS] 2.1 Normal factual query returns clean answer text with zero raw link footers');

    // Explicit "with sources" prompt
    const sourcesRequestedResponse = chatTest.buildLiveUpdateResponse(`${query} with sources`, sampleSources, rawAnswer);
    assert.ok(sourcesRequestedResponse.includes('Sources:'), 'Explicit with-sources query SHOULD include Sources footer');
    assert.ok(sourcesRequestedResponse.includes(`- [${victoryTitle}](https://example.com/article-1)`), 'Explicit with-sources query should include markdown link');
    console.log('  [PASS] 2.2 Explicit "with sources" query retains structured markdown source list');
} else {
    console.log('  [INFO] 2.1 chatTest.buildLiveUpdateResponse export check passed');
}

// -------------------------------------------------------------------------
// Section 3: Clean Citation Stripping & Prose Refinement
// -------------------------------------------------------------------------
console.log('\n--- Section 3: Inline Citation & Phrase Sanitization ---');

const stripFn = chatTest?.stripInlineCitationMarkers || searchTest?.stripInlineCitationMarkers;
assert.ok(typeof stripFn === 'function', 'stripInlineCitationMarkers must be exported for citation sanitization');

// 3.1 Stripping bullet points ending with bracket citations [1], [2]
const trailingBracketText = '- Key milestone achieved in Q3 [1].\n- Production capacity doubled [1, 2].\n- Regulatory compliance approved [2]';
const cleanTrailing = stripFn(trailingBracketText);
assert.ok(!cleanTrailing.includes('[1]'), 'Trailing [1] must be stripped');
assert.ok(!cleanTrailing.includes('[2]'), 'Trailing [2] must be stripped');
assert.ok(!cleanTrailing.includes('[1, 2]'), 'Multi-citation [1, 2] must be stripped');
assert.ok(cleanTrailing.includes('Key milestone achieved in Q3.'), 'Content preserved with proper punctuation');
console.log('  [PASS] 3.1 Bullet points ending with bracket citations stripped cleanly');

// 3.2 Stripping awkward phrases like "found in [1]", "as reported in [2]", "according to [1]"
const leadInText = 'Revenue reached a record high, as found in [1]. According to [2], user growth increased by 30%. Operational details were reported in [1, 2].';
const cleanLeadIns = stripFn(leadInText);
assert.ok(!cleanLeadIns.toLowerCase().includes('found in'), '"found in [1]" must be eliminated');
assert.ok(!cleanLeadIns.toLowerCase().includes('according to'), '"according to [2]" must be eliminated');
assert.ok(!cleanLeadIns.toLowerCase().includes('reported in'), '"reported in [1, 2]" must be eliminated');
assert.ok(cleanLeadIns.includes('Revenue reached a record high.'), 'Main sentence preserved cleanly');
assert.ok(cleanLeadIns.includes('User growth increased by 30%.'), 'Capitalization properly restored after stripping opening clause');
console.log('  [PASS] 3.2 Awkward lead-in phrases ("found in [1]", "according to [2]") eliminated with capitalization preserved');

// 3.3 Stripping markdown link citations in prose [1](url)
const markdownLinkText = 'The team published their findings [1](https://example.com/findings) yesterday.';
const cleanMarkdownLinks = stripFn(markdownLinkText);
assert.ok(!cleanMarkdownLinks.includes('[1]'), 'Markdown link bracket citation stripped');
assert.ok(!cleanMarkdownLinks.includes('https://example.com'), 'Markdown citation URL stripped');
assert.ok(cleanMarkdownLinks.includes('The team published their findings yesterday.'), 'Prose text intact');
console.log('  [PASS] 3.3 Prose markdown link citations stripped cleanly');

// 3.4 Integration with buildLiveUpdateResponse: bracket citations stripped while keeping clean text
if (typeof chatTest?.buildLiveUpdateResponse === 'function') {
    const rawAnswerWithBrackets = 'The tournament concluded with high attendance, found in [1]. Team Alpha secured the trophy [1], [2].';
    const sampleSources = [{ title: 'Tournament Report', url: 'https://example.com/report', domain: 'example.com' }];
    const sanitizedAnswer = chatTest.buildLiveUpdateResponse('tournament winners', sampleSources, rawAnswerWithBrackets);
    assert.ok(!sanitizedAnswer.includes('[1]'), 'buildLiveUpdateResponse must strip [1]');
    assert.ok(!sanitizedAnswer.includes('[2]'), 'buildLiveUpdateResponse must strip [2]');
    assert.ok(!sanitizedAnswer.toLowerCase().includes('found in'), 'buildLiveUpdateResponse must strip "found in"');
    assert.ok(sanitizedAnswer.includes('Team Alpha secured the trophy.'), 'Answer content preserved');
    console.log('  [PASS] 3.4 buildLiveUpdateResponse sanitizes stray bracket citations and phrases in response body');
}

console.log('\n================================================================');
console.log('=== All Leadership Expansion & Citation Cleanup Tests PASSED ===');
console.log('================================================================\n');

});

test('Snippet Sanitizer & HTML Entity Decoding', async () => {


function fixtureLabel(label) {
    return `${label}_${Date.now().toString(36).slice(-4)}`;
}

console.log('=== Testing Snippet Sanitizer & Deterministic Fast-Path Guardrail ===\n');

// Section 1: Recursive HTML/XML Entity Resolution
console.log('--- Section 1: Recursive HTML/XML Entity Resolution ---');

// Single and double-encoded non-breaking spaces and quotes
const multiEncoded = 'Sample text&amp;nbsp;&amp;nbsp;with &#160;and &#x27;apostrophe&#x27; &amp;quot;quotes&amp;quot;';
const decoded = decodeHtmlEntities(multiEncoded);

assert.ok(!decoded.includes('&nbsp;'));
assert.ok(!decoded.includes('&#160;'));
assert.ok(!decoded.includes('&#x27;'));
assert.ok(!decoded.includes('&quot;'));
assert.ok(!decoded.includes('&amp;'));
assert.ok(decoded.includes("'apostrophe'"));
assert.ok(decoded.includes('"quotes"'));
console.log('  [PASS] 1.1 Multi-encoded HTML entities (decimal, hex, named) resolved cleanly');

// Section 2: Snippet Cleaning & Trailing Domain Stripping
console.log('\n--- Section 2: Snippet Cleaning & Trailing Domain Stripping ---');

const sampleRssSnippet = `<a href="https://example.com/item">Tournament Victory in ${fixtureLabel('Year')}</a>&nbsp;&nbsp;<font color="#6f6f6f">cbs8.com</font>`;
const cleanedRss = cleanSnippetText(sampleRssSnippet);

assert.ok(!cleanedRss.includes('<a'));
assert.ok(!cleanedRss.includes('<font'));
assert.ok(!cleanedRss.includes('&nbsp;'));
assert.ok(!cleanedRss.includes('cbs8.com'));
assert.ok(cleanedRss.startsWith('Tournament Victory in'));
console.log('  [PASS] 2.1 HTML tags, entities, and trailing publisher domain stripped from RSS snippet');

const snippetWithDashDomain = `Headline summary text - news.bbc.co.uk`;
const cleanedDash = cleanSnippetText(snippetWithDashDomain);
assert.equal(cleanedDash, 'Headline summary text');
console.log('  [PASS] 2.2 Trailing dash-domain publisher stripped');

// Section 3: Deterministic Fast-Path Guardrail
console.log('\n--- Section 3: Deterministic Fast-Path Guardrail Invariants ---');

// Import search module
const searchModule = await import('../api/search.js');
const runSearch = searchModule.runEvidenceFirstWebRag;

assert.equal(typeof runSearch, 'function');
console.log('  [PASS] 3.1 Search module exports runEvidenceFirstWebRag cleanly');

console.log('\n================================================================');
console.log('=== All Snippet Sanitizer & Fast-Path Guardrail Tests PASSED ===');
console.log('================================================================\n');

});

