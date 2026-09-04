export const CONVERSE_STATES = Object.freeze({
    idle: 'idle',
    listening: 'listening',
    processing: 'processing',
    responding: 'responding',
    speaking: 'speaking',
    interrupted: 'interrupted',
    recovering: 'recovering'
});

export function normalizeConverseState(state) {
    const value = String(state || '').trim().toLowerCase();
    return Object.values(CONVERSE_STATES).includes(value) ? value : CONVERSE_STATES.listening;
}

const TRAILING_CONNECTORS_REGEX = /\b(?:and|or|because|so|also|but|with|then|like|that|if|when|while|as|since|although|though)\s*$/i;
const INCOMPLETE_INTERROGATIVE_REGEX = /^(?:who|what|where|when|why|how|which|can\s+you|could\s+you|tell\s+me|show\s+me)(?:\s+(?:is|are|was|were|the|a|an|do|does|did|will|would|can|could|should|to|why|what|how|who|where|when|which|about))?\s*$/i;

/**
 * Evaluates speech transcript completeness to determine dynamic adaptive pause threshold.
 */
export function evaluateTurnCompleteness(transcript = '', options = {}) {
    const text = String(transcript || '').trim();
    const config = {
        completeTimeoutMs: options.completeTimeoutMs || 800,
        normalTimeoutMs: options.normalTimeoutMs || 1200,
        incompleteTimeoutMs: options.incompleteTimeoutMs || 1800,
        ...options
    };

    if (!text) {
        return {
            isComplete: false,
            trailingConnector: false,
            recommendedTimeoutMs: config.normalTimeoutMs,
            reason: 'empty_transcript'
        };
    }

    // 1. Trailing connectors / conjunctions indicate continuation
    if (TRAILING_CONNECTORS_REGEX.test(text)) {
        return {
            isComplete: false,
            trailingConnector: true,
            recommendedTimeoutMs: config.incompleteTimeoutMs,
            reason: 'trailing_connector'
        };
    }

    // 2. Trailing incomplete interrogatives (e.g. user just said "What is")
    if (INCOMPLETE_INTERROGATIVE_REGEX.test(text)) {
        return {
            isComplete: false,
            trailingConnector: true,
            recommendedTimeoutMs: config.incompleteTimeoutMs,
            reason: 'incomplete_interrogative'
        };
    }

    // 3. Clear terminal sentence punctuation (? ! .)
    if (/[.?!]$/.test(text)) {
        return {
            isComplete: true,
            trailingConnector: false,
            recommendedTimeoutMs: config.completeTimeoutMs,
            reason: 'terminal_punctuation'
        };
    }

    // 4. Word count heuristics
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length >= 6) {
        // Multi-word thought without trailing conjunction
        return {
            isComplete: true,
            trailingConnector: false,
            recommendedTimeoutMs: config.normalTimeoutMs,
            reason: 'complete_phrase'
        };
    }

    return {
        isComplete: false,
        trailingConnector: false,
        recommendedTimeoutMs: config.normalTimeoutMs,
        reason: 'short_utterance'
    };
}

/**
 * Creates telemetry tracker for a single conversation turn.
 */
export function createTurnTelemetry(turnId = '') {
    const timestamps = {
        sttStart: 0,
        firstInterim: 0,
        finalTranscript: 0,
        endOfSpeech: 0,
        requestSent: 0,
        firstToken: 0,
        firstTtsAudio: 0,
        firstSpokenWord: 0,
        ttsStart: 0,
        audiblePlayback: 0,
        interruption: 0,
        ttsStopped: 0,
        turnCompleted: 0
    };

    function mark(stage) {
        if (typeof timestamps[stage] !== 'undefined' && !timestamps[stage]) {
            timestamps[stage] = performance.now();
        }
    }

    function recordMilestone(stage, customTime = null) {
        timestamps[stage] = typeof customTime === 'number' ? customTime : performance.now();
    }

    function getMetrics() {
        const diff = (a, b) => (a > 0 && b > 0 && b >= a) ? Math.round((b - a) * 100) / 100 : null;

        return {
            turnId,
            sttStartToFirstInterimMs: diff(timestamps.sttStart, timestamps.firstInterim),
            sttStartToFinalTranscriptMs: diff(timestamps.sttStart, timestamps.finalTranscript),
            endOfSpeechToRequestSentMs: diff(timestamps.endOfSpeech, timestamps.requestSent),
            llmRequestToFirstTokenMs: diff(timestamps.requestSent, timestamps.firstToken),
            firstTokenToFirstTtsAudioMs: diff(timestamps.firstToken, timestamps.firstTtsAudio),
            firstTokenToFirstSpokenWordMs: diff(timestamps.firstToken, timestamps.firstSpokenWord),
            ttsStartToAudiblePlaybackMs: diff(timestamps.ttsStart, timestamps.audiblePlayback),
            userInterruptionToTtsStoppedMs: diff(timestamps.interruption, timestamps.ttsStopped),
            completeVoiceTurnLatencyMs: diff(timestamps.endOfSpeech || timestamps.sttStart, timestamps.turnCompleted || timestamps.audiblePlayback)
        };
    }

    return {
        turnId,
        timestamps,
        mark,
        recordMilestone,
        getMetrics
    };
}

