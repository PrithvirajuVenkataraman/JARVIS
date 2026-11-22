export function installRequestPreferences() {
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
        try {
            const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
            if (url.origin === location.origin && /^\/api\/(?:chat-groq|search|vision)$/.test(url.pathname) && typeof init?.body === 'string') {
                const body = JSON.parse(init.body);
                if (body && typeof body === 'object' && !Array.isArray(body)) {
                    body.preferences = { ...body.preferences, customSystemPrompt: String(window.customSystemPrompt || '').trim().slice(0, 1200) };
                    init = { ...init, body: JSON.stringify(body) };
                }
            }
        } catch { /* Non-JSON requests retain their original transport behavior. */ }
        return original(input, init);
    };
}
