import { evaluateTurnCompleteness, normalizeConverseState } from './converse-state.js';

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
    let s = String(text || '').trim();
    if (!s) return '';

    // 1. Remove verbal fillers & hesitations (e.g. "um", "uh", "umm", "uhh", "er", "erm", "ah", "ahh", "hmm", "hm")
    s = s.replace(/\b(?:um+|uh+|er+|ah+|erm+|hmm+|hm+)\b/gi, '');

    // 2. Remove filler phrases when surrounded by boundaries or at start/end
    s = s.replace(/\b(?:you know|i mean|sort of|kind of)\b/gi, '');
    s = s.replace(/^(?:like|basically|literally)[,\s]+/gi, '');
    s = s.replace(/[,\s]+(?:like|basically|literally)[,\s]+/gi, ' ');
    s = s.replace(/[,\s]+(?:like|basically|literally)$/gi, '');

    // 3. Remove speech stutter / immediate duplicate words (e.g. "the the", "I I", "to to")
    s = s.replace(/\b([a-zA-Z]+)\s+\1\b/gi, '$1');
    s = s.replace(/\b([a-zA-Z]+)\s+\1\b/gi, '$1');

    // 4. Auto-correct common speech-to-text contractions, pronouns & slips
    const autoCorrectMap = [
        [/\bi\b/g, 'I'],
        [/\bi'm\b/gi, "I'm"],
        [/\bi'll\b/gi, "I'll"],
        [/\bi'd\b/gi, "I'd"],
        [/\bi've\b/gi, "I've"],
        [/\bim\b/gi, "I'm"],
        [/\bive\b/gi, "I've"],
        [/\bill\b/gi, "I'll"],
        [/\bid\b/g, "I'd"],
        [/\bdont\b/gi, "don't"],
        [/\bcant\b/gi, "can't"],
        [/\bwont\b/gi, "won't"],
        [/\bdidnt\b/gi, "didn't"],
        [/\bdoesnt\b/gi, "doesn't"],
        [/\bisnt\b/gi, "isn't"],
        [/\barent\b/gi, "aren't"],
        [/\bwasnt\b/gi, "wasn't"],
        [/\bwerent\b/gi, "weren't"],
        [/\bhavent\b/gi, "haven't"],
        [/\bhasnt\b/gi, "hasn't"],
        [/\bhadnt\b/gi, "hadn't"],
        [/\bcouldnt\b/gi, "couldn't"],
        [/\bshouldnt\b/gi, "shouldn't"],
        [/\bwouldnt\b/gi, "wouldn't"],
        [/\bwhats\b/gi, "what's"],
        [/\bhows\b/gi, "how's"],
        [/\bwheres\b/gi, "where's"],
        [/\bwhos\b/gi, "who's"],
        [/\bthats\b/gi, "that's"],
        [/\btheres\b/gi, "there's"],
        [/\bheres\b/gi, "here's"],
        [/\blets\b/gi, "let's"]
    ];

    for (const [pattern, replacement] of autoCorrectMap) {
        s = s.replace(pattern, replacement);
    }

    // 5. Clean punctuation spacing (e.g. "word , next" -> "word, next")
    s = s.replace(/\s+([,.:;?!])/g, '$1');
    s = s.replace(/([,.:;?!])(?=[^\s\d])/g, '$1 ');

    // 6. Sentence capitalization
    s = s.replace(/(^\s*|[.!?]\s+)([a-z])/g, (_, prefix, letter) => prefix + letter.toUpperCase());

    // 7. Clean excessive whitespace
    s = s.replace(/\s{2,}/g, ' ').trim();

    return s;
}

export function normalizeVoiceInputLanguage(language = '') {
    return 'en-US';
}

export function detectSpokenLanguage(text = '') {
    return 'en-US';
}

export function detectLanguageSwitchCommand(text = '') {
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
    let audioCtx = null;
    let analyser = null;
    let silenceTimer = null;
    let speechDetected = false;
    let volumeMonitorInterval = null;

    const onTranscribed = options.onTranscribed || (() => {});
    const onError = options.onError || (() => {});
    const onState = options.onState || (() => {});

    function releaseStreamTracks() {
        if (volumeMonitorInterval) {
            clearInterval(volumeMonitorInterval);
            volumeMonitorInterval = null;
        }
        if (silenceTimer) {
            clearTimeout(silenceTimer);
            silenceTimer = null;
        }
        if (audioCtx) {
            try { audioCtx.close(); } catch (_) {}
            audioCtx = null;
            analyser = null;
        }
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

    function setupAudioAnalyser(stream) {
        try {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextClass) return;
            audioCtx = new AudioContextClass();
            analyser = audioCtx.createAnalyser();
            analyser.fftSize = 256;
            const source = audioCtx.createMediaStreamSource(stream);
            source.connect(analyser);

            const buffer = new Uint8Array(analyser.frequencyBinCount);
            speechDetected = false;

            volumeMonitorInterval = setInterval(() => {
                if (!isRecording || !analyser) return;
                analyser.getByteFrequencyData(buffer);
                let sum = 0;
                for (let i = 0; i < buffer.length; i++) sum += buffer[i];
                const avgVolume = sum / buffer.length;

                // Barge-in check: if user speaks while assistant is speaking, halt speech
                if (avgVolume > 14) {
                    if (globalThis.speechSynthesis?.speaking || globalThis.isConverseSpeechActive?.()) {
                        try { globalThis.speechSynthesis?.cancel?.(); } catch (_) {}
                        globalThis.stopConverseSpeech?.('barge_in');
                        globalThis.stopActiveGeneration?.('barge_in');
                    }
                    speechDetected = true;
                    if (silenceTimer) {
                        clearTimeout(silenceTimer);
                        silenceTimer = null;
                    }
                } else if (speechDetected && avgVolume <= 8) {
                    // Speech was occurring, now silence detected -> natural pause
                    if (!silenceTimer) {
                        silenceTimer = setTimeout(() => {
                            silenceTimer = null;
                            speechDetected = false;
                            if (isRecording && mediaRecorder && mediaRecorder.state === 'recording') {
                                try { mediaRecorder.stop(); } catch (_) {}
                            }
                        }, 850);
                    }
                }
            }, 60);
        } catch (_) {}
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
                mediaStream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true
                    }
                });
            }

            setupAudioAnalyser(mediaStream);

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
                if (volumeMonitorInterval) {
                    clearInterval(volumeMonitorInterval);
                    volumeMonitorInterval = null;
                }
                if (silenceTimer) {
                    clearTimeout(silenceTimer);
                    silenceTimer = null;
                }

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
        if (volumeMonitorInterval) {
            clearInterval(volumeMonitorInterval);
            volumeMonitorInterval = null;
        }
        if (silenceTimer) {
            clearTimeout(silenceTimer);
            silenceTimer = null;
        }
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
        if (volumeMonitorInterval) {
            clearInterval(volumeMonitorInterval);
            volumeMonitorInterval = null;
        }
        if (silenceTimer) {
            clearTimeout(silenceTimer);
            silenceTimer = null;
        }
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
    let adaptiveTurnTimer = null;
    let accumulatedTranscript = '';
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
                    fallbackMode = false;
                    startBrowserRecognition();
                    return;
                }
            }
            if (err.code === 'mic_permission_error') {
                callbacks.onError(ERROR_MESSAGES['not-allowed']);
                stop({ disableConverse: true });
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

            r.onresult = event => {
                const isSpeaking = Boolean(globalThis.speechSynthesis?.speaking || globalThis.isConverseSpeechActive?.());
                if (isSpeaking || processing) {
                    if (globalThis.speechSynthesis?.speaking) {
                        try { globalThis.speechSynthesis.cancel(); } catch (_) {}
                    }
                    globalThis.stopConverseSpeech?.('barge_in');
                    globalThis.stopActiveGeneration?.('converse_interruption');
                    processing = false;
                    if (adaptiveTurnTimer) {
                        clearTimeout(adaptiveTurnTimer);
                        adaptiveTurnTimer = null;
                    }
                }

                let currentInterim = '';
                let currentFinal = '';
                for (let i = event.resultIndex; i < event.results.length; i++) {
                    const res = event.results[i];
                    if (res.isFinal) {
                        currentFinal += res[0].transcript + ' ';
                    } else {
                        currentInterim += res[0].transcript;
                    }
                }

                if (currentFinal) {
                    accumulatedTranscript = (accumulatedTranscript ? (accumulatedTranscript + ' ' + currentFinal) : currentFinal).trim();
                }

                const liveCandidate = (accumulatedTranscript ? (accumulatedTranscript + ' ' + currentInterim) : currentInterim).trim();
                const cleanedInterim = cleanSpeechFillers(liveCandidate);

                if (cleanedInterim) {
                    callbacks.onInterim(cleanedInterim, getState());
                }

                if (adaptiveTurnTimer) {
                    clearTimeout(adaptiveTurnTimer);
                    adaptiveTurnTimer = null;
                }

                const evalResult = evaluateTurnCompleteness(liveCandidate, {
                    completeTimeoutMs: options.completeTimeoutMs || 800,
                    normalTimeoutMs: options.normalTimeoutMs || 1200,
                    incompleteTimeoutMs: options.incompleteTimeoutMs || 1800
                });

                if (currentFinal && !converseEnabled && mode === 'dictation' && !options.adaptiveDictation) {
                    const cleanedFinal = cleanSpeechFillers(accumulatedTranscript || currentFinal);
                    accumulatedTranscript = '';
                    if (cleanedFinal) {
                        callbacks.onFinal(cleanedFinal, {
                            autoSubmit: false,
                            source: 'vtt',
                            transcriptFinal: true,
                            interrupt: false
                        });
                    }
                    return;
                }

                if (converseEnabled || mode === 'dictation') {
                    adaptiveTurnTimer = setTimeout(() => {
                        const targetText = accumulatedTranscript || liveCandidate;
                        const cleanedFinal = cleanSpeechFillers(targetText);
                        accumulatedTranscript = '';
                        if (cleanedFinal) {
                            callbacks.onFinal(cleanedFinal, {
                                autoSubmit: converseEnabled,
                                source: converseEnabled ? 'converse' : 'vtt',
                                transcriptFinal: true,
                                interrupt: false
                            });
                        }
                    }, evalResult.recommendedTimeoutMs);
                }
            };

            r.onerror = event => {
                if (explicitlyStopped) return;
                if (event.error === 'no-speech') return;
                
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

                if (converseEnabled && !processing && !globalThis.isConverseSpeechActive?.()) {
                    if (restartTimer) clearTimeout(restartTimer);
                    restartTimer = setTimeout(() => {
                        if (!explicitlyStopped && converseEnabled && !processing && !globalThis.isConverseSpeechActive?.()) {
                            startBrowserRecognition();
                        }
                    }, 150);
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
            try { browserRecognition.abort(); } catch (_) {}
            browserRecognition = null;
        }
        browserRecognition = initBrowserRecognition();
        if (browserRecognition) {
            try {
                browserRecognition.start();
            } catch (err) {
                browserRecognition = null;
                if (whisperRecorder.isSupported() && !fallbackMode) {
                    fallbackMode = true;
                    whisperRecorder.start(language);
                } else {
                    callbacks.onError('Microphone access is needed for Converse Mode.');
                }
            }
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
    }

    function setLanguage(lang) {
        language = normalizeVoiceInputLanguage(lang);
        if (browserRecognition) {
            browserRecognition.lang = language;
        }
        emitState();
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

        // Pure Whisper STT Priority: use Whisper backend directly for accurate English speech capture
        if (whisperRecorder.isSupported()) {
            fallbackMode = false;
            const started = await whisperRecorder.start(language);
            if (!started && Recognition) {
                fallbackMode = true;
                startBrowserRecognition();
            }
        } else if (Recognition) {
            startBrowserRecognition();
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
        if (adaptiveTurnTimer) {
            clearTimeout(adaptiveTurnTimer);
            adaptiveTurnTimer = null;
        }
        accumulatedTranscript = '';
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
            }, 200);
        }
        if (typeof document !== 'undefined' && document.body) {
            document.body.classList.toggle('is-processing', processing);
        }
        emitState();
    }

    function resumeListening() {
        if (!converseEnabled || explicitlyStopped) return false;
        processing = false;
        if (adaptiveTurnTimer) {
            clearTimeout(adaptiveTurnTimer);
            adaptiveTurnTimer = null;
        }
        accumulatedTranscript = '';
        if (processingTimer) {
            clearTimeout(processingTimer);
            processingTimer = null;
        }
        if (restartTimer) {
            clearTimeout(restartTimer);
            restartTimer = null;
        }
        if (typeof document !== 'undefined' && document.body) {
            document.body.classList.toggle('is-processing', false);
        }
        if (!globalThis.isConverseSpeechActive?.()) {
            if (Recognition && !fallbackMode) {
                startBrowserRecognition();
            } else {
                whisperRecorder.start(language);
            }
        }
        emitState();
        return true;
    }

    function stop(options = {}) {
        explicitlyStopped = true;
        if (adaptiveTurnTimer) {
            clearTimeout(adaptiveTurnTimer);
            adaptiveTurnTimer = null;
        }
        accumulatedTranscript = '';
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
        resumeListening,
        stop
    };
}

