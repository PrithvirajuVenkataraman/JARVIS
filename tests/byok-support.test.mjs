import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chatGroqHandler, { __test as chatGroqTest } from '../api/chat-groq.js';
import { __test as visionTest } from '../api/vision.js';
import { applyApiSecurity, sealSecret, unsealSecret, getSealedSecretsPublicKey } from '../api/_lib/security.js';
import { buildDiagnosticsStatus } from '../api/diagnostics.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('=== Testing Bring Your Own Key (BYOK) Architecture Suite ===\n');

// Section 1: Security Headers and CORS Configuration
console.log('--- Section 1: Security Headers & CORS Preflight Support ---');
{
    const req = {
        method: 'OPTIONS',
        headers: {
            origin: 'http://localhost:3000',
            'access-control-request-headers': 'x-groq-api-key, x-gemini-api-key'
        }
    };
    const capturedHeaders = {};
    let statusCode = 200;
    const res = {
        setHeader(name, value) {
            capturedHeaders[name.toLowerCase()] = value;
            return this;
        },
        status(code) {
            statusCode = code;
            return this;
        },
        end() {
            return this;
        }
    };

    const guard = applyApiSecurity(req, res, { methods: ['GET', 'POST', 'OPTIONS'], routeKey: 'test-byok' });
    assert.equal(guard.handled, true, 'OPTIONS preflight should exit early via CORS handler');
    assert.equal(statusCode, 200, 'Preflight should return HTTP 200');
    
    const allowHeaders = String(capturedHeaders['access-control-allow-headers'] || '').toLowerCase();
    assert.ok(allowHeaders.includes('x-groq-api-key'), 'CORS must allow X-Groq-Api-Key header');
    assert.ok(allowHeaders.includes('x-gemini-api-key'), 'CORS must allow X-Gemini-Api-Key header');
    console.log('  [PASS] 1.1 CORS preflight dynamically permits x-groq-api-key and x-gemini-api-key');
}

// Section 2: Groq Chat & Reasoning Key Prioritization
console.log('\n--- Section 2: Groq Chat & Reasoning Key Prioritization ---');
{
    const originalEnv = process.env.GROQ_API_KEYS;
    try {
        process.env.GROQ_API_KEYS = 'platform_key_alpha, platform_key_beta';
        
        // Without BYOK key
        const defaultKeys = chatGroqTest.getGroqApiKeys('');
        assert.deepEqual(defaultKeys, ['platform_key_alpha', 'platform_key_beta']);

        // With BYOK key
        const customKey = 'gsk_user_custom_test_key_12345';
        const byokKeys = chatGroqTest.getGroqApiKeys(customKey);
        assert.equal(byokKeys[0], customKey, 'Custom BYOK key must be prioritized at index 0');
        assert.ok(byokKeys.includes('platform_key_alpha'), 'Platform fallback keys must remain available as fallbacks');
        assert.equal(byokKeys.length, 3, 'Must contain custom key + unique platform keys');

        // Check getAllGroqApiKeys
        const allKeys = chatGroqTest.getAllGroqApiKeys(customKey);
        assert.equal(allKeys[0], customKey, 'getAllGroqApiKeys must place custom key at index 0');

        // Check hasAnyConfiguredKeys with zero env keys but custom key provided
        delete process.env.GROQ_API_KEYS;
        delete process.env.GROQ_API_KEY;
        delete process.env.GROQ_KEY;
        
        assert.equal(chatGroqTest.hasAnyConfiguredKeys({ customGroqKey: '' }), false, 'Without keys, should return false');
        assert.equal(chatGroqTest.hasAnyConfiguredKeys({ customGroqKey: customKey }), true, 'With BYOK key, should return true even with empty env');
        
        console.log('  [PASS] 2.1 Custom Groq key placed at index 0 and activates service without platform env keys');
    } finally {
        if (originalEnv !== undefined) {
            process.env.GROQ_API_KEYS = originalEnv;
        } else {
            delete process.env.GROQ_API_KEYS;
        }
    }
}

