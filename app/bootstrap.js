import { createConversationEngine } from './context-engine.js';
import { ApiError, postJson } from './api-client.js';
import { createApplicationState } from './state.js';
import { createSafeStorage } from './storage.js';
import { installSpeechInputUI } from './speech-input.js';
import * as JarvisFrontendRouting from './frontend-routing.js';
import * as JarvisFailurePolicy from './failure-policy.js';
import * as JarvisPlaceGrounding from './place-grounding.js';
import * as JarvisConverseState from './converse-state.js';
import * as JarvisObservability from './observability.js';
import * as JarvisSessionRecovery from './session-recovery.js';
import * as JarvisInstantReplies from './instant-replies.js';
import * as JarvisSourceTransparency from './source-transparency.js';
import * as JarvisContextCopilotUi from './context-copilot-ui.js';
import * as JarvisMemoryQuality from './memory-quality.js';
import * as JarvisAttachments from './attachments.js';
import * as JarvisAgentWorkflows from './agent-workflows.js';
import JarvisDataVerification from './data-tracking-verification.js';
import * as JarvisToolDispatcher from './tool-dispatcher.js';

const engine = createConversationEngine({
    maxTurns: 12,
    maxContextChars: 9000,
    maxThreads: 8
});

globalThis.JarvisConversation = engine;
globalThis.JarvisApi = Object.freeze({ ApiError, postJson });
globalThis.JarvisState = createApplicationState();
globalThis.JarvisStorage = createSafeStorage();
globalThis.JarvisFrontendRouting = Object.freeze({ ...JarvisFrontendRouting });
globalThis.JarvisFailurePolicy = Object.freeze({ ...JarvisFailurePolicy });
globalThis.JarvisPlaceGrounding = Object.freeze({ ...JarvisPlaceGrounding });
globalThis.JarvisConverseState = Object.freeze({ ...JarvisConverseState });
globalThis.JarvisObservability = Object.freeze({ ...JarvisObservability });
globalThis.JarvisSessionRecovery = Object.freeze({ ...JarvisSessionRecovery });
globalThis.JarvisInstantReplies = Object.freeze({ ...JarvisInstantReplies });
globalThis.JarvisSourceTransparency = Object.freeze({ ...JarvisSourceTransparency });
globalThis.JarvisContextCopilotUi = Object.freeze({ ...JarvisContextCopilotUi });
globalThis.JarvisMemoryQuality = Object.freeze({ ...JarvisMemoryQuality });
globalThis.JarvisAttachments = Object.freeze({ ...JarvisAttachments });
globalThis.JarvisAgentWorkflows = Object.freeze({ ...JarvisAgentWorkflows });
globalThis.JarvisDataVerification = Object.freeze({ ...JarvisDataVerification });
globalThis.JarvisToolDispatcher = Object.freeze({ ...JarvisToolDispatcher });

function initializeSpeechInput() {
    if (globalThis.__jarvisSpeechInputInstalled) return;
    const controller = installSpeechInputUI({
        onComposerChanged() {
            globalThis.handleComposerInput?.();
        },
        onStateChanged() {
            globalThis.toggleSendButton?.();
        },
        async onSubmit(submission) {
            return globalThis.sendTextInput?.(submission);
        },
        onError(message) {
            globalThis.showTemporaryMessage?.(message);
        }
    });
    if (controller) {
        globalThis.__jarvisSpeechInputInstalled = true;
    }
}

if (globalThis.__jarvisAppReady || document.readyState !== 'loading') {
    initializeSpeechInput();
} else {
    globalThis.addEventListener('jarvis:app-ready', initializeSpeechInput, { once: true });
    document.addEventListener('DOMContentLoaded', initializeSpeechInput, { once: true });
}
window.addEventListener('load', initializeSpeechInput, { once: true });

globalThis.dispatchEvent(new CustomEvent('jarvis:modules-ready'));
