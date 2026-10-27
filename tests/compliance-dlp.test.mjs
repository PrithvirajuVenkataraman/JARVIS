import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    computeShannonEntropy,
    isValidLuhn,
    isValidSsn,
    isValidAadhaar,
    isValidPan,
    normalizeForScan,
    scanDlp,
    CREDENTIAL_RULES,
    PII_RULES
} from '../app/dlp-engine.js';

import {
    dlpGateway,
    rehydrateText,
    clearConversationDlpContext,
    isDlpEnabled,
    getDlpPolicyMode,
    isPiiMaskingEnabled
} from '../app/dlp-gateway.js';

import {
    COMPLIANCE_AUDIT_STORAGE_KEY,
    COMPLIANCE_SCHEMA_VERSION,
    MAX_AUDIT_EVENTS,
    recordDlpAudit,
    recordFeedbackAudit,
    recordRoutingAudit,
    getComplianceAuditEvents,
    exportLocalDiagnostics,
    clearLocalDiagnostics
} from '../app/observability.js';

import {
    exportTraceSpan,
    exportFeedbackScore,
    isTelemetryExporterConfigured
} from '../api/_lib/telemetry-exporter.js';

import feedbackHandler from '../api/feedback.js';
import diagnosticsHandler from '../api/diagnostics.js';
import chatHandler from '../api/chat-groq.js';
import searchHandler from '../api/search.js';
import { shouldIgnoreForExtraction } from '../app/memory/memory-extractor.mjs';
import { generateImage } from '../app/image-generator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const stylesCss = fs.readFileSync(path.join(__dirname, '../styles.css'), 'utf8');

// Mock request / response helpers for API handlers
function createMockRequest(url, body, options = {}) {
    return {
        method: options.method || 'POST',
        url,
        headers: {
            'content-type': 'application/json',
            ...(options.headers || {})
        },
        body
    };
}

function createMockResponse() {
    const res = {
        statusCode: 200,
        body: null,
        headers: {},
        setHeader(name, value) {
            this.headers[name] = value;
            return this;
        },
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        },
        end() {
            return this;
        }
    };
    return res;
}

// =========================================================================
// Suite 1: Pure DLP Engine - Math, Checksums, and Security Normalization
// =========================================================================

test('DLP Engine 1.1: Shannon Entropy differentiates repetitive vs random text', () => {
    const emptyEntropy = computeShannonEntropy('');
    assert.equal(emptyEntropy, 0, 'Empty string has 0 entropy');

    const lowEntropy = computeShannonEntropy('aaaaaaaaaaaaaaaa');
    assert.ok(lowEntropy < 1.0, 'Repetitive single char has very low entropy');

    const dictionaryEntropy = computeShannonEntropy('passwordpassword');
    assert.ok(dictionaryEntropy < 3.0, 'Repeated word has entropy below 3.0');

    const highEntropyHex = computeShannonEntropy('9f82c4e7a1b63d09e5f2a8c14b7e93d2');
    assert.ok(highEntropyHex >= 3.2, 'Random hex string has entropy >= 3.2');
});

test('DLP Engine 1.2: Luhn Checksum validates credit card numbers', () => {
    // Valid test card candidate with valid Luhn checksum
    const validCard = '4000000000000002';
    assert.equal(isValidLuhn(validCard), true, 'Luhn valid card returns true');
    assert.equal(isValidLuhn('4000 0000 0000 0002'), true, 'Spaces ignored in Luhn check');
    assert.equal(isValidLuhn('4000-0000-0000-0002'), true, 'Dashes ignored in Luhn check');

    // Invalid checksum
    const invalidCard = '4000000000000003';
    assert.equal(isValidLuhn(invalidCard), false, 'Luhn invalid card returns false');

    // Invalid length (< 13 or > 19)
    assert.equal(isValidLuhn('123456789'), false, 'Too short number rejected');
    assert.equal(isValidLuhn('123456789012345678901'), false, 'Too long number rejected');
});