// Section 3: Vision API Provider BYOK Resolution
console.log('\n--- Section 3: Vision API BYOK Key Resolution ---');
{
    // Test Gemini custom key extraction from headers
    const reqWithHeader = {
        headers: {
            'x-gemini-api-key': 'AIzaSy_custom_vision_key_header'
        },
        body: {}
    };
    const providersFromHeader = visionTest.getVisionProviders(reqWithHeader);
    assert.equal(providersFromHeader.geminiApiKey, 'AIzaSy_custom_vision_key_header', 'Gemini provider must use header custom key');

    // Test Gemini custom key extraction from body.customKeys
    const reqWithBody = {
        headers: {},
        body: {
            customKeys: {
                gemini: 'AIzaSy_custom_vision_key_body'
            }
        }
    };
    const providersFromBody = visionTest.getVisionProviders(reqWithBody);
    assert.equal(providersFromBody.geminiApiKey, 'AIzaSy_custom_vision_key_body', 'Gemini provider must use body customKeys.gemini');

    // Test Groq custom key in vision providers
    const reqWithGroq = {
        headers: {
            'x-groq-api-key': 'gsk_custom_groq_vision_key'
        },
        body: {}
    };
    const providersWithGroq = visionTest.getVisionProviders(reqWithGroq);
    assert.equal(providersWithGroq.groqApiKey, 'gsk_custom_groq_vision_key', 'Groq provider must use header custom key');

    console.log('  [PASS] 3.1 Vision API properly binds BYOK credentials from headers and body payloads');
}

// Section 4: Frontend UI Components and Settings Markup
console.log('\n--- Section 4: Frontend UI Markup & Client Architecture ---');
{
    const indexHtmlPath = path.resolve(__dirname, '../index.html');
    const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

    // BYOK row in Section 0
    assert.ok(indexHtml.includes('id="settings-row-byok"'), 'index.html must contain #settings-row-byok');
    assert.ok(indexHtml.includes('id="byok-status-badge"'), 'index.html must contain #byok-status-badge');
    assert.ok(indexHtml.includes('API Keys (BYOK)'), 'index.html must display BYOK title');

    // BYOK Sub-view panel
    assert.ok(indexHtml.includes('id="settings-view-byok"'), 'index.html must contain #settings-view-byok panel');
    assert.ok(indexHtml.includes('id="byok-groq-input"'), 'index.html must contain Groq key input');
    assert.ok(indexHtml.includes('id="byok-gemini-input"'), 'index.html must contain Gemini key input');
    assert.ok(indexHtml.includes('id="byok-tier-badge"'), 'index.html must contain BYOK credential tier badge');

    // BYOK JavaScript functions
    assert.ok(indexHtml.includes('function loadByokSettings()'), 'index.html must define loadByokSettings');
    assert.ok(indexHtml.includes('function saveByokKeys('), 'index.html must define saveByokKeys');
    assert.ok(indexHtml.includes('function saveByokKeysAndReturn()'), 'index.html must define saveByokKeysAndReturn');
    assert.ok(indexHtml.includes('function clearByokKeys()'), 'index.html must define clearByokKeys');
    assert.ok(indexHtml.includes('function updateByokStatusBadge()'), 'index.html must define updateByokStatusBadge');
    assert.ok(indexHtml.includes('function togglePasswordVisibility('), 'index.html must define togglePasswordVisibility');
    assert.ok(indexHtml.includes('function installByokFetchInterceptor()'), 'index.html must define installByokFetchInterceptor');

    // Content Security Policy check in vercel.json
    const vercelJsonPath = path.resolve(__dirname, '../vercel.json');
    const vercelJson = JSON.parse(fs.readFileSync(vercelJsonPath, 'utf8'));
    const cspHeader = vercelJson.headers?.[0]?.headers?.find(h => h.key === 'Content-Security-Policy');
    assert.ok(cspHeader, 'vercel.json must define Content-Security-Policy header');
    assert.ok(cspHeader.value.includes("connect-src 'self' https: wss:"), 'CSP must permit connect-src HTTPS connections');

    console.log('  [PASS] 4.1 Settings UI, client fetch interceptor, and CSP headers are fully grounded and verified');
}

