import crypto from 'node:crypto';

const DEFAULT_RATE_WINDOW_MS = 60 * 1000;
const DEFAULT_RATE_MAX = 60;
const DEFAULT_MAX_BODY_BYTES = 256 * 1024;

function getRateStore() {
    if (!globalThis.__jarvisRateLimitStore) {
        globalThis.__jarvisRateLimitStore = new Map();
    }
    return globalThis.__jarvisRateLimitStore;
}

function parseAllowedOrigins() {
    const raw = String(process.env.CORS_ALLOWED_ORIGINS || '').trim();
    if (!raw) return [];
    return raw
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
}

function resolveClientIp(req) {
    const xfwd = String(req?.headers?.['x-forwarded-for'] || '').trim();
    if (xfwd) {
        const first = xfwd.split(',')[0].trim();
        if (first) return first;
    }
    return String(
        req?.headers?.['x-real-ip'] ||
        req?.socket?.remoteAddress ||
        req?.connection?.remoteAddress ||
        'unknown'
    ).trim();
}

function parseBodyBytes(req) {
    try {
        const body = req?.body ?? {};
        return Buffer.byteLength(JSON.stringify(body), 'utf8');
    } catch (_) {
        return 0;
    }
}

function setDefaultSecurityHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(self)');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    const csp = String(process.env.JARVIS_CSP || '').trim() ||
        "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net data:; img-src 'self' data: blob: https:; media-src 'self' blob: data:; connect-src 'self' https: wss: data: blob:; worker-src 'self' blob: data:; frame-src 'self' https://maps.google.com https://www.google.com https://openstreetmap.org; object-src 'none'; base-uri 'self'; form-action 'self';";
    res.setHeader('Content-Security-Policy', csp);
}

function looksLikeAbusivePayload(body) {
    let sanitized = body;
    if (body && typeof body === 'object') {
        const copy = { ...body };
        if (Array.isArray(copy.images)) {
            copy.images = copy.images.map(img => ({ ...img, base64: '', data: '', inlineData: undefined }));
        }
        if (copy.grounding && typeof copy.grounding === 'object' && Array.isArray(copy.grounding.images)) {
            copy.grounding = {
                ...copy.grounding,
                images: copy.grounding.images.map(img => ({ ...img, base64: '', data: '', inlineData: undefined }))
            };
        }
        sanitized = copy;
    }
    const text = JSON.stringify(sanitized || {});
    if (text.length > 500000) return true;
    if (/(?:\b(?:ignore|forget)\s+(?:all|previous)\s+instructions\b|\bact as\b|\bsystem prompt\b)/i.test(text) && text.length > 12000) {
        return true;
    }
    if (/(?:<script|javascript:|onerror=|onload=)/i.test(text)) return true;
    return false;
}

function applyCors(req, res) {
    const allowedOrigins = parseAllowedOrigins();
    const requestOrigin = String(req?.headers?.origin || '').trim();
    const production = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
    const requestHost = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '').trim().toLowerCase();
    const sameOrigin = isSameOriginRequest(requestOrigin, requestHost);

    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Groq-Api-Key, X-Gemini-Api-Key, X-Goog-Api-Key, X-BYOK-Groq, X-BYOK-Gemini');

    if (!allowedOrigins.length) {
        if (production && requestOrigin && !sameOrigin) {
            return { ok: false };
        }
        if (sameOrigin) res.setHeader('Access-Control-Allow-Origin', requestOrigin);
        if (!production && !sameOrigin) res.setHeader('Access-Control-Allow-Origin', '*');
        return { ok: true };
    }

    const allowed = requestOrigin && allowedOrigins.includes(requestOrigin);
    res.setHeader('Vary', 'Origin');
    if (allowed) {
        res.setHeader('Access-Control-Allow-Origin', requestOrigin);
        return { ok: true };
    }

    if (!requestOrigin) {
        return { ok: true };
    }

    return { ok: false };
}

