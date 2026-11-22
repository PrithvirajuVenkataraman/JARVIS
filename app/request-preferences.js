import { serializeRequestPayload } from './request-payload.js';

export function installRequestPreferences() {
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
        let body;
        try {
            const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
            if (url.origin === location.origin && /^\/api\/(?:chat-groq|search|vision)$/.test(url.pathname) && typeof init?.body === 'string') {
                body = JSON.parse(init.body);
                if (body && typeof body === 'object' && !Array.isArray(body)) {
                    body.preferences = { ...body.preferences, customSystemPrompt: String(window.customSystemPrompt || '').trim().slice(0, 1200) };
                }
            }
        } catch { /* Non-JSON requests retain their original transport behavior. */ }
        if (body && typeof body === 'object' && !Array.isArray(body)) {
            try { init = { ...init, body: serializeRequestPayload(body) }; }
            catch (error) { return Promise.reject(error); }
        }
        return original(input, init);
    };
}
