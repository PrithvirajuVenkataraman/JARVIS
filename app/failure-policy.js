function compactText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function asErrorText(failureOrReason) {
    if (failureOrReason && typeof failureOrReason === 'object') {
        return `${String(failureOrReason.name || '')} ${String(failureOrReason.message || failureOrReason.code || '')} ${String(failureOrReason.reason || '')}`.toLowerCase();
    }
    return String(failureOrReason || '').toLowerCase();
}

export function classifyFailure(failureOrReason, context = {}) {
    const text = asErrorText(failureOrReason);
    const codeHint = String(failureOrReason?.code || context?.code || '').toLowerCase();

    if (codeHint === 'aborted' || /abort/.test(text)) {
        return {
            code: 'aborted',
            recoverable: false,
            userActions: [],
            message: 'Request aborted.'
        };
    }

    if (
        codeHint === 'network_timeout' ||
        /timeout|timed out|network|failed to fetch|service unavailable|temporar|rate limit|429|5\d\d/.test(text)
    ) {
        return {
            code: 'network_timeout',
            recoverable: true,
            userActions: ['retry', 'web_search'],
            message: 'Network or timeout failure.'
        };
    }

    if (codeHint === 'permission_blocked' || /permission|not-allowed|denied|microphone|camera/.test(text)) {
        return {
            code: 'permission_blocked',
            recoverable: true,
            userActions: ['retry'],
            message: 'Browser permission blocked the action.'
        };
    }

    if (
        codeHint === 'retrieval_empty' ||
        context?.retrievalEmpty === true ||
        /no (?:usable )?(?:sources?|results?)|retrieval.?empty|could not find enough/.test(text)
    ) {
        return {
            code: 'retrieval_empty',
            recoverable: true,
            userActions: ['retry', 'web_search'],
            message: 'Not enough live sources were found.'
        };
    }

    if (
        codeHint === 'model_empty' ||
        context?.emptyAnswer === true ||
        context?.weakAnswer === true ||
        /empty answer|model.?empty|no response|blank response/.test(text)
    ) {
        return {
            code: 'model_empty',
            recoverable: true,
            userActions: ['retry'],
            message: 'The model returned an empty or weak answer.'
        };
    }

    if (codeHint === 'transient_failure' || failureOrReason === 'transient_failure') {
        return {
            code: 'network_timeout',
            recoverable: true,
            userActions: ['retry', 'web_search'],
            message: 'Transient failure.'
        };
    }

    return {
        code: 'unknown',
        recoverable: true,
        userActions: ['retry'],
        message: 'Unexpected failure.'
    };
}

export function getFallbackFailureReason(error, context = {}) {
    const failure = classifyFailure(error, context);
    if (failure.code === 'aborted') return 'aborted';
    if (failure.code === 'network_timeout') return 'transient_failure';
    if (failure.code === 'model_empty') {
        return context?.weakAnswer === true ? 'weak_answer' : 'empty_answer';
    }
    if (failure.code === 'retrieval_empty') return 'empty_answer';
    return 'non_transient';
}

export function shouldShowFailureFallbackCard(failureOrReason, userText, context = {}) {
    const failure = classifyFailure(failureOrReason, context);
    if (!failure.recoverable || !failure.userActions.length) return false;
    const text = compactText(userText).toLowerCase();
    if (!text) return false;
    if (context.fastSimple === true || context.casual === true) return false;
    if (/\b(how are you|what'?s up|hello|hi|thanks|thank you|are you there)\b/.test(text)) return false;
    if (/\b(what do you mean|clarify|did you mean|not sure|could you provide more context)\b/.test(text)) return false;
    return ['network_timeout', 'model_empty', 'retrieval_empty', 'permission_blocked'].includes(failure.code);
}

export function buildUserFacingErrorMessage(failureOrReason, context = {}) {
    const failure = classifyFailure(failureOrReason, context);
    switch (failure.code) {
        case 'network_timeout':
            return 'The answer is taking longer than expected. You can retry, or ask a shorter follow-up.';
        case 'model_empty':
            return 'I could not generate a reliable answer for that. Please try again with a bit more detail.';
        case 'retrieval_empty':
            return 'I could not find enough current sources to answer that confidently.';
        case 'permission_blocked':
            return 'That action was blocked by browser permissions. Please allow access and try again.';
        case 'aborted':
            return '';
        default:
            return 'I hit a temporary issue while processing that. Please try again.';
    }
}

export function shouldPreservePartialStream(error, accumulated = '') {
    if (!String(accumulated || '').trim()) return false;
    const failure = classifyFailure(error);
    return failure.code !== 'aborted';
}
