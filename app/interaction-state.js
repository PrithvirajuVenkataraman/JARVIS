/**
 * Authoritative Interaction State Machine for JARVIS
 * Replaces scattered booleans with a single source of truth for the request & voice lifecycle.
 */

export const InteractionState = Object.freeze({
    IDLE: 'IDLE',
    LISTENING: 'LISTENING',
    TRANSCRIBING: 'TRANSCRIBING',
    SUBMITTING: 'SUBMITTING',
    ROUTING: 'ROUTING',
    ANALYZING: 'ANALYZING',
    THINKING: 'THINKING',
    SEARCHING: 'SEARCHING',
    GENERATING: 'GENERATING',
    SPEAKING: 'SPEAKING',
    INTERRUPTED: 'INTERRUPTED',
    CANCELLED: 'CANCELLED',
    ERROR: 'ERROR'
});

export function getInteractionStateLabel(state) {
    switch (state) {
        case InteractionState.LISTENING:
            return 'Listening...';
        case InteractionState.TRANSCRIBING:
            return 'Transcribing...';
        case InteractionState.ROUTING:
        case InteractionState.ANALYZING:
        case InteractionState.THINKING:
            return 'Analyzing...';
        case InteractionState.SEARCHING:
            return 'Searching...';
        case InteractionState.GENERATING:
            return 'Generating...';
        case InteractionState.SPEAKING:
            return 'Speaking...';
        default:
            return '';
    }
}

const DEFAULT_STATE_WATCHDOG_MS = 35000;
const SPEAKING_WATCHDOG_MS = 25000;