/**
/**
 * Creates a real-time Web Audio API amplitude visualizer attached to the active mic stream.
 */
export function createAudioVisualizer(containerEl) {
    let audioContext = null;
    let analyser = null;
    let source = null;
    let activeStream = null;
    let animationFrameId = null;
    let barElements = [];
    let smoothedLevels = [];
    const NUM_BARS = 14;

    function initDom() {
        if (!containerEl || typeof document === 'undefined' || typeof document.createElement !== 'function') return;
        containerEl.innerHTML = '';
        const waveWrap = document.createElement('div');
        waveWrap.className = 'composer-voice-waveform';
        barElements = [];
        smoothedLevels = new Array(NUM_BARS).fill(0.12);
        for (let i = 0; i < NUM_BARS; i++) {
            const bar = document.createElement('span');
            bar.className = 'voice-wave-bar';
            bar.style.setProperty?.('--bar-index', String(i));
            bar.style.setProperty?.('--bar-scale', '0.12');
            waveWrap.appendChild(bar);
            barElements.push(bar);
        }
        containerEl.appendChild(waveWrap);
    }

    async function start(existingStream = null) {
        stop();
        initDom();

        const requestAnimFrame = typeof globalThis.requestAnimationFrame === 'function'
            ? globalThis.requestAnimationFrame
            : (cb) => setTimeout(cb, 16);

        function drawAmbientFallback() {
            let frame = 0;
            function drawLoop() {
                animationFrameId = requestAnimFrame(drawLoop);
                frame += 0.06;
                for (let i = 0; i < NUM_BARS; i++) {
                    const dist = Math.abs(i - NUM_BARS / 2) / (NUM_BARS / 2);
                    const wave = Math.sin(frame + i * 0.45) * 0.16 + 0.26;
                    const scale = Math.max(0.12, wave * (1 - dist * 0.35));
                    if (barElements[i]) {
                        barElements[i].style.setProperty?.('--bar-scale', scale.toFixed(3));
                    }
                }
            }
            drawLoop();
        }

        try {
            if (existingStream && existingStream.active && existingStream.getAudioTracks().some(t => t.readyState === 'live')) {
                activeStream = existingStream;
            } else if (typeof navigator !== 'undefined' && navigator?.mediaDevices?.getUserMedia) {
                try {
                    activeStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                } catch (_) {
                    drawAmbientFallback();
                    return;
                }
            } else {
                drawAmbientFallback();
                return;
            }

            const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
            if (!AudioCtx) {
                drawAmbientFallback();
                return;
            }
            audioContext = new AudioCtx();
            if (audioContext.state === 'suspended') {
                try { await audioContext.resume(); } catch (_) {}
            }

            analyser = audioContext.createAnalyser();
            analyser.fftSize = 64;
            analyser.smoothingTimeConstant = 0.75;

            source = audioContext.createMediaStreamSource(activeStream);
            source.connect(analyser);

            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);

            function draw() {
                animationFrameId = requestAnimFrame(draw);
                if (!analyser || barElements.length === 0) return;

                analyser.getByteFrequencyData(dataArray);

                let total = 0;
                for (let i = 0; i < bufferLength; i++) {
                    total += dataArray[i];
                }
                const avgVolume = total / (bufferLength * 255);

                for (let i = 0; i < NUM_BARS; i++) {
                    const half = NUM_BARS / 2;
                    const distFromCenter = Math.abs(i - half) / half;
                    const binIndex = Math.min(bufferLength - 1, Math.floor((1 - distFromCenter * 0.5) * (bufferLength / 2)));
                    const rawVal = (dataArray[binIndex] || 0) / 255;

                    const centerWeight = Math.cos(distFromCenter * Math.PI * 0.42);
                    const targetScale = Math.min(1.0, Math.max(0.12, (rawVal * 0.85 + avgVolume * 0.5) * centerWeight * 1.9));

                    smoothedLevels[i] += (targetScale - smoothedLevels[i]) * 0.32;
                    if (barElements[i]) {
                        barElements[i].style.setProperty?.('--bar-scale', smoothedLevels[i].toFixed(3));
                    }
                }
            }

            draw();
        } catch (err) {
            drawAmbientFallback();
        }
    }

    function stop() {
        if (animationFrameId) {
            if (typeof globalThis.cancelAnimationFrame === 'function') {
                globalThis.cancelAnimationFrame(animationFrameId);
            } else {
                clearTimeout(animationFrameId);
            }
            animationFrameId = null;
        }
        if (source) {
            try { source.disconnect(); } catch (_) {}
            source = null;
        }
        if (analyser) {
            try { analyser.disconnect(); } catch (_) {}
            analyser = null;
        }
        if (audioContext && audioContext.state !== 'closed') {
            try { audioContext.close(); } catch (_) {}
            audioContext = null;
        }
        activeStream = null;
        smoothedLevels = new Array(NUM_BARS).fill(0.12);
        barElements.forEach(bar => {
            bar.style?.setProperty?.('--bar-scale', '0.12');
        });
    }

    return {
        start,
        stop,
        getBarCount: () => barElements.length
    };
}