test('DLP Engine 1.3: US SSN Range and structure validation', () => {
    // Valid format and area range
    assert.equal(isValidSsn('123-45-6789'), true, 'Valid SSN returns true');
    assert.equal(isValidSsn('123456789'), true, 'Digits-only valid SSN returns true');

    // Invalid area codes: 000, 666, 900+
    assert.equal(isValidSsn('000-12-3456'), false, 'SSN with area 000 rejected');
    assert.equal(isValidSsn('666-12-3456'), false, 'SSN with area 666 rejected');
    assert.equal(isValidSsn('900-12-3456'), false, 'SSN with area 900+ rejected');
    assert.equal(isValidSsn('999-12-3456'), false, 'SSN with area 999 rejected');

    // Invalid group code: 00
    assert.equal(isValidSsn('123-00-6789'), false, 'SSN with group 00 rejected');

    // Invalid serial code: 0000
    assert.equal(isValidSsn('123-45-0000'), false, 'SSN with serial 0000 rejected');
});

test('DLP Engine 1.4: Verhoeff Checksum validates Indian Aadhaar numbers', () => {
    // Valid 12-digit number verified by Verhoeff
    const validAadhaar = '200000000009';
    assert.equal(isValidAadhaar(validAadhaar), true, 'Verhoeff valid Aadhaar returns true');
    assert.equal(isValidAadhaar('2000 0000 0009'), true, 'Spaced Aadhaar returns true');

    // Invalid check digit
    assert.equal(isValidAadhaar('200000000001'), false, 'Verhoeff invalid check digit returns false');

    // Numbers starting with 0 or 1 are invalid in Aadhaar spec
    assert.equal(isValidAadhaar('012345678901'), false, 'Aadhaar starting with 0 rejected');
    assert.equal(isValidAadhaar('123456789012'), false, 'Aadhaar starting with 1 rejected');

    // Invalid length
    assert.equal(isValidAadhaar('20000000009'), false, '11-digit number rejected');
});

test('DLP Engine 1.5: Indian PAN format and 4th-character entity status validation', () => {
    // Valid PANs with status in C, P, H, F, A, T, B, L, J, G
    assert.equal(isValidPan('AAAPA1234A'), true, 'PAN with status P (Individual) is valid');
    assert.equal(isValidPan('ABC CA 1234 B'), true, 'PAN with status C (Company) is valid');

    // Invalid 4th character status (e.g. 'D' is not a valid status code)
    assert.equal(isValidPan('ABCDE1234F'), false, 'PAN with invalid 4th character D rejected');

    // Invalid structure (e.g. wrong digit/letter count)
    assert.equal(isValidPan('12345ABCDE'), false, 'Inverted PAN pattern rejected');
    assert.equal(isValidPan('ABC P12345'), false, 'Malformed PAN length rejected');
});

test('DLP Engine 1.6: Unicode Normalization, zero-width stripping, and ReDoS safety', () => {
    // Fullwidth Unicode characters normalized to standard ASCII
    const fullwidthAws = 'ＡＫＩＡIOSFODNN7EXAMPLE';
    const normResult = normalizeForScan(fullwidthAws);
    assert.ok(normResult.normalized.startsWith('AKIA'), 'Fullwidth Latin characters converted via NFKC');

    // Zero-width characters (ZWSP, ZWNJ, ZWJ, BOM) stripped cleanly
    const zeroWidthEvasion = 'AK\u200BIA\u200CIOSF\u200DODNN7EXAMPLE';
    const zwResult = normalizeForScan(zeroWidthEvasion);
    assert.equal(zwResult.normalized, 'AKIAIOSFODNN7EXAMPLE', 'Zero-width characters stripped out');

    // Bidi override characters stripped
    const bidiEvasion = 'AKIA\u202E\u202DIOSFODNN7EXAMPLE';
    const bidiResult = normalizeForScan(bidiEvasion);
    assert.equal(bidiResult.normalized, 'AKIAIOSFODNN7EXAMPLE', 'Bidi overrides stripped out');

    // Large input capping (100k cap with head/tail sampling)
    const longString = 'A'.repeat(120_000);
    const capResult = normalizeForScan(longString, 100_000);
    assert.equal(capResult.truncatedScan, true, 'Flagged as truncatedScan');
    assert.ok(capResult.normalized.length <= 100_010, 'Bounded length maintained');

    // ReDoS protection: polynomial regex patterns finish rapidly
    const start = Date.now();
    const maliciousInput = 'a'.repeat(25_000) + '!';
    scanDlp(maliciousInput);
    const duration = Date.now() - start;
    assert.ok(duration < 150, `Scan completed in ${duration}ms without catastrophic backtracking`);
});

