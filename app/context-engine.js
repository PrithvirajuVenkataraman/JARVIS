export function textToEmbeddingVector(text, dim = 512) {
    const v = new Float32Array(dim);
    const tokens = String(text || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return v;
    for (const token of tokens) {
        let h1 = 0x811c9dc5;
        let h2 = 0x5bd1e995;
        for (let i = 0; i < token.length; i++) {
            const code = token.charCodeAt(i);
            h1 ^= code;
            h1 = Math.imul(h1, 0x01000193);
            h2 ^= code;
            h2 = Math.imul(h2, 0x5bd1e995);
        }
        const idx1 = Math.abs(h1) % dim;
        const idx2 = Math.abs(h2) % dim;
        v[idx1] += 1.0;
        v[idx2] += 0.5;
        if (token.length >= 4) {
            for (let i = 0; i < token.length - 2; i++) {
                const trigram = token.slice(i, i + 3);
                let th = 0;
                for (let j = 0; j < trigram.length; j++) th = (th * 31 + trigram.charCodeAt(j)) | 0;
                v[Math.abs(th) % dim] += 0.2;
            }
        }
    }
    let norm = 0;
    for (let i = 0; i < dim; i++) norm += v[i] * v[i];
    norm = Math.sqrt(norm);
    if (norm > 0) {
        for (let i = 0; i < dim; i++) v[i] /= norm;
    }
    return v;
}

export function vectorCosineSimilarity(a, b) {
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
    return dot;
}

// 512-Dimensional Dense Semantic Intent Prototypes
const ACKNOWLEDGEMENT_VECTOR = textToEmbeddingVector('yes yeah yep ok okay sure alright fine got it makes sense understood perfect awesome');
const CANCEL_VECTOR = textToEmbeddingVector('cancel stop reset start over forget that clear context');
const SWITCH_VECTOR = textToEmbeddingVector('switch topic change subject moving on on another note lets talk about another question new task');
const FOLLOWUP_VECTOR = textToEmbeddingVector('more continue further what about it explain further how about it then what next details on that');
const MODIFICATION_VECTOR = textToEmbeddingVector('shorter longer simpler instead format as bullet points make it concise expand elaborate');
const CORRECTION_VECTOR = textToEmbeddingVector('no i meant that is wrong you misunderstood actually not what i meant');
const SETTINGS_VECTOR = textToEmbeddingVector('set change switch turn enable disable response dark light memory');
const FEATURE_VECTOR = textToEmbeddingVector('weather forecast trip itinerary translate camera ocr scan vision remember export');
const LIVE_REQUEST_VECTOR = textToEmbeddingVector('weather temperature forecast bitcoin crypto price now live score breaking news');
const RESUME_VECTOR = textToEmbeddingVector('back to return to resume continue with earlier previous topic again about regarding');
const CONSTRAINT_PROTOTYPE_VECTOR = textToEmbeddingVector('must be strictly required rules constraints format only concise in typescript python no external dependencies');
const DECISION_PROTOTYPE_VECTOR = textToEmbeddingVector('we will use selected architecture chosen database framework postgresql prisma redis solution implementation decision');

const STANDALONE_LIVE_REQUEST = /\b(?:weather|temperature|forecast|bitcoin|btc|ethereum|eth|crypto|price now|rate now|score now|live score|ipl|nba|nfl|epl|earthquake|wildfire|flood|cyclone|hurricane|tsunami|latest news|breaking news|government news|stock price)\b/i;
const PLACE_RELATIVE_FOLLOWUP = /\b(?:nearby|near by|around (?:there|here)|close by|tourist (?:places?|spots?|attractions?)|sightseeing|things to do|places to (?:visit|see)|what to see|where to go|hotels nearby|restaurants nearby|stay options|day trip|weekend trip)\b/i;
const PLACE_CATEGORY_FOLLOWUP = /\b(?:hill stations?|beaches?|waterfalls?|temples?|parks?|lakes?|viewpoints?|attractions?)\b/i;
const STANDALONE_CAPABILITY_QUESTION = /^(?:do|can|are|will)\s+you\b|^do\s+you\s+understand\s+[A-Za-z][A-Za-z\s-]{1,40}\??$/i;
const PROPER_NOUN_OR_PLACE = /^(?:[A-Z][A-Za-z0-9.'-]{1,}(?:\s+[A-Z][A-Za-z0-9.'-]{1,}){0,4}|[A-Za-z][A-Za-z0-9.'-]{2,}(?:\s+[A-Za-z][A-Za-z0-9.'-]{2,}){0,2})$/;
const CLEAR_NEW_TOPIC_SHORT = /^(?:[A-Za-z][A-Za-z0-9.'-]{1,}(?:\s+[A-Za-z][A-Za-z0-9.'-]{1,}){0,2})$/;