/**
 * Attaches the speech input controller to DOM UI elements.
 */
export function installSpeechInputUI(options = {}) {
    const input = document.getElementById('text-input');
    const vttButton = document.getElementById('voice-to-text-btn');
    const status = document.getElementById('speech-input-status');
    const vttWaveform = document.getElementById('vtt-waveform-container');
    const composerShell = document.getElementById('input-bar-inner');
    const sendBtn = document.getElementById('send-message-btn');
    if (!input || !vttButton) return null;

    const visualizer = vttWaveform ? createAudioVisualizer(vttWaveform) : null;
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

    const controller = createSpeechInputController({
        Recognition,
        language: 'en-US',
        onInterim(text, state) {
            const cleaned = cleanSpeechFillers(text);
            lastInterimText = cleaned;
            input.value = '';
            delete input.dataset.inputSource;
            const isConverse = Boolean(state?.converseEnabled);

            globalThis.updateLiveSpeechTranscriptionOnScreen?.(cleaned, true, isConverse ? 'converse' : 'vtt');
            if (isConverse) {
                globalThis.updateLiveConverseOverlay?.(state.processing ? 'thinking' : 'listening', cleaned, true);
            }
            options.onComposerChanged?.();
            globalThis.handleComposerInput?.();
        },
        async onFinal(text, event) {
            lastInterimText = '';
            const cleaned = cleanSpeechFillers(text);
            input.value = '';
            delete input.dataset.inputSource;

            if (cleaned) {
                const isConverse = event.autoSubmit || event.source === 'converse' || controller.getState().converseEnabled;
                if (isConverse) {
                    globalThis.updateLiveConverseOverlay?.('thinking', cleaned, false);
                }
                options.onComposerChanged?.();
                globalThis.handleComposerInput?.();
                await options.onSubmit?.({
                    text: cleaned,
                    source: isConverse ? 'converse' : 'vtt',
                    preserveTranscript: true,
                    interrupt: isConverse || event.interrupt === true
                });
            } else {
                globalThis.clearLiveSpeechTranscriptionOnScreen?.();
            }
        },
        onState(state) {
            if (!state.listening) {
                lastInterimText = '';
                if (!state.processing) {
                    globalThis.clearLiveSpeechTranscriptionOnScreen?.();
                }
            }
            const isListening = Boolean(state.listening);
            const isProcessing = Boolean(state.processing);
            const isDictation = state.mode === 'dictation' && isListening;
            const isConverse = Boolean(state.converseEnabled);

            vttButton.classList.toggle('is-listening', isDictation);
            vttButton.setAttribute('aria-pressed', isDictation ? 'true' : 'false');

            if (sendBtn) {
                sendBtn.classList.toggle('is-converse-active', isConverse);
            }

            if (composerShell) {
                composerShell.classList.toggle('is-voice-active', isListening || isProcessing);
                composerShell.classList.toggle('is-processing', isProcessing);
            }

            if (vttWaveform) {
                vttWaveform.classList.toggle('hidden', !isListening && !isProcessing);
                vttWaveform.classList.toggle('is-active', isListening);
                vttWaveform.classList.toggle('is-processing', isProcessing);
            }

            if (isListening) {
                visualizer?.start();
            } else {
                visualizer?.stop();
            }

            if (status) {
                if (!state.supported) {
                    setStatusText('Voice input unavailable in this browser.');
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
            globalThis.clearLiveSpeechTranscriptionOnScreen?.();
            if (vttWaveform) {
                vttWaveform.classList.add('hidden');
                vttWaveform.classList.remove('is-active', 'is-processing');
            }
            if (composerShell) {
                composerShell.classList.remove('is-voice-active', 'is-processing');
            }
            visualizer?.stop();
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
        if (!wasConverseEnabled) {
            globalThis.unlockConverseSpeechFromGesture?.();
        }
        const toggled = await rawToggleConverse();
        // If converse has just been enabled, speak a random greeting
        if (!wasConverseEnabled && toggled) {
            // Cancel any ongoing speech synthesis
            if (globalThis.speechSynthesis?.speaking) {
                try { globalThis.speechSynthesis.cancel(); } catch (_) {}
            }
            const greetings = [
                "Hey, happy to help!",
                "Hi there! I'm ready to assist you.",
                "Hello! How can I help you today?",
                "Greetings! Let me know what you need.",
                "Welcome! Ask me anything.",
                "Hi! I'm here for you.",
                "Hey! Ready when you are.",
                "Hello! What can I do for you?",
                "Hey there! How can I assist?",
                "Hi! Let’s get started."
            ];
            const msg = greetings[Math.floor(Math.random() * greetings.length)];
            try {
                const utter = new SpeechSynthesisUtterance(msg);
                // Preserve the current language if set
                if (typeof language === 'string') utter.lang = language;
                globalThis.speechSynthesis?.speak(utter);
            } catch (_) {}
        }
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

    vttButton.addEventListener('click', globalThis.toggleConverseMode);
    globalThis.addEventListener?.('jarvis:assistant-processing', event => {
        controller.setProcessing(Boolean(event.detail?.active));
    });
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && controller.getState().listening) {
                controller.stop({ disableConverse: true });
            }
        });
    }

    return controller;
}
