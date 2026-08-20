/**
 * Unified Speech Input & Hands-Free Converse Controller.
 * Primary STT: Native Browser Web Speech API (SpeechRecognition / webkitSpeechRecognition).
 * Fallback STT: Serverless MediaRecorder -> /api/stt (Whisper Large).
 * Designed for zero main-thread blocking, continuous converse, and instant streaming.
 */

const ERROR_MESSAGES = {
    'not-allowed': 'Microphone permission was denied. Allow microphone access in your browser settings.',
    'service-not-allowed': 'Speech recognition is blocked by browser policy. Language support depends on your browser and device; try English or another language.',
    'audio-capture': 'No working microphone was found.',
    network: 'Speech recognition could not reach the recognition service. Language support depends on your browser and device; try English or another language.',
    'no-speech': 'No speech was detected. If this repeats, try English or another language.'
};

export function cleanSpeechFillers(text = '') {
    return String(text || '')
        .replace(/\b(um+|uh+|er+|ah+|erm+)\b/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

export function normalizeVoiceInputLanguage(language = '') {
    const value = String(language || '').trim();
    const supported = ['en-US', 'en-IN', 'ta-IN', 'te-IN', 'kn-IN', 'hi-IN'];
    if (supported.includes(value)) return value;
    const lower = value.toLowerCase();
    if (lower.startsWith('ta')) return 'ta-IN';
    if (lower.startsWith('te')) return 'te-IN';
    if (lower.startsWith('kn')) return 'kn-IN';
    if (lower.startsWith('hi')) return 'hi-IN';
    return 'en-US';
}

export function detectSpokenLanguage(text = '') {
    const s = String(text || '').trim();
    if (!s) return null;
    if (/[\u0B80-\u0BFF]/.test(s)) return 'ta-IN';
    if (/[\u0C00-\u0C7F]/.test(s)) return 'te-IN';
    if (/[\u0C80-\u0CFF]/.test(s)) return 'kn-IN';
    if (/[\u0900-\u097F]/.test(s)) return 'hi-IN';
    return null;
}

export function detectLanguageSwitchCommand(text = '') {
    const s = String(text || '').toLowerCase().trim();
    if (!s) return null;
    if (/\b(?:switch|change|set|speak|talk)\s+(?:in|to|(?:the\s+)?language\s+to)\s+tamil\b/i.test(s) || /தமிழில்\s+பேசு|தமிழுக்கு\s+மாற்று/i.test(s)) return 'ta-IN';
    if (/\b(?:switch|change|set|speak|talk)\s+(?:in|to|(?:the\s+)?language\s+to)\s+telugu\b/i.test(s) || /தெலுங்கில்\s+பேசு|తెలుగులో\s+మాట్లాడు/i.test(s)) return 'te-IN';
    if (/\b(?:switch|change|set|speak|talk)\s+(?:in|to|(?:the\s+)?language\s+to)\s+kannada\b/i.test(s) || /கன்னடத்தில்\s+பேசு|ಕನ್ನಡದಲ್ಲಿ\s+ಮಾತನಾಡು/i.test(s)) return 'kn-IN';
    if (/\b(?:switch|change|set|speak|talk)\s+(?:in|to|(?:the\s+)?language\s+to)\s+hindi\b/i.test(s) || /இந்தியில்\s+பேசு|हिंदी\s+में\s+बोलो/i.test(s)) return 'hi-IN';
    if (/\b(?:switch|change|set|speak|talk)\s+(?:in|to|(?:the\s+)?language\s+to)\s+english\b/i.test(s) || /ஆங்கிலத்தில்\s+பேசு|ஆங்கிலத்திற்கு\s+மாற்று/i.test(s)) return 'en-US';
    return null;
}

/**
 * Creates a clean MediaRecorder audio recorder that sends audio chunks to /api/stt.
 */
export function createWhisperRecorder(options = {}) {
    let mediaStream = null;
    let mediaRecorder = null;
    let audioChunks = [];
    let isRecording = false;

    const onTranscribed = options.onTranscribed || (() => {});
    const onError = options.onError || (() => {});
    const onState = options.onState || (() => {});

    function releaseStreamTracks() {
        if (mediaStream) {
            try {
                mediaStream.getTracks().forEach(t => t.stop());
            } catch (_) {}
            mediaStream = null;
        }
    }

    function isSupported() {
        return Boolean(typeof navigator !== 'undefined' && navigator?.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined');
    }

    async function start(language = 'en-US') {
        if (isRecording) return true;
        if (!isSupported()) {
            onError({ code: 'unsupported' });
            return false;
        }

        try {
            audioChunks = [];
            const hasLiveTracks = mediaStream && mediaStream.active && mediaStream.getAudioTracks().some(t => t.readyState === 'live');
            if (hasLiveTracks) {
                mediaStream.getAudioTracks().forEach(t => { t.enabled = true; });
            } else {
                mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            }

            const mimeTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/wav'];
            const chosenMime = mimeTypes.find(t => typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(t)) || '';

            mediaRecorder = chosenMime ? new MediaRecorder(mediaStream, { mimeType: chosenMime }) : new MediaRecorder(mediaStream);
            mediaRecorder.ondataavailable = event => {
                if (event.data && event.data.size > 0) {
                    audioChunks.push(event.data);
                }
            };

            mediaRecorder.onstop = async () => {
                isRecording = false;
                onState({ recording: false, processing: true });
                if (audioChunks.length === 0) {
                    onState({ recording: false, processing: false });
                    return;
                }

                const mime = mediaRecorder.mimeType || 'audio/webm';
                const audioBlob = new Blob(audioChunks, { type: mime });
                audioChunks = [];

                try {
                    const reader = new FileReader();
                    reader.onloadend = async () => {
                        try {
                            const base64Audio = reader.result?.split(',')[1];
                            if (!base64Audio) {
                                onState({ recording: false, processing: false });
                                return;
                            }
                            const res = await fetch('/api/stt', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ audioBase64: base64Audio, mimeType: mime, language })
                            });
                            const data = await res.json();
                            onState({ recording: false, processing: false });
                            if (data?.success && data.text) {
                                onTranscribed(data.text);
                            } else if (data?.fallbackToBrowser) {
                                onError({ code: 'fallback_to_browser', error: data.error });
                            } else {
                                onError({ code: 'transcription_empty' });
                            }
                        } catch (err) {
                            onState({ recording: false, processing: false });
                            onError({ code: 'stt_network_error', error: err });
                        }
                    };
                    reader.readAsDataURL(audioBlob);
                } catch (err) {
                    onState({ recording: false, processing: false });
                    onError({ code: 'stt_network_error', error: err });
                }
            };

            mediaRecorder.start();
            isRecording = true;
            onState({ recording: true, processing: false });
            return true;
        } catch (err) {
            isRecording = false;
            releaseStreamTracks();
            onError({ code: 'mic_permission_error', error: err });
            return false;
        }
    }

    function stop(options = {}) {
        const keepStream = options.keepStream === true;
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            try { mediaRecorder.stop(); } catch {}
        }
        if (mediaStream) {
            if (keepStream) {
                try {
                    mediaStream.getAudioTracks().forEach(t => { t.enabled = false; });
                } catch (_) {}
            } else {
                releaseStreamTracks();
            }
        }
        isRecording = false;
    }

    function cancel() {
        audioChunks = [];
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            try { mediaRecorder.stop(); } catch {}
        }
        releaseStreamTracks();
        isRecording = false;
        onState({ recording: false, processing: false });
    }

    return {
        start,
        stop,
        cancel,
        isSupported,
        isRecording: () => isRecording
    };
}

