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
const CONSTRAINT_PROTOTYPE_VECTOR = textToEmbeddingVector('must be strictly required rules constraints format budget limit price preference avoid prefer only maximum minimum deadline under');
const DECISION_PROTOTYPE_VECTOR = textToEmbeddingVector('we will use selected architecture chosen database framework postgresql prisma redis solution implementation decision');

const STANDALONE_LIVE_REQUEST = /\b(?:weather|temperature|forecast|bitcoin|btc|ethereum|eth|crypto|price now|rate now|score now|live score|ipl|nba|nfl|epl|earthquake|wildfire|flood|cyclone|hurricane|tsunami|latest news|breaking news|government news|stock price)\b/i;
const PLACE_RELATIVE_FOLLOWUP = /\b(?:nearby|near by|around (?:there|here)|close by|tourist (?:places?|spots?|attractions?)|sightseeing|things to do|places to (?:visit|see)|what to see|where to go|hotels nearby|restaurants nearby|stay options|day trip|weekend trip)\b/i;
const PLACE_CATEGORY_FOLLOWUP = /\b(?:hill stations?|beaches?|waterfalls?|temples?|parks?|lakes?|viewpoints?|attractions?)\b/i;
const STANDALONE_CAPABILITY_QUESTION = /^(?:do|can|are|will)\s+you\s+(?:have|support|speak|understand|know how to|know what|act as|remember)\b|^(?:what|which)\s+(?:features?|capabilities)\s+do\s+you\s+have\b|^do\s+you\s+understand\s+[A-Za-z][A-Za-z\s-]{1,40}\??$/i;
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

