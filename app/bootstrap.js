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
import { highlightCode, normalizeLang } from './code-highlighter.js';
import { renderMathInText, formatLatexExpression } from './math-renderer.js';
import { renderMarkdown } from './markdown-renderer.js';

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
globalThis.JarvisCodeHighlighter = Object.freeze({ highlightCode, normalizeLang });
globalThis.JarvisMathRenderer = Object.freeze({ renderMathInText, formatLatexExpression });
globalThis.JarvisMarkdownRenderer = Object.freeze({ renderMarkdown });

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

globalThis.initializeSpeechInput = initializeSpeechInput;

if (typeof document !== 'undefined') {
    if (globalThis.__jarvisAppReady || document.readyState !== 'loading') {
        initializeSpeechInput();
    } else {
        globalThis.addEventListener?.('jarvis:app-ready', initializeSpeechInput, { once: true });
        document.addEventListener?.('DOMContentLoaded', initializeSpeechInput, { once: true });
    }
    if (typeof window !== 'undefined') {
        window.addEventListener?.('load', initializeSpeechInput, { once: true });
    }
} else {
    initializeSpeechInput();
}

globalThis.dispatchEvent(new CustomEvent('jarvis:modules-ready'));