// =========================================================================
// Suite 2: All 11 Credential Rules & Hard Negatives
// =========================================================================

test('DLP Engine 2.1: Rule 1 - AWS Key (cred_aws_key)', () => {
    const awsSample = 'Deploying with AKIAIOSFODNN7EXAMPLE to us-east-1';
    const res = scanDlp(awsSample);
    assert.equal(res.decision, 'BLOCK');
    assert.ok(res.findings.some(f => f.ruleId === 'cred_aws_key'));

    // Negative: lowercase or short
    const neg = scanDlp('akiaiosfodnn7example or AKIA123');
    assert.equal(neg.decision, 'ALLOW');
});

test('DLP Engine 2.2: Rule 2 - Anthropic API Key (cred_anthropic)', () => {
    const anthropicSample = 'Using key sk-ant-api03-abcdef1234567890abcdef1234567890abcdef1234567890 for Claude';
    const res = scanDlp(anthropicSample);
    assert.equal(res.decision, 'BLOCK');
    assert.ok(res.findings.some(f => f.ruleId === 'cred_anthropic'));

    // Negative
    const neg = scanDlp('Discussing ant-api-key configurations');
    assert.equal(neg.decision, 'ALLOW');
});

test('DLP Engine 2.3: Rule 3 - OpenAI API Key (cred_openai) & "risk-free" negative', () => {
    const openaiSample = 'Key is sk-abcdefghijklmnopqrstuvwxyz0123456789ABCDEF in config';
    const res = scanDlp(openaiSample);
    assert.equal(res.decision, 'BLOCK');
    assert.ok(res.findings.some(f => f.ruleId === 'cred_openai'));

    // Project key format
    const projSample = 'Key is sk-proj-abcdefghijklmnopqrstuvwxyz0123456789ABCDEF';
    const projRes = scanDlp(projSample);
    assert.equal(projRes.decision, 'BLOCK');

    // CRITICAL HARD NEGATIVE: "risk-free" must NEVER trigger
    const riskFreeSample = 'We offer a risk-free trial for 30 days!';
    const riskFreeRes = scanDlp(riskFreeSample);
    assert.equal(riskFreeRes.decision, 'ALLOW', '"risk-free" must NOT trigger credential rule');
    assert.equal(riskFreeRes.findings.length, 0);
});

test('DLP Engine 2.4: Rule 4 - Groq API Key (cred_groq)', () => {
    const groqSample = 'export GROQ_API_KEY=gsk_abcdefghijklmnopqrstuvwxyz0123456789ABCDEF1234';
    const res = scanDlp(groqSample);
    assert.equal(res.decision, 'BLOCK');
    assert.ok(res.findings.some(f => f.ruleId === 'cred_groq'));

    // Negative
    const neg = scanDlp('gsk_short');
    assert.equal(neg.decision, 'ALLOW');
});

test('DLP Engine 2.5: Rule 5 - GitHub Personal Access Token (cred_github)', () => {
    const ghpSample = 'git push with ghp_abcdefghijklmnopqrstuvwxyz0123456789 token';
    const res = scanDlp(ghpSample);
    assert.equal(res.decision, 'BLOCK');
    assert.ok(res.findings.some(f => f.ruleId === 'cred_github'));

    // Negative
    const neg = scanDlp('ghp_short');
    assert.equal(neg.decision, 'ALLOW');
});

test('DLP Engine 2.6: Rule 6 - Slack Token (cred_slack)', () => {
    const slackSample = 'Bot token is xoxb-1234567890-1234567890123-abcdefghijklmnopqrstuvwx';
    const res = scanDlp(slackSample);
    assert.equal(res.decision, 'BLOCK');
    assert.ok(res.findings.some(f => f.ruleId === 'cred_slack'));

    // Negative
    const neg = scanDlp('xoxo-friendly-message');
    assert.equal(neg.decision, 'ALLOW');
});