// Section 5: Asymmetric Sealed Secrets Cryptography & Web Crypto Interoperability
console.log('\n--- Section 5: Asymmetric Sealed Secrets Cryptography (GitHub Secrets-Style) ---');
{
    // 5.1 Diagnostics exposes public key with RSA-OAEP-256 JWK
    const status = buildDiagnosticsStatus();
    assert.ok(status.model.byokSupported, 'Diagnostics must indicate BYOK support');
    assert.ok(status.model.byokPublicKey, 'Diagnostics must expose byokPublicKey');
    assert.equal(status.model.byokPublicKey.jwk.alg, 'RSA-OAEP-256', 'JWK alg must be RSA-OAEP-256');
    assert.ok(status.model.byokPublicKey.pem.includes('BEGIN PUBLIC KEY'), 'PEM must be valid SPKI public key');
    console.log('  [PASS] 5.1 Diagnostics endpoint exports RSA-OAEP public key and JWK metadata');

    // 5.2 Server-side sealing and unsealing round-trip
    const rawSecret = 'gsk_secret_enterprise_token_9999';
    const sealedToken = sealSecret(rawSecret);
    assert.ok(sealedToken.startsWith('jarvis_sealed_v1:'), 'Sealed token must start with jarvis_sealed_v1:');
    assert.ok(sealedToken.endsWith('9999'), 'Sealed token must include safe masked fingerprint');
    
    const unsealed = unsealSecret(sealedToken);
    assert.equal(unsealed, rawSecret, 'unsealSecret must recover the exact original plaintext token');
    console.log('  [PASS] 5.2 Server-side sealing and unsealing round-trip recovers raw key perfectly');

    // 5.3 Client Web Crypto Simulation (crypto.subtle) -> Server unsealing
    const pub = getSealedSecretsPublicKey();
    const cryptoKey = await crypto.subtle.importKey('jwk', pub.jwk, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
    const rawAesKey = crypto.getRandomValues(new Uint8Array(32));
    const encAesKey = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, cryptoKey, rawAesKey);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const aesKeyObj = await crypto.subtle.importKey('raw', rawAesKey, { name: 'AES-GCM' }, false, ['encrypt']);
    const testPlaintext = 'AIzaSy_client_web_crypto_secret_token_1234';
    const cipherWithTag = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKeyObj, new TextEncoder().encode(testPlaintext));
    
    const encAesB64 = Buffer.from(encAesKey).toString('base64');
    const ivB64 = Buffer.from(iv).toString('base64');
    const cipherB64 = Buffer.from(cipherWithTag).toString('base64');
    const browserSealedString = `jarvis_sealed_v1:${encAesB64}:${ivB64}:${cipherB64}:1234`;
    
    const browserUnsealed = unsealSecret(browserSealedString);
    assert.equal(browserUnsealed, testPlaintext, 'Server unsealSecret must decrypt browser Web Crypto envelope encryption');
    console.log('  [PASS] 5.3 Browser Web Crypto Subtle envelope encryption interoperates with server unsealing');

    // 5.4 Tamper Resistance & Graceful Failure
    const tamperedCipher = browserSealedString.slice(0, -10) + 'X' + browserSealedString.slice(-9);
    const tamperedResult = unsealSecret(tamperedCipher);
    assert.equal(tamperedResult, '', 'Tampered or invalid sealed secret must fail closed and return empty string');
    console.log('  [PASS] 5.4 Tampered sealed ciphertext fails closed and returns safe empty string');

    // 5.5 Vision and Chat route resolution with Sealed Secret
    const sealedGroqKey = sealSecret('gsk_sealed_vision_groq_key_abc1');
    const reqWithSealedGroq = {
        headers: {
            'x-groq-api-key': sealedGroqKey
        },
        body: {}
    };
    const resolvedProviders = visionTest.getVisionProviders(reqWithSealedGroq);
    assert.equal(resolvedProviders.groqApiKey, 'gsk_sealed_vision_groq_key_abc1', 'Vision provider must unseal Groq key from header');

    const sealedGeminiKey = sealSecret('AIzaSy_sealed_vision_gemini_key_def2');
    const reqWithSealedGemini = {
        headers: {
            'x-gemini-api-key': sealedGeminiKey
        },
        body: {}
    };
    const resolvedGeminiProviders = visionTest.getVisionProviders(reqWithSealedGemini);
    assert.equal(resolvedGeminiProviders.geminiApiKey, 'AIzaSy_sealed_vision_gemini_key_def2', 'Vision provider must unseal Gemini key from header');
    console.log('  [PASS] 5.5 Vision and Chat endpoints seamlessly unseal sealed tokens in ephemeral memory');
}

