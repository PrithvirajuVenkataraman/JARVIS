import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { __test as chatGroqTest } from '../api/chat-groq.js';
import { __test as visionTest } from '../api/vision.js';
import { applyApiSecurity } from '../api/_lib/security.js';

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

console.log('\n=== All BYOK Architecture Tests Passed Successfully! ===');