test('DLP Engine 2.7: Rule 7 - Google API Key (cred_google)', () => {
    const googleSample = 'key AIzaSyB12345678901234567890123456789012';
    const res = scanDlp(googleSample);
    assert.equal(res.decision, 'BLOCK');
    assert.ok(res.findings.some(f => f.ruleId === 'cred_google'));

    // Negative
    const neg = scanDlp('AIzaShort');
    assert.equal(neg.decision, 'ALLOW');
});

test('DLP Engine 2.8: Rule 8 - JSON Web Token (cred_jwt)', () => {
    const jwtSample = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IlRlc3QiLCJpYXQiOjE1MTYyMzkwMjJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const res = scanDlp(jwtSample);
    assert.equal(res.decision, 'BLOCK');
    assert.ok(res.findings.some(f => f.ruleId === 'cred_jwt'));

    // Negative
    const neg = scanDlp('eyJ.invalid.token');
    assert.equal(neg.decision, 'ALLOW');
});

test('DLP Engine 2.9: Rule 9 - Private Key (cred_private_key)', () => {
    const keySample = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Y123456789012345678901234567890\n-----END RSA PRIVATE KEY-----';
    const res = scanDlp(keySample);
    assert.equal(res.decision, 'BLOCK');
    assert.ok(res.findings.some(f => f.ruleId === 'cred_private_key'));

    // OpenSSH key header
    const sshSample = '-----BEGIN OPENSSH PRIVATE KEY-----';
    const sshRes = scanDlp(sshSample);
    assert.equal(sshRes.decision, 'BLOCK');

    // Negative: Public certificate
    const certSample = '-----BEGIN CERTIFICATE-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A\n-----END CERTIFICATE-----';
    const certRes = scanDlp(certSample);
    assert.equal(certRes.decision, 'ALLOW');
});

test('DLP Engine 2.10: Rule 10 - Database URI with user:pass@ (cred_db_uri)', () => {
    const dbSample = 'Connecting to postgres://admin:superSecret123@db.example.com:5432/production';
    const res = scanDlp(dbSample);
    assert.equal(res.decision, 'BLOCK');
    assert.ok(res.findings.some(f => f.ruleId === 'cred_db_uri'));

    // Mongo URI with credentials
    const mongoSample = 'mongodb+srv://root:pass1234@cluster0.abcde.mongodb.net/test';
    const mongoRes = scanDlp(mongoSample);
    assert.equal(mongoRes.decision, 'BLOCK');

    // CRITICAL HARD NEGATIVE: Database URI WITHOUT user:pass@ must NOT block
    const safeDb = 'Connecting to postgres://db.example.com:5432/public';
    const safeRes = scanDlp(safeDb);
    assert.equal(safeRes.decision, 'ALLOW', 'DB URI without credentials must be allowed');
});

test('DLP Engine 2.11: Rule 11 - Generic High-Entropy Assignment (cred_generic)', () => {
    const genericSample = 'api_key = "d3f7a1c9e8b24056a1b2c3d4e5f67890"';
    const res = scanDlp(genericSample);
    assert.equal(res.decision, 'BLOCK');
    assert.ok(res.findings.some(f => f.ruleId === 'cred_generic'));

    // Hard Negative: Low-entropy strings should not trigger
    const lowEntropySample = 'password = "1234561234561234"';
    const lowEntropyRes = scanDlp(lowEntropySample);
    assert.equal(lowEntropyRes.decision, 'ALLOW', 'Low entropy assignment should not trigger');
});

test('DLP Engine 2.12: Benign General Queries are ALLOWED', () => {
    const queries = [
        'How does photosynthesis work in green plants?',
        'Calculate compound interest on 10000 at 5% for 3 years',
        'Explain quicksort algorithm in JavaScript',
        'Can you summarize the plot of Hamlet?'
    ];

    for (const q of queries) {
        const res = scanDlp(q);
        assert.equal(res.decision, 'ALLOW', `Benign query "${q}" must be ALLOWED`);
        assert.equal(res.findings.length, 0);
    }
});

