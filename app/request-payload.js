// Budget the UTF-8 JSON on the wire, including base64 and conversation context.
// Stay below Vercel's default 4.5 MB limit without requiring paid compute.
export const MAX_JSON_REQUEST_BYTES = 4_000_000;
export const PAYLOAD_TOO_LARGE_MESSAGE = 'This message is too large to send. Remove some attachments, use a smaller image, or send a shorter excerpt, then try again.';
const PREPARATION_HEADROOM = 16_000;

export function isPayloadTooLarge(error) {
    return Number(error?.status) === 413 || ['request_too_large', 'payload_too_large', 'FUNCTION_PAYLOAD_TOO_LARGE'].includes(error?.code);
}

export function payloadSizeError() {
    return Object.assign(new Error(PAYLOAD_TOO_LARGE_MESSAGE), { status: 413, code: 'request_too_large', retryable: false });
}

export function jsonByteLength(payload) { return new TextEncoder().encode(JSON.stringify(payload ?? {})).byteLength; }

export function serializeRequestPayload(payload) {
    const body = JSON.stringify(payload ?? {});
    if (new TextEncoder().encode(body).byteLength > MAX_JSON_REQUEST_BYTES) throw payloadSizeError();
    return body;
}

function checkAbort(signal) { signal?.throwIfAborted(); }

export async function prepareRequestPayload(payload, { signal, resizeImage = resizeInlineImage } = {}) {
    checkAbort(signal);
    if (jsonByteLength(payload) <= MAX_JSON_REQUEST_BYTES - PREPARATION_HEADROOM) return payload;
    const prepared = { ...payload };
    const entries = [];
    const add = (holder, key, mimeType) => {
        const value = String(holder[key] || '');
        const match = value.match(/^data:(image\/[^;]+);base64,/i);
        const base64 = match ? value.slice(match[0].length) : value;
        if (!base64) return;
        entries.push({ holder, key, base64, mimeType: match?.[1] || mimeType || 'image/jpeg' });
        holder[key] = '';
    };
    const imageList = (list) => list.map(image => {
        const copy = { ...image }; if (String(copy.mimeType || '').toLowerCase() === 'application/pdf') return copy;
        if (copy.base64 || copy.data || /^data:image\//i.test(copy.url || '')) {
            copy.base64 = copy.base64 || copy.data || copy.url;
            delete copy.data;
            if (/^data:image\//i.test(copy.url || '')) delete copy.url;
            add(copy, 'base64', copy.mimeType);
        }
        return copy;
    });
    if (Array.isArray(payload?.images)) prepared.images = imageList(payload.images);
    if (Array.isArray(payload?.grounding?.images)) prepared.grounding = { ...payload.grounding, images: imageList(payload.grounding.images) };
    if (payload?.imageBase64) add(prepared, 'imageBase64', payload.mimeType);
    if (payload?.base64 && /^image\//i.test(payload.mimeType || '')) add(prepared, 'base64', payload.mimeType);
    const available = MAX_JSON_REQUEST_BYTES - PREPARATION_HEADROOM - jsonByteLength(prepared) - entries.length * 64;
    if (!entries.length || available < entries.length * 64_000) throw payloadSizeError();
    const total = entries.reduce((sum, image) => sum + image.base64.length, 0);
    for (const entry of entries) {
        checkAbort(signal);
        const allowance = Math.floor(available * entry.base64.length / total);
        if (entry.base64.length <= allowance) entry.holder[entry.key] = entry.base64;
        else {
            const resized = await resizeImage(entry.base64, entry.mimeType, allowance, signal);
            checkAbort(signal);
            if (!resized || resized.length > allowance) throw payloadSizeError();
            entry.holder[entry.key] = resized;
            entry.holder.mimeType = 'image/jpeg';
        }
    }
    if (jsonByteLength(prepared) > MAX_JSON_REQUEST_BYTES - PREPARATION_HEADROOM) throw payloadSizeError();
    return prepared;
}

async function resizeInlineImage(base64, mimeType, allowance, signal) {
    if (typeof document === 'undefined') throw payloadSizeError();
    checkAbort(signal);
    let source;
    let objectUrl;
    try {
        const binary = atob(base64);
        const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
        const blob = new Blob([bytes], { type: mimeType });
        if (typeof createImageBitmap === 'function') {
            try { source = await createImageBitmap(blob); } catch { /* Use the browser image decoder below. */ }
        }
        checkAbort(signal);
        if (!source) {
            objectUrl = URL.createObjectURL(blob);
            source = await new Promise((resolve, reject) => {
                const image = new Image();
                const cleanup = () => { image.onload = image.onerror = null; signal?.removeEventListener('abort', abort); };
                const abort = () => { cleanup(); image.src = ''; reject(signal.reason); };
                image.onload = () => { cleanup(); resolve(image); };
                image.onerror = () => { cleanup(); reject(payloadSizeError()); };
                signal?.addEventListener('abort', abort, { once: true });
                image.src = objectUrl;
                if (signal?.aborted) abort();
            });
        }
        checkAbort(signal);
        const width = source.width || source.naturalWidth;
        const height = source.height || source.naturalHeight;
        if (!width || !height) throw payloadSizeError();
        const canvas = document.createElement('canvas');
        try {
            // Keep a readable image; if this cannot fit, ask for a smaller batch.
            for (const maxDimension of [1600, 1280, 1024, 768]) {
                const scale = Math.min(1, maxDimension / Math.max(width, height));
                canvas.width = Math.max(1, Math.round(width * scale));
                canvas.height = Math.max(1, Math.round(height * scale));
                const context = canvas.getContext('2d');
                if (!context) throw payloadSizeError();
                context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
                context.drawImage(source, 0, 0, canvas.width, canvas.height);
                for (const quality of [0.88, 0.75, 0.6]) {
                    checkAbort(signal);
                    const encoded = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
                    checkAbort(signal);
                    if (encoded && Math.ceil(encoded.size / 3) * 4 <= allowance) {
                        return await new Promise((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onload = () => resolve(String(reader.result).split(',')[1]);
                            reader.onerror = () => reject(payloadSizeError());
                            reader.readAsDataURL(encoded);
                        });
                    }
                }
            }
        } finally { canvas.width = canvas.height = 0; }
        throw payloadSizeError();
    } catch {
        checkAbort(signal);
        throw payloadSizeError();
    } finally {
        source?.close?.();
        if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
}