export function createInteractionStateMachine(options = {}) {
    const watchdogMs = Number(options.watchdogMs) || DEFAULT_STATE_WATCHDOG_MS;
    const listeners = new Set();
    let watchdogTimer = null;
    let requestSequence = 0;

    const stateRecord = {
        state: InteractionState.IDLE,
        previousState: null,
        requestId: null,
        turnId: null,
        startedAt: null,
        updatedAt: Date.now(),
        metadata: {},
        error: null
    };

    function clearWatchdog() {
        if (watchdogTimer) {
            clearTimeout(watchdogTimer);
            watchdogTimer = null;
        }
    }

    function scheduleWatchdog(currentState, reqId) {
        clearWatchdog();
        // IDLE, INTERRUPTED, CANCELLED do not require an active execution timeout
        if ([InteractionState.IDLE, InteractionState.CANCELLED, InteractionState.INTERRUPTED].includes(currentState)) {
            return;
        }

        const timeout = currentState === InteractionState.SPEAKING ? SPEAKING_WATCHDOG_MS : watchdogMs;
        watchdogTimer = setTimeout(() => {
            if (stateRecord.state === currentState && stateRecord.requestId === reqId) {
                console.warn(`[InteractionState] Watchdog timeout in state "${currentState}" for request "${reqId}". Forcing reset to IDLE.`);
                resetToIdle('watchdog_timeout');
            }
        }, timeout);
        if (typeof watchdogTimer?.unref === 'function') {
            watchdogTimer.unref();
        }
    }

    function isBusy() {
        return [
            InteractionState.TRANSCRIBING,
            InteractionState.SUBMITTING,
            InteractionState.ROUTING,
            InteractionState.ANALYZING,
            InteractionState.THINKING,
            InteractionState.SEARCHING,
            InteractionState.GENERATING,
            InteractionState.SPEAKING
        ].includes(stateRecord.state);
    }

    function isProcessing() {
        return [
            InteractionState.TRANSCRIBING,
            InteractionState.SUBMITTING,
            InteractionState.ROUTING,
            InteractionState.ANALYZING,
            InteractionState.THINKING,
            InteractionState.SEARCHING,
            InteractionState.GENERATING
        ].includes(stateRecord.state);
    }

    function isListening() {
        return stateRecord.state === InteractionState.LISTENING;
    }

    function isSpeaking() {
        return stateRecord.state === InteractionState.SPEAKING;
    }

    function isCurrentRequest(reqId) {
        if (!reqId || !stateRecord.requestId) return true;
        return stateRecord.requestId === reqId;
    }

    function createRequestId(prefix = 'req') {
        requestSequence += 1;
        return `${prefix}_${Date.now().toString(36)}_${requestSequence}_${Math.random().toString(36).slice(2, 6)}`;
    }

    function transition(nextState, context = {}) {
        if (!InteractionState[nextState]) {
            console.warn(`[InteractionState] Unknown interaction state: ${nextState}`);
            return stateRecord.state;
        }

        const prev = stateRecord.state;
        const now = Date.now();

        // Assign or inherit requestId / turnId
        if (context.requestId) {
            stateRecord.requestId = context.requestId;
        } else if (nextState === InteractionState.IDLE) {
            stateRecord.requestId = null;
        }

        if (context.turnId !== undefined) {
            stateRecord.turnId = context.turnId;
        } else if (nextState === InteractionState.IDLE) {
            stateRecord.turnId = null;
        }

        stateRecord.previousState = prev;
        stateRecord.state = nextState;
        stateRecord.updatedAt = now;
        stateRecord.error = context.error || null;
        stateRecord.metadata = { ...(context.metadata || {}) };

        if (!stateRecord.startedAt || prev === InteractionState.IDLE) {
            stateRecord.startedAt = now;
        }
        if (nextState === InteractionState.IDLE) {
            stateRecord.startedAt = null;
        }

        scheduleWatchdog(nextState, stateRecord.requestId);

        const snapshot = getSnapshot();

        // Notify subscribers
        for (const listener of listeners) {
            try {
                listener(nextState, snapshot);
            } catch (err) {
                console.error('[InteractionState] Listener error:', err);
            }
        }

        // Emit standard DOM CustomEvents
        const target = options.windowRef || (typeof globalThis !== 'undefined' ? globalThis : null);
        if (target && typeof target.dispatchEvent === 'function') {
            try {
                const EventConstructor = typeof CustomEvent === 'function'
                    ? CustomEvent
                    : class {
                        constructor(type, params = {}) {
                            this.type = type;
                            this.detail = params.detail;
                        }
                    };

                target.dispatchEvent(new EventConstructor('jarvis:interaction-state', {
                    detail: snapshot
                }));

                // Maintain backward compatibility with existing listeners
                target.dispatchEvent(new EventConstructor('jarvis:assistant-processing', {
                    detail: {
                        active: isProcessing(),
                        depth: isProcessing() ? 1 : 0
                    }
                }));
            } catch (_) {}
        }

        return nextState;
    }

    function resetToIdle(reason = 'manual_reset') {
        if (stateRecord.state === InteractionState.SPEAKING && reason === 'send_complete') {
            return stateRecord.state;
        }
        clearWatchdog();
        return transition(InteractionState.IDLE, {
            metadata: { reason }
        });
    }

    function addStateListener(listener) {
        if (typeof listener === 'function') {
            listeners.add(listener);
            return () => listeners.delete(listener);
        }
        return () => {};
    }

    function getSnapshot() {
        return {
            state: stateRecord.state,
            previousState: stateRecord.previousState,
            requestId: stateRecord.requestId,
            turnId: stateRecord.turnId,
            startedAt: stateRecord.startedAt,
            updatedAt: stateRecord.updatedAt,
            metadata: { ...stateRecord.metadata },
            error: stateRecord.error,
            isBusy: isBusy(),
            isProcessing: isProcessing(),
            isListening: isListening(),
            isSpeaking: isSpeaking()
        };
    }

    return {
        get state() {
            return stateRecord.state;
        },
        getState() {
            return stateRecord.state;
        },
        getSnapshot,
        getRequestId() {
            return stateRecord.requestId;
        },
        isBusy,
        isProcessing,
        isListening,
        isSpeaking,
        isCurrentRequest,
        createRequestId,
        transition,
        resetToIdle,
        addStateListener,
        subscribe: addStateListener
    };
}