// =========================================================================
// Suite 3: PII Masking, Stability, and Reversible Placeholders
// =========================================================================

test('DLP Engine 3.1: PII Masking for Email, Card, SSN, Aadhaar, PAN, and Phone', () => {
    const piiText = [
        'Contact: alice.doe@example.org',
        'Card: 4000-0000-0000-0002',
        'SSN: 123-45-6789',
        'Aadhaar: 2000 0000 0009',
        'PAN: AAAPA1234A',
        'Phone: +1-555-867-5309'
    ].join('\n');

    const res = scanDlp(piiText, { maskPii: true });
    assert.equal(res.decision, 'MASK');
    assert.ok(res.sanitizedText.includes('[REDACTED_EMAIL_1]'));
    assert.ok(res.sanitizedText.includes('[REDACTED_CARD_1]'));
    assert.ok(res.sanitizedText.includes('[REDACTED_SSN_1]'));
    assert.ok(res.sanitizedText.includes('[REDACTED_AADHAAR_1]'));
    assert.ok(res.sanitizedText.includes('[REDACTED_PAN_1]'));
    assert.ok(res.sanitizedText.includes('[REDACTED_PHONE_1]'));
    assert.ok(!res.sanitizedText.includes('alice.doe@example.org'));
});

test('DLP Engine 3.2: Masking Stability - Same PII gets identical placeholder in same context', () => {
    const context = {
        placeholderToRaw: new Map(),
        rawToPlaceholder: new Map(),
        counters: { EMAIL: 0 }
    };

    const turn1 = 'Reach out at user.first@example.org today';
    const res1 = scanDlp(turn1, { maskPii: true, context });
    assert.ok(res1.sanitizedText.includes('[REDACTED_EMAIL_1]'));

    const turn2 = 'Reminder: Send email to user.first@example.org and user.second@example.org';
    const res2 = scanDlp(turn2, { maskPii: true, context });
    assert.ok(res2.sanitizedText.includes('[REDACTED_EMAIL_1]'), 'First email retains [REDACTED_EMAIL_1]');
    assert.ok(res2.sanitizedText.includes('[REDACTED_EMAIL_2]'), 'Second email gets [REDACTED_EMAIL_2]');
});

test('DLP Engine 3.3: Zero Sensitive Text Exposure Invariant in Findings and Objects', () => {
    const secret = 'AKIAIOSFODNN7EXAMPLE';
    const res = scanDlp(`Here is key ${secret}`);

    for (const f of res.findings) {
        assert.ok('ruleId' in f);
        assert.ok('category' in f);
        assert.ok('severity' in f);
        assert.ok('count' in f);
        assert.equal('matchedStr' in f, false, 'No raw match in finding');
        assert.equal('value' in f, false, 'No value in finding');
        assert.equal('hash' in f, false, 'No hash in finding');
    }

    const serializedFindings = JSON.stringify(res.findings);
    assert.ok(!serializedFindings.includes(secret), 'Findings must never contain secret text');
});

// =========================================================================
// Suite 4: DLP Gateway, Policy Modes, and In-Memory Rehydration
// =========================================================================

test('DLP Gateway 4.1: Gateway routes outbound traffic and manages reversible rehydration', () => {
    clearConversationDlpContext('conv-101');

    const prompt = 'My email is member@example.com for notifications';
    const gatewayRes = dlpGateway(prompt, { conversationId: 'conv-101', channel: 'composer' });
    assert.equal(gatewayRes.decision, 'MASK');
    assert.ok(gatewayRes.sanitizedText.includes('[REDACTED_EMAIL_1]'));

    // Simulated assistant response using the placeholder
    const assistantReply = 'I have set notifications for [REDACTED_EMAIL_1].';
    const rehydrated = rehydrateText(assistantReply, 'conv-101');
    assert.equal(rehydrated, 'I have set notifications for member@example.com.');

    // Clear context and verify rehydration no longer operates
    clearConversationDlpContext('conv-101');
    const afterClear = rehydrateText(assistantReply, 'conv-101');
    assert.equal(afterClear, assistantReply, 'Context cleared: placeholders unchanged');
});