const TOKEN_FILTER_WORDS = [
    'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'than', 'is', 'are', 'am', 'was', 'were',
    'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'can', 'could', 'would', 'will',
    'should', 'what', 'which', 'who', 'when', 'where', 'why', 'how', 'i', 'me', 'my', 'you', 'your',
    'we', 'our', 'they', 'their', 'he', 'she', 'it', 'this', 'that', 'these', 'those', 'please',
    'tell', 'show', 'give', 'explain', 'about', 'for', 'to', 'of', 'in', 'on', 'at', 'with', 'from'
];
const STOP_WORDS = new Set(TOKEN_FILTER_WORDS);
const ENTITY_PATTERNS = Object.freeze([
    /\b(?:who|what)\s+is\s+([A-Za-z0-9][A-Za-z0-9 .'-]{1,70})/i,
    /\b(?:tell me about|about|regarding)\s+([A-Za-z0-9][A-Za-z0-9 .'-]{1,70})/i,
    /\b(?:in|to|for)\s+([A-Z][A-Za-z .'-]{1,50})/
]);

export function createConversationEngine(options = {}) {
    const maxTurns = clamp(options.maxTurns, 12, 4, 30);
    const maxContextChars = clamp(options.maxContextChars, 9000, 1000, 24000);
    const maxThreads = clamp(options.maxThreads, 8, 2, 20);
    const state = {
        activeThreadId: '',
        threads: new Map(),
        turns: [],
        pending: null,
        preferences: { 
            responseLength: 'normal', 
            responseFormat: 'paragraph', 
            responseStyle: 'balanced',
            customSystemPrompt: ''
        } 
    };

    return {
        getState: () => snapshotState(state),
        restoreState: snapshot => restoreState(state, snapshot, { maxTurns, maxThreads }),
        setPending: pending => setPending(state, pending),
        clearPending: reason => clearPending(state, reason),
        reset: () => resetState(state),
        resolve: input => resolveInput(state, input, { maxThreads }),
        recordTurn: turn => recordTurn(state, turn, { maxTurns }),
        discardTurn: turnId => discardTurn(state, turnId),
        buildContext: options => buildContext(state, { maxTurns, maxContextChars, ...options }),
        setPreferences: preferences => {
            state.preferences = { ...state.preferences, ...sanitizePreferences(preferences) };
            return { ...state.preferences };
        }
    };
}

export function classifyInput(message, pending = null, activeThread = null) {
    const originalMessage = cleanText(message);
    const lower = originalMessage.toLowerCase();
    const tokens = tokenize(originalMessage);
    const vec = textToEmbeddingVector(originalMessage);
    const hasAnaphoricReference = /\b(?:it|its|this|that|they|them|those|these|same|earlier|previous|above)\b/i.test(lower);

    const isAcknowledgement = vectorCosineSimilarity(vec, ACKNOWLEDGEMENT_VECTOR) >= 0.36 || /^(?:yes|yeah|yep|yup|ok|okay|sure|alright|fine|thanks|thank you|got it|makes sense|understood)\b/i.test(lower);
    const isCancel = vectorCosineSimilarity(vec, CANCEL_VECTOR) >= 0.38 || /^(?:cancel|stop|reset|nevermind|start over|forget that)\b/i.test(lower);
    const isSetting = vectorCosineSimilarity(vec, SETTINGS_VECTOR) >= 0.38;
    const isFeatureCommand = vectorCosineSimilarity(vec, FEATURE_VECTOR) >= 0.38;
    const isStandaloneLiveRequest = !hasAnaphoricReference && (STANDALONE_LIVE_REQUEST.test(originalMessage) || vectorCosineSimilarity(vec, LIVE_REQUEST_VECTOR) >= 0.42);
    const isExplicitSwitch = vectorCosineSimilarity(vec, SWITCH_VECTOR) >= 0.35 || /^(?:switch|change topic|moving on|new task|lets talk about|another question)\b/i.test(lower);
    const isCorrection = vectorCosineSimilarity(vec, CORRECTION_VECTOR) >= 0.36 || /^(?:no|actually|wait)[,\s]+(?:i meant|that is wrong|you misunderstood)/i.test(originalMessage);
    const isModification = (vectorCosineSimilarity(vec, MODIFICATION_VECTOR) >= 0.36 && /\b(?:shorter|longer|simpler|instead|bullet|concise|brief|detail)\b/i.test(lower)) || /^(?:make it|make this|change it|change this|shorter|longer|simpler|instead)\b/i.test(lower);
    
    // Acknowledgements stay on the thread but are not treated as content follow-ups.
    const isPlaceRelativeFollowUp = !hasExplicitPlaceMention(originalMessage) && (
        PLACE_RELATIVE_FOLLOWUP.test(originalMessage) ||
        (
            PLACE_CATEGORY_FOLLOWUP.test(originalMessage) &&
            tokens.length <= 4 &&
            !/^(?:what|who|how|why|which|define|explain|tell me what)\b/i.test(originalMessage)
        )
    );
    const hasFollowUpLead = /^(?:show examples?|examples?|more|continue|explain further|further|tell me more|what about|how about|then what|what next|pros and cons|difference|differences|compare|cost|price|details)\b/i.test(lower);
    const isFollowUp = isCorrection || isModification || isPlaceRelativeFollowUp || hasFollowUpLead || (hasAnaphoricReference && (vectorCosineSimilarity(vec, FOLLOWUP_VECTOR) >= 0.28 || tokens.length <= 6)) || vectorCosineSimilarity(vec, FOLLOWUP_VECTOR) >= 0.35;
    const pendingMatch = pending ? matchesPending(originalMessage, pending) : false;
    const hasSubstantiveIntent = tokens.length >= 1 && !isAcknowledgement;
    const startsClearRequest = /^(?:who|what|when|where|why|how|do|can|are|will|explain|tell|give|show|plan|create|write|compare|calculate|translate|remember|open|start)\b/i.test(originalMessage);
    const isStandaloneCapabilityQuestion = STANDALONE_CAPABILITY_QUESTION.test(originalMessage);
    const topic = deriveTopic(originalMessage);
    const topicOverlap = activeThread
        ? countOverlap(tokens, tokenize(`${activeThread.topic || ''} ${activeThread.entity || ''}`))
        : 0;
    const looksLikeNamedTopic = looksLikeStandaloneNamedTopic(originalMessage, tokens);
    const ambiguousShortContext = Boolean(activeThread) &&
        !pending &&
        !isCancel &&
        !isSetting &&
        !isFeatureCommand &&
        !isStandaloneLiveRequest &&
        !isStandaloneCapabilityQuestion &&
        !isExplicitSwitch &&
        !isFollowUp &&
        !isAcknowledgement &&
        !startsClearRequest &&
        !looksLikeNamedTopic &&
        tokens.length > 0 &&
        tokens.length <= 3 &&
        topicOverlap === 0 &&
        hasAnaphoricReference;
    const clearNewIntent = !isCancel &&
        !isSetting &&
        hasSubstantiveIntent &&
        (
            isExplicitSwitch ||
            isFeatureCommand ||
            isStandaloneLiveRequest ||
            isStandaloneCapabilityQuestion ||
            (looksLikeNamedTopic && !pendingMatch) ||
            (startsClearRequest && !isFollowUp && Boolean(pending)) ||
            (startsClearRequest && !isFollowUp && topicOverlap === 0) ||
            (!pendingMatch && !isFollowUp && !isAcknowledgement && topicOverlap === 0)
        );

    return {
        originalMessage,
        tokens,
        topic,
        isCancel,
        isSetting,
        isFeatureCommand,
        isStandaloneLiveRequest,
        isStandaloneCapabilityQuestion,
        isAcknowledgement,
        isExplicitSwitch,
        isModification,
        isFollowUp,
        isPlaceRelativeFollowUp,
        isCorrection,
        pendingMatch,
        looksLikeNamedTopic,
        ambiguousShortContext,
        clearNewIntent
    };
}

function resolveInput(state, input, limits) {
    const originalMessage = cleanText(input?.message ?? input);
    const activeThread = state.threads.get(state.activeThreadId) || null;
    const classification = classifyInput(originalMessage, state.pending, activeThread);
    const vec = textToEmbeddingVector(originalMessage);
    let cancelledPendingState = null;
    let decisionReason = 'normal_request';
    let confidence = 0.72;

    if (classification.isCancel) {
        cancelledPendingState = clearPending(state, 'user_cancelled');
        state.activeThreadId = '';
        return resolution(originalMessage, originalMessage, null, 'reset_or_cancel', 1, cancelledPendingState);
    }

    if (classification.isSetting) {
        decisionReason = 'explicit_setting_command';
        confidence = 0.98;
    } else if (vectorCosineSimilarity(vec, RESUME_VECTOR) >= 0.32 || /\b(?:back to|return to|resume|previous topic|continue with)\b/i.test(originalMessage)) {
        const resumedThread = findReferencedThread(state, originalMessage);
        if (resumedThread) {
            cancelledPendingState = clearPending(state, 'superseded_by_explicit_thread_resume');
            state.activeThreadId = resumedThread.id;
            resumedThread.updatedAt = Date.now();
            return resolution(
                originalMessage,
                resolveFollowUpText(originalMessage, resumedThread.entity || resumedThread.topic),
                resumedThread,
                'explicit_thread_resume',
                0.97,
                cancelledPendingState
            );
        }
    } else if (classification.ambiguousShortContext) {
        return resolution(originalMessage, originalMessage, activeThread, 'ambiguous_short_context', 0.58, null);
    } else if (classification.isFollowUp && hasAmbiguousReferenceAcrossThreads(state, originalMessage, activeThread)) {
        return resolution(originalMessage, originalMessage, activeThread, 'ambiguous_reference_context', 0.52, null);
    } else if (classification.clearNewIntent) {
        cancelledPendingState = clearPending(state, 'superseded_by_new_intent');
        const thread = createThread(state, classification.topic || originalMessage, limits.maxThreads);
        decisionReason = 'clear_new_intent';
        confidence = classification.isExplicitSwitch || classification.isFeatureCommand || classification.looksLikeNamedTopic
            ? 0.98
            : 0.88;
        return resolution(originalMessage, originalMessage, thread, decisionReason, confidence, cancelledPendingState);
    } else if (classification.pendingMatch && state.pending) {
        // Pending answers (locations, yes/no, numbered choices) bind when not a clear new request.
        decisionReason = 'pending_clarification_answer';
        confidence = 0.96;
        const pendingThread = state.threads.get(state.pending.threadId) || activeThread;
        if (pendingThread) {
            state.activeThreadId = pendingThread.id;
            pendingThread.updatedAt = Date.now();
        }
        return resolution(originalMessage, originalMessage, pendingThread, decisionReason, confidence, null);
    } else if (classification.isAcknowledgement && activeThread) {
        // Keep the active thread; do not expand "okay" into a follow-up query.
        return resolution(originalMessage, originalMessage, activeThread, 'acknowledgement_keep_context', 0.95, null);
    } else if (classification.isFollowUp && activeThread) { 
        if (!shouldResolveAgainstActiveThread(originalMessage, classification, activeThread)) {
            const thread = createThread(state, classification.topic || originalMessage, limits.maxThreads);
            const reason = hasExplicitPlaceMention(originalMessage)
                ? 'clear_new_intent'
                : 'new_intent_low_context_confidence';
            return resolution(originalMessage, originalMessage, thread, reason, reason === 'clear_new_intent' ? 0.9 : 0.66, null);
        }
        const resolved = resolveFollowUpText(originalMessage, activeThread.entity || activeThread.topic); 
        decisionReason = classification.isCorrection ? 'conversation_repair' : 'contextual_follow_up'; 
        confidence = classification.isFollowUp ? 0.92 : 0.78; 
        return resolution(originalMessage, resolved, activeThread, decisionReason, confidence, null);
    }

    const thread = activeThread || createThread(state, classification.topic || originalMessage, limits.maxThreads);
    return resolution(originalMessage, originalMessage, thread, decisionReason, confidence, cancelledPendingState);
}

function discardTurn(state, turnId) {
    const id = cleanText(turnId);
    if (!id) return 0;
    const before = state.turns.length;
    state.turns = state.turns.filter(turn => turn.id !== id && turn.turnId !== id);
    return before - state.turns.length;
}

function recordTurn(state, turn, limits) {
    const role = turn?.role === 'assistant' ? 'assistant' : 'user';
    const text = cleanText(turn?.text);
    if (!text || turn?.aborted || turn?.error || turn?.control) return null;

    const threadId = cleanText(turn?.threadId) || state.activeThreadId;
    if (!threadId || !state.threads.has(threadId)) return null;
    const thread = state.threads.get(threadId);
    const record = {
        id: cleanText(turn?.id) || `${role}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        turnId: cleanText(turn?.turnId),
        role,
        text: text.slice(0, 4000),
        source: cleanText(turn?.source) || 'text',
        threadId,
        createdAt: Number(turn?.createdAt) || Date.now()
    };
    state.turns.push(record);
    state.turns = state.turns.slice(-limits.maxTurns * 3);
    thread.updatedAt = record.createdAt;
    const isAck = vectorCosineSimilarity(textToEmbeddingVector(text), ACKNOWLEDGEMENT_VECTOR) >= 0.36 || /^(?:yes|yeah|yep|yup|ok|okay|sure|alright|fine|thanks|thank you|got it|makes sense|understood)\b/i.test(text.toLowerCase());
    if (role === 'user' && !isAck) {
        const entity = deriveEntity(text);
        if (entity) thread.entity = entity;
        const topic = deriveTopic(text);
        if (topic) thread.topic = topic;
    }
    return { ...record };
}

function buildContext(state, options = {}) {
    const threadId = cleanText(options.threadId) || state.activeThreadId;
    if (!threadId) return [];
    const maxTurns = clamp(options.maxTurns, 12, 2, 30);
    const maxChars = clamp(options.maxContextChars, 9000, 500, 24000);
    const selected = state.turns.filter(turn => turn.threadId === threadId).slice(-maxTurns);
    const out = [];
    let chars = 0;
    for (let i = selected.length - 1; i >= 0; i -= 1) {
        const turn = selected[i];
        const cost = turn.text.length + 20;
        if (out.length && chars + cost > maxChars) break;
        chars += cost;
        out.unshift({ role: turn.role, text: turn.text });
    }
    return out;
}

function setPending(state, pending) {
    if (!pending || typeof pending !== 'object') {
        state.pending = null;
        return null;
    }
    state.pending = {
        type: cleanText(pending.type) || 'clarification',
        expected: cleanText(pending.expected) || 'free_text',
        options: Array.isArray(pending.options) ? pending.options.map(cleanText).filter(Boolean).slice(0, 10) : [],
        threadId: cleanText(pending.threadId) || state.activeThreadId,
        createdAt: Date.now()
    };
    return { ...state.pending };
}

function clearPending(state, reason = 'cleared') {
    if (!state.pending) return null;
    const previous = { ...state.pending, reason };
    state.pending = null;
    return previous;
}

function matchesPending(message, pending) {
    const text = cleanText(message);
    if (!text) return false;
    if (pending.expected === 'number') {
        const match = text.match(/^\s*(\d{1,2})\s*$/);
        if (!match) return false;
        const value = Number(match[1]);
        return pending.options.length ? value >= 1 && value <= pending.options.length : value >= 1;
    }
    if (pending.expected === 'yes_no') return /^(yes|yeah|yep|sure|ok|okay|no|nope|nah)$/i.test(text);
    if (pending.expected === 'name') return /^[A-Za-z][A-Za-z '-]{1,70}$/.test(text);
    const vec = textToEmbeddingVector(text);
    if (pending.expected === 'location') {
        const startsNewRequest = /^(?:who|what|when|where|why|how|do|can|are|will|explain|tell|give|show|plan|create|write|stop)\b/i.test(text);
        const isFeature = vectorCosineSimilarity(vec, FEATURE_VECTOR) >= 0.38;
        const isSetting = vectorCosineSimilarity(vec, SETTINGS_VECTOR) >= 0.38;
        return !startsNewRequest &&
            !isFeature &&
            !isSetting &&
            text.split(/\s+/).length <= 6;
    }
    const isAck = vectorCosineSimilarity(vec, ACKNOWLEDGEMENT_VECTOR) >= 0.36 || /^(?:yes|yeah|yep|yup|ok|okay|sure|alright|fine|thanks|got it)\b/i.test(text.toLowerCase());
    return isAck || tokenize(text).length <= 8;
}

function findReferencedThread(state, message) {
    const messageTokens = tokenize(message);
    let best = null;
    let bestScore = 0;
    for (const thread of state.threads.values()) {
        const referenceTokens = tokenize(`${thread.topic} ${thread.entity || ''}`);
        const score = countOverlap(messageTokens, referenceTokens);
        if (score > bestScore) {
            best = thread;
            bestScore = score;
        }
    }
    return bestScore > 0 ? best : null;
}

function createThread(state, topic, maxThreads) {
    const normalized = deriveTopic(topic) || cleanText(topic).toLowerCase().slice(0, 80) || 'general';
    const existing = [...state.threads.values()].find(thread => thread.topic === normalized);
    if (existing) {
        existing.updatedAt = Date.now();
        state.activeThreadId = existing.id;
        return existing;
    }
    const thread = {
        id: `thread_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        topic: normalized,
        entity: deriveEntity(topic),
        createdAt: Date.now(),
        updatedAt: Date.now()
    };
    state.threads.set(thread.id, thread);
    state.activeThreadId = thread.id;
    if (state.threads.size > maxThreads) {
        const oldest = [...state.threads.values()]
            .filter(item => item.id !== thread.id)
            .sort((a, b) => a.updatedAt - b.updatedAt)[0];
        if (oldest) {
            state.threads.delete(oldest.id);
            state.turns = state.turns.filter(turn => turn.threadId !== oldest.id);
        }
    }
    return thread;
}

function resetState(state) {
    state.activeThreadId = '';
    state.threads.clear();
    state.turns = [];
    state.pending = null;
}

function restoreState(state, snapshot, limits) {
    const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
    state.activeThreadId = String(source.activeThreadId || '');
    state.threads = new Map(
        (Array.isArray(source.threads) ? source.threads : [])
            .slice(-limits.maxThreads)
            .map(thread => [String(thread.id || ''), { ...thread }])
            .filter(([id]) => id)
    );
    state.turns = (Array.isArray(source.turns) ? source.turns : [])
        .slice(-limits.maxTurns)
        .map(turn => ({ ...turn }));
    state.pending = source.pending ? { ...source.pending } : null;
    state.preferences = {
        responseLength: 'normal',
        responseFormat: 'paragraph',
        responseStyle: 'balanced',
        customSystemPrompt: '',
        ...sanitizePreferences(source.preferences)
    };
    if (!state.threads.has(state.activeThreadId)) state.activeThreadId = '';
    return snapshotState(state);
}

function resolution(originalMessage, resolvedMessage, thread, decisionReason, confidence, cancelledPendingState) {
    return {
        originalMessage,
        resolvedMessage,
        activeThread: thread ? { ...thread } : null,
        decisionReason,
        primaryIntent: primaryIntentForDecision(decisionReason),
        confidence,
        cancelledPendingState
    };
}

function primaryIntentForDecision(decisionReason) {
    switch (String(decisionReason || '')) {
        case 'contextual_follow_up':
            return 'continue_previous_task';
        case 'conversation_repair':
            return 'modify_previous_task';
        case 'explicit_thread_resume':
            return 'refers_back_to_earlier_task';
        case 'pending_clarification_answer':
        case 'ambiguous_short_context':
        case 'ambiguous_reference_context':
            return 'clarification';
        case 'acknowledgement_keep_context':
            return 'continue_previous_task';
        case 'clear_new_intent':
        case 'new_intent_low_context_confidence':
            return 'new_unrelated_task';
        default:
            return 'new_unrelated_task';
    }
}

function hasExplicitPlaceMention(text) {
    const raw = cleanText(text);
    if (!raw) return false;
    // "nearby beaches in Goa" / "tourist places near Manali" already name a place.
    if (/\b(?:in|at|near|around|to|for)\s+[A-Za-z][A-Za-z\s.'-]{1,40}$/i.test(raw)) return true;
    if (/\b(?:in|at|near|around)\s+[A-Za-z][A-Za-z\s.'-]{1,40}\b/i.test(raw) &&
        !/\b(?:near me|nearby|near by|around there|around here)\b/i.test(raw)) {
        // Allow "near me" style relatives; otherwise treat as explicit place.
        const withoutRelative = raw.replace(/\b(?:nearby|near by|around there|around here|close by|near me)\b/gi, ' ');
        return /\b(?:in|at|near|around|to|for)\s+[A-Za-z][A-Za-z][A-Za-z\s.'-]{0,40}\b/i.test(withoutRelative);
    }
    return false;
}

function looksLikeStandaloneNamedTopic(message, tokens = []) {
    const raw = cleanText(message);
    if (!raw) return false;
    const tokenList = Array.isArray(tokens) && tokens.length ? tokens : tokenize(raw);
    if (tokenList.length === 0 || tokenList.length > 4) return false;
    if (/\b(?:it|its|this|that|they|them|those|these|same|earlier|previous|above)\b/i.test(raw)) return false;
    if (PLACE_RELATIVE_FOLLOWUP.test(raw) || PLACE_CATEGORY_FOLLOWUP.test(raw)) return false;
    const vec = textToEmbeddingVector(raw);
    if (vectorCosineSimilarity(vec, FOLLOWUP_VECTOR) >= 0.30 || vectorCosineSimilarity(vec, MODIFICATION_VECTOR) >= 0.34) return false;
    if (/^(?:who|what|when|where|why|how|which|do|can|are|will|explain|tell|give|show)\b/i.test(raw)) return false;
    // Capitalized multi-word names, cities, brands, or short noun phrases without pronouns.
    if (PROPER_NOUN_OR_PLACE.test(raw)) return true;
    if (CLEAR_NEW_TOPIC_SHORT.test(raw) && tokenList.length <= 3) return true;
    return false;
}

function deriveTopic(text) {
    const tokens = tokenize(text);
    // Prefer entity when available so follow-ups bind to a stable subject.
    const entity = deriveEntity(text);
    if (entity) {
        const entityTokens = tokenize(entity);
        if (entityTokens.length) return entityTokens.slice(0, 8).join(' ');
    }
    return tokens.slice(0, 8).join(' ');
}

function deriveEntity(text) {
    const raw = cleanText(text);
    for (const pattern of ENTITY_PATTERNS) {
        const match = raw.match(pattern);
        if (match?.[1]) return cleanText(match[1]).replace(/[?.!,;]+$/g, '').slice(0, 80);
    }
    const travelPlace = raw.match(
        /\b(?:trip|itinerary|travel|vacation|holiday|visit|weekend|day trip)\s+(?:to|in|for|around)\s+([A-Za-z][A-Za-z\s.'-]{1,50})/i
    ) || raw.match(/\b(?:in|to|around)\s+([A-Z][A-Za-z][A-Za-z\s.'-]{1,50})(?:\s*$|[?.!,])/);
    if (travelPlace?.[1]) {
        const place = cleanText(travelPlace[1]).replace(/[?.!,;]+$/g, '').slice(0, 80);
        if (place && !PLACE_RELATIVE_FOLLOWUP.test(place)) return place;
    }
    // Bare named topics ("Bengaluru", "SpaceX") become the thread entity.
    if (looksLikeStandaloneNamedTopic(raw)) {
        return raw.replace(/[?.!,;]+$/g, '').slice(0, 80);
    }
    return '';
}

function resolvePronouns(text, entity) {
    if (!entity) return text;
    return cleanText(text).replace(
        /\b(?:it|its|this|that|this one|that one|the company|the person|the topic|they|them)\b/gi,
        entity
    );
}

function resolveFollowUpText(text, entity) {
    const raw = cleanText(text);
    const anchor = cleanText(entity);
    if (!anchor) return raw;
    const pronounResolved = resolvePronouns(raw, anchor);
    if (pronounResolved !== raw) return pronounResolved;
    if ((PLACE_RELATIVE_FOLLOWUP.test(raw) || PLACE_CATEGORY_FOLLOWUP.test(raw)) && !hasExplicitPlaceMention(raw)) {
        if (/^(?:nearby|near by|around (?:there|here)|close by)\b/i.test(raw)) {
            return `${raw} near ${anchor}`;
        }
        return `${raw} near ${anchor}`;
    }
    if (!isContextualExpansionCandidate(raw)) return pronounResolved;
    // Avoid awkward expansions like "latest on it for SpaceX" when pronouns already resolved.
    if (/^(?:more|continue|continue from earlier|explain further|tell me more|further|then what|what next)\b/i.test(raw)) {
        return `${raw} about ${anchor}`;
    }
    if (/^(?:latest|price|cost|news|mission|sources?|pros|cons|examples?|difference|differences)\b/i.test(raw)) {
        return `${raw} about ${anchor}`;
    }
    if (/\b(?:about|for|on|regarding)\b/i.test(raw)) return pronounResolved;
    return `${raw} about ${anchor}`;
}

function isContextualExpansionCandidate(text) {
    const raw = cleanText(text);
    if (!raw) return false;
    if (/^(?:who|what|when|where|why|how|which)\s+(?:is|are|was|were)\s+[A-Za-z0-9][A-Za-z0-9 .'-]{2,}\??$/i.test(raw)) {
        return false;
    }
    if ((PLACE_RELATIVE_FOLLOWUP.test(raw) || PLACE_CATEGORY_FOLLOWUP.test(raw)) && !hasExplicitPlaceMention(raw)) return true;
    const vec = textToEmbeddingVector(raw);
    return (vectorCosineSimilarity(vec, FOLLOWUP_VECTOR) >= 0.30 || /\b(?:it|its|this|that|more|continue|further|compare|latest)\b/i.test(raw)) && tokenize(raw).length <= 8;
}

function hasExplicitNewObject(text) {
    const raw = cleanText(text);
    return /\b(?:of|for|on|about|with)\s+(?:[A-Z][A-Za-z0-9.'-]{1,}(?:\s+[A-Z][A-Za-z0-9.'-]{1,}){0,4}|[A-Z0-9]{2,})\b/.test(raw);
}

function shouldResolveAgainstActiveThread(message, classification, activeThread) {
    if (!activeThread) return false;
    if (classification?.isCorrection) return true;
    const raw = cleanText(message);
    const tokens = Array.isArray(classification?.tokens) ? classification.tokens : tokenize(raw);
    const topicTokens = tokenize(`${activeThread.topic || ''} ${activeThread.entity || ''}`);
    const overlap = countOverlap(tokens, topicTokens);
    const hasEntity = Boolean(cleanText(activeThread.entity));
    const hasTopicAnchor = hasEntity || topicTokens.length > 0;
    const vec = textToEmbeddingVector(raw);
    const explicitReference = Boolean(classification?.isFollowUp) || vectorCosineSimilarity(vec, FOLLOWUP_VECTOR) >= 0.30 || /\b(?:it|its|this|that|they|them|more|continue|further|compare|latest|examples?|cost|price|pros|cons|differences?)\b/i.test(raw);
    const bareShortQuestion = /^(?:who|what|when|where|why|how|which)\b/i.test(raw) && tokens.length <= 3 && overlap === 0 && !explicitReference;
    const namedLikeNewTopic = /^(?:who|what)\s+is\s+[A-Za-z0-9][A-Za-z0-9 .'-]{2,}\??$/i.test(raw) && overlap === 0;
    const explicitNewObject = hasExplicitNewObject(raw) && overlap === 0 && !/\b(?:it|its|this|that|they|them)\b/i.test(raw);

    if (classification?.isStandaloneLiveRequest && overlap === 0) return false;
    if (hasExplicitPlaceMention(raw) && overlap === 0) return false;
    if (namedLikeNewTopic || bareShortQuestion || explicitNewObject) return false;
    if (overlap > 0) return true;
    if (explicitReference && hasTopicAnchor && tokens.length <= 8) return true;
    if (classification?.isPlaceRelativeFollowUp && hasTopicAnchor) return true;
    return explicitReference && tokens.length <= 3 && hasTopicAnchor;
}

function hasAmbiguousReferenceAcrossThreads(state, message, activeThread) {
    if (!activeThread || !state?.threads || state.threads.size < 2) return false;
    const raw = cleanText(message);
    if (!raw) return false;
    const vec = textToEmbeddingVector(raw);
    if (vectorCosineSimilarity(vec, MODIFICATION_VECTOR) >= 0.34) return false;
    const hasVagueReference = /\b(?:it|this|that|they|them|those|these|one|them both|both of them)\b/i.test(raw);
    if (!hasVagueReference) return false;
    const tokens = tokenize(raw);
    const activeTokens = tokenize(`${activeThread.topic || ''} ${activeThread.entity || ''}`);
    const activeOverlap = countOverlap(tokens, activeTokens);
    if (activeOverlap > 0) return false;
    const namesOtherThread = [...state.threads.values()]
        .filter(thread => thread.id !== activeThread.id)
        .some(thread => countOverlap(tokens, tokenize(`${thread.topic || ''} ${thread.entity || ''}`)) > 0);
    if (namesOtherThread) return false;
    const isPairwiseRequest = /\b(?:compare|difference|differences|both|between|versus|vs)\b/i.test(raw);
    if (isPairwiseRequest) return true;
    // Clear continuations ("tell me more about it") bind to the active thread.
    if (/^(?:tell me more|more|continue|explain further|further|what about it|how about it|latest on it)\b/i.test(raw)) {
        return false;
    }
    // Only bare pronoun-like replies are treated as ambiguous across threads.
    return /^(?:it|this|that|they|them|those|these|one|them both|both of them)\??$/i.test(raw) ||
        tokens.length === 0;
}

function tokenize(text) {
    return cleanText(text)
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(token => token && token.length > 1 && !STOP_WORDS.has(token))
        .slice(0, 24);
}

function countOverlap(a, b) {
    const right = new Set(b);
    return a.reduce((count, token) => count + (right.has(token) ? 1 : 0), 0);
}

function sanitizePreferences(preferences) {
    if (!preferences || typeof preferences !== 'object') return {};
    const out = {};
    if (['short', 'normal', 'detailed'].includes(preferences.responseLength)) out.responseLength = preferences.responseLength;
    if (['paragraph', 'bullet', 'steps'].includes(preferences.responseFormat)) out.responseFormat = preferences.responseFormat;
    const responseStyle = preferences.responseStyle || preferences.supportMode;
    if (['balanced', 'witty', 'chatty', 'supportive', 'debate'].includes(responseStyle)) {
        out.responseStyle = responseStyle;
    }
    const customSystemPrompt = cleanText(preferences.customSystemPrompt).slice(0, 1200);
    if (customSystemPrompt) out.customSystemPrompt = customSystemPrompt;
    return out;
}

function snapshotState(state) {
    return {
        activeThreadId: state.activeThreadId,
        threads: [...state.threads.values()].map(thread => ({ ...thread })),
        turns: state.turns.map(turn => ({ ...turn })),
        pending: state.pending ? { ...state.pending } : null,
        preferences: { ...state.preferences }
    };
}

function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function clamp(value, fallback, min, max) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
}

export function extractRollingExecutiveSummary(olderTurns = []) {
    if (!Array.isArray(olderTurns) || !olderTurns.length) return null;

    const constraints = [];
    const decisions = [];
    const topics = [];

    for (const turn of olderTurns) {
        const isUser = turn?.role === 'user';
        const text = String(turn?.text || '').replace(/\s+/g, ' ').trim();
        if (!text) continue;

        const vec = textToEmbeddingVector(text);
        const constraintSim = vectorCosineSimilarity(vec, CONSTRAINT_PROTOTYPE_VECTOR);
        const decisionSim = vectorCosineSimilarity(vec, DECISION_PROTOTYPE_VECTOR);

        if (isUser && constraintSim >= 0.18) {
            const snippet = text.length > 140 ? text.slice(0, 137) + '...' : text;
            if (!constraints.some(c => c.toLowerCase() === snippet.toLowerCase())) {
                constraints.push(snippet);
            }
        }

        if (decisionSim >= 0.18) {
            const snippet = text.length > 140 ? text.slice(0, 137) + '...' : text;
            if (!decisions.some(d => d.toLowerCase() === snippet.toLowerCase())) {
                decisions.push(snippet);
            }
        }

        if (isUser && text.length > 10 && text.length < 90) {
            const topicCandidate = text.replace(/^[¿¡"'\s]+|[?"'\s]+$/g, '').replace(/^(?:can you|please|help me|tell me|what is|how to)\s+/i, '').trim();
            if (topicCandidate && !topics.some(t => t.toLowerCase() === topicCandidate.toLowerCase())) {
                topics.push(topicCandidate);
            }
        }
    }

    return {
        constraints: constraints.slice(-4),
        decisions: decisions.slice(-4),
        topics: topics.slice(-4)
    };
}

export function buildCompactedContext(turns = [], options = {}) {
    if (!Array.isArray(turns) || !turns.length) return [];
    const maxVerbatim = clamp(options.maxVerbatimTurns, 8, 2, 20);
    if (turns.length <= maxVerbatim) {
        return turns.map(t => ({ role: t.role, text: t.text }));
    }

    const olderTurns = turns.slice(0, turns.length - maxVerbatim);
    const recentTurns = turns.slice(-maxVerbatim);
    const summary = options.rollingSummary || extractRollingExecutiveSummary(olderTurns);

    const summaryParts = [];
    if (summary) {
        if (summary.constraints?.length) summaryParts.push(`Constraints: ${summary.constraints.join('; ')}`);
        if (summary.decisions?.length) summaryParts.push(`Decisions: ${summary.decisions.join('; ')}`);
        if (summary.topics?.length) summaryParts.push(`Topics: ${summary.topics.join(' -> ')}`);
    }

    const digestText = summaryParts.length
        ? `[Conversation context summary from earlier turns: ${summaryParts.join(' | ')}]`
        : `[Context: ${olderTurns.length} earlier turns discussed]`;

    return [
        { role: 'system', text: digestText },
        ...recentTurns.map(t => ({ role: t.role, text: t.text }))
    ];
}
