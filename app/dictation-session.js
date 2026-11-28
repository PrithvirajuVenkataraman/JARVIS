// A recording owns its recognizer, recorder, timers and transcript until it settles.
// Stopping capture and cancelling transcription are deliberately separate operations.
export function createDictationController(options) {
    const { Recognition, createRecorder, formatTranscript, normalizeLanguage } = options;
    const sessions = new Map();
    let nextId = 0, active = null, externallyProcessing = false;
    let pendingSubmission = null;
    let language = normalizeLanguage(options.language);
    const cleanupMs = Math.max(0, Number(options.postStopCleanupMs ?? 1200));

    function getState() {
        const pending = [...sessions.values()].filter(s => s.stopped && !s.done);
        const transcribing = pending.length > 0;
        return {
            supported: Boolean(Recognition) || Boolean(globalThis.navigator?.mediaDevices?.getUserMedia && globalThis.MediaRecorder),
            mode: active ? 'dictation' : 'idle', converseEnabled: false,
            listening: Boolean(active && active.phase === 'listening'),
            starting: Boolean(active && active.phase === 'starting'),
            processing: externallyProcessing || transcribing || Boolean(pendingSubmission),
            transcribing, finishing: pending.some(s => s.recognition),
            transcriptionPhase: pending.some(s => s.recorder) ? 'transcribing' : transcribing ? 'cleanup' : 'idle',
            interruptible: false, language, pendingCount: pending.length,
            sessionId: active?.id ?? null, submissionPending: Boolean(pendingSubmission)
        };
    }
    const emitState = () => options.onState?.(getState());
    const live = s => sessions.get(s.id) === s && !s.done;
    function clearTimers(s) {
        clearTimeout(s.finishTimer); clearTimeout(s.inactivityTimer);
    }
    function detach(s, abort = false) {
        const rec = s.recognition;
        s.recognition = null;
        if (!rec) return;
        rec.onresult = rec.onerror = rec.onend = rec.onstart = null;
        if (abort) { try { rec.abort?.(); } catch { /* The recognizer may have already ended. */ } }
    }
    function textFor(s) {
        return formatTranscript([s.nativeText, s.recordedText].filter(Boolean).join(' '));
    }
    function publish(s, final = false, settled = false) {
        if (!live(s)) return;
        const text = textFor(s);
        const event = { sessionId: s.id, source: 'vtt', autoSubmit: false, transcriptFinal: final, settled, interrupt: false };
        if (final) {
            if (settled || text !== s.lastFinal) {
                s.lastFinal = text;
                options.onFinal?.(text, event);
            }
        } else {
            options.onInterim?.(text, { ...getState(), ...event });
        }
    }
    function settle(s) {
        if (!live(s)) return;
        clearTimers(s);
        detach(s, true);
        if (active === s) active = null;
        publish(s, true, true);
        s.done = true;
        sessions.delete(s.id);
        s.resolve();
        emitState();
    }
    function fail(s, message) {
        if (!live(s)) return;
        pendingSubmission = null;
        // An older failed clip must never stop a newer recording.
        settle(s);
        options.onError?.(message, { sessionId: s.id });
    }
    function recorderError(error) {
        return error.code === 'mic_permission_error' ? 'Microphone permission was denied. Allow microphone access in your browser settings.'
            : error.code === 'transcription_empty' ? 'No speech could be transcribed. Please try again.'
            : error.code === 'audio_too_large' ? 'This recording is too large. Please record a shorter clip.'
            : error.code === 'transcription_timeout' ? 'Voice transcription timed out. Please try again.'
            : error.code === 'unsupported' ? 'Voice input is unavailable in this browser.'
            : 'Voice transcription is temporarily unavailable. Please try again or type your message.';
    }
    async function startRecorder(s) {
        if (!live(s) || s.stopped) return false;
        detach(s, true);
        s.phase = 'starting';
        // Each clip gets a recorder, so starting the next one cannot abort this one's upload.
        s.recorder = createRecorder({
            transcriptionTimeoutMs: options.transcriptionTimeoutMs,
            shouldAutoStopOnSilence: () => false,
            onSpeechDetected() { clearTimeout(s.inactivityTimer); },
            onState(state) {
                if (!live(s)) return;
                if (state.recording) s.phase = 'listening';
                if (state.processing) {
                    s.stopped = true;
                    if (active === s) active = null;
                    s.phase = 'transcribing';
                }
                if (!state.recording && !state.processing && s.stopped) {
                    // Recorder callbacks publish their result synchronously after this terminal state.
                    queueMicrotask(() => settle(s));
                }
                emitState();
            },
            onTranscribed(text) {
                if (!live(s)) return;
                s.recordedText = text;
                settle(s);
            },
            onError(error) { fail(s, recorderError(error)); }
        });
        const started = await s.recorder.start(s.language);
        if (!live(s)) return false;
        if (!started) { settle(s); return false; }
        if (s.stopped) s.recorder.stop();
        emitState();
        return !s.stopped;
    }
    function startNative(s) {
        if (!live(s) || s.stopped) return;
        try {
            const rec = new Recognition();
            s.recognition = rec;
            rec.lang = s.language; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
            rec.onstart = () => { if (live(s) && !s.stopped) { s.phase = 'listening'; emitState(); } };
            rec.onresult = event => {
                if (!live(s)) return;
                clearTimeout(s.inactivityTimer);
                // Results are indexed snapshots. Revisions replace an interim result; they are not appended as new speech.
                for (let i = event.resultIndex; i < event.results.length; i++) {
                    const result = event.results[i];
                    s.results[i] = { text: String(result[0]?.transcript || ''), final: Boolean(result.isFinal) };
                }
                s.results.length = event.results.length;
                s.nativeText = s.results.map(r => r?.text || '').join(' ').trim();
                publish(s);
                if (s.results.some(r => r?.final)) publish(s, true);
            };
            rec.onend = () => { if (live(s)) settle(s); };
            rec.onerror = event => {
                if (!live(s)) return;
                if (s.stopped) { settle(s); return; }
                if (event.error === 'no-speech') return;
                if (event.error === 'not-allowed' || event.error === 'audio-capture') {
                    detach(s, true);
                    fail(s, event.error === 'not-allowed'
                        ? 'Microphone permission was denied. Allow microphone access in your browser settings.'
                        : 'No working microphone was found.');
                } else {
                    // Preserve already recognized words; the fallback records only subsequent audio.
                    void startRecorder(s);
                }
            };
            rec.start();
        } catch { void startRecorder(s); }
    }
    async function start() {
        if (active) return true;
        // A new recording is a new edit, not permission to send the preceding draft.
        pendingSubmission = null;
        if (globalThis.window?.isSecureContext === false && !['localhost', '127.0.0.1'].includes(globalThis.window.location?.hostname)) {
            options.onError?.('Microphone access requires HTTPS or localhost.'); return false;
        }
        const s = { id: ++nextId, phase: 'starting', stopped: false, done: false, language, results: [], nativeText: '', recordedText: '', lastFinal: '' };
        s.finished = new Promise(resolve => { s.resolve = resolve; });
        const draining = [...sessions.values()].filter(previous => previous.recognition && previous.stopped);
        sessions.set(s.id, s); active = s;
        options.onSessionStart?.({ sessionId: s.id });
        emitState();
        const begin = () => {
            if (!live(s) || s.stopped) return false;
            // An initial no-speech timeout releases the mic; thinking pauses after speech do not finish a clip.
            s.inactivityTimer = setTimeout(() => { if (active === s && !s.nativeText) stop(); }, Number(options.dictationInactivityTimeoutMs) || 8000);
            if (Recognition) { startNative(s); return true; }
            return startRecorder(s);
        };
        if (draining.length) {
            // Browsers may allow only one native recognizer. Drain its final events before starting the next.
            void Promise.all(draining.map(previous => previous.finished)).then(begin);
            return true;
        }
        return await begin();
    }
    function cancel() {
        active = null;
        pendingSubmission = null;
        for (const s of [...sessions.values()]) {
            s.done = true;
            sessions.delete(s.id);
            clearTimers(s); detach(s, true); s.recorder?.cancel(); s.resolve();
        }
        externallyProcessing = false;
        options.onCancel?.();
        emitState();
    }
    function stop(settings = {}) {
        if (settings.cancelled || settings.disableConverse || settings.releaseStream) { cancel(); return; }
        const s = active;
        if (!s) return;
        active = null; s.stopped = true;
        clearTimeout(s.inactivityTimer);
        if (s.recognition) {
            const timeout = settings.immediate ? 0 : Math.max(0, Number(settings.postStopCleanupMs ?? cleanupMs));
            // Preserve the complete last visible snapshot, including its unfinished tail.
            s.finishTimer = setTimeout(() => settle(s), timeout);
            try { s.recognition.stop(); } catch { settle(s); }
        } else if (s.recorder) {
            if (s.phase === 'starting') { s.recorder.cancel(); settle(s); }
            else s.recorder.stop({ keepStream: false });
        } else settle(s);
        emitState();
    }
    return {
        getState, start, stop,
        async prepareSubmit() {
            if (pendingSubmission) return false;
            if (!sessions.size) return true;
            const ticket = {};
            pendingSubmission = ticket;
            stop();
            const finishing = [...sessions.values()].map(s => s.finished);
            emitState();
            await Promise.all(finishing);
            if (pendingSubmission !== ticket) return false;
            pendingSubmission = null;
            emitState();
            return true;
        },
        async toggleDictation(settings) { if (active) { stop(settings); return false; } return await start(); },
        setLanguage(value) { language = normalizeLanguage(value); return language; },
        setProcessing(value) { externallyProcessing = Boolean(value); emitState(); },
        _callbacks: options
    };
}

// The composer is a draft plus ordered recording slots. An old result updates only its own slot.
export function createDictationDraft() {
    let prefix = '', rendered = '';
    const slots = new Map();
    function reset(value = '') { prefix = rendered = String(value); slots.clear(); }
    function begin(id, value) {
        if (!slots.size || String(value) !== rendered) reset(value);
        slots.set(id, { text: '', settled: false });
    }
    function update(id, text, value, settled = false) {
        if (String(value) !== rendered) { reset(value); return null; }
        const slot = slots.get(id);
        if (!slot) return null;
        slot.text = String(text || ''); slot.settled = settled;
        rendered = prefix;
        for (const entry of slots.values()) {
            if (entry.text) rendered += `${rendered && !/\s$/.test(rendered) && !entry.text.startsWith('\n') ? ' ' : ''}${entry.text}`;
        }
        const result = rendered;
        if ([...slots.values()].every(entry => entry.settled)) reset(rendered);
        return result;
    }
    return { reset, begin, update };
}