test('DLP Gateway 4.2: Redact and Send Mode converts credentials to [REDACTED_SECRET_1]', () => {
    clearConversationDlpContext('conv-102');

    const prompt = 'Deploying with AKIAIOSFODNN7EXAMPLE';
    const gatewayRes = dlpGateway(prompt, {
        conversationId: 'conv-102',
        channel: 'composer',
        redactCredentials: true
    });
    assert.equal(gatewayRes.decision, 'MASK');
    assert.ok(gatewayRes.sanitizedText.includes('[REDACTED_SECRET_1]'));
    assert.ok(!gatewayRes.sanitizedText.includes('AKIAIOSFODNN7EXAMPLE'));

    // Rehydration restores secret locally in memory
    const restored = rehydrateText('Status for [REDACTED_SECRET_1] is OK', 'conv-102');
    assert.equal(restored, 'Status for AKIAIOSFODNN7EXAMPLE is OK');
    clearConversationDlpContext('conv-102');
});

test('DLP Gateway 4.3: Policy Mode and Feature Flags', () => {
    // Mode defaults
    assert.ok(['personal', 'enforced'].includes(getDlpPolicyMode()));
    assert.equal(typeof isDlpEnabled(), 'boolean');
    assert.equal(typeof isPiiMaskingEnabled(), 'boolean');

    // Disabled DLP pass-through
    const originalEnv = process.env.DLP_ENABLED;
    try {
        process.env.DLP_ENABLED = 'false';
        const res = dlpGateway('My key is AKIAIOSFODNN7EXAMPLE', { channel: 'test' });
        assert.equal(res.decision, 'ALLOW');
        assert.equal(res.findings.length, 0);
    } finally {
        if (originalEnv !== undefined) {
            process.env.DLP_ENABLED = originalEnv;
        } else {
            delete process.env.DLP_ENABLED;
        }
    }
});

// =========================================================================
// Suite 5: Observability & Compliance Diagnostics Ring Buffer
// =========================================================================

test('Observability 5.1: Ring buffer bounds, schema v1, and zero-sensitive logging', () => {
    clearLocalDiagnostics();

    // Fill buffer beyond MAX_AUDIT_EVENTS (100)
    for (let i = 0; i < 115; i++) {
        recordDlpAudit({
            channel: 'test',
            ruleId: `rule_${i}`,
            category: 'test_category',
            action: 'block',
            count: 1
        });
    }

    const events = getComplianceAuditEvents();
    assert.equal(events.length, MAX_AUDIT_EVENTS, `Ring buffer must be capped at ${MAX_AUDIT_EVENTS}`);

    // Verify schema v1
    const latestEvent = events[events.length - 1];
    assert.ok(latestEvent.id);
    assert.equal(latestEvent.type, 'dlp_inspection');
    assert.ok(typeof latestEvent.ts === 'number');
    assert.equal(latestEvent.channel, 'test');
    assert.equal(latestEvent.action, 'block');

    // Export local diagnostics
    const rawExport = exportLocalDiagnostics();
    assert.equal(typeof rawExport, 'string');
    const exportDoc = JSON.parse(rawExport);
    assert.equal(exportDoc.schemaVersion, COMPLIANCE_SCHEMA_VERSION);
    assert.ok(exportDoc.generatedAt);
    assert.equal(exportDoc.events.length, MAX_AUDIT_EVENTS);

    // Assert zero sensitive text in exported diagnostics
    const serializedExport = JSON.stringify(exportDoc);
    assert.ok(!serializedExport.includes('AKIAIOSFODNN7EXAMPLE'));

    // Clear diagnostics
    clearLocalDiagnostics();
    assert.equal(getComplianceAuditEvents().length, 0);
});

