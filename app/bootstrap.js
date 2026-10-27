import { createConversationEngine } from './context-engine.js?v=2.0.5';
import { ApiError, postJson } from './api-client.js?v=2.0.5';
import { createApplicationState } from './state.js?v=2.0.5';
import { createSafeStorage } from './storage.js?v=2.0.5';
import { installSpeechInputUI } from './speech-input.js?v=2.0.5';
import * as JarvisFrontendRouting from './frontend-routing.js?v=2.0.5';
import * as JarvisFailurePolicy from './failure-policy.js?v=2.0.5';
import * as JarvisPlaceGrounding from './place-grounding.js?v=2.0.5';
import * as JarvisObservability from './observability.js?v=2.0.5';
import * as JarvisSessionRecovery from './session-recovery.js?v=2.0.5';
import * as JarvisInstantReplies from './instant-replies.js?v=2.0.5';
import * as JarvisSourceTransparency from './source-transparency.js?v=2.0.5';
import * as JarvisContextCopilotUi from './context-copilot-ui.js?v=2.0.5';
import * as JarvisMemoryQuality from './memory-quality.js?v=2.0.5';
import * as JarvisAttachments from './attachments.js?v=2.0.5';
import * as JarvisAgentWorkflows from './agent-workflows.js?v=2.0.5';
import JarvisDataVerification from './data-tracking-verification.js?v=2.0.5';
import * as JarvisToolDispatcher from './tool-dispatcher.js?v=2.0.5';
import { highlightCode, normalizeLang } from './code-highlighter.js?v=2.0.5';
import { renderMathInText, formatLatexExpression } from './math-renderer.js?v=2.0.5';
import { renderMarkdown } from './markdown-renderer.js?v=2.0.5';
import * as JarvisAgentOrchestrator from './agent-orchestrator.js?v=2.0.5';
import * as JarvisLocationSuite from './location-suite.js?v=2.0.5';
import * as JarvisEmergencySOS from './emergency-sos.js?v=2.0.5';
import * as JarvisImageConfig from './image-generation-config.js?v=2.0.5';
import * as JarvisImageStorage from './image-storage.js?v=2.0.5';
import * as JarvisImageGenerator from './image-generator.js?v=2.0.5';
import { selfImprovingMemory } from './self-improving-memory.js?v=2.0.5';
import * as JarvisLiveResearch from './bounded-live-research.js?v=2.0.5';
import * as JarvisQueryNormalizer from './query-normalizer.js?v=2.0.5';
import * as JarvisUnifiedMemory from './unified-memory.js?v=2.0.5';
import * as JarvisDocumentExporter from './document-exporter.js?v=2.0.5';
import * as JarvisDlpGateway from './dlp-gateway.js?v=2.0.5';
import * as JarvisDlpEngine from './dlp-engine.js?v=2.0.5';

import { createInteractionStateMachine, InteractionState } from './interaction-state.js?v=2.0.5';

const engine = createConversationEngine({
    maxTurns: 30,
    maxTurnHistory: 200,
    maxContextChars: 16000,
    maxThreads: 8
});

globalThis.InteractionState = InteractionState;
globalThis.JarvisInteractionState = createInteractionStateMachine();
globalThis.JarvisConversation = engine;
globalThis.JarvisApi = Object.freeze({ ApiError, postJson });
globalThis.JarvisState = createApplicationState();
globalThis.JarvisStorage = createSafeStorage();
globalThis.JarvisFrontendRouting = Object.freeze({ ...JarvisFrontendRouting });
globalThis.JarvisFailurePolicy = Object.freeze({ ...JarvisFailurePolicy });
globalThis.JarvisPlaceGrounding = Object.freeze({ ...JarvisPlaceGrounding });
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
globalThis.JarvisAgentOrchestrator = Object.freeze({ ...JarvisAgentOrchestrator });
globalThis.JarvisLocationSuite = Object.freeze({ ...JarvisLocationSuite });
globalThis.JarvisEmergencySOS = Object.freeze({ ...JarvisEmergencySOS });
globalThis.JarvisImageConfig = Object.freeze({ ...JarvisImageConfig });
globalThis.JarvisImageStorage = Object.freeze({ ...JarvisImageStorage });
globalThis.JarvisImageGenerator = Object.freeze({ ...JarvisImageGenerator });
globalThis.JarvisSelfImprovingMemory = selfImprovingMemory;
globalThis.JarvisLiveResearch = { ...JarvisLiveResearch, ...(globalThis.JarvisLiveResearch || {}) };
globalThis.JarvisQueryNormalizer = Object.freeze({ ...JarvisQueryNormalizer });
globalThis.normalizeUserQuery = JarvisQueryNormalizer.normalizeUserQuery;
globalThis.hasSearchableContent = JarvisQueryNormalizer.hasSearchableContent;
globalThis.JarvisUnifiedMemory = JarvisUnifiedMemory;
globalThis.JarvisDocumentExporter = JarvisDocumentExporter;
globalThis.JarvisDlp = Object.freeze({ ...JarvisDlpGateway, ...JarvisDlpEngine });
try {
    JarvisUnifiedMemory.unifiedMemoryStore?.runIdempotentMigration();
} catch (_) {}
selfImprovingMemory.init().catch(() => {});

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