export function extractAssistantListItems(text = '') {
    const raw = String(text || '');
    const items = [];
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        const numMatch = trimmed.match(/^(?:(?:\d{1,2}|[a-e])[\.\)]|\-|\*)\s+(?:\*\*)?([A-Za-z0-9][A-Za-z0-9\s,'’\.\-–—:]{2,80})(?:\*\*)?/i);
        if (numMatch) {
            let item = numMatch[1].replace(/[:–—\-\*\.]+$/, '').trim();
            if (item && item.length >= 3) {
                const stripped = item.replace(/^(?:step|point|number|item)\s*[0-9]+[:–—\-\s]*/i, '').trim();
                const cleanItem = stripped.length >= 3 ? stripped : item;
                if (!/^(?:note|tip|here|these)\b/i.test(cleanItem)) {
                    items.push(cleanItem);
                }
            }
        }
    }
    return items.slice(0, 10);
}

export function extractAssistantKeyEntities(text = '') {
    const raw = String(text || '');
    const entities = [];
    const boldMatches = raw.matchAll(/\*\*([A-Za-z0-9][A-Za-z0-9\s,'’\.\-–—]{2,60})\*\*/g);
    for (const m of boldMatches) {
        const val = m[1].replace(/[:–—\-\.]+$/, '').trim();
        if (val && val.length >= 3 && !entities.includes(val) && !/^(?:note|tip|important|key|summary|overview|pros|cons)\b/i.test(val)) {
            entities.push(val);
        }
    }
    const propMatches = raw.matchAll(/\b([A-Z][a-z0-9]{2,}(?:\s+[A-Z][a-z0-9]{2,}){1,3})\b/g);
    for (const m of propMatches) {
        const val = m[1].trim();
        if (val && !entities.includes(val) && !STOP_WORDS.has(val.toLowerCase())) {
            entities.push(val);
        }
    }
    return entities.slice(0, 12);
}

export function resolveOrdinalOrAnaphoricAntecedent(text = '', thread = null) {
    if (!thread) return null;
    const lower = String(text || '').toLowerCase().trim();
    const listItems = Array.isArray(thread.assistantListItems) ? thread.assistantListItems : [];
    const entities = Array.isArray(thread.assistantEntities) ? thread.assistantEntities : [];

    if (/\b(?:first(?:\s+(?:one|option|item|park|place|book|suggestion))?|option\s*1|number\s*1|step\s*1|point\s*1|item\s*1|#1|former)\b/i.test(lower)) {
        if (listItems.length >= 1) return listItems[0];
        if (entities.length >= 1) return entities[0];
    }
    if (/\b(?:second(?:\s+(?:one|option|item|park|place|book|suggestion))?|option\s*2|number\s*2|step\s*2|point\s*2|item\s*2|#2|latter)\b/i.test(lower)) {
        if (listItems.length >= 2) return listItems[1];
        if (entities.length >= 2) return entities[1];
    }
    if (/\b(?:third(?:\s+(?:one|option|item|park|place|book|suggestion))?|option\s*3|number\s*3|step\s*3|point\s*3|item\s*3|#3)\b/i.test(lower)) {
        if (listItems.length >= 3) return listItems[2];
        if (entities.length >= 3) return entities[2];
    }
    if (/\b(?:fourth(?:\s+(?:one|option|item|park|place|book|suggestion))?|option\s*4|number\s*4|step\s*4|point\s*4|item\s*4|#4)\b/i.test(lower)) {
        if (listItems.length >= 4) return listItems[3];
    }
    if (/\b(?:fifth(?:\s+(?:one|option|item|park|place|book|suggestion))?|option\s*5|number\s*5|step\s*5|point\s*5|item\s*5|#5)\b/i.test(lower)) {
        if (listItems.length >= 5) return listItems[4];
    }
    if (/\b(?:last(?:\s+(?:one|option|item))?|final\s+(?:one|option|item))\b/i.test(lower)) {
        if (listItems.length > 0) return listItems[listItems.length - 1];
        if (entities.length > 0) return entities[entities.length - 1];
    }

    if (/\b(?:it|its|that|this|there)\b/i.test(lower)) {
        if (thread.entity) return thread.entity;
        if (entities.length > 0) return entities[0];
        if (thread.topic) return thread.topic;
    }

    return null;
}

export function createConversationEngine(options = {}) {
    const maxTurns = clamp(options.maxTurns, 12, 4, 60);
    const maxTurnHistory = clamp(options.maxTurnHistory, 160, 40, 400);
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
        restoreState: snapshot => restoreState(state, snapshot, { maxTurns, maxTurnHistory, maxThreads }),
        setPending: pending => setPending(state, pending),
        clearPending: reason => clearPending(state, reason),
        reset: () => resetState(state),
        resolve: input => resolveInput(state, input, { maxThreads }),
        recordTurn: turn => recordTurn(state, turn, { maxTurns, maxTurnHistory }),
        discardTurn: turnId => discardTurn(state, turnId),
        buildContext: options => buildContext(state, { maxTurns, maxContextChars, ...options }),
        retrievePastTurns: (query, options) => retrievePastTurns(state.turns, query, options),
        buildMultiTierContext: options => buildMultiTierContext(state, { maxTurns, maxContextChars, ...options }),
        reformulateSearchQuery: (query, options = {}) => reformulateSearchQuery(query, { state, ...options }),
        resolveFollowUp: message => {
            const activeThread = state.threads.get(state.activeThreadId);
            const entity = activeThread?.entity || activeThread?.topic || findRecentEntityFromState(state) || '';
            return resolveFollowUpText(message, entity, state);
        },
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
    const hasAnaphoricReference = /\b(?:it|its|this|that|they|them|their|theirs|there|he|him|his|she|her|hers|those|these|same|earlier|previous|above|the former|the latter)\b/i.test(lower);

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
    const hasFollowUpLead = /^(?:show examples?|examples?|more(?: details| info)?|continue(?: speaking| reading)?|explain (?:further|more|simply|it)|tell (?:me )?more|expand(?: on that)?|elaborate|what about|how about|then what|what next|what else|pros and cons|difference|differences|compare|cost|price|details|break that down|go deeper|give (?:some |an? )?(?:examples?|use cases?|code|sample)|can you (?:give|show|explain|elaborate))\b/i.test(lower);
    const hasDefiniteAspect = /\b(?:the|its|their)\s+[a-z]{3,}\b/i.test(lower);
    const isUltraShortFollowUp = /^(?:why|how|when|where|who|what next|what else|and then|how so|what about that|what about it|why so|who was it|who is it|what was it|what is that|how come)\??$/i.test(lower.trim());
    const hasOrdinalReference = /\b(?:first(?:\s+(?:one|option|item))?|second(?:\s+(?:one|option|item))?|third(?:\s+(?:one|option|item))?|fourth(?:\s+(?:one|option|item))?|fifth(?:\s+(?:one|option|item))?|last(?:\s+(?:one|option|item))?|former|latter|option\s+[1-9]|number\s+[1-9]|step\s+[1-9]|point\s+[1-9]|item\s+[1-9]|#\s*[1-9])\b/i.test(lower);
    const assistantEntitiesText = activeThread && Array.isArray(activeThread.assistantEntities) ? activeThread.assistantEntities.join(' ') : '';
    const assistantListText = activeThread && Array.isArray(activeThread.assistantListItems) ? activeThread.assistantListItems.join(' ') : '';
    const assistantOverlap = (assistantEntitiesText || assistantListText)
        ? countOverlap(tokens, tokenize(`${assistantEntitiesText} ${assistantListText}`))
        : 0;
    const referencesAssistantOutput = Boolean(activeThread) && (hasOrdinalReference || assistantOverlap > 0);

    const isContinuationOfActiveThread = Boolean(activeThread) && (
        /\b(?:use cases?|real world|applications?|alternatives?|examples?|pros and cons|tradeoffs?|benefits?|drawbacks?|how to implement|why is that|can you explain|walk me through|in practice|code sample)\b/i.test(lower) ||
        (hasAnaphoricReference) ||
        referencesAssistantOutput ||
        (/^(?:how|why|can|what|where|which|do|does)\b/i.test(lower) && tokens.length <= 10 && !looksLikeStandaloneNamedTopic(originalMessage, tokens) && !isStandaloneLiveRequest)
    );
    const isFollowUp = isCorrection || isModification || isPlaceRelativeFollowUp || hasFollowUpLead || isUltraShortFollowUp || isContinuationOfActiveThread || referencesAssistantOutput || (hasAnaphoricReference && (vectorCosineSimilarity(vec, FOLLOWUP_VECTOR) >= 0.28 || tokens.length <= 8)) || (hasDefiniteAspect && Boolean(activeThread) && tokens.length <= 8) || vectorCosineSimilarity(vec, FOLLOWUP_VECTOR) >= 0.35;
    const pendingMatch = pending ? matchesPending(originalMessage, pending) : false;
    const hasSubstantiveIntent = tokens.length >= 1 && !isAcknowledgement;
    const startsClearRequest = /^(?:who|what|when|where|why|how|do|can|are|will|explain|tell|give|show|plan|create|write|compare|calculate|translate|remember|open|start)\b/i.test(originalMessage);
    const isStandaloneCapabilityQuestion = !isFollowUp && STANDALONE_CAPABILITY_QUESTION.test(originalMessage);
    const topic = deriveTopic(originalMessage);
    const topicOverlap = activeThread
        ? countOverlap(tokens, tokenize(`${activeThread.topic || ''} ${activeThread.entity || ''} ${assistantEntitiesText} ${assistantListText}`))
        : 0;
    const looksLikeNamedTopic = looksLikeStandaloneNamedTopic(originalMessage, tokens);
    const ambiguousShortContext = false;
    const clearNewIntent = !isCancel &&
        !isSetting &&
        hasSubstantiveIntent &&
        !isUltraShortFollowUp &&
        !referencesAssistantOutput &&
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
                originalMessage,
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
        decisionReason = classification.isCorrection ? 'conversation_repair' : 'contextual_follow_up'; 
        confidence = classification.isFollowUp ? 0.92 : 0.78; 
        return resolution(originalMessage, originalMessage, activeThread, decisionReason, confidence, null);
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
    const rawText = String(turn?.text || '').trim();
    const text = role === 'assistant' ? pruneSearchNoiseFromText(rawText) : rawText;
    if (!text || turn?.aborted || turn?.error || turn?.control) return null;

    let threadId = cleanText(turn?.threadId) || state.activeThreadId;
    if (!threadId) {
        const topic = deriveTopic(text) || 'general';
        const created = createThread(state, topic, limits?.maxThreads || 20);
        threadId = created.id;
    } else if (!state.threads.has(threadId)) {
        const thread = {
            id: threadId,
            topic: deriveTopic(text) || threadId.slice(0, 80),
            entity: deriveEntity(text) || '',
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        state.threads.set(threadId, thread);
        state.activeThreadId = threadId;
    }
    const thread = state.threads.get(threadId);
    const embedding = turn?.embedding || textToEmbeddingVector(text);
    const record = {
        id: cleanText(turn?.id) || `${role}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        turnId: cleanText(turn?.turnId),
        role,
        text: text.slice(0, 4000),
        source: cleanText(turn?.source) || 'text',
        threadId,
        createdAt: Number(turn?.createdAt) || Date.now(),
        embedding
    };
    state.turns.push(record);
    const maxHistory = limits?.maxTurnHistory || Math.max(160, (limits?.maxTurns || 12) * 5);
    state.turns = state.turns.slice(-maxHistory);
    thread.updatedAt = record.createdAt;
    const isAck = vectorCosineSimilarity(embedding, ACKNOWLEDGEMENT_VECTOR) >= 0.36 || /^(?:yes|yeah|yep|yup|ok|okay|sure|alright|fine|thanks|thank you|got it|makes sense|understood)\b/i.test(text.toLowerCase());
    if (role === 'user' && !isAck) {
        const isFollowUpTurn = /^(?:why|how|when|where|who|tell me more|more|continue|explain|elaborate|what about|how about|what next)\b/i.test(text) ||
            /\b(?:it|its|this|that|they|them|those|these)\b/i.test(text);
        const entity = deriveEntity(text);
        if (entity && !/^(?:it|its|this|that|them|they|him|her|me|us|more)$/i.test(entity)) {
            thread.entity = entity;
        }
        if (!isFollowUpTurn || !thread.topic) {
            const topic = deriveTopic(text);
            if (topic && !/^(?:it|this|that|more|why|how|what)\b/i.test(topic)) {
                thread.topic = topic;
            }
        }
    } else if (role === 'assistant') {
        thread.lastAssistantText = text;
        const listItems = extractAssistantListItems(text);
        if (listItems.length > 0) {
            thread.assistantListItems = listItems;
        }
        const entities = extractAssistantKeyEntities(text);
        if (entities.length > 0) {
            thread.assistantEntities = entities;
            if (!thread.entity) {
                thread.entity = entities[0];
            }
        }
    }
    return { ...record };
}

function buildContext(state, options = {}) {
    const threadId = cleanText(options.threadId) || state.activeThreadId;
    const maxTurns = clamp(options.maxTurns, 12, 2, 30);
    const maxChars = clamp(options.maxContextChars, 12000, 500, 24000);
    let selected = threadId ? state.turns.filter(turn => turn.threadId === threadId) : [];
    // If active thread has no turns or very few, fall back to recent turns from state.turns
    if (selected.length === 0 && state.turns.length > 0) {
        selected = state.turns.slice(-maxTurns);
    } else if (selected.length < 4 && state.turns.length > selected.length) {
        const recentSessionTurns = state.turns.slice(-maxTurns);
        const map = new Map();
        for (const t of recentSessionTurns) map.set(t.id, t);
        for (const t of selected) map.set(t.id, t);
        selected = [...map.values()].slice(-maxTurns);
    } else {
        selected = selected.slice(-maxTurns);
    }
    const out = [];
    let chars = 0;
    for (let i = selected.length - 1; i >= 0; i -= 1) {
        const turn = selected[i];
        const cleanedText = turn.role === 'assistant' ? pruneSearchNoiseFromText(turn.text) : turn.text;
        const cost = cleanedText.length + 20;
        if (out.length && chars + cost > maxChars) break;
        chars += cost;
        out.unshift({ role: turn.role, text: cleanedText });
    }
    // Context pairing integrity: If out starts with an assistant turn, and there is a preceding user turn in selected,
    // ensure we include the user prompt or don't leave an orphaned assistant turn alone without context
    if (out.length > 0 && out[0].role === 'assistant') {
        const firstSelectedIdx = selected.findIndex(t => t.text === out[0].text);
        if (firstSelectedIdx > 0 && selected[firstSelectedIdx - 1]?.role === 'user') {
            const userTurn = selected[firstSelectedIdx - 1];
            out.unshift({ role: userTurn.role, text: userTurn.text });
        }
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
    const maxHistory = limits?.maxTurnHistory || Math.max(160, (limits?.maxTurns || 12) * 5);
    state.turns = (Array.isArray(source.turns) ? source.turns : [])
        .slice(-maxHistory)
        .map(turn => ({
            ...turn,
            embedding: turn.embedding || textToEmbeddingVector(turn.text)
        }));
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
    const verbatim = cleanText(originalMessage);
    let searchQuery = verbatim;
    const resolvedAntecedent = resolveOrdinalOrAnaphoricAntecedent(verbatim, thread);
    if ((decisionReason === 'contextual_follow_up' || decisionReason === 'conversation_repair') && thread) {
        const anchor = cleanText(resolvedAntecedent || thread.entity || thread.topic || '');
        if (anchor && !verbatim.toLowerCase().includes(anchor.toLowerCase())) {
            searchQuery = `${anchor} ${verbatim}`;
        }
    }
    return {
        originalMessage: verbatim,
        verbatimMessage: verbatim,
        resolvedMessage: verbatim,
        resolvedAntecedent: resolvedAntecedent || '',
        searchQuery,
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

const NON_PLACE_TARGETS = /^(?:it|its|this|that|these|those|he|him|his|she|her|hers|they|them|their|theirs|me|my|mine|us|our|ours|you|your|yours|what|which|who|whom|where|when|why|how|here|there|now|then|all|both|each|doing|do|know|learn|see|ask|say|work|begin|start|happen|details|example|examples|more|further)$/i;

function hasExplicitPlaceMention(text) {
    const raw = cleanText(text);
    if (!raw) return false;
    const prepMatch = raw.match(/\b(?:in|at|near|around|to|for)\s+([A-Za-z][A-Za-z\s.'-]{0,40})$/i);
    if (prepMatch) {
        const candidate = prepMatch[1].trim();
        const firstWord = candidate.split(/\s+/)[0].replace(/[?.!,;]+$/g, '');
        if (NON_PLACE_TARGETS.test(firstWord)) return false;
        return true;
    }
    if (/\b(?:in|at|near|around)\s+[A-Za-z][A-Za-z\s.'-]{1,40}\b/i.test(raw) &&
        !/\b(?:near me|nearby|near by|around there|around here)\b/i.test(raw)) {
        // Allow "near me" style relatives; otherwise treat as explicit place.
        const withoutRelative = raw.replace(/\b(?:nearby|near by|around there|around here|close by|near me)\b/gi, ' ');
        const midMatch = withoutRelative.match(/\b(?:in|at|near|around|to|for)\s+([A-Za-z][A-Za-z][A-Za-z\s.'-]{0,40})\b/i);
        if (midMatch) {
            const candidate = midMatch[1].trim();
            const firstWord = candidate.split(/\s+/)[0].replace(/[?.!,;]+$/g, '');
            if (NON_PLACE_TARGETS.test(firstWord)) return false;
            return true;
        }
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
        if (match?.[1]) {
            const val = cleanText(match[1]).replace(/[?.!,;]+$/g, '').slice(0, 80);
            if (!/^(?:it|its|this|that|them|they|him|he|her|she|me|us|anything|something|nothing|more|everything)$/i.test(val)) {
                return val;
            }
        }
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
    // Preserve verbatim user message without destructive pronoun replacements
    return cleanText(text);
}

function findRecentEntityFromState(state) {
    if (!state) return '';
    if (state.activeThreadId && state.threads?.has(state.activeThreadId)) {
        const t = state.threads.get(state.activeThreadId);
        if (t.entity) return t.entity;
        if (Array.isArray(t.assistantEntities) && t.assistantEntities.length) return t.assistantEntities[0];
        if (t.topic) return t.topic;
    }
    const turns = Array.isArray(state.turns) ? state.turns : [];
    for (let i = turns.length - 1; i >= 0 && i >= turns.length - 8; i--) {
        const turn = turns[i];
        if (turn.role === 'assistant') {
            const entities = extractAssistantKeyEntities(turn.text);
            if (entities.length > 0) return entities[0];
        }
        const entity = deriveEntity(turn.text);
        if (entity && !PLACE_RELATIVE_FOLLOWUP.test(entity)) return entity;
    }
    return '';
}

export function resolveFollowUpText(text, entity, state = null) {
    // Preserve user's exact message unchanged without regex rewrites or synthetic appendages
    return cleanText(text);
}

function isContextualExpansionCandidate(text) {
    const raw = cleanText(text);
    if (!raw) return false;
    if (/^(?:why|how|when|where|who)\??$/i.test(raw)) return true;
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
    const lower = raw.toLowerCase();
    const tokens = Array.isArray(classification?.tokens) ? classification.tokens : tokenize(raw);
    const topicTokens = tokenize(`${activeThread.topic || ''} ${activeThread.entity || ''}`);
    const overlap = countOverlap(tokens, topicTokens);
    const hasEntity = Boolean(cleanText(activeThread.entity));
    const hasTopicAnchor = hasEntity || topicTokens.length > 0;
    const vec = textToEmbeddingVector(raw);
    const hasAnaphoric = /\b(?:it|its|this|that|they|them|their|theirs|there|he|him|his|she|her|hers|those|these|same|earlier|previous|above|the former|the latter)\b/i.test(lower);
    const hasDefiniteAspect = /\b(?:the|its|their)\s+[a-z]{3,}\b/i.test(lower);
    const explicitReference = Boolean(classification?.isFollowUp) || hasAnaphoric || hasDefiniteAspect || vectorCosineSimilarity(vec, FOLLOWUP_VECTOR) >= 0.30 || /\b(?:it|its|this|that|they|them|more|continue|further|compare|latest|examples?|cost|price|pros|cons|differences?)\b/i.test(raw);
    const bareShortQuestion = /^(?:who|what|when|where|why|how|which)\b/i.test(raw) && tokens.length <= 3 && overlap === 0 && !explicitReference;
    
    // Only treat as brand new topic if it explicitly names a new capitalized proper entity without pronouns
    const hasNewNamedEntity = !hasAnaphoric && /\b[A-Z][a-z]{1,20}\s+[A-Z][a-z]{1,20}\b/.test(raw) && overlap === 0;
    const namedLikeNewTopic = !hasAnaphoric && !hasDefiniteAspect && /^(?:who|what)\s+is\s+(?!the\s)[A-Za-z0-9 .'-]{2,}\??$/i.test(raw) && overlap === 0;
    const explicitNewObject = !hasAnaphoric && hasExplicitNewObject(raw) && overlap === 0;

    if (classification?.isStandaloneLiveRequest && overlap === 0) return false;
    if (hasExplicitPlaceMention(raw) && overlap === 0) return false;
    
    const assistantEntitiesText = activeThread && Array.isArray(activeThread.assistantEntities) ? activeThread.assistantEntities.join(' ') : '';
    const assistantListText = activeThread && Array.isArray(activeThread.assistantListItems) ? activeThread.assistantListItems.join(' ') : '';
    const assistantOverlap = (assistantEntitiesText || assistantListText)
        ? countOverlap(tokens, tokenize(`${assistantEntitiesText} ${assistantListText}`))
        : 0;
    const hasOrdinal = /\b(?:first(?:\s+(?:one|option|item))?|second(?:\s+(?:one|option|item))?|third(?:\s+(?:one|option|item))?|fourth(?:\s+(?:one|option|item))?|fifth(?:\s+(?:one|option|item))?|last(?:\s+(?:one|option|item))?|former|latter|option\s+[1-9]|number\s+[1-9]|step\s+[1-9]|point\s+[1-9]|item\s+[1-9]|#\s*[1-9])\b/i.test(lower);
    if (assistantOverlap > 0 || hasOrdinal) return true;

    if (hasNewNamedEntity || namedLikeNewTopic || bareShortQuestion || explicitNewObject) return false;
    if (overlap > 0) return true;
    if (explicitReference && hasTopicAnchor) return true;
    if (classification?.isPlaceRelativeFollowUp && hasTopicAnchor) return true;
    return false;
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
    // Clear continuations bind to the active thread.
    if (/^(?:tell me more|more|continue|explain further|further|what about (?:it|that|this)|how about (?:it|that|this)|latest on it|who was (?:it|he|she)|what was (?:it|that)|why|how so)\b/i.test(raw)) {
        return false;
    }
    // Only bare pronoun-like replies are treated as ambiguous across threads.
    return /^(?:it|this|that|they|them|those|these|one|them both|both of them)\??$/i.test(raw);
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

        const hasConstraintSignal = /\b(?:must|strictly|budget|prefer|preference|avoid|cannot|can't|only|under|max|maximum|at most|require|required|rule|rules|limit|limited)\b/i.test(text);
        if (isUser && (constraintSim >= 0.16 || hasConstraintSignal)) {
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

/**
 * Intelligently retrieves relevant past turns from historical conversation outside the active window.
 * Groups turns into conversational exchanges (user query + assistant reply).
 */
export function retrievePastTurns(turns = [], query = '', options = {}) {
    const cleanQuery = cleanText(query);
    if (!cleanQuery || !Array.isArray(turns) || turns.length === 0) return [];

    const excludeTurnIds = new Set(options.excludeTurnIds || []);
    const maxPairs = clamp(options.maxPairs || options.topK, 2, 1, 6);
    const queryVec = textToEmbeddingVector(cleanQuery);

    const isRetrospective = /\b(?:earlier|previously|before|prior|remember|you said|i said|what did (?:i|we|you) (?:say|decide|discuss|mention)|as mentioned|what was (?:the|that|my)|last time|earlier on|we talked about|what was our|conclusion)\b/i.test(cleanQuery);
    const minSimilarity = isRetrospective ? 0.08 : 0.16;

    // Group turns into chronological exchanges (user turn and following assistant turn)
    const exchanges = [];
    const stopWords = new Set(['what', 'did', 'say', 'earlier', 'before', 'prior', 'remember', 'the', 'that', 'this', 'was', 'were', 'our', 'you', 'can', 'could', 'would', 'tell', 'remind', 'about', 'with', 'from', 'again', 'when', 'how', 'why', 'who']);
    const queryKeywords = tokenize(cleanQuery).filter(w => w.length >= 2 && !stopWords.has(w.toLowerCase()));

    for (let i = 0; i < turns.length; i++) {
        const turn = turns[i];
        if (turn.role === 'user') {
            const assistantTurn = (i + 1 < turns.length && turns[i + 1].role === 'assistant') ? turns[i + 1] : null;
            const turnId = turn.id || String(i);
            const asstId = assistantTurn ? (assistantTurn.id || String(i + 1)) : '';

            if (!excludeTurnIds.has(turnId) && (!asstId || !excludeTurnIds.has(asstId))) {
                const combinedText = `${turn.text} ${assistantTurn ? assistantTurn.text : ''}`;
                const combinedVec = textToEmbeddingVector(combinedText);
                const turnVec = turn.embedding || textToEmbeddingVector(turn.text);
                let sim = Math.max(
                    vectorCosineSimilarity(queryVec, combinedVec),
                    vectorCosineSimilarity(queryVec, turnVec)
                );

                let matchedKw = [];
                if (queryKeywords.length > 0) {
                    const lowerExchange = combinedText.toLowerCase();
                    let hitCount = 0;
                    for (const kw of queryKeywords) {
                        const kwLower = kw.toLowerCase();
                        if (lowerExchange.includes(kwLower)) {
                            hitCount += 1;
                            matchedKw.push(kw);
                            if (kw.length >= 3 && kw === kw.toUpperCase()) {
                                hitCount += 1; // Acronym priority
                            }
                        }
                    }
                    if (hitCount > 0) {
                        sim += 0.20 * Math.min(4, hitCount);
                    }
                }

                exchanges.push({
                    userTurn: turn,
                    assistantTurn,
                    similarity: sim,
                    reason: matchedKw.length ? `keyword: ${matchedKw.join(', ')}` : `similarity: ${sim.toFixed(2)}`,
                    index: i
                });
            }
        }
    }

    let matches = exchanges.filter(e => e.similarity >= minSimilarity);

    // If query is explicitly retrospective (e.g. "what did we discuss earlier?")
    // but specific lexical/vector similarity was low, intelligently retrieve the foundational earlier exchanges
    if (isRetrospective && matches.length === 0 && exchanges.length > 0) {
        matches = exchanges.slice(0, maxPairs).map(e => ({
            ...e,
            similarity: 0.5,
            reason: 'foundational earlier exchange'
        }));
    }

    matches.sort((a, b) => b.similarity - a.similarity);
    const topMatches = matches.slice(0, maxPairs);
    // Restore chronological order
    topMatches.sort((a, b) => a.index - b.index);

    const retrieved = [];
    for (const match of topMatches) {
        retrieved.push({
            role: 'user',
            text: match.userTurn.text,
            id: match.userTurn.id || '',
            turnId: match.userTurn.turnId || '',
            retrievalReason: match.reason
        });
        if (match.assistantTurn) {
            retrieved.push({
                role: 'assistant',
                text: match.assistantTurn.text,
                id: match.assistantTurn.id || '',
                turnId: match.assistantTurn.turnId || '',
                retrievalReason: match.reason
            });
        }
    }
    return retrieved;
}

/**
 * Builds the complete multi-tier context model:
 * - Tier 1: Recent verbatim dialogue window (last 6-8 turns)
 * - Tier 2: In-session semantically retrieved past turns (from older turns outside the verbatim window)
 * - Tier 3: Rolling executive milestone summary (constraints, decisions, topics)
 * - Structured Messages: OpenAI/Groq/Gemini formatted messages array
 */
export function buildMultiTierContext(state, options = {}) {
    const currentMessage = cleanText(options.message || '');
    const maxRecentTurns = clamp(options.maxRecentTurns || options.maxVerbatimTurns, 8, 2, 20);
    const maxContextChars = clamp(options.maxContextChars, 12000, 1000, 24000);

    const allTurns = Array.isArray(state?.turns) ? state.turns : [];
    const threadId = cleanText(options.threadId) || state?.activeThreadId || '';
    
    // Select turns for conversation: prioritize active thread for verbatim window, search all session turns for retrieval
    let verbatimTurnsSource = (threadId ? allTurns.filter(t => t.threadId === threadId) : allTurns);
    if (verbatimTurnsSource.length < 2 && allTurns.length > 0) {
        verbatimTurnsSource = allTurns;
    } else if (verbatimTurnsSource.length < 4 && allTurns.length > verbatimTurnsSource.length) {
        verbatimTurnsSource = allTurns;
    }

    // Tier 1: Active verbatim window (most recent turns) - prune bulky search noise & budget tokens
    const recentTurnsRaw = verbatimTurnsSource.slice(-maxRecentTurns);
    const recentTurnIds = new Set(recentTurnsRaw.map(t => t.id || t.turnId).filter(Boolean));
    const recentTurns = recentTurnsRaw.map((t, idx, arr) => {
        const isLatest = idx >= arr.length - 2;
        let text = t.role === 'assistant' ? pruneSearchNoiseFromText(t.text) : String(t.text || '').trim();
        // Token-aware pruning: older recent turns get capped to 800 chars, preserving core answer without runaways
        if (!isLatest && text.length > 800) {
            text = truncateAtWordBoundary(text, 800);
        }
        return { role: t.role, text };
    });

    // Older turns outside the verbatim window (searches across all session turns for deep recall)
    const olderTurns = allTurns.filter(t => !recentTurnIds.has(t.id) && !recentTurnIds.has(t.turnId));

    // Tier 2: Semantic Turn Retrieval from older turns
    const retrievedTurnsRaw = olderTurns.length > 0 && currentMessage
        ? retrievePastTurns(olderTurns, currentMessage, {
            excludeTurnIds: recentTurnIds,
            topK: clamp(options.topK || 2, 2, 1, 4)
        })
        : [];
    const retrievedTurns = retrievedTurnsRaw.map(t => {
        let text = t.role === 'assistant' ? pruneSearchNoiseFromText(t.text) : String(t.text || '').trim();
        if (text.length > 500) {
            text = truncateAtWordBoundary(text, 500);
        }
        return { role: t.role, text };
    });

    // Tier 3: Rolling Milestone Summary
    const milestones = options.rollingSummary || (olderTurns.length > 0 ? extractRollingExecutiveSummary(olderTurns) : null);
    const milestoneParts = [];
    if (milestones) {
        if (milestones.constraints?.length) milestoneParts.push(`Established Constraints & Preferences: ${milestones.constraints.join('; ')}`);
        if (milestones.decisions?.length) milestoneParts.push(`Key Decisions & Concrete Facts: ${milestones.decisions.join('; ')}`);
        if (milestones.topics?.length) milestoneParts.push(`Topics Explored: ${milestones.topics.join(' -> ')}`);
    }
    const summaryText = milestoneParts.join('\n');

    // Compose system background additions (Tier 2 + Tier 3)
    const backgroundSections = [];
    if (summaryText) {
        backgroundSections.push(`[Milestone Summary of earlier conversation (${olderTurns.length} turns prior):\n${summaryText}]`);
    }
    if (retrievedTurns.length > 0) {
        const retrievedFormatted = retrievedTurns
            .map(t => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.text}`)
            .join('\n');
        backgroundSections.push(`[Retrieved Relevant Context From Earlier in this Conversation:\n${retrievedFormatted}]`);
    }
    const backgroundContextBlock = backgroundSections.join('\n\n');

    // Compose Structured Messages array (Native OpenAI / Groq / Gemini format)
    const structuredMessages = [];
    const baseSystemPrompt = cleanText(options.systemPrompt || state?.preferences?.customSystemPrompt || '');
    const combinedSystemPrompt = [
        baseSystemPrompt,
        backgroundContextBlock
    ].filter(Boolean).join('\n\n');

    if (combinedSystemPrompt) {
        structuredMessages.push({ role: 'system', content: combinedSystemPrompt });
    }

    // Add verbatim recent dialogue turns, bounded by maxContextChars token budget
    let accumulatedChars = combinedSystemPrompt.length + (currentMessage.length || 0);
    const includedRecentTurns = [];
    for (let i = recentTurns.length - 1; i >= 0; i--) {
        const t = recentTurns[i];
        const cost = t.text.length + 20;
        if (includedRecentTurns.length > 0 && accumulatedChars + cost > maxContextChars) {
            break;
        }
        accumulatedChars += cost;
        includedRecentTurns.unshift(t);
    }

    for (const t of includedRecentTurns) {
        structuredMessages.push({
            role: t.role === 'user' ? 'user' : 'assistant',
            content: t.text
        });
    }

    // Add current user message if supplied
    if (currentMessage) {
        structuredMessages.push({
            role: 'user',
            content: currentMessage
        });
    }

    return {
        recentTurns: includedRecentTurns,
        retrievedTurns,
        olderTurnsCount: olderTurns.length,
        milestones,
        summaryText,
        backgroundContextBlock,
        structuredMessages,
        // Legacy flat context compatibility
        context: [
            ...(backgroundContextBlock ? [{ role: 'system', text: backgroundContextBlock }] : []),
            ...includedRecentTurns
        ]
    };
}

export function pruneSearchNoiseFromText(text = '') {
    if (!text) return '';
    let cleaned = String(text).replace(/\r\n/g, '\n');
    // Strip verification reports and debug blocks
    cleaned = cleaned.replace(/(?:\n{2,}|\s{2,}|\s+)===\s*(?:SOURCE METADATA|VERIFICATION REPORT)\s*===[\s\S]*$/i, '');
    // Strip trailing source sections: Sources:, Verified Sources:, Source Excerpts:, Citations:, References:
    cleaned = cleaned.replace(/(?:\n{2,}|\s{2,}|\s+)(?:Sources|Verified Sources|Source Excerpts|Citations|References):[\s\S]*$/i, '');
    // Strip synthesis deadline and provenance footers
    cleaned = cleaned.replace(/(?:\n{2,}|\s{2,}|\s+)\*(?:Synthesis completed at[\s\S]*?\*|\(Source[s]?:.*?\))/gi, '');
    // Strip bulleted URL lists
    cleaned = cleaned.replace(/(?:\n|\s+)(?:\[\d+\]|-|\*)\s+https?:\/\/\S+/gi, '');
    return cleaned.trim();
}

export function truncateAtWordBoundary(text, maxChars) {
    if (!text || text.length <= maxChars) return text;
    const truncated = text.slice(0, maxChars);
    const lastSpace = truncated.lastIndexOf(' ');
    if (lastSpace > maxChars * 0.7) {
        return truncated.slice(0, lastSpace) + '...';
    }
    return truncated + '...';
}

function escapeRegex(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isStandaloneQuery(query, turns = []) {
    const q = String(query || '').trim();
    if (!q) return true;
    if (!Array.isArray(turns) || turns.length === 0) return true;

    // Explicit new topic / switch markers
    if (/^(?:(?:new|different|another)\s+topic[:\s]|switch(?:\s+topic)?\s+to[:\s]|by the way[,:\s]|on another note[,:\s]|let's talk about\s+|moving on to\s+)/i.test(q)) {
        return true;
    }

    // MCQ patterns (options A/B/C/D, Question:, etc.)
    if (/^(?:which of the following|choose the correct|select the best|question:)\b/i.test(q) ||
        /\b(?:[a-d]\)|\([a-d]\))\s+[A-Za-z0-9]/i.test(q) ||
        /\boptions?:\s*[a-d]/i.test(q)) {
        return true;
    }

    // Multimodal / Image prompts
    if (/^:::(?:image|vision)\[/i.test(q) || /\b(?:generate|draw|paint|sketch|create)\s+(?:an?\s+)?image\b/i.test(q)) {
        return true;
    }

    // Code / syntax / math queries that are self-contained
    if (/^(?:write|create|implement|code|generate|debug)\s+(?:a|an)?\s*(?:python|javascript|typescript|c\+\+|java|rust|go|html|css|sql|script|function|class|algorithm)\b/i.test(q)) {
        return true;
    }

    // Check for referential pronouns, demonstratives, or elliptical markers
    const hasReferentialPronoun = /\b(?:he|him|his|she|her|hers|they|them|their|theirs|it|its)\b/i.test(q);
    const hasDemonstrativeReference = /\b(?:this|that|these|those|the two|both|the former|the latter)\b/i.test(q);
    const hasEllipticalMarker = /^(?:(?:and|what|how)\s+about|and\s+in|what\s+if)\b/i.test(q);
    const hasComparativeMarker = /\b(?:compare\s+(?:the\s+two|them|both)|difference\s+between|which\s+one\s+is\s+(?:better|faster|cheaper|larger|recommended)|who\s+won|head\s+to\s+head)\b/i.test(q);
    const isVeryShortFragment = q.split(/\s+/).length <= 3 && /^(?:why|how\s+much|how\s+many|when|where|who|salary|net\s+worth|age|height|founder|price|status|cost|results?)\??$/i.test(q);

    if (hasReferentialPronoun || hasDemonstrativeReference || hasEllipticalMarker || hasComparativeMarker || isVeryShortFragment) {
        return false;
    }

    // Standalone live / factual queries (weather, crypto, markets, etc.)
    if (STANDALONE_LIVE_REQUEST.test(q)) {
        return true;
    }

    // Queries with prepositional phrases anchoring the subject (e.g. "Weather in Tokyo", "Capital of France", "Population of India")
    if (/\b(?:in|of|for|about|at)\s+[A-Za-z0-9]/i.test(q)) {
        return true;
    }

    // Has at least one capitalized proper noun (e.g. "Tokyo", "France", "Apple", "Bitcoin", "Photosynthesis")
    if (/[A-Z][a-z0-9]{2,}/.test(q) && q.split(/\s+/).length >= 2) {
        return true;
    }

    // Standalone live / factual queries with question lead
    // E.g. "Who is the CEO of Apple?", "What is photosynthesis?"
    const hasQuestionLead = /^(?:who|what|where|when|which|why|how)\s+(?:is|are|was|were|do|does|did|can|will)\b/i.test(q);
    if (hasQuestionLead && !hasReferentialPronoun && !hasDemonstrativeReference) {
        const terms = q.replace(/^(?:who|what|where|when|which|why|how)\s+(?:is|are|was|were|do|does|did|can|will)\s+(?:the\s+|a\s+|an\s+)?/i, '')
            .replace(/[?.!]+$/, '')
            .trim();
        if (terms.split(/\s+/).length >= 2) {
            return true;
        }
    }

    // If query has 4+ words and no referential pronouns/demonstratives, treat as standalone
    if (q.split(/\s+/).length >= 4 && !hasReferentialPronoun && !hasDemonstrativeReference) {
        return true;
    }

    return false;
}

export function extractThreadAntecedents(turns = [], activeThread = null) {
    const validTurns = (Array.isArray(turns) ? turns : []).filter(t => t && (t.text || t.user || t.ai));
    if (!validTurns.length) {
        return {
            entities: activeThread?.entity ? [activeThread.entity] : [],
            listItems: activeThread?.assistantListItems || [],
            lastUserText: '',
            lastAssistantText: '',
            primaryEntity: activeThread?.entity || '',
            primaryTopic: activeThread?.topic || ''
        };
    }

    let lastAssistantText = '';
    let lastUserText = '';

    for (let i = validTurns.length - 1; i >= 0; i--) {
        const t = validTurns[i];
        const role = String(t.role || (t.user ? 'user' : (t.ai ? 'assistant' : ''))).toLowerCase();
        const text = String(t.text || (role === 'user' ? t.user : t.ai) || '').trim();
        if (!lastAssistantText && role === 'assistant') {
            lastAssistantText = pruneSearchNoiseFromText(text);
        } else if (!lastUserText && role === 'user') {
            lastUserText = text;
        }
        if (lastAssistantText && lastUserText) break;
    }

    const assistantEntities = lastAssistantText ? extractAssistantKeyEntities(lastAssistantText) : [];
    const assistantListItems = lastAssistantText ? extractAssistantListItems(lastAssistantText) : [];
    const userEntities = lastUserText ? extractAssistantKeyEntities(lastUserText) : [];

    const entities = Array.from(new Set([
        ...(activeThread?.entity ? [activeThread.entity] : []),
        ...assistantEntities,
        ...userEntities
    ])).filter(e => e && e.length >= 2 && !STOP_WORDS.has(e.toLowerCase()));

    const listItems = Array.from(new Set([
        ...(activeThread?.assistantListItems || []),
        ...assistantListItems
    ])).filter(item => item && item.length >= 2);

    const primaryEntity = activeThread?.entity || entities[0] || '';
    const primaryTopic = activeThread?.topic || deriveTopic(lastUserText) || entities[0] || '';

    return {
        entities,
        listItems,
        lastUserText,
        lastAssistantText,
        primaryEntity,
        primaryTopic
    };
}

export function reformulateSearchQuery(query, options = {}) {
    try {
        const raw = String(query || '').trim();
        if (!raw) return '';

        // Extract turns from various options patterns (state, turns, conversationHistory)
        let turns = [];
        if (Array.isArray(options.turns)) {
            turns = options.turns;
        } else if (Array.isArray(options.conversationHistory)) {
            turns = options.conversationHistory.flatMap(item => {
                if (item.role && item.text) return [item];
                return [
                    item.user ? { role: 'user', text: item.user } : null,
                    item.ai ? { role: 'assistant', text: item.ai } : null
                ].filter(Boolean);
            });
        } else if (options.state && Array.isArray(options.state.turns)) {
            turns = options.state.turns;
        }

        // 1. Fast Standalone Check (0ms): If query is already standalone, preserve it!
        if (isStandaloneQuery(raw, turns)) {
            return raw;
        }

        const activeThread = options.activeThread ||
            (options.state?.threads && options.state?.activeThreadId ? options.state.threads.get(options.state.activeThreadId) : null);

        // 2. Extract antecedents from recent turns
        const antecedents = extractThreadAntecedents(turns, activeThread);
        const { entities, listItems, lastUserText, primaryEntity, primaryTopic } = antecedents;

        if (!primaryEntity && !primaryTopic && !entities.length && !listItems.length) {
            return raw; // No antecedent context available -> fail-open
        }

        const cleanQ = raw.replace(/[?.!]+$/, '').trim();

        // 3. Case A: Comparative Reference ("compare the two", "which one is better?", "difference between them")
        if (/\b(?:compare\s+(?:the\s+two|them|both)|difference\s+between\s+(?:the\s+two|them|both)|which\s+one\s+is\s+(?:better|faster|cheaper|larger|recommended)|who\s+won|head\s+to\s+head)\b/i.test(cleanQ)) {
            let item1 = '';
            let item2 = '';
            if (listItems.length >= 2) {
                item1 = listItems[0];
                item2 = listItems[1];
            } else if (entities.length >= 2) {
                item1 = entities[0];
                item2 = entities[1];
            } else if (lastUserText) {
                const vsMatch = lastUserText.match(/\b([A-Za-z0-9][A-Za-z0-9\s-]{1,30})\s+(?:vs\.?|versus|and|or)\s+([A-Za-z0-9][A-Za-z0-9\s-]{1,30})\b/i);
                if (vsMatch) {
                    item1 = vsMatch[1].trim();
                    item2 = vsMatch[2].trim();
                }
            }
            if (item1 && item2) {
                return `${item1} vs ${item2} comparison`;
            }
        }

        // 4. Case B: Elliptical Prepositional / Temporal ("what about in 2024?", "in 2020?", "and in Europe?")
        const ellipticalMatch = cleanQ.match(/^(?:(?:and|what|how)\s+about\s+)?(?:in|at|for|during|since)\s+([0-9]{4}|[A-Za-z\s'-]+)$/i) ||
                                cleanQ.match(/^(?:what|how)\s+about\s+([0-9]{4}|[A-Za-z\s'-]+)$/i);
        if (ellipticalMatch && ellipticalMatch[1]) {
            const modifier = ellipticalMatch[1].trim();
            let baseTopic = primaryTopic || primaryEntity || '';
            if (lastUserText) {
                const topicSubject = lastUserText
                    .replace(/^(?:who|what|where|when|which|why|how)\s+(?:is|are|was|were|do|does|did|can|will)\s+(?:the\s+|a\s+|an\s+)?/i, '')
                    .replace(/\b(?:in|at|for|during|since)\s+[0-9]{4}\b/gi, '')
                    .replace(/[?.!]+$/, '')
                    .trim();
                if (topicSubject.length >= 3) {
                    baseTopic = topicSubject;
                }
            }
            if (baseTopic) {
                return `${baseTopic} in ${modifier}`.replace(/\bin\s+in\b/gi, 'in').trim();
            }
        }

        // 5. Case C: Pronoun Coreference ("his net worth", "what is her salary?", "how old is he?", "what did they announce?")
        if (/\b(?:he|him|his|she|her|hers|they|them|their|theirs|it|its)\b/i.test(cleanQ)) {
            const targetEntity = primaryEntity || (entities.length ? entities[0] : '') || primaryTopic;
            if (targetEntity) {
                let rewritten = cleanQ;
                rewritten = rewritten.replace(/\b(?:his|her|their|its)\b/gi, targetEntity);
                rewritten = rewritten.replace(/\b(?:he|him|she|they|them|it)\b/gi, targetEntity);
                rewritten = rewritten
                    .replace(/^(?:what|who|when|where|how)\s+(?:is|are|was|were|do|does|did)\s+/i, '')
                    .replace(/^(?:tell\s+me\s+about|find\s+out|search\s+for)\s+/i, '')
                    .replace(/\s+/g, ' ')
                    .trim();
                if (rewritten.length >= 3) {
                    return rewritten;
                }
            }
        }

        // 6. Case D: Demonstrative & Expansion ("tell me more about this", "why did that happen?", "key features")
        if (/\b(?:this|that|these|those)\b/i.test(cleanQ) || /^(?:tell\s+me\s+more|explain\s+further|details|more\s+info|key\s+features|pros\s+and\s+cons)\b/i.test(cleanQ)) {
            const target = primaryEntity || primaryTopic || (entities.length ? entities[0] : '');
            if (target) {
                let rewritten = cleanQ
                    .replace(/\b(?:this|that|these|those)\b/gi, target)
                    .replace(/^(?:tell\s+me\s+more(?:\s+about)?|explain\s+further(?:\s+about)?)\s*/i, `${target} `)
                    .trim();
                return rewritten;
            }
        }

        // 7. Case E: Short Attribute Follow-Up ("net worth?", "salary?", "headquarters?", "age?")
        if (cleanQ.split(/\s+/).length <= 3 && (primaryEntity || primaryTopic)) {
            const target = primaryEntity || primaryTopic;
            return `${target} ${cleanQ}`;
        }

        // 8. General Follow-Up Fallback: Append primary anchor if not already present
        const anchor = primaryEntity || primaryTopic;
        if (anchor && !new RegExp(`\\b${escapeRegex(anchor)}\\b`, 'i').test(cleanQ)) {
            return `${cleanQ} ${anchor}`;
        }

        return raw;
    } catch (_) {
        // Fast fail-open fallback
        return String(query || '').trim();
    }
}


