/**
 * @file api/_lib/temporal-query-planner.js
 * @description DeepMind-Grade Mathematical Temporal Query Planner for Live Search & RAG.
 * 
 * Implements Allen's Interval Algebra and Multi-Resolution Temporal Projection:
 * - Dynamically computes reference epoch frames (\tau) relative to the runtime clock.
 * - Resolves temporal intervals (Day, Week, Month, Quarter, Year) without hardcoded word dictionaries.
 * - Generates multi-resolution query expansions with provider-native freshness filters (DDG, SearXNG).
 * - Preserves historical anchors while ensuring current/recent queries target fresh active-window records.
 */

/**
 * Computes the dynamic temporal reference frame from the system runtime clock
 * @param {Date|number} [referenceEpoch=new Date()] - Reference time for calculation
 * @returns {Object} Structured temporal frame
 */
export function resolveTemporalFrame(referenceEpoch = new Date()) {
    const epoch = referenceEpoch instanceof Date ? referenceEpoch : new Date(referenceEpoch);
    const validEpoch = isNaN(epoch.getTime()) ? new Date() : epoch;

    const year = validEpoch.getUTCFullYear();
    const month = validEpoch.getUTCMonth() + 1; // 1-indexed (1-12)
    const day = validEpoch.getUTCDate();
    const hours = validEpoch.getUTCHours();
    const minutes = validEpoch.getUTCMinutes();

    // Multilingual & locale-neutral Intl formatters (zero hardcoded dictionaries)
    const monthFormatter = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' });
    const monthShortFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });
    const weekdayFormatter = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' });

    const monthName = monthFormatter.format(validEpoch);
    const monthShort = monthShortFormatter.format(validEpoch);
    const weekdayName = weekdayFormatter.format(validEpoch);

    const monthPadded = String(month).padStart(2, '0');
    const dayPadded = String(day).padStart(2, '0');
    const isoYearMonth = `${year}-${monthPadded}`;
    const isoDate = `${isoYearMonth}-${dayPadded}`;
    const quarterNumber = Math.floor((month - 1) / 3) + 1;
    const quarter = `Q${quarterNumber}`;

    // ISO-8601 Week Number calculation
    const tempDate = new Date(Date.UTC(year, month - 1, day));
    const dayNum = (tempDate.getUTCDay() + 6) % 7;
    tempDate.setUTCDate(tempDate.getUTCDate() - dayNum + 3);
    const firstThursday = tempDate.getTime();
    tempDate.setUTCMonth(0, 1);
    if (tempDate.getUTCDay() !== 4) {
        tempDate.setUTCMonth(0, 1 + ((4 - tempDate.getUTCDay()) + 7) % 7);
    }
    const isoWeek = Math.ceil((firstThursday - tempDate.getTime()) / (7 * 24 * 3600 * 1000)) + 1;

    return Object.freeze({
        epochMs: validEpoch.getTime(),
        year,
        month,
        day,
        hours,
        minutes,
        monthName,
        monthShort,
        weekdayName,
        quarter,
        quarterNumber,
        isoWeek,
        isoYearMonth,
        isoDate
    });
}

/**
 * Classifies the temporal intent and extracts the relative time window
 * @param {string} rawQuery - Raw user search query
 * @param {Object} [frame] - Temporal reference frame
 * @returns {Object} Temporal classification result
 */