test('Observability 5.2: Feedback and Routing audit events', () => {
    clearLocalDiagnostics();

    recordFeedbackAudit({
        turnId: 'turn-999',
        rating: 1,
        tags: ['helpful', 'precise'],
        hasComment: true
    });

    recordRoutingAudit({
        route: 'chat-groq',
        model: 'llama-3.3-70b',
        latencyMs: 345
    });

    const events = getComplianceAuditEvents();
    assert.equal(events.length, 2);
    assert.equal(events[0].type, 'feedback');
    assert.equal(events[0].rating, 1);
    assert.equal(events[1].type, 'routing');
    assert.equal(events[1].route, 'chat-groq');
    clearLocalDiagnostics();
});

// =========================================================================
// Suite 6: Telemetry Exporter Non-blocking Execution
// =========================================================================

test('Telemetry Exporter 6.1: Graceful non-blocking execution when unconfigured', async () => {
    const isConfigured = isTelemetryExporterConfigured();
    assert.equal(typeof isConfigured, 'boolean');

    // exportTraceSpan does not throw when exporter is not configured
    const traceSuccess = await exportTraceSpan({
        traceId: 'tr-1',
        route: 'test-route',
        model: 'test-model',
        latencyMs: 120,
        dlpAction: 'ALLOW'
    });
    assert.equal(typeof traceSuccess, 'boolean');

    // exportFeedbackScore does not throw
    const fbSuccess = await exportFeedbackScore({
        traceId: 'tr-1',
        turnId: 'turn-1',
        score: 1,
        tags: ['good']
    });
    assert.equal(typeof fbSuccess, 'boolean');
});

// =========================================================================
// Suite 7: Feedback API Endpoint
// =========================================================================

test('Feedback API 7.1: Method validation, score recording, and DLP scanning', async () => {
    // 1. Reject non-POST methods with 405
    const getReq = createMockRequest('/api/feedback', {}, { method: 'GET' });
    const getRes = createMockResponse();
    await feedbackHandler(getReq, getRes);
    assert.equal(getRes.statusCode, 405, 'GET method rejected with 405');

    // 2. Valid positive feedback accepted
    const validReq = createMockRequest('/api/feedback', {
        turnId: 'turn-001',
        score: 1,
        tags: ['accurate'],
        comment: 'Very helpful response!'
    });
    const validRes = createMockResponse();
    await feedbackHandler(validReq, validRes);
    assert.equal(validRes.statusCode, 200);
    assert.equal(validRes.body.success, true);

    // 3. Feedback comment containing credentials is BLOCKED with 400 dlp_violation
    const secretCommentReq = createMockRequest('/api/feedback', {
        turnId: 'turn-002',
        score: -1,
        tags: ['error'],
        comment: 'Fails with AKIAIOSFODNN7EXAMPLE key'
    });
    const secretRes = createMockResponse();
    await feedbackHandler(secretCommentReq, secretRes);
    assert.equal(secretRes.statusCode, 400);
    assert.equal(secretRes.body.code, 'dlp_violation');

    // 4. Feedback comment containing PII is masked
    const piiCommentReq = createMockRequest('/api/feedback', {
        turnId: 'turn-003',
        score: 1,
        comment: 'Please email me at user.contact@example.org'
    });
    const piiRes = createMockResponse();
    await feedbackHandler(piiCommentReq, piiRes);
    assert.equal(piiRes.statusCode, 200);
    assert.equal(piiRes.body.success, true);
});

// =========================================================================
// Suite 8: Diagnostics API Endpoint
// =========================================================================

test('Diagnostics API 8.1: Exposes compliance status metadata', async () => {
    const req = createMockRequest('/api/diagnostics', {}, { method: 'GET' });
    const res = createMockResponse();
    await diagnosticsHandler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.ok(res.body.diagnostics?.compliance, 'Compliance metadata must be present');
    assert.equal(typeof res.body.diagnostics.compliance.dlpEnabled, 'boolean');
    assert.ok(['personal', 'enforced'].includes(res.body.diagnostics.compliance.policyMode));
    assert.equal(typeof res.body.diagnostics.compliance.telemetryExportEnabled, 'boolean');
    assert.equal(typeof res.body.diagnostics.compliance.exporterConfigured, 'boolean');
    assert.equal(typeof res.body.diagnostics.compliance.feedbackEnabled, 'boolean');
});

// =========================================================================
// Suite 9: Server-Side Parity & Protection (Chat & Search)
// =========================================================================