function isSameOriginRequest(origin, host) {
    if (!origin || !host) return false;
    try {
        const parsed = new URL(origin);
        const originHost = parsed.host.toLowerCase();
        const cleanHost = host.toLowerCase();
        if (originHost === cleanHost) return true;
        if (cleanHost.includes('localhost') || cleanHost.includes('127.0.0.1')) {
            return originHost.includes('localhost') || originHost.includes('127.0.0.1');
        }
        if (originHost === 'jarvisjr.vercel.app' || (cleanHost.endsWith('.vercel.app') && originHost.endsWith('.vercel.app'))) {
            return true;
        }
        return false;
    } catch (_) {
        return false;
    }
}

function applyRateLimit(req, res, options = {}) {
    const routeKey = String(options.routeKey || 'api');
    const envWindow = Number(process.env.RATE_LIMIT_WINDOW_MS || '');
    const envMax = Number(process.env.RATE_LIMIT_MAX || '');
    const windowMs = Number(options.windowMs || envWindow || DEFAULT_RATE_WINDOW_MS);
    const max = Number(options.max || envMax || DEFAULT_RATE_MAX);
    const ip = resolveClientIp(req);
    const now = Date.now();
    const resetAt = now + windowMs;
    const store = getRateStore();
    const key = `${routeKey}:${ip}`;
    const existing = store.get(key);
    const current = (!existing || existing.resetAt <= now)
        ? { count: 0, resetAt }
        : existing;

    current.count += 1;
    store.set(key, current);

    const remaining = Math.max(0, max - current.count);
    const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));

    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.floor(current.resetAt / 1000)));

    if (current.count > max) {
        res.setHeader('Retry-After', String(retryAfterSeconds));
        sendSecurityError(res, 429, 'rate_limited', 'Too many requests. Please retry shortly.');
        return false;
    }

    return true;
}

export function applyApiSecurity(req, res, options = {}) {
    setDefaultSecurityHeaders(res);

    const cors = applyCors(req, res);
    if (!cors.ok) {
        sendSecurityError(res, 403, 'origin_not_allowed', 'Origin not allowed.');
        return { handled: true };
    }

    if (req.method === 'OPTIONS' || req.method === 'HEAD') {
        res.status(200).end();
        return { handled: true };
    }

    const allowedMethods = Array.isArray(options.methods) && options.methods.length
        ? options.methods
        : ['POST'];
    if (!allowedMethods.includes(req.method)) {
        sendSecurityError(res, 405, 'method_not_allowed', 'Method not allowed.');
        return { handled: true };
    }

    const contentType = String(req?.headers?.['content-type'] || '').toLowerCase();
    if (req.method === 'POST' && !contentType.includes('application/json')) {
        sendSecurityError(res, 415, 'unsupported_media_type', 'Content-Type must be application/json.');
        return { handled: true };
    }

    const maxBodyBytes = Number(options.maxBodyBytes || DEFAULT_MAX_BODY_BYTES);
    const actualBytes = parseBodyBytes(req);
    if (actualBytes > maxBodyBytes) {
        sendSecurityError(res, 413, 'request_too_large', 'Request body too large.');
        return { handled: true };
    }

    const skipAbusiveCheck = Boolean(options.skipAbusiveCheck);
    if (!skipAbusiveCheck && looksLikeAbusivePayload(req?.body)) {
        sendSecurityError(res, 400, 'abusive_payload', 'Request payload was rejected.');
        return { handled: true };
    }

    const rateLimitOptions = options.rateLimit || {};
    const okRate = applyRateLimit(req, res, {
        routeKey: options.routeKey || 'api',
        windowMs: rateLimitOptions.windowMs,
        max: rateLimitOptions.max
    });
    if (!okRate) {
        return { handled: true };
    }

    return { handled: false };
}

function sendSecurityError(res, status, code, message) {
    return res.status(status).json({
        success: false,
        error: { code, message }
    });
}

// ============================================================================
// Asymmetric Sealed Secrets Architecture (GitHub Secrets Style BYOK Protection)
// ============================================================================

const SEALED_SECRET_PREFIX = 'jarvis_sealed_v1:';