/**
 * Conversation Turn Manager coordinating lifecycle, turnIds, and cancellation.
 */
export function createTurnManager() {
    let currentTurnId = '';
    let currentAbortController = null;
    let currentTelemetry = null;
    let turnCounter = 0;

    function startNewTurn(options = {}) {
        if (currentAbortController) {
            try { currentAbortController.abort('new_turn_started'); } catch (_) {}
        }
        turnCounter += 1;
        currentTurnId = `turn_${Date.now()}_${turnCounter}_${Math.random().toString(36).slice(2, 7)}`;
        currentAbortController = new AbortController();
        currentTelemetry = createTurnTelemetry(currentTurnId);
        currentTelemetry.mark('sttStart');
        return {
            turnId: currentTurnId,
            signal: currentAbortController.signal,
            telemetry: currentTelemetry
        };
    }

    function getActiveTurnId() {
        return currentTurnId;
    }

    function isTurnActive(turnId) {
        return Boolean(turnId && turnId === currentTurnId && currentAbortController && !currentAbortController.signal.aborted);
    }

    function cancelActiveTurn(reason = 'cancelled') {
        if (currentAbortController) {
            try { currentAbortController.abort(reason); } catch (_) {}
            currentAbortController = null;
        }
        if (currentTelemetry) {
            currentTelemetry.mark('interruption');
            currentTelemetry.mark('ttsStopped');
        }
        currentTurnId = '';
    }

    function getTelemetry() {
        return currentTelemetry;
    }

    return {
        startNewTurn,
        getActiveTurnId,
        isTurnActive,
        cancelActiveTurn,
        getTelemetry
    };
}

/**
 * Staged Text-To-Speech Sanitization Pipeline for Conversational Audio.
 */
