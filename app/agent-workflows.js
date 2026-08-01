const PLAN_WEEKEND_PATTERN = /\b(?:plan|suggest|build)\s+(?:my\s+|a\s+|the\s+)?(?:weekend|saturday|sunday|day\s+trip|2[\s-]?day|two[\s-]?day)\b/i;
const COMPARE_DOCS_PATTERN = /\bcompare\s+(?:these|the|my|both|two)?\s*(?:files?|docs?|documents?|pdfs?|attachments?|versions?)\b/i;
const FIX_FROM_SCREEN_PATTERN = /\b(?:fix|debug|solve|resolve)\s+(?:this|the|my)?\s*(?:error|bug|issue|exception|stack\s*trace|problem)\b/i;
const VISION_FOLLOWUP_PATTERN = /^(?:what about (?:that|this|it)|explain (?:that|this|it)(?: more)?|tell me more(?: about (?:that|this|it))?|zoom in on (?:that|this|it)|is (?:that|this) (?:safe|correct|right)|save (?:that|this)|verify (?:that|this|it)|check (?:that|this|it)|what(?:'s| is) (?:the )?(?:brand|model|text|error))\??$/i;
const ATTACH_FOLLOWUP_PATTERN = /^(?:summarize (?:that|this|it)|key points(?: from (?:that|this|it))?|extract (?:the )?(?:dates?|names?|numbers?)|what does (?:that|this|it) say|verify (?:that|this|it)|save (?:that|this))\??$/i;

export function detectAgentWorkflow(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;

    if (PLAN_WEEKEND_PATTERN.test(raw)) {
        const place = extractPlaceHint(raw);
        return {
            id: 'plan_weekend',
            label: 'Weekend plan',
            place,
            steps: [
                'Clarify city and constraints',
                'Build a day-by-day plan',
                'Add travel, food, and timing tips'
            ],
            prompt: buildWeekendPlanPrompt(raw, place)
        };
    }

    if (COMPARE_DOCS_PATTERN.test(raw)) {
        return {
            id: 'compare_docs',
            label: 'Compare documents',
            steps: [
                'Read both attached documents',
                'List key differences',
                'Call out conflicts and missing pieces'
            ],
            prompt: [
                'Compare the attached documents carefully.',
                'Return:',
                '1. Shared facts',
                '2. Important differences',
                '3. Conflicts or missing details',
                '4. A short recommendation of which source is clearer for what.',
                `User request: ${raw}`
            ].join('\n')
        };
    }

    if (FIX_FROM_SCREEN_PATTERN.test(raw)) {
        return {
            id: 'fix_from_screen',
            label: 'Fix from screen',
            steps: [
                'Read the visible error',
                'Identify likely cause',
                'Give a concrete fix sequence'
            ],
            prompt: [
                'Use the attached screenshot/camera view as the primary evidence.',
                'Identify the exact error text if visible.',
                'Explain the most likely cause in plain language.',
                'Give a numbered fix sequence the user can follow now.',
                'If the image is unclear, say what is missing.',
                `User request: ${raw}`
            ].join('\n')
        };
    }

    return null;
}

export function isMultimodalFollowup(text) {
    const raw = String(text || '').trim();
    if (!raw || raw.length > 120) return false;
    return VISION_FOLLOWUP_PATTERN.test(raw) || ATTACH_FOLLOWUP_PATTERN.test(raw);
}

export function classifyMultimodalFollowup(text) {
    const raw = String(text || '').trim().toLowerCase();
    if (/^save\b/.test(raw)) return 'save_memory';
    if (/^verify\b|^check\b/.test(raw)) return 'verify';
    if (/brand|model|text|error|zoom|explain|tell me more|what about|what does|summarize|key points|extract/.test(raw)) {
        return 'continue';
    }
    return 'continue';
}

export function buildMultimodalFollowupPrompt(text, grounding) {
    const kind = String(grounding?.kind || 'multimodal');
    const summary = String(grounding?.summary || grounding?.selectedText || '').trim().slice(0, 1800);
    const action = classifyMultimodalFollowup(text);
    return {
        action,
        prompt: [
            `Continue from the previous ${kind} context.`,
            summary ? `Previous grounded context:\n${summary}` : '',
            `User follow-up: ${String(text || '').trim()}`,
            'Answer using the grounded context first. If the context is insufficient, say what is missing.'
        ].filter(Boolean).join('\n\n')
    };
}

function extractPlaceHint(text) {
    const match = String(text || '').match(/\b(?:in|for|around|near)\s+([A-Za-z][A-Za-z\s.'-]{1,40})$/i);
    return match?.[1] ? String(match[1]).replace(/[?.!,]+$/g, '').trim() : '';
}

function buildWeekendPlanPrompt(raw, place) {
    const destination = place || 'the requested city';
    return [
        `Create a practical weekend plan for ${destination}.`,
        'Structure the answer as:',
        '1. Quick overview',
        '2. Saturday morning / afternoon / evening',
        '3. Sunday morning / afternoon',
        '4. Food and transit tips',
        '5. One backup indoor option',
        'Keep it actionable and complete.',
        `User request: ${raw}`
    ].join('\n');
}