/**
 * Creates the complete Speech & Converse Controller combining native SpeechRecognition + Whisper STT.
 */
export function createSpeechInputController(options = {}) {
    const Recognition = options.Recognition || (typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null);
    const callbacks = {
        onInterim: options.onInterim || (() => {}),
        onFinal: options.onFinal || (() => {}),
        onState: options.onState || (() => {}),
        onError: options.onError || (() => {})
    };

    let mode = 'idle'; // 'idle' | 'dictation' | 'converse'
    let converseEnabled = false;
    let processing = false;
    let language = normalizeVoiceInputLanguage(options.language || 'en-US');
    let browserRecognition = null;
    let fallbackMode = false;
    let processingTimer = null;
    let restartTimer = null;
    let explicitlyStopped = false;

    const whisperRecorder = createWhisperRecorder({
        onTranscribed(text) {
            const clean = cleanSpeechFillers(text);
            if (!clean) return;
            callbacks.onFinal(clean, {
                autoSubmit: converseEnabled,
                source: converseEnabled ? 'converse' : 'vtt',
                transcriptFinal: true
            });
        },
        onError(err) {
            if (err.code === 'fallback_to_browser' || err.code === 'stt_network_error' || err.code === 'transcription_empty') {
                if ((converseEnabled || mode === 'dictation') && Recognition) {
                    fallbackMode = true;
                    startBrowserRecognition();
                }
            } else if (err.code === 'mic_permission_error') {
                if (Recognition && !fallbackMode) {
                    fallbackMode = true;
                    startBrowserRecognition();
                } else {
                    callbacks.onError(ERROR_MESSAGES['not-allowed']);
                    stop({ disableConverse: true });
                }
            }
        },
        onState() {
            emitState();
        }
    });

    function initBrowserRecognition() {
        if (!Recognition) return null;
        try {
            const r = new Recognition();
            r.continuous = converseEnabled;
            r.interimResults = true;
            r.lang = language;
            r.maxAlternatives = 1;

            let resultReceived = false;
            let sessionStartTime = Date.now();

            r.onresult = event => {
                resultReceived = true;
                if (globalThis.speechSynthesis?.speaking || globalThis.isConverseSpeechActive?.()) {
                    globalThis.stopConverseSpeech?.('barge_in');
                }
                let interim = '';
                let final = '';
                for (let i = event.resultIndex; i < event.results.length; i++) {
                    const res = event.results[i];
                    if (res.isFinal) {
                        final += res[0].transcript;
                    } else {
                        interim += res[0].transcript;
                    }
                }
                const cleanedInterim = cleanSpeechFillers(interim);
                const cleanedFinal = cleanSpeechFillers(final);

                const detectedCommandLang = detectLanguageSwitchCommand(cleanedFinal || cleanedInterim);
                const detectedScriptLang = detectSpokenLanguage(cleanedFinal || cleanedInterim);
                const targetNewLang = detectedCommandLang || detectedScriptLang;
                if (targetNewLang && targetNewLang !== language) {
                    setLanguage(targetNewLang);
                    globalThis.localStorage?.setItem?.('jarvis_voice_input_language', targetNewLang);
                    try {
                        globalThis.dispatchEvent?.(new CustomEvent('jarvis:voice-language-changed', { detail: { language: targetNewLang } }));
                    } catch (_) {}
                }

                if (cleanedInterim) callbacks.onInterim(cleanedInterim, getState());
                if (cleanedFinal) {
                    callbacks.onFinal(cleanedFinal, {
                        autoSubmit: converseEnabled,
                        source: converseEnabled ? 'converse' : 'vtt',
                        transcriptFinal: true,
                        language
                    });
                }
            };

            r.onerror = event => {
                if (explicitlyStopped || (!converseEnabled && mode !== 'dictation')) return;
                if (event.error === 'no-speech') {
                    if (converseEnabled && !processing && !globalThis.isConverseSpeechActive?.()) {
                        if (restartTimer) clearTimeout(restartTimer);
                        restartTimer = setTimeout(() => {
                            if (!explicitlyStopped && converseEnabled && !processing && !globalThis.isConverseSpeechActive?.()) {
                                startBrowserRecognition();
                            }
                        }, 200);
                    }
                    return;
                }
                if ((converseEnabled || mode === 'dictation') && !fallbackMode && whisperRecorder.isSupported()) {
                    fallbackMode = true;
                    try { r.abort?.(); } catch (_) {}
                    browserRecognition = null;
                    whisperRecorder.start(language);
                    return;
                }
                const msg = ERROR_MESSAGES[event.error] || `Recognition error: ${event.error}`;
                callbacks.onError(msg);
            };

            r.onend = () => {
                if (explicitlyStopped || (!converseEnabled && mode !== 'dictation')) {
                    browserRecognition = null;
                    emitState();
                    return;
                }

                const duration = Date.now() - sessionStartTime;
                if (!resultReceived && duration < 600 && (converseEnabled || mode === 'dictation') && !fallbackMode && whisperRecorder.isSupported()) {
                    fallbackMode = true;
                    browserRecognition = null;
                    whisperRecorder.start(language);
                    return;
                }

                if (converseEnabled && !processing && !globalThis.isConverseSpeechActive?.()) {
                    if (restartTimer) clearTimeout(restartTimer);
                    restartTimer = setTimeout(() => {
                        if (!explicitlyStopped && converseEnabled && !processing && !globalThis.isConverseSpeechActive?.()) {
                            startBrowserRecognition();
                        }
                    }, 200);
                } else {
                    if (mode === 'dictation') {
                        mode = 'idle';
                        browserRecognition = null;
                    }
                    emitState();
                }
            };

            return r;
        } catch {
            return null;
        }
    }

    function startBrowserRecognition() {
        if (explicitlyStopped && !converseEnabled && mode !== 'dictation') return;
        if (browserRecognition) {
            try {
                browserRecognition.start();
                return;
            } catch (err) {
                try { browserRecognition.abort?.(); } catch (_) {}
                browserRecognition = null;
            }
        }
        browserRecognition = initBrowserRecognition();
        if (browserRecognition) {
            try {
                browserRecognition.start();
            } catch (_) {}
        }
    }

    function getState() {
        return {
            supported: whisperRecorder.isSupported() || Boolean(Recognition),
            mode,
            converseEnabled,
            listening: whisperRecorder.isRecording() || Boolean(browserRecognition),
            processing,
            interruptible: converseEnabled && processing,
            language
        };
    }

    function emitState() {
        const state = getState();
        callbacks.onState(state);
        try {
            globalThis.dispatchEvent?.(new CustomEvent('jarvis:speech-state', { detail: state }));
        } catch {}
    }

    async function toggleDictation() {
        if (mode === 'dictation') {
            stop();
            return false;
        }
        stop();
        explicitlyStopped = false;
        mode = 'dictation';
        converseEnabled = false;

        if (Recognition) {
            fallbackMode = false;
            startBrowserRecognition();
        } else {
            const started = await whisperRecorder.start(language);
            if (!started && Recognition) {
                fallbackMode = true;
                startBrowserRecognition();
            }
        }
        emitState();
        return true;
    }

    async function start(options = {}) {
        explicitlyStopped = false;
        if (converseEnabled || options.converse) {
            mode = 'converse';
            converseEnabled = true;
        } else if (mode === 'idle') {
            mode = 'dictation';
        }

        if (Recognition) {
            fallbackMode = false;
            startBrowserRecognition();
        } else {
            const started = await whisperRecorder.start(language);
            if (!started && Recognition) {
                fallbackMode = true;
                startBrowserRecognition();
            }
        }
        emitState();
        return true;
    }

    async function toggleConverse() {
        if (converseEnabled) {
            stop({ disableConverse: true });
            return false;
        }
        return await start({ converse: true });
    }

    function setProcessing(isProc) {
        if (processingTimer) {
            clearTimeout(processingTimer);
            processingTimer = null;
        }
        if (restartTimer) {
            clearTimeout(restartTimer);
            restartTimer = null;
        }
        processing = Boolean(isProc);
        if (processing) {
            // Auto-release processing lock after 20s safety threshold to prevent permanent DOM locking
            processingTimer = setTimeout(() => {
                setProcessing(false);
            }, 20000);
            whisperRecorder.stop({ keepStream: true });
            if (browserRecognition) {
                const rec = browserRecognition;
                browserRecognition = null;
                try { rec.stop(); } catch {}
            }
        } else if (converseEnabled && !explicitlyStopped) {
            if (restartTimer) clearTimeout(restartTimer);
            restartTimer = setTimeout(() => {
                if (converseEnabled && !processing && !globalThis.isConverseSpeechActive?.()) {
                    if (Recognition && !fallbackMode) {
                        startBrowserRecognition();
                    } else {
                        whisperRecorder.start(language);
                    }
                }
            }, 250);
        }
        if (typeof document !== 'undefined' && document.body) {
            document.body.classList.toggle('is-processing', processing);
        }
        emitState();
    }

    function stop(options = {}) {
        explicitlyStopped = true;
        if (processingTimer) {
            clearTimeout(processingTimer);
            processingTimer = null;
        }
        if (restartTimer) {
            clearTimeout(restartTimer);
            restartTimer = null;
        }
        if (options.disableConverse) {
            converseEnabled = false;
            mode = 'idle';
            if (processing) {
                processing = false;
                if (typeof document !== 'undefined' && document.body) {
                    document.body.classList.toggle('is-processing', false);
                }
            }
        } else if (mode === 'dictation') {
            mode = 'idle';
        }

        const keepStream = options.keepStream === true && !options.disableConverse;
        whisperRecorder.stop({ keepStream });

        if (browserRecognition) {
            const rec = browserRecognition;
            browserRecognition = null;
            try { rec.stop(); } catch {}
        }
        emitState();
    }

    function setLanguage(lang) {
        language = normalizeVoiceInputLanguage(lang);
        if (browserRecognition) browserRecognition.lang = language;
        return language;
    }

    return {
        getState,
        setLanguage,
        start,
        toggleDictation,
        toggleConverse,
        setProcessing,
        stop
    };
}