export function sanitizeTextForConverseSpeech(text) {
    let result = String(text || '');
    if (!result.trim()) return '';

    // Stage 1: Internal Reasoning & Metadata Tag Removal
    result = result.replace(/<think>[\s\S]*?<\/think>/gi, '');
    result = result.replace(/<[^>]+>/g, ' ');
    result = result.replace(/(?:^|\n)\s*Sources:\s*[\s\S]*$/i, '');

    // Stage 2: Code Blocks & Technical Artifacts
    result = result.replace(/```[\s\S]*?```/g, ' The code snippet is displayed on your screen. ');
    result = result.replace(/`([^`]+)`/g, '$1');
    result = result.replace(/\|[^\n]+\|(?:\n\|[^\n]+\|)*/g, ' The details are displayed on your screen. ');

    // Stage 3: Links, Images, Footnotes & Citations
    result = result.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
    result = result.replace(/\[([^\]]+)\]\((?:https?:\/\/[^)]+)\)/g, '$1');
    result = result.replace(/https?:\/\/\S+/gi, '');
    result = result.replace(/\[\d+\]/g, '');
    result = result.replace(/【[^】]+】/g, '');

    // Stage 4: Markdown Formatting & Structure
    result = result.replace(/^\s*[-*•]\s+/gm, '. ');
    result = result.replace(/^\s*\d+\.\s+/gm, '. ');
    result = result.replace(/^[#\s]+/gm, '');
    result = result.replace(/[*_~|#>]+/g, ' ');

    // Stage 5: Currencies, Units, Percentages & Math Expansions
    result = result.replace(/\$(\d+(?:\.\d+)?)\s*(?:billion|B)\b/gi, '$1 billion dollars');
    result = result.replace(/\$(\d+(?:\.\d+)?)\s*(?:million|M)\b/gi, '$1 million dollars');
    result = result.replace(/\$(\d+(?:\.\d+)?)\b/g, '$1 dollars');
    result = result.replace(/₹(\d+(?:\.\d+)?)\s*(?:crore|cr)\b/gi, '$1 crore rupees');
    result = result.replace(/₹(\d+(?:\.\d+)?)\s*(?:lakh|L)\b/gi, '$1 lakh rupees');
    result = result.replace(/₹(\d+(?:\.\d+)?)\b/g, '$1 rupees');
    result = result.replace(/€(\d+(?:\.\d+)?)\b/g, '$1 euros');
    result = result.replace(/£(\d+(?:\.\d+)?)\b/g, '$1 pounds');
    result = result.replace(/(\d+(?:\.\d+)?)%/g, '$1 percent');

    // Math symbols
    result = result.replace(/(\b[a-zA-Z0-9]+|\))\s*\^\s*2\b/g, '$1 squared');
    result = result.replace(/(\b[a-zA-Z0-9]+|\))\s*\^\s*3\b/g, '$1 cubed');
    result = result.replace(/(\b[a-zA-Z0-9]+|\))\s*\^\s*([0-9a-zA-Z]+)\b/g, '$1 to the power of $2');
    result = result.replace(/(\b[a-zA-Z0-9]+|\))²/g, '$1 squared');
    result = result.replace(/(\b[a-zA-Z0-9]+|\))³/g, '$1 cubed');
    result = result.replace(/²/g, ' squared');
    result = result.replace(/³/g, ' cubed');
    result = result.replace(/≈/g, ' approximately ');
    result = result.replace(/(\b\d+)\.(\d+\b)/g, '$1 point $2');

    // Stage 6: Conversational Condensation & Punctuation Cleanup
    result = result.replace(/\s+/g, ' ').replace(/\s+([,.:;?!])/g, '$1').trim();

    // Condense long explanations for voice to keep response conversational
    const sentences = result.match(/[^.!?]+[.!?]+/g) || [result];
    if (sentences.length > 4) {
        result = sentences.slice(0, 4).map(s => s.trim()).join(' ');
    }

    return result.slice(0, 600).trim();
}

/**
 * Splits text into natural conversational speech segments suitable for Web Speech Synthesis.
 */
export function splitConverseSpeechSegments(text) {
    const source = String(text || '').replace(/\s+/g, ' ').trim();
    if (!source) return [];
    const sentences = source.match(/[^.!?;:]+[.!?;:]?/g) || [source];
    const segments = [];
    for (const sentence of sentences) {
        const clean = sentence.trim();
        if (!clean) continue;
        if (clean.length <= 180) {
            segments.push(clean);
            continue;
        }
        const clauses = clean.match(/[^,]+,?/g) || [clean];
        let buffer = '';
        for (const clause of clauses) {
            const next = [buffer, clause.trim()].filter(Boolean).join(' ');
            if (next.length > 180 && buffer) {
                segments.push(buffer.trim());
                buffer = clause.trim();
            } else {
                buffer = next;
            }
        }
        if (buffer.trim()) segments.push(buffer.trim());
    }
    return segments.slice(0, 8);
}

export function createConverseStateTracker(initialState = CONVERSE_STATES.idle) {
    const listeners = new Set();
    let snapshot = {
        state: normalizeConverseState(initialState),
        reason: 'initial',
        updatedAt: Date.now()
    };
    return {
        getSnapshot() {
            return { ...snapshot };
        },
        getState() {
            return snapshot.state;
        },
        subscribe(listener) {
            if (typeof listener === 'function') {
                listeners.add(listener);
                return () => listeners.delete(listener);
            }
            return () => {};
        },
        setState(state, reason = '') {
            const prevState = snapshot.state;
            snapshot = {
                state: normalizeConverseState(state),
                reason: String(reason || '').trim(),
                updatedAt: Date.now()
            };
            for (const listener of listeners) {
                try {
                    listener({ ...snapshot }, prevState);
                } catch (_) {}
            }
            return { ...snapshot };
        }
    };
}


