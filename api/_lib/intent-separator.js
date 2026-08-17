/**
 * @file api/_lib/intent-separator.js
 * @description Upfront Query Intent Separator that categorizes queries into:
 * 1. static_reasoning (Coding, Math, Explanations, Creative Writing -> Direct Fast LLM)
 * 2. temporal_fact (Political leaders, current officeholders, civic facts -> Instant Fact Layer)
 * 3. domain_specific (Weather, Crypto, Markets -> Targeted JSON APIs)
 * 4. explicit_search (User explicitly asked to search or find articles)
 */

import { extractEntityTarget } from './entity-verifier.js';

const CODING_PATTERNS = [
    /\b(?:function|def|class|const|let|var|import|export|return|async|await|console\.log|print\(|public\s+static|void\s+main)\b/,
    /\b(?:javascript|python|typescript|java|c\+\+|c#|golang|rust|php|ruby|swift|kotlin|html|css|sql|dockerfile|yaml|json|regex)\b/i,
    /\b(?:write|create|debug|fix|refactor|optimize|implement|explain)\s+(?:a\s+)?(?:code|function|script|algorithm|regex|query|component|loop|array|regex|endpoint)\b/i,
    /\b(?:how\s+to\s+sort|binary\s+search|linked\s+list|dynamic\s+programming|tree\s+traversal|recursion|memoization|merge\s+sort|quick\s+sort)\b/i
];

const MATH_PATTERNS = [
    /\b(?:calculate|compute|solve|integrate|differentiate|derivative|integral|equation|formula|pythagorean|factorial|matrix|determinant|eigenvalue)\b/i,
    /^\s*[\d\s+\-*/^().=xXyYzZ]+\s*$/
];

const CREATIVE_AND_EXPLANATION_PATTERNS = [
    /\b(?:write\s+(?:a\s+)?(?:story|poem|essay|email|letter|song|joke|haiku|dialogue|script))\b/i,
    /\b(?:explain\s+(?:quantum\s+physics|relativity|gravity|photosynthesis|evolution|mitosis|black\s+hole|machine\s+learning|transformer\s+architecture|how\s+airplanes\s+fly))\b/i,
    /\b(?:what\s+is\s+(?:the\s+difference\s+between|oop|functional\s+programming|recursion|concurrency|multithreading|asynchronous))\b/i
];

const DOMAIN_WEATHER_PATTERNS = [
    /\b(?:weather|forecast|temperature|humidity|rain|rainfall|precipitation|sunny|cloudy|wind\s+speed)\b/i
];

const DOMAIN_FINANCE_PATTERNS = [
    /\b(?:price\s+of\s+(?:bitcoin|btc|ethereum|eth|solana|crypto|gold|silver|crude\s+oil)|stock\s+price\s+of|market\s+cap\s+of)\b/i
];

const EXPLICIT_SEARCH_PATTERNS = [
    /\b(?:search\s+(?:for|the\s+web\s+for|google\s+for)|find\s+(?:articles|news|web\s+pages)\s+about|look\s+up\s+online)\b/i
];

/**
 * Classifies a user query into clean intent categories.
 * @param {string} rawQuery 
 * @returns {{
 *   type: 'static_reasoning' | 'temporal_fact' | 'domain_specific' | 'explicit_search',
 *   category: string,
 *   requiresLiveGrounding: boolean,
 *   entityTarget?: { role: string, jurisdiction: string } | null
 * }}
 */
export function classifyQueryIntent(rawQuery = '') {
    const query = String(rawQuery || '').trim();
    if (!query) {
        return {
            type: 'static_reasoning',
            category: 'empty_query',
            requiresLiveGrounding: false
        };
    }

    // 1. Check for explicit search request
    for (const pattern of EXPLICIT_SEARCH_PATTERNS) {
        if (pattern.test(query)) {
            return {
                type: 'explicit_search',
                category: 'web_search',
                requiresLiveGrounding: true
            };
        }
    }

    // 2. Check for domain-specific live data (Weather, Finance)
    for (const pattern of DOMAIN_WEATHER_PATTERNS) {
        if (pattern.test(query)) {
            return {
                type: 'domain_specific',
                category: 'weather',
                requiresLiveGrounding: true
            };
        }
    }
    for (const pattern of DOMAIN_FINANCE_PATTERNS) {
        if (pattern.test(query)) {
            return {
                type: 'domain_specific',
                category: 'finance_crypto',
                requiresLiveGrounding: true
            };
        }
    }
    // Stable geographic / definition facts (e.g. "capital of France", "what is the capital of Japan")
    if (/\b(?:capital\s+of|what\s+is\s+the\s+capital\s+of)\b/i.test(query) && !/\b(?:current|latest|today|now|new)\b/i.test(query)) {
        return {
            type: 'static_reasoning',
            category: 'stable_geographic_fact',
            requiresLiveGrounding: false
        };
    }

    // 3. Check for temporal / political leadership / mutable civic entity facts
    const entityTarget = extractEntityTarget(query);
    if (entityTarget) {
        return {
            type: 'temporal_fact',
            category: 'political_leadership',
            requiresLiveGrounding: true,
            entityTarget
        };
    }

    // Temporal keywords or dynamic officeholder patterns
    if (/\b(?:current|latest|present|today|now)\s+(?:governor|pm|cm|president|chancellor|minister|mayor|ceo|chairman|leader|ruler|monarch|head\s+of\s+state|pope|director)\b/i.test(query) ||
        /\b(?:who\s+is\s+(?:the\s+)?(?:current|present|latest)?\s*(?:chief\s+minister|prime\s+minister|president|governor|mayor|chancellor|ceo|chairman))\b/i.test(query) ||
        /\b(?:who\s+is\s+(?:the\s+)?(?:cm|pm)\s+of)\b/i.test(query)) {
        return {
            type: 'temporal_fact',
            category: 'civic_or_leadership_fact',
            requiresLiveGrounding: true,
            entityTarget: extractEntityTarget(query)
        };
    }

    // 4. Check for static coding / math / conceptual reasoning queries
    for (const pattern of CODING_PATTERNS) {
        if (pattern.test(query)) {
            return {
                type: 'static_reasoning',
                category: 'coding',
                requiresLiveGrounding: false
            };
        }
    }
    for (const pattern of MATH_PATTERNS) {
        if (pattern.test(query)) {
            return {
                type: 'static_reasoning',
                category: 'mathematics',
                requiresLiveGrounding: false
            };
        }
    }
    for (const pattern of CREATIVE_AND_EXPLANATION_PATTERNS) {
        if (pattern.test(query)) {
            return {
                type: 'static_reasoning',
                category: 'conceptual_or_creative',
                requiresLiveGrounding: false
            };
        }
    }

    // Default: Static general knowledge & conversational reasoning
    return {
        type: 'static_reasoning',
        category: 'general_reasoning',
        requiresLiveGrounding: false
    };
}