/**
 * Attaches the speech input controller to DOM UI elements.
 */
export function installSpeechInputUI(options = {}) {
    const input = document.getElementById('text-input');
    const vttButton = document.getElementById('voice-to-text-btn');
    const status = document.getElementById('speech-input-status');
    if (!input || !vttButton) return null;

    const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
    let committedText = '';
    let lastInterimText = '';

    input.addEventListener('input', () => {
        delete input.dataset.inputSource;
        const currentVal = input.value;
        if (lastInterimText && currentVal.endsWith(lastInterimText)) {
            committedText = currentVal.slice(0, currentVal.length - lastInterimText.length).trim();
        } else {
            committedText = currentVal.trim();
            lastInterimText = '';
        }
    });

    globalThis.resetSpeechInputCommittedText = () => {
        committedText = '';
        lastInterimText = '';
    };

    function setStatusText(message = '') {
        if (!status) return;
        status.classList.remove('speech-listening-status');
        status.textContent = message;
    }

    function setListeningStatus() {
        if (!status) return;
        status.classList.add('speech-listening-status');
        status.innerHTML = 'Listening<span class="speech-listening-dots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span>';
    }

    const savedLanguage = globalThis.localStorage?.getItem?.('jarvis_voice_input_language');
    const controller = createSpeechInputController({
        Recognition,
        language: savedLanguage || navigator.language || 'en-US',
        onInterim(text, state) {
            const cleaned = cleanSpeechFillers(text);
            lastInterimText = cleaned;
            input.value = [committedText, cleaned].filter(Boolean).join(' ').trim();
            if (state?.mode === 'dictation' && state.listening && status) {
                if (cleaned) setStatusText('Listening');
                else setListeningStatus();
            }
            if (state?.converseEnabled) {
                globalThis.updateLiveConverseOverlay?.(state.processing ? 'thinking' : 'listening', cleaned, true);
            }
            options.onComposerChanged?.();
        },
        async onFinal(text, event) {
            lastInterimText = '';
            const cleaned = cleanSpeechFillers(text);
            if (event.autoSubmit) {
                committedText = '';
                input.value = cleaned;
                input.dataset.inputSource = 'converse';
                globalThis.updateLiveConverseOverlay?.('thinking', cleaned, false);
                options.onComposerChanged?.();
                await options.onSubmit?.({
                    source: 'converse',
                    preserveTranscript: true,
                    interrupt: event.interrupt === true
                });
            } else {
                committedText = [committedText, cleaned].filter(Boolean).join(' ').trim();
                input.value = committedText;
                input.dataset.inputSource = 'vtt';
                options.onComposerChanged?.();
                input.focus();
            }
        },
        onState(state) {
            if (!state.listening) {
                lastInterimText = '';
            }
            vttButton.classList.toggle('is-listening', state.mode === 'dictation' && state.listening);
            vttButton.setAttribute('aria-pressed', state.mode === 'dictation' && state.listening ? 'true' : 'false');
            input.placeholder = state.converseEnabled
                ? (state.processing ? 'Thinking...' : 'Listening (speak now)...')
                : (state.mode === 'dictation' && state.listening ? 'Listening...' : 'Ask anything...');
            if (status) {
                if (!state.supported) {
                    setStatusText('Voice input unavailable in this browser.');
                } else if (state.converseEnabled) {
                    setStatusText(state.processing ? 'Thinking...' : 'Listening...');
                } else if (state.mode === 'dictation' && state.listening) {
                    setListeningStatus();
                } else {
                    setStatusText('');
                }
            }
            globalThis.updateLiveConverseOverlay?.(state.processing ? 'thinking' : (state.listening ? 'listening' : 'idle'));
            options.onStateChanged?.(state);
            globalThis.updateComposerPlaceholder?.();
        },
        onError(message) {
            lastInterimText = '';
            setStatusText(message);
            options.onError?.(message);
        }
    });

    globalThis.toggleVoiceToText = () => {
        committedText = input.value.trim();
        lastInterimText = '';
        return controller.toggleDictation();
    };

    const rawToggleConverse = typeof controller?.toggleConverse === 'function' ? controller.toggleConverse.bind(controller) : async () => false;
    globalThis.toggleConverseMode = async () => {
        const wasConverseEnabled = controller.getState().converseEnabled;
        committedText = '';
        lastInterimText = '';
        input.value = '';
        delete input.dataset.inputSource;
        options.onComposerChanged?.();
        const toggled = await rawToggleConverse();
        if (wasConverseEnabled) {
            globalThis.stopActiveGeneration?.('converse_stop');
            if (globalThis.speechSynthesis?.speaking) {
                try { globalThis.speechSynthesis.cancel(); } catch {}
            }
        }
        return toggled;
    };

    globalThis.JarvisSpeechInput = controller;
    globalThis.JarvisSpeechInput.toggleConverse = globalThis.toggleConverseMode;
    globalThis.JarvisSpeechInput.resetCommittedText = globalThis.resetSpeechInputCommittedText;
    globalThis.syncVttUiState = () => controller.getState();
    globalThis.setVoiceInputLanguage = language => controller.setLanguage(language);

    vttButton.addEventListener('click', globalThis.toggleVoiceToText);
    globalThis.addEventListener('jarvis:assistant-processing', event => {
        controller.setProcessing(Boolean(event.detail?.active));
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && controller.getState().listening) {
            controller.stop({ disableConverse: true });
        }
    });

    return controller;
}
