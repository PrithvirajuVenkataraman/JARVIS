/**
 * @file app/conversation-search.js
 * @description Intelligent Hybrid Search (ANN Partitioned IVF Vector Search + Multi-term Keyword Density)
 * with highlighted snippet extraction and in-text navigation helpers for conversation history.
 */

import { PartitionedIVFIndex } from './storage.js';

/**
 * Escapes HTML characters for safe rendering in HTML contexts.
 */
export function escapeHtml(str = '') {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Normalizes and extracts searchable tokens from a query string.
 */
export function tokenizeQuery(query = '') {
    return String(query || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .trim()
        .split(/\s+/)
        .filter(t => t.length > 0);
}

/**
 * Computes hybrid match score for a conversation session.
 * Combines exact phrases, individual token matches, recency, pinned status,
 * and cosine similarity from the PartitionedIVFIndex.
 */
export function scoreConversation(session, queryTokens = [], queryPhrase = '', vectorSim = 0) {
    if (!session || (!queryTokens.length && !queryPhrase)) return 0;

    let score = 0;
    const title = String(session.title || '').toLowerCase();
    const messages = Array.isArray(session.messages) ? session.messages : [];

    // 1. Exact phrase matches (strongest signal)
    if (queryPhrase) {
        if (title.includes(queryPhrase)) score += 5.0;
        for (const msg of messages) {
            const text = String(msg?.text || msg?.content || '').toLowerCase();
            if (text.includes(queryPhrase)) {
                score += 3.0;
                break;
            }
        }
    }

    // 2. Individual token matches across title and messages
    let matchedTokenCount = 0;
    for (const token of queryTokens) {
        let tokenFound = false;
        if (title.includes(token)) {
            score += 1.5;
            tokenFound = true;
        }
        for (const msg of messages) {
            const text = String(msg?.text || msg?.content || '').toLowerCase();
            if (text.includes(token)) {
                score += 0.8;
                tokenFound = true;
                break;
            }
        }
        if (tokenFound) matchedTokenCount++;
    }

    // Bonus for matching all query tokens
    if (queryTokens.length > 1 && matchedTokenCount === queryTokens.length) {
        score += 2.0;
    }

    // 3. Semantic vector similarity (boost by up to 2.5)
    if (vectorSim > 0.15) {
        score += vectorSim * 2.5;
    }

    // 4. Recency boost (within 7 days)
    if (session.updatedAt) {
        const ageMs = Date.now() - new Date(session.updatedAt).getTime();
        const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
        if (ageMs > 0 && ageMs < sevenDaysMs) {
            score += 0.4 * (1 - ageMs / sevenDaysMs);
        }
    }

    // 5. Pinned boost as slight tie-breaker
    if (session.pinned) {
        score += 0.25;
    }

    return score;
}

/**
 * Wraps occurrences of tokens with <mark class="chat-search-snippet-mark">, safely escaping non-marked text.
 */
export function highlightTokensInText(text = '', tokens = []) {
    if (!text) return '';
    if (!tokens.length) return escapeHtml(text);

    // Sort tokens by length descending to match longest phrases first
    const sortedTokens = [...tokens].sort((a, b) => b.length - a.length);
    const regexPattern = sortedTokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    if (!regexPattern) return escapeHtml(text);

    const regex = new RegExp(`(${regexPattern})`, 'gi');
    const parts = text.split(regex);

    let html = '';
    for (const part of parts) {
        if (!part) continue;
        const isMatch = sortedTokens.some(t => t.toLowerCase() === part.toLowerCase());
        if (isMatch) {
            html += `<mark class="chat-search-snippet-mark">${escapeHtml(part)}</mark>`;
        } else {
            html += escapeHtml(part);
        }
    }
    return html;
}

/**
 * Extracts a compact preview snippet around matching terms with <mark class="chat-search-snippet-mark"> highlights.
 */
export function extractHighlightedSnippet(session, query = '', maxLen = 110) {
    const q = String(query || '').trim();
    if (!q) return '';

    const tokens = tokenizeQuery(q);
    if (!tokens.length) return '';

    const messages = Array.isArray(session?.messages) ? session.messages : [];
    if (!messages.length) {
        // Fallback to title matching
        const title = String(session?.title || '');
        return highlightTokensInText(title, tokens);
    }

    // Find the message with the highest density of matching tokens
    let bestMsg = null;
    let bestScore = -1;
    let bestIndex = -1;

    for (const msg of messages) {
        const text = String(msg?.text || msg?.content || '');
        if (!text) continue;
        const lower = text.toLowerCase();

        let score = 0;
        let firstPos = -1;

        // Exact phrase check
        const phrasePos = lower.indexOf(q.toLowerCase());
        if (phrasePos !== -1) {
            score += 10;
            if (firstPos === -1) firstPos = phrasePos;
        }

        // Token matches
        for (const token of tokens) {
            const pos = lower.indexOf(token);
            if (pos !== -1) {
                score += 2;
                if (firstPos === -1 || pos < firstPos) {
                    firstPos = pos;
                }
            }
        }

        if (score > bestScore) {
            bestScore = score;
            bestMsg = text;
            bestIndex = firstPos;
        }
    }

    if (!bestMsg) {
        // No match found in messages, check title
        return highlightTokensInText(session?.title || '', tokens);
    }

    // Slice snippet around the best match
    const cleanText = bestMsg.replace(/\s+/g, ' ').trim();
    const targetIdx = Math.max(0, bestIndex >= 0 ? bestIndex : 0);
    const start = Math.max(0, targetIdx - 35);
    const end = Math.min(cleanText.length, targetIdx + maxLen);

    const prefix = start > 0 ? '...' : '';
    const suffix = end < cleanText.length ? '...' : '';
    const rawSnippet = `${prefix}${cleanText.slice(start, end)}${suffix}`;

    return highlightTokensInText(rawSnippet, tokens);
}

/**
 * Finds the specific message in a session that best matches the query (for auto-scrolling).
 */
export function findBestMatchingMessage(session, query = '') {
    const q = String(query || '').trim();
    if (!q) return null;
    const tokens = tokenizeQuery(q);
    const messages = Array.isArray(session?.messages) ? session.messages : [];
    if (!messages.length) return null;

    let bestMsg = null;
    let highestScore = 0;

    for (const msg of messages) {
        const text = String(msg?.text || msg?.content || '').toLowerCase();
        let score = 0;
        if (text.includes(q.toLowerCase())) score += 10;
        for (const token of tokens) {
            if (text.includes(token)) score += 2;
        }
        if (score > highestScore) {
            highestScore = score;
            bestMsg = msg;
        }
    }
    return bestMsg;
}

/**
 * Performs a hybrid search over conversation sessions.
 */
export function hybridSearchConversations(conversations = [], query = '', options = {}) {
    const list = Array.isArray(conversations) ? conversations.filter(s => s && !s.deleted) : [];
    const q = String(query || '').trim();

    if (!q) {
        // Return sorted by pinned first, then updatedAt desc
        return [...list].sort((a, b) => {
            if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
            return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
        }).map(session => ({ session, score: 0, snippetHtml: '', bestMessage: null }));
    }

    const tokens = tokenizeQuery(q);
    const phrase = q.toLowerCase();

    // 1. Vector index search (if 1 or more sessions)
    const vectorScores = new Map();
    if (list.length >= 1) {
        try {
            const index = new PartitionedIVFIndex({
                numClusters: Math.min(8, Math.max(2, Math.floor(list.length / 3))),
                nProbe: 2
            });
            for (const session of list) {
                const title = String(session.title || '');
                const msgs = (session.messages || []).map(m => m?.text || m?.content || '').join(' ');
                index.add(session, `${title} ${msgs}`);
            }
            const vectorHits = index.search(q, list.length, 0.1);
            for (const hit of vectorHits) {
                if (hit?.item?.id) {
                    vectorScores.set(hit.item.id, Number(hit.score) || 0);
                }
            }
        } catch (_) {}
    }

    // 2. Score and filter candidates
    const scored = [];
    for (const session of list) {
        const vSim = vectorScores.get(session.id) || 0;
        const matchScore = scoreConversation(session, tokens, phrase, vSim);
        if (matchScore > 0.4) {
            const snippetHtml = extractHighlightedSnippet(session, q);
            const bestMessage = findBestMatchingMessage(session, q);
            scored.push({
                session,
                score: matchScore,
                snippetHtml,
                bestMessage
            });
        }
    }

    // Sort by score descending
    scored.sort((a, b) => {
        if (Math.abs(b.score - a.score) > 0.1) {
            return b.score - a.score;
        }
        if (a.session.pinned !== b.session.pinned) return a.session.pinned ? -1 : 1;
        return new Date(b.session.updatedAt || 0).getTime() - new Date(a.session.updatedAt || 0).getTime();
    });

    return scored;
}
