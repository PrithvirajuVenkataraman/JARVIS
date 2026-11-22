export const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
export const MODEL_REVISION = '751bff37182d3f1213fa05d7196b954e230abad9';
export const MODEL_CACHE = 'jarvis-local-model-minilm-v1';
export const MODEL_FILES = Object.freeze({
    'config.json': '7135149f7cffa1a573466c6e4d8423ed73b62fd2332c575bf738a0d033f70df7',
    'tokenizer.json': 'da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0',
    'tokenizer_config.json': '9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3',
    'special_tokens_map.json': 'b6d346be366a7d1d48332dbc9fdf3bf8960b5d879522b7799ddba59e76237ee3',
    'vocab.txt': '07eced375cec144d27c900241f3e339478dec958f92fddbc551f295c992038a3',
    'onnx/model_quantized.onnx': 'afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1'
});
export async function verifiedModelFetch(input, init, { fetchFn = fetch, cache = globalThis.caches, cryptoApi = globalThis.crypto } = {}) {
    const url = new URL(input);
    const prefix = `/${MODEL_ID}/resolve/${MODEL_REVISION}/`;
    // Pipeline discovery can ask for config on "main" before forwarding revision.
    // Never fetch that mutable URL: rewrite this exact model to the pinned commit.
    const discovery = `/${MODEL_ID}/resolve/main/`;
    if (url.origin === 'https://huggingface.co' && url.pathname.startsWith(discovery)) url.pathname = prefix + url.pathname.slice(discovery.length);
    if (url.origin !== 'https://huggingface.co' || !url.pathname.startsWith(prefix)) throw new Error('Unexpected model source: ' + url.origin + url.pathname);
    const file = url.pathname.slice(prefix.length), expected = MODEL_FILES[file];
    if (!expected) return new Response('', { status: 404 });
    const storage = await cache?.open(MODEL_CACHE).catch(() => null);
    const cached = await storage?.match(url.href);
    const verify = async response => {
        const bytes = await response.arrayBuffer();
        const digest = Array.from(new Uint8Array(await cryptoApi.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
        if (digest !== expected) throw new Error(`Model asset verification failed for ${file} (${bytes.byteLength} bytes)`);
        return new Response(bytes, { headers: { 'content-type': file.endsWith('.json') ? 'application/json' : 'application/octet-stream', 'content-length': String(bytes.byteLength) } });
    };
    if (String(init?.method || '').toUpperCase() === 'HEAD') {
        if (cached) { try { return new Response(null, { headers: (await verify(cached)).headers }); } catch { await storage.delete(url.href); } }
        return fetchFn(url.href, { ...init, credentials: 'omit', referrerPolicy: 'no-referrer' });
    }
    if (cached) { try { return await verify(cached); } catch { await storage.delete(url.href); } }
    const headers = new Headers(init?.headers); headers.delete('Range');
    const response = await fetchFn(url.href, { ...init, headers, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error('Model download unavailable');
    const verified = await verify(response);
    try { await storage?.put(url.href, verified.clone()); } catch { /* Inference can still run without persistence. */ }
    return verified;
}
