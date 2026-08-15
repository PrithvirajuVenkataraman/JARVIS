/**
 * Unified Speech Input & Hands-Free Converse Controller.
 * Primary STT: Serverless Groq Whisper (whisper-large-v3-turbo) via MediaRecorder.
 * Fallback STT: Native Browser Web Speech API (SpeechRecognition / webkitSpeechRecognition).
 */

const ERROR_MESSAGES = {
    'not-allowed': 'Microphone permission was denied. Allow microphone access in your browser settings.',
    'service-not-allowed': 'Speech recognition is blocked by browser policy. Language support depends on your browser and device; try English or another language.',
    'audio-capture': 'No working microphone was found.',
    network: 'Speech recognition could not reach the recognition service. Language support depends on your browser and device; try English or another language.',
    'no-speech': 'No speech was detected. If this repeats, try English or another language.'
};

const DEFAULT_CONVERSE_SILENCE_MS = 800;
const DEFAULT_CONVERSE_MAX_WAIT_MS = 3500;

function normalizeVoiceInputLanguage(language = '') {
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

/**
 * Creates an audio recorder that posts audio to /api/stt with fallback support.
 */
export function createWhisperRecorder(options = {}) {
    let mediaStream = null;
    let mediaRecorder = null;
    let audioChunks = [];
    let isRecording = false;
    let audioContext = null;
    let analyser = null;
    let silenceTimer = null;
    let speechDetected = false;

    const onTranscribed = options.onTranscribed || (() => {});
    const onError = options.onError || (() => {});
    const onState = options.onState || (() => {});
    const silenceTimeoutMs = options.silenceTimeoutMs || DEFAULT_CONVERSE_SILENCE_MS;

    async function start(language = 'en-US') {
        if (isRecording) return true;

        try {
            audioChunks = [];
            speechDetected = false;

            // Reuse persistent mediaStream if active and has live audio tracks
            const hasLiveTracks = mediaStream && mediaStream.active && mediaStream.getAudioTracks().some(t => t.readyState === 'live');
            if (hasLiveTracks) {
                mediaStream.getAudioTracks().forEach(t => { t.enabled = true; });
            } else {
                if (!navigator?.mediaDevices?.getUserMedia) {
                    return false;
                }
                mediaStream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true
                    }
                });
            }

            // Choose supported mimeType
            const mimeTypes = [
                'audio/webm;codecs=opus',
                'audio/webm',
                'audio/mp4',
                'audio/ogg;codecs=opus',
                'audio/wav'
            ];
            const chosenMime = mimeTypes.find(t => MediaRecorder.isTypeSupported?.(t)) || '';

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
                        const base64Audio = reader.result?.split(',')[1];
                        if (!base64Audio) {
                            onState({ recording: false, processing: false });
                            return;
                        }

                        const res = await fetch('/api/stt', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                audioBase64: base64Audio,
                                mimeType: mime,
                                language
                            })
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
                    };
                    reader.readAsDataURL(audioBlob);
                } catch (err) {
                    onState({ recording: false, processing: false });
                    onError({ code: 'stt_network_error', error: err });
                }
            };

            // Setup WebAudio VAD for silence detection in continuous mode
            try {
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                if (AudioCtx) {
                    if (!audioContext || audioContext.state === 'closed') {
                        audioContext = new AudioCtx();
                    } else if (audioContext.state === 'suspended') {
                        audioContext.resume();
                    }
                    const source = audioContext.createMediaStreamSource(mediaStream);
                    analyser = audioContext.createAnalyser();
                    analyser.fftSize = 512;
                    source.connect(analyser);

                    const bufferLength = analyser.frequencyBinCount;
                    const dataArray = new Uint8Array(bufferLength);

                    const checkVolume = () => {
                        if (!isRecording) return;
                        analyser.getByteFrequencyData(dataArray);
                        let sum = 0;
                        for (let i = 0; i < bufferLength; i++) {
                            sum += dataArray[i];
                        }
                        const average = sum / bufferLength;

                        // Voice activity threshold
                        if (average > 12) {
                            speechDetected = true;
                            // Instant barge-in: cancel any active TTS speaking and capture interrupted state
                            if (globalThis.speechSynthesis?.speaking || globalThis.isConverseSpeechActive?.()) {
                                globalThis.stopConverseSpeech?.('barge_in');
                            }
                            if (silenceTimer) {
                                clearTimeout(silenceTimer);
                                silenceTimer = null;
                            }
                        } else if (speechDetected && !silenceTimer) {
                            silenceTimer = setTimeout(() => {
                                if (isRecording) {
                                    stop({ keepStream: true });
                                }
                            }, silenceTimeoutMs);
                        }

                        requestAnimationFrame(checkVolume);
                    };
                    requestAnimationFrame(checkVolume);
                }
            } catch {}

            mediaRecorder.start(250);
            isRecording = true;
            onState({ recording: true, processing: false });
            return true;
        } catch (err) {
            isRecording = false;
            onError({ code: 'mic_permission_error', error: err });
            return false;
        }
    }

    function stop(options = {}) {
        const keepStream = options.keepStream === true;
        if (silenceTimer) {
            clearTimeout(silenceTimer);
            silenceTimer = null;
        }
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            try {
                mediaRecorder.stop();
            } catch {}
        }
        if (mediaStream) {
            if (keepStream) {
                // Mute tracks during processing / TTS without destroying the authorization
                mediaStream.getAudioTracks().forEach(t => { t.enabled = false; });
            } else {
                mediaStream.getTracks().forEach(t => t.stop());
                mediaStream = null;
            }
        }
        if (!keepStream && audioContext && audioContext.state !== 'closed') {
            try {
                audioContext.close();
            } catch {}
            audioContext = null;
        }
        isRecording = false;
    }

    function isSupported() {
        return Boolean(navigator?.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined');
    }

    return {
        start,
        stop,
        isSupported,
        isRecording: () => isRecording
    };
}

