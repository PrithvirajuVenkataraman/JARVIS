/** Execute explicitly requested snippets in an opaque-origin frame with networking disabled. */
export function executeJavaScript(code, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        const token = crypto.randomUUID();
        const frame = document.createElement('iframe');
        frame.hidden = true;
        frame.setAttribute('sandbox', 'allow-scripts');
        frame.title = 'Isolated JavaScript execution';
        const clean = () => { clearTimeout(timer); window.removeEventListener('message', receive); frame.remove(); };
        const receive = event => {
            if (event.source !== frame.contentWindow || event.data?.token !== token) return;
            const value = event.data;
            clean();
            if (value.error) reject(new Error(value.error)); else resolve(value);
        };
        const timer = setTimeout(() => { clean(); reject(new Error('Code execution exceeded its time limit.')); }, timeoutMs);
        window.addEventListener('message', receive);
        frame.src = '/code-sandbox.html';
        frame.addEventListener('load', () => frame.contentWindow.postMessage({ code: String(code), token }, '*'), { once: true });
        document.body.append(frame);
    });
}