test('Server Parity 9.1: Chat API (api/chat-groq.js) blocks credentials with HTTP 400 dlp_violation', async () => {
    const chatReq = createMockRequest('/api/chat-groq', {
        message: 'Here is my AWS key: AKIAIOSFODNN7EXAMPLE'
    });
    const chatRes = createMockResponse();
    await chatHandler(chatReq, chatRes);

    assert.equal(chatRes.statusCode, 400);
    assert.equal(chatRes.body.code, 'dlp_violation');
    assert.equal(chatRes.body.category, 'cloud_credential');
    assert.ok(chatRes.body.error);
});

test('Server Parity 9.2: Search API (api/search.js) blocks credentials with HTTP 400 dlp_violation', async () => {
    const searchReq = createMockRequest('/api/search', {
        query: 'Lookup credentials for AKIAIOSFODNN7EXAMPLE'
    });
    const searchRes = createMockResponse();
    await searchHandler(searchReq, searchRes);

    assert.equal(searchRes.statusCode, 400);
    assert.equal(searchRes.body.code, 'dlp_violation');
    assert.equal(searchRes.body.category, 'cloud_credential');
});

// =========================================================================
// Suite 10: Memory & Image Generator Outbound Interception
// =========================================================================

test('Memory Extraction 10.1: Utterances with credentials are never extracted into memory', () => {
    const secretUtterance = 'I work as developer and my AWS key is AKIAIOSFODNN7EXAMPLE';
    const shouldIgnore = shouldIgnoreForExtraction(secretUtterance);
    assert.equal(shouldIgnore, true, 'Utterance with credential must be ignored for memory extraction');
});

test('Image Generator 10.2: Prompts with credentials throw and are blocked', async () => {
    await assert.rejects(
        async () => {
            await generateImage({
                prompt: 'A painting of AKIAIOSFODNN7EXAMPLE on a canvas'
            });
        },
        /blocked by policy|credentials/i,
        'Prompt with credential must be rejected'
    );
});

// =========================================================================
// Suite 11: UI and CSS Structure Verification
// =========================================================================

test('UI Verification 11.1: Index.html has required compliance, DLP, and feedback elements', () => {
    // Composer DLP tray
    assert.ok(indexHtml.includes('id="composer-dlp-tray"'), 'Must have #composer-dlp-tray');

    // Settings modal Compliance subview
    assert.ok(indexHtml.includes('id="settings-view-compliance"'), 'Must have #settings-view-compliance');
    assert.ok(indexHtml.includes('id="compliance-policy-badge"'), 'Must have #compliance-policy-badge');
    assert.ok(indexHtml.includes('id="compliance-audit-list"'), 'Must have #compliance-audit-list');
    assert.ok(indexHtml.includes('id="btn-export-diagnostics"'), 'Must have #btn-export-diagnostics');
    assert.ok(indexHtml.includes('id="btn-clear-diagnostics"'), 'Must have #btn-clear-diagnostics');

    // Feedback thumbs button handlers
    assert.ok(indexHtml.includes('handleAssistantPositiveFeedback'), 'Must have handleAssistantPositiveFeedback');
    assert.ok(indexHtml.includes('handleAssistantNegativeFeedbackClick'), 'Must have handleAssistantNegativeFeedbackClick');
});

test('UI Verification 11.2: Styles.css contains required compliance and feedback classes', () => {
    assert.ok(stylesCss.includes('.composer-dlp-tray'), 'styles.css must style .composer-dlp-tray');
    assert.ok(stylesCss.includes('.composer-dlp-banner'), 'styles.css must style .composer-dlp-banner');
    assert.ok(stylesCss.includes('.assistant-feedback-popover'), 'styles.css must style .assistant-feedback-popover');
    assert.ok(stylesCss.includes('.feedback-tag-chip'), 'styles.css must style .feedback-tag-chip');
    assert.ok(stylesCss.includes('.compliance-badge'), 'styles.css must style .compliance-badge');
    assert.ok(stylesCss.includes('.compliance-status-dot'), 'styles.css must style .compliance-status-dot');
});