// Section 6: Streaming Chat End-to-End Handshake & BYOK Propagation
console.log('\n--- Section 6: Streaming Chat End-to-End Handshake & BYOK Propagation ---');
{
    // 6.1 Stream request with sealed BYOK key should establish SSE and not throw ReferenceError
    const chunks = [];
    let endCalled = false;
    const responseHeaders = {};
    const res = {
        setHeader(name, value) {
            responseHeaders[name.toLowerCase()] = value;
            return this;
        },
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(data) {
            this.jsonData = data;
            return this;
        },
        write(chunk) {
            chunks.push(String(chunk));
        },
        end() {
            endCalled = true;
            return this;
        }
    };

    const sealedKey = sealSecret('gsk_streaming_byok_test_key_xyz9');
    const req = {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'host': 'localhost',
            'x-groq-api-key': sealedKey
        },
        body: {
            message: 'What is the capital of France?',
            stream: true,
            tier: 'instant'
        }
    };

    await chatGroqHandler(req, res);
    assert.ok(endCalled, 'Streaming response must end cleanly');
    assert.equal(responseHeaders['content-type'], 'text/event-stream; charset=utf-8', 'Streaming must set text/event-stream');
    const fullSse = chunks.join('');
    assert.ok(fullSse.includes('event: meta'), 'Streaming response must include event: meta');
    assert.ok(!fullSse.includes('"stream_error"'), 'Must not crash with unhandled stream_error / ReferenceError');
    console.log('  [PASS] 6.1 Streaming chat endpoint unpacks BYOK key and streams SSE without ReferenceError');

    // 6.2 Stream request with no keys returns clean missing_credentials event, not stream_error
    const noKeyChunks = [];
    const noKeyRes = {
        setHeader() { return this; },
        status(code) { this.statusCode = code; return this; },
        json(data) { this.jsonData = data; return this; },
        write(chunk) { noKeyChunks.push(String(chunk)); },
        end() { return this; }
    };
    const savedKeys = process.env.GROQ_API_KEYS;
    const savedKey = process.env.GROQ_API_KEY;
    const savedGemini = process.env.GEMINI_API_KEY;
    const savedGoogle = process.env.GOOGLE_API_KEY;
    delete process.env.GROQ_API_KEYS;
    delete process.env.GROQ_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;

    try {
        const unauthenticatedReq = {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'host': 'localhost'
            },
            body: {
                message: 'Hello assistant',
                stream: true
            }
        };
        await chatGroqHandler(unauthenticatedReq, noKeyRes);
        const noKeySse = noKeyChunks.join('');
        assert.ok(noKeySse.includes('"missing_credentials"'), 'Zero-key streaming request must return missing_credentials');
        console.log('  [PASS] 6.2 Zero-key streaming request returns explicit missing_credentials event instead of stream_error');
    } finally {
        if (savedKeys) process.env.GROQ_API_KEYS = savedKeys;
        if (savedKey) process.env.GROQ_API_KEY = savedKey;
        if (savedGemini) process.env.GEMINI_API_KEY = savedGemini;
        if (savedGoogle) process.env.GOOGLE_API_KEY = savedGoogle;
    }
}

console.log('\n=== All BYOK Architecture Tests Passed Successfully! ===');
