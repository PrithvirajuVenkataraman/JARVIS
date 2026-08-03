function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function buildAmbiguousContextMessage(contextResolution = {}) {
    const topic = String(contextResolution?.activeThread?.entity || contextResolution?.activeThread?.topic || '').trim();
    const original = String(contextResolution?.originalMessage || '').trim();
    if (topic) {
        return `Did you mean "${original}" as a new topic, or as a follow-up about ${topic}?`;
    }
    return `Did you mean "${original}" as a new topic, or as a follow-up to the previous answer?`;
}

export function buildContextClarificationHtml(contextResolution = {}) {
    const topic = String(contextResolution?.activeThread?.entity || contextResolution?.activeThread?.topic || 'the previous topic').trim();
    const original = escapeHtml(String(contextResolution?.originalMessage || '').trim());
    const safeTopic = escapeHtml(topic);
    return `
        <div class="context-clarification-card" data-original="${original}">
            <div class="context-clarification-topic">Active topic: <strong>${safeTopic}</strong></div>
            <div class="context-clarification-actions">
                <button type="button" class="context-clarification-btn" data-context-choice="follow_up">Follow-up about ${safeTopic}</button>
                <button type="button" class="context-clarification-btn" data-context-choice="new_topic">New topic: ${original}</button>
            </div>
        </div>
    `.trim();
}

export function buildActiveTopicChipHtml(topic = '') {
    const clean = String(topic || '').trim();
    if (!clean) return '';
    const safeTopic = escapeHtml(clean);
    return `
        <div class="context-topic-chip" role="status" aria-live="polite">
            <span class="context-topic-label">Following: <strong>${safeTopic}</strong></span>
            <button type="button" class="context-topic-clear" data-context-topic-action="clear" aria-label="Clear active topic">Clear</button>
            <button type="button" class="context-topic-new" data-context-topic-action="new_topic" aria-label="Start a new topic">New topic</button>
        </div>
    `.trim();
}

export function resolveContextClarificationChoice(choice, contextResolution = {}) {
    const original = String(contextResolution?.originalMessage || '').trim();
    const topic = String(contextResolution?.activeThread?.entity || contextResolution?.activeThread?.topic || '').trim();
    if (choice === 'follow_up' && topic) {
        return `Tell me more about ${original} in the context of ${topic}`;
    }
    return original;
}