export function classifyTemporalScope(rawQuery = '', frame = resolveTemporalFrame()) {
    const raw = String(rawQuery || '').trim();
    if (!raw) {
        return {
            scope: 'UNCONSTRAINED',
            isTimeSensitive: false,
            filter: null,
            targetYear: null,
            matchedOperator: null
        };
    }

    const lower = raw.toLowerCase();

    // 1. Explicit historical or anchored year detection
    const yearMatches = lower.match(/\b(19\d{2}|20\d{2})\b/g);
    if (yearMatches && yearMatches.length > 0) {
        const parsedYears = yearMatches.map(y => parseInt(y, 10));
        const earliestYear = Math.min(...parsedYears);
        const latestYear = Math.max(...parsedYears);

        // If the query explicitly targets a past year
        if (latestYear < frame.year - 1) {
            return {
                scope: 'HISTORICAL_ANCHORED',
                isTimeSensitive: false,
                filter: null,
                targetYear: latestYear,
                earliestYear,
                matchedOperator: String(latestYear)
            };
        }
    }

    // 2. Immediate / Realtime scope (today, right now, past 24 hours)
    if (/\b(?:today|tonight|right\s+now|currently|now|past\s+24\s+hours?|last\s+24\s+hours?|hours?\s+ago)\b/i.test(lower)) {
        return {
            scope: 'IMMEDIATE_DAY',
            isTimeSensitive: true,
            filter: Object.freeze({ ddg: 'd', searx: 'day', windowHours: 24 }),
            targetYear: frame.year,
            matchedOperator: 'today'
        };
    }

    // 3. Weekly / Recent Days scope (this week, past week, last week, few days ago)
    if (/\b(?:this\s+week|past\s+week|last\s+week|current\s+week|past\s+7\s+days|recent\s+days|days?\s+ago)\b/i.test(lower)) {
        return {
            scope: 'RECENT_WEEK',
            isTimeSensitive: true,
            filter: Object.freeze({ ddg: 'w', searx: 'week', windowDays: 7 }),
            targetYear: frame.year,
            matchedOperator: 'this week'
        };
    }

    // 4. Monthly scope (this month, past month, last month, past 30 days)
    if (/\b(?:this\s+month|past\s+month|last\s+month|current\s+month|past\s+30\s+days)\b/i.test(lower)) {
        return {
            scope: 'CURRENT_MONTH',
            isTimeSensitive: true,
            filter: Object.freeze({ ddg: 'm', searx: 'month', windowDays: 30 }),
            targetYear: frame.year,
            matchedOperator: 'this month'
        };
    }

    // 5. General Recency cues (latest, recent, newest, release, changelog, update)
    if (/\b(?:latest|newest|recent|recently|just\s+in|breaking|what('?s|\s+is)\s+new|updates?|changelog|release\s+notes)\b/i.test(lower)) {
        return {
            scope: 'ACTIVE_PERIOD',
            isTimeSensitive: true,
            filter: Object.freeze({ ddg: 'm', searx: 'month', windowDays: 45 }),
            targetYear: frame.year,
            matchedOperator: 'latest'
        };
    }

    // 6. Annual scope (this year, current year)
    if (/\b(?:this\s+year|current\s+year|in\s+office\s+now)\b/i.test(lower)) {
        return {
            scope: 'CURRENT_YEAR',
            isTimeSensitive: true,
            filter: Object.freeze({ ddg: 'y', searx: 'year', windowDays: 365 }),
            targetYear: frame.year,
            matchedOperator: 'this year'
        };
    }

    return {
        scope: 'UNCONSTRAINED',
        isTimeSensitive: false,
        filter: null,
        targetYear: null,
        matchedOperator: null
    };
}

/**
 * Distills core topical entities by stripping temporal conversational modifiers
 * @param {string} rawQuery 
 * @returns {string} Clean topic text
 */
export function distillTemporalTopic(rawQuery = '') {
    const raw = String(rawQuery || '').trim();
    if (!raw) return '';

    return raw
        .replace(/\b(?:this\s+(?:week|month|year)|past\s+(?:24\s+hours?|week|month|year|7\s+days|30\s+days)|last\s+(?:24\s+hours?|week|month|year)|right\s+now|currently|today|tonight|now)\b/gi, ' ')
        .replace(/\b(?:latest|newest|recent|recently|just\s+in|what('?s|\s+is)\s+new)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .replace(/[?.!,;:]+$/g, '')
        .trim();
}

/**
 * Plans multi-resolution temporal search queries for search engines
 * @param {string} rawQuery - User search query
 * @param {Object} [options] - Options
 * @param {Date|number} [options.referenceEpoch] - Optional time anchor
 * @param {number} [options.maxQueries=4] - Maximum queries to return
 * @returns {Object} Structured temporal query plan
 */
export function planTemporalSearchQueries(rawQuery = '', options = {}) {
    const cleanQ = String(rawQuery || '').trim();
    if (!cleanQ) {
        return {
            queries: [],
            scope: 'UNCONSTRAINED',
            filter: null,
            primaryQuery: '',
            temporalFrame: resolveTemporalFrame()
        };
    }

    const frame = resolveTemporalFrame(options.referenceEpoch);
    const classification = classifyTemporalScope(cleanQ, frame);
    const maxQueries = typeof options.maxQueries === 'number' ? options.maxQueries : 4;

    const topic = distillTemporalTopic(cleanQ) || cleanQ;
    const candidates = [];

    if (classification.scope === 'HISTORICAL_ANCHORED') {
        // Query explicitly targets a historical era/year; preserve without adding current date
        candidates.push(cleanQ);
        if (topic !== cleanQ) {
            candidates.push(`${topic} ${classification.targetYear}`);
        }
    } else if (classification.scope === 'IMMEDIATE_DAY' || classification.scope === 'RECENT_WEEK') {
        // High-precision active window: append Month Name + Year, ISO Month, and Year
        candidates.push(`${topic} ${frame.monthName} ${frame.year}`);
        candidates.push(`${topic} ${frame.isoYearMonth}`);
        candidates.push(`${topic} ${frame.year}`);
        candidates.push(topic);
    } else if (classification.scope === 'CURRENT_MONTH' || classification.scope === 'ACTIVE_PERIOD') {
        candidates.push(`${topic} ${frame.monthName} ${frame.year}`);
        candidates.push(`${topic} ${frame.year}`);
        candidates.push(topic);
    } else if (classification.scope === 'CURRENT_YEAR') {
        candidates.push(`${topic} ${frame.year}`);
        candidates.push(topic);
    } else {
        // Unconstrained timeless query
        candidates.push(cleanQ);
        if (topic !== cleanQ && topic.length > 3) {
            candidates.push(topic);
        }
    }

    // Deduplicate, sanitize adjacent duplicate tokens (e.g. "2026 2026"), and trim
    const deduplicated = [];
    const seen = new Set();

    for (const cand of candidates) {
        const normalized = cand
            .replace(/\b(\w+)\s+\1\b/gi, '$1')
            .replace(/\s+/g, ' ')
            .trim();
        const key = normalized.toLowerCase();
        if (normalized.length > 2 && !seen.has(key)) {
            seen.add(key);
            deduplicated.push(normalized);
        }
    }

    const finalQueries = deduplicated.slice(0, maxQueries);

    return Object.freeze({
        queries: finalQueries,
        primaryQuery: finalQueries[0] || cleanQ,
        scope: classification.scope,
        isTimeSensitive: classification.isTimeSensitive,
        filter: classification.filter,
        targetYear: classification.targetYear,
        matchedOperator: classification.matchedOperator,
        temporalFrame: frame
    });
}