/**
 * Creates the complete Speech & Converse Controller combining Whisper STT + Web Speech fallback.
 */
export function createSpeechInputController(options = {}) {
    const Recognition = options.Recognition;
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

    const whisperRecorder = createWhisperRecorder({
        silenceTimeoutMs: options.converseSilenceMs || DEFAULT_CONVERSE_SILENCE_MS,
        onTranscribed(text) {
            const clean = String(text || '').trim();
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
        onState(state) {
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
                if (interim) callbacks.onInterim(interim, getState());
                if (final && final.trim()) {
                    callbacks.onFinal(final.trim(), {
                        autoSubmit: converseEnabled,
                        source: converseEnabled ? 'converse' : 'vtt',
                        transcriptFinal: true
                    });
                }
            };

            r.onerror = event => {
                if (event.error === 'no-speech') {
                    return;
                }
                if ((converseEnabled || mode === 'dictation') && !fallbackMode && whisperRecorder.isSupported()) {
                    fallbackMode = false;
                    try { r.abort?.(); } catch (_) {}
                    browserRecognition = null;
                    whisperRecorder.start(language);
                    return;
                }
                const msg = ERROR_MESSAGES[event.error] || `Recognition error: ${event.error}`;
                callbacks.onError(msg);
            };

            r.onend = () => {
                if (converseEnabled && !processing) {
                    // Auto-resume continuous listening in converse mode
                    setTimeout(() => {
                        if (converseEnabled && !processing && browserRecognition) {
                            try { browserRecognition.start(); } catch {}
                        }
                    }, 200);
                } else {
                    emitState();
                }
            };

            return r;
        } catch {
            return null;
        }
    }

    function startBrowserRecognition() {
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
            supported: whisperRecorder.isSupported() || typeof Recognition === 'function',
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
        mode = 'dictation';
        converseEnabled = false;

        const started = await whisperRecorder.start(language);
        if (!started && Recognition) {
            fallbackMode = true;
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
        stop();
        mode = 'converse';
        converseEnabled = true;

        const started = await whisperRecorder.start(language);
        if (!started && Recognition) {
            fallbackMode = true;
            startBrowserRecognition();
        }
        emitState();
        return true;
    }

    function setProcessing(isProc) {
        processing = Boolean(isProc);
        if (processing) {
            whisperRecorder.stop({ keepStream: true });
            if (browserRecognition) {
                try { browserRecognition.stop(); } catch {}
            }
        } else if (converseEnabled) {
            // Re-open microphone after processing/speech finishes
            setTimeout(() => {
                if (converseEnabled && !processing) {
                    if (fallbackMode && Recognition) {
                        startBrowserRecognition();
                    } else {
                        whisperRecorder.start(language);
                    }
                }
            }, 250);
        }
        emitState();
    }

    function stop(options = {}) {
        const keepStream = options.keepStream === true && !options.disableConverse;
        whisperRecorder.stop({ keepStream });
        if (browserRecognition) {
            try { browserRecognition.stop(); } catch {}
            if (options.disableConverse || mode === 'dictation') {
                browserRecognition = null;
            }
        }
        if (options.disableConverse) {
            converseEnabled = false;
            mode = 'idle';
        } else if (mode === 'dictation') {
            mode = 'idle';
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
            input.value = [committedText, text].filter(Boolean).join(' ').trim();
            if (state?.mode === 'dictation' && state.listening && status) {
                if (text) setStatusText('Listening');
                else setListeningStatus();
            }
            options.onComposerChanged?.();
        },
        async onFinal(text, event) {
            if (event.autoSubmit) {
                committedText = '';
                input.value = text;
                input.dataset.inputSource = 'converse';
                options.onComposerChanged?.();
                await options.onSubmit?.({
                    source: 'converse',
                    preserveTranscript: true,
                    interrupt: event.interrupt === true
                });
            } else {
                committedText = [committedText, text].filter(Boolean).join(' ').trim();
                input.value = committedText;
                input.dataset.inputSource = 'vtt';
                options.onComposerChanged?.();
                input.focus();
            }
        },
        onState(state) {
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
            options.onStateChanged?.(state);
            globalThis.updateComposerPlaceholder?.();
        },
        onError(message) {
            setStatusText(message);
            options.onError?.(message);
        }
    });

    globalThis.toggleVoiceToText = () => {
        committedText = input.value.trim();
        return controller.toggleDictation();
    };

    globalThis.toggleConverseMode = async () => {
        const wasConverseEnabled = controller.getState().converseEnabled;
        committedText = '';
        input.value = '';
        delete input.dataset.inputSource;
        options.onComposerChanged?.();
        const toggled = await controller.toggleConverse();
        if (wasConverseEnabled) {
            globalThis.stopActiveGeneration?.('converse_stop');
            if (globalThis.speechSynthesis?.speaking) {
                globalThis.speechSynthesis.cancel();
            }
        }
        return toggled;
    };

    globalThis.JarvisSpeechInput = controller;
    globalThis.JarvisSpeechInput.toggleConverse = globalThis.toggleConverseMode;
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

    controller.setProcessing(false);
    return controller;
}
