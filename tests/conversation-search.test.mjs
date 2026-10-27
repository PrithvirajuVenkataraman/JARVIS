import test from 'node:test';
import assert from 'node:assert/strict';
import {
    escapeHtml,
    tokenizeQuery,
    highlightTokensInText,
    extractHighlightedSnippet,
    scoreConversation,
    findBestMatchingMessage,
    hybridSearchConversations
} from '../app/conversation-search.js';

test('Conversation Search 1.1: tokenizeQuery normalizes terms and strips punctuation', () => {
    const tokens = tokenizeQuery('React & Node.js: Asynchronous Programming!');
    assert.deepEqual(tokens, ['react', 'node', 'js', 'asynchronous', 'programming']);

    const empty = tokenizeQuery('   !@#$$%^   ');
    assert.deepEqual(empty, []);
});

test('Conversation Search 1.2: escapeHtml escapes dangerous characters', () => {
    const raw = '<script>alert("xss & fun")</script>';
    const escaped = escapeHtml(raw);
    assert.ok(!escaped.includes('<script>'));
    assert.ok(escaped.includes('&lt;script&gt;'));
    assert.ok(escaped.includes('&quot;xss &amp; fun&quot;'));
});

test('Conversation Search 1.3: highlightTokensInText injects glowing mark tags around matched terms', () => {
    const text = 'Exploring quantum computing algorithms with Python';
    const tokens = ['quantum', 'python'];
    const html = highlightTokensInText(text, tokens);

    assert.ok(html.includes('<mark class="chat-search-snippet-mark">quantum</mark>'));
    assert.ok(html.includes('<mark class="chat-search-snippet-mark">Python</mark>'));
    assert.ok(html.includes('computing algorithms with'));
});

test('Conversation Search 1.4: extractHighlightedSnippet selects the best matching message context', () => {
    const session = {
        title: 'Tech discussion',
        messages: [
            { text: 'Hello, how can I assist you today?' },
            { text: 'I am trying to optimize Docker multi-stage builds for a fast deploy cycle.' },
            { text: 'Here are three best practices for Docker caching layers.' }
        ]
    };

    const snippet = extractHighlightedSnippet(session, 'multi-stage builds');
    assert.ok(snippet.includes('<mark class="chat-search-snippet-mark">multi</mark>'));
    assert.ok(snippet.includes('<mark class="chat-search-snippet-mark">stage</mark>'));
    assert.ok(snippet.includes('<mark class="chat-search-snippet-mark">builds</mark>'));
});

test('Conversation Search 1.5: scoreConversation prioritizes exact phrases, multi-tokens, and recency', () => {
    const freshSession = {
        title: 'PostgreSQL Database Indexing',
        messages: [
            { text: 'Explain B-tree and GIN indexes in postgresql' }
        ],
        updatedAt: new Date().toISOString(),
        pinned: true
    };

    const weakSession = {
        title: 'General Cooking Recipes',
        messages: [
            { text: 'How to make pasta' }
        ],
        updatedAt: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
        pinned: false
    };

    const score1 = scoreConversation(freshSession, ['postgresql', 'indexing'], 'postgresql database indexing', 0.8);
    const score2 = scoreConversation(weakSession, ['postgresql', 'indexing'], 'postgresql database indexing', 0.0);

    assert.ok(score1 > score2, 'Relevant session must score significantly higher than irrelevant session');
    assert.ok(score1 > 5.0, 'Exact title match + tokens + pinned + fresh must yield high score');
    assert.equal(score2, 0, 'Completely unmatched session must score 0');
});

test('Conversation Search 1.6: hybridSearchConversations ranks results accurately and falls back gracefully', () => {
    const sessions = [
        {
            id: 's1',
            title: 'Kubernetes Cluster Setup',
            messages: [{ text: 'Step by step guide to configure ingress-nginx on K8s' }],
            updatedAt: new Date(Date.now() - 10000).toISOString(),
            pinned: false
        },
        {
            id: 's2',
            title: 'TypeScript Generics Tutorial',
            messages: [{ text: 'Understanding infer keyword and conditional types in TypeScript' }],
            updatedAt: new Date(Date.now() - 20000).toISOString(),
            pinned: false
        },
        {
            id: 's3',
            title: 'Docker and Kubernetes Deployments',
            messages: [{ text: 'Helm charts and Kubernetes deployment manifests' }],
            updatedAt: new Date(Date.now() - 5000).toISOString(),
            pinned: true
        }
    ];

    // Search for "Kubernetes"
    const results = hybridSearchConversations(sessions, 'Kubernetes');
    assert.ok(results.length >= 2, 'Should find both Kubernetes sessions');
    assert.ok(results.some(r => r.session.id === 's1'));
    assert.ok(results.some(r => r.session.id === 's3'));
    assert.ok(results[0].snippetHtml.includes('<mark class="chat-search-snippet-mark">Kubernetes</mark>'));

    // Empty query returns all sessions in default order (pinned first)
    const all = hybridSearchConversations(sessions, '');
    assert.equal(all.length, 3);
    assert.equal(all[0].session.id, 's3', 'Pinned session s3 must be first when query is empty');
});

test('Conversation Search 1.7: findBestMatchingMessage returns the target message object', () => {
    const session = {
        id: 's1',
        title: 'API Design',
        messages: [
            { id: 'm1', text: 'REST vs GraphQL differences' },
            { id: 'm2', text: 'WebSocket bidirectional streaming architectures' },
            { id: 'm3', text: 'gRPC protocol buffers definition' }
        ]
    };

    const target = findBestMatchingMessage(session, 'streaming websocket');
    assert.equal(target?.id, 'm2');
});