function getSealedSecretsKeyPair() {
    if (globalThis.__jarvisSealedSecretsKeyPair) {
        return globalThis.__jarvisSealedSecretsKeyPair;
    }

    const envPrivate = String(process.env.JARVIS_BYOK_PRIVATE_KEY || '').trim();
    const envPublic = String(process.env.JARVIS_BYOK_PUBLIC_KEY || '').trim();

    if (envPrivate && envPublic) {
        try {
            const jwk = crypto.createPublicKey(envPublic).export({ format: 'jwk' });
            jwk.alg = 'RSA-OAEP-256';
            jwk.key_ops = ['encrypt'];
            const pair = {
                publicKeyPem: envPublic,
                privateKeyPem: envPrivate,
                jwk,
                keyId: 'jarvis-env-key'
            };
            globalThis.__jarvisSealedSecretsKeyPair = pair;
            return pair;
        } catch (_) {}
    }

    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });

    const jwk = crypto.createPublicKey(publicKey).export({ format: 'jwk' });
    jwk.alg = 'RSA-OAEP-256';
    jwk.key_ops = ['encrypt'];

    const pair = {
        publicKeyPem: publicKey,
        privateKeyPem: privateKey,
        jwk,
        keyId: 'jarvis-sealed-v1'
    };

    globalThis.__jarvisSealedSecretsKeyPair = pair;
    return pair;
}

export function getSealedSecretsPublicKey() {
    const pair = getSealedSecretsKeyPair();
    return {
        keyId: pair.keyId,
        jwk: pair.jwk,
        pem: pair.publicKeyPem
    };
}

export function isSealedSecret(value) {
    return typeof value === 'string' && value.startsWith(SEALED_SECRET_PREFIX);
}

export function unsealSecret(sealedOrRaw) {
    if (!sealedOrRaw || typeof sealedOrRaw !== 'string') return '';
    const trimmed = sealedOrRaw.trim();
    if (!trimmed.startsWith(SEALED_SECRET_PREFIX)) {
        return trimmed;
    }

    try {
        const parts = trimmed.slice(SEALED_SECRET_PREFIX.length).split(':');
        if (parts.length < 3) return '';
        const [encAesKeyB64, ivB64, ciphertextB64] = parts;

        const pair = getSealedSecretsKeyPair();
        const encryptedAesKey = Buffer.from(encAesKeyB64, 'base64');
        const iv = Buffer.from(ivB64, 'base64');
        const cipherWithTag = Buffer.from(ciphertextB64, 'base64');

        if (cipherWithTag.length < 16) return '';

        // 1. Decrypt AES key with RSA-OAEP private key
        const decryptedAesKey = crypto.privateDecrypt({
            key: pair.privateKeyPem,
            padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
            oaepHash: 'sha256'
        }, encryptedAesKey);

        // 2. Decrypt ciphertext with AES-256-GCM
        const tag = cipherWithTag.subarray(cipherWithTag.length - 16);
        const data = cipherWithTag.subarray(0, cipherWithTag.length - 16);
        const decipher = crypto.createDecipheriv('aes-256-gcm', decryptedAesKey, iv);
        decipher.setAuthTag(tag);
        const decrypted = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
        return decrypted.trim();
    } catch (_) {
        return '';
    }
}

export function sealSecret(rawSecret, optionalPublicKeyPem = null) {
    if (!rawSecret || typeof rawSecret !== 'string') return '';
    const cleanSecret = rawSecret.trim();
    if (!cleanSecret) return '';

    const pair = getSealedSecretsKeyPair();
    const pubKey = optionalPublicKeyPem || pair.publicKeyPem;

    const aesKey = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);

    const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
    const encrypted = Buffer.concat([cipher.update(cleanSecret, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const cipherWithTag = Buffer.concat([encrypted, authTag]);

    const encryptedAesKey = crypto.publicEncrypt({
        key: pubKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256'
    }, aesKey);

    const fingerprint = cleanSecret.length > 8
        ? `${cleanSecret.slice(0, 4)}••••••••${cleanSecret.slice(-4)}`
        : '••••';

    return `${SEALED_SECRET_PREFIX}${encryptedAesKey.toString('base64')}:${iv.toString('base64')}:${cipherWithTag.toString('base64')}:${fingerprint}`;
}
