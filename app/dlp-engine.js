/**
 * Pure, deterministic Data Loss Prevention (DLP) engine for Unify (JARVIS).
 * Shared across client (index.html / app/) and serverless backend (api/).
 *
 * Invariant: Never log, store, or transmit matched sensitive text.
 */

// --- 1. Shannon Entropy Calculator ---
export function computeShannonEntropy(str) {
    if (!str || typeof str !== 'string') return 0;
    const len = str.length;
    if (len === 0) return 0;
    const freq = new Map();
    for (let i = 0; i < len; i++) {
        const ch = str[i];
        freq.set(ch, (freq.get(ch) || 0) + 1);
    }
    let entropy = 0;
    for (const count of freq.values()) {
        const p = count / len;
        entropy -= p * Math.log2(p);
    }
    return entropy;
}

// --- 2. Checksum Validators ---

/**
 * Luhn algorithm for Credit Card numbers (13 - 19 digits)
 */
export function isValidLuhn(candidate) {
    const clean = String(candidate || '').replace(/\D/g, '');
    if (clean.length < 13 || clean.length > 19) return false;
    let sum = 0;
    let shouldDouble = false;
    for (let i = clean.length - 1; i >= 0; i--) {
        let digit = parseInt(clean[i], 10);
        if (Number.isNaN(digit)) return false;
        if (shouldDouble) {
            digit *= 2;
            if (digit > 9) digit -= 9;
        }
        sum += digit;
        shouldDouble = !shouldDouble;
    }
    return sum % 10 === 0;
}

/**
 * US Social Security Number (SSN) range validation
 */
export function isValidSsn(candidate) {
    const clean = String(candidate || '').replace(/\D/g, '');
    if (clean.length !== 9) return false;
    const area = parseInt(clean.slice(0, 3), 10);
    const group = parseInt(clean.slice(3, 5), 10);
    const serial = parseInt(clean.slice(5, 9), 10);
    if (area === 0 || area === 666 || area >= 900) return false;
    if (group === 0) return false;
    if (serial === 0) return false;
    return true;
}

/**
 * Verhoeff checksum algorithm for Indian 12-digit Aadhaar numbers
 */
const VERHOEFF_D = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
    [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
];

const VERHOEFF_P = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]
];

export function isValidAadhaar(candidate) {
    const clean = String(candidate || '').replace(/\D/g, '');
    if (clean.length !== 12) return false;
    // Aadhaar numbers do not start with 0 or 1
    if (clean[0] === '0' || clean[0] === '1') return false;
    let c = 0;
    const reversed = clean.split('').reverse().map(Number);
    for (let i = 0; i < reversed.length; i++) {
        c = VERHOEFF_D[c][VERHOEFF_P[i % 8][reversed[i]]];
    }
    return c === 0;
}

/**
 * Indian Income Tax Permanent Account Number (PAN)
 */
export function isValidPan(candidate) {
    const clean = String(candidate || '').replace(/\s+/g, '').toUpperCase();
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(clean)) return false;
    // 4th char is entity status: C, P, H, F, A, T, B, L, J, G
    const status = clean[3];
    return 'CPHFATBLJG'.includes(status);
}

// --- 3. Unicode Normalization & Strip ---
export function normalizeForScan(text, maxChars = 100_000) {
    const raw = String(text || '');
    let truncatedScan = false;
    let target = raw;

    if (target.length > maxChars) {
        truncatedScan = true;
        const half = Math.floor(maxChars / 2);
        target = target.slice(0, half) + '\n...\n' + target.slice(-half);
    }

    // NFKC normalization
    let normalized = target.normalize('NFKC');

    // Strip zero-width characters (ZWSP, ZWNJ, ZWJ, BOM)
    normalized = normalized.replace(/[\u200B-\u200D\uFEFF]/g, '');

    // Strip bidi control characters (LRE, RLE, PDF, LRO, RLO, LRI, RLI, FSI, PDI)
    normalized = normalized.replace(/[\u202A-\u202E\u2066-\u2069]/g, '');

    return { normalized, truncatedScan, originalLength: raw.length };
}

// --- 4. Rule Definitions ---

export const CREDENTIAL_RULES = Object.freeze([
    {
        id: 'cred_aws_key',
        category: 'cloud_credential',
        severity: 'critical',
        action: 'BLOCK',
        // 20-char AWS key identifier starting with AKIA or ASIA
        regex: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g
    },
    {
        id: 'cred_anthropic',
        category: 'ai_api_key',
        severity: 'critical',
        action: 'BLOCK',
        regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g
    },
    {
        id: 'cred_openai',
        category: 'ai_api_key',
        severity: 'critical',
        action: 'BLOCK',
        // Match OpenAI format; must not match "risk-free" or words ending in sk-
        regex: /(?<![A-Za-z0-9])sk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/g
    },
    {
        id: 'cred_groq',
        category: 'ai_api_key',
        severity: 'critical',
        action: 'BLOCK',
        regex: /\bgsk_[A-Za-z0-9]{40,}\b/g
    },
    {
        id: 'cred_github',
        category: 'vcs_token',
        severity: 'critical',
        action: 'BLOCK',
        regex: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/g
    },
    {
        id: 'cred_slack',
        category: 'chat_token',
        severity: 'critical',
        action: 'BLOCK',
        regex: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g
    },
    {
        id: 'cred_google',
        category: 'cloud_credential',
        severity: 'critical',
        action: 'BLOCK',
        regex: /\bAIza[0-9A-Za-z_-]{35}\b/g
    },
    {
        id: 'cred_jwt',
        category: 'auth_token',
        severity: 'critical',
        action: 'BLOCK',
        regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g
    },
    {
        id: 'cred_private_key',
        category: 'crypto_key',
        severity: 'critical',
        action: 'BLOCK',
        // Header match or full block with bounded length to prevent ReDoS
        regex: /-----BEGIN (?:RSA |OPENSSH |EC |DSA |PGP )?PRIVATE KEY-----(?:[A-Za-z0-9+/=\s\r\n]{30,20000}?-----END (?:RSA |OPENSSH |EC |DSA |PGP )?PRIVATE KEY-----)?/g
    },
    {
        id: 'cred_db_uri',
        category: 'database_uri',
        severity: 'critical',
        action: 'BLOCK',
        // Must contain username:password@ before host
        regex: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:@/]+:[^\s@/]+@/g
    },
    {
        id: 'cred_generic',
        category: 'generic_secret',
        severity: 'critical',
        action: 'BLOCK',
        regex: /\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*['"]?([A-Za-z0-9/+_-]{16,})['"]?/gi,
        validator: match => {
            // Extract the secret value capture
            const parts = match.split(/[:=]/);
            if (parts.length < 2) return false;
            const val = parts.slice(1).join(':').replace(/['"\s]/g, '');
            if (val.length < 16) return false;
            // Shannon entropy threshold >= 3.2 to reject low-entropy words like "passwordpassword1"
            const entropy = computeShannonEntropy(val);
            return entropy >= 3.2;
        }
    }
]);

export const PII_RULES = Object.freeze([
    {
        id: 'pii_email',
        category: 'email',
        severity: 'medium',
        action: 'MASK',
        prefix: 'EMAIL',
        regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g
    },
    {
        id: 'pii_card',
        category: 'financial',
        severity: 'high',
        action: 'MASK',
        prefix: 'CARD',
        // Candidates 13-19 digits with optional spaces or dashes
        regex: /\b(?:\d{4}[ -]?){3}\d{1,7}\b|\b3[47]\d{2}[ -]?\d{6}[ -]?\d{5}\b/g,
        validator: isValidLuhn
    },
    {
        id: 'pii_ssn',
        category: 'government_id',
        severity: 'high',
        action: 'MASK',
        prefix: 'SSN',
        regex: /\b\d{3}-\d{2}-\d{4}\b/g,
        validator: isValidSsn
    },
    {
        id: 'pii_aadhaar',
        category: 'government_id',
        severity: 'high',
        action: 'MASK',
        prefix: 'AADHAAR',
        regex: /\b[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}\b/g,
        validator: isValidAadhaar
    },
    {
        id: 'pii_pan',
        category: 'government_id',
        severity: 'high',
        action: 'MASK',
        prefix: 'PAN',
        regex: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g,
        validator: isValidPan
    },
    {
        id: 'pii_phone',
        category: 'phone_number',
        severity: 'medium',
        action: 'MASK',
        prefix: 'PHONE',
        // International (+ prefix) or Indian mobile formats with 10-15 digits
        regex: /(?:(?<!\w)(?:\+91[\s-]?)?[6-9]\d{9}\b)|(?:(?<!\w)\+[1-9]\d{0,3}[\s.-]?(?:\(?\d{1,4}\)?[\s.-]?){1,4}\d{1,4}\b)/g,
        validator: candidate => {
            const digits = candidate.replace(/\D/g, '');
            return digits.length >= 10 && digits.length <= 15;
        }
    }
]);

// --- 5. Scan Engine ---

/**
 * Scans text against DLP rules and generates decision, findings, and sanitized text.
 *
 * @param {string} text - User or conversational text to inspect.
 * @param {object} options
 * @param {boolean} [options.maskPii=true] - Whether PII should be masked.
 * @param {boolean} [options.redactCredentials=false] - If true, replaces credentials with [REDACTED_SECRET_n] instead of BLOCK.
 * @param {object} [options.context] - Persistent placeholder context (maps for stability).
 * @returns {object} { decision: 'ALLOW' | 'BLOCK' | 'MASK', findings: Array, sanitizedText: string, truncatedScan: boolean }
 */
export function scanDlp(text, options = {}) {
    const rawText = String(text || '');
    if (!rawText.trim()) {
        return {
            decision: 'ALLOW',
            findings: [],
            sanitizedText: rawText,
            truncatedScan: false
        };
    }

    const maskPii = options.maskPii !== false;
    const redactCredentials = Boolean(options.redactCredentials);
    const { normalized, truncatedScan } = normalizeForScan(rawText);

    const findings = [];
    let hasCredentialHit = false;
    let hasPiiHit = false;

    // Phase A: Credential rules (BLOCK)
    const credMatches = [];
    for (const rule of CREDENTIAL_RULES) {
        const regex = new RegExp(rule.regex.source, rule.regex.flags);
        let m;
        let matchCount = 0;
        while ((m = regex.exec(normalized)) !== null) {
            const fullMatch = m[0];
            if (rule.validator && !rule.validator(fullMatch)) {
                continue;
            }
            matchCount++;
            credMatches.push({
                ruleId: rule.id,
                category: rule.category,
                matchedStr: fullMatch
            });
        }
        if (matchCount > 0) {
            hasCredentialHit = true;
            findings.push({
                ruleId: rule.id,
                category: rule.category,
                severity: rule.severity,
                count: matchCount
            });
        }
    }

    // If credentials are found and not in "redact and send" mode -> instant BLOCK
    if (hasCredentialHit && !redactCredentials) {
        return {
            decision: 'BLOCK',
            findings,
            sanitizedText: rawText,
            truncatedScan
        };
    }

    // Phase B: PII rules (MASK)
    const piiMatches = [];
    if (maskPii) {
        for (const rule of PII_RULES) {
            const regex = new RegExp(rule.regex.source, rule.regex.flags);
            let m;
            let matchCount = 0;
            while ((m = regex.exec(normalized)) !== null) {
                const fullMatch = m[0];
                if (rule.validator && !rule.validator(fullMatch)) {
                    continue;
                }
                matchCount++;
                piiMatches.push({
                    ruleId: rule.id,
                    category: rule.category,
                    prefix: rule.prefix,
                    matchedStr: fullMatch
                });
            }
            if (matchCount > 0) {
                hasPiiHit = true;
                findings.push({
                    ruleId: rule.id,
                    category: rule.category,
                    severity: rule.severity,
                    count: matchCount
                });
            }
        }
    }

    // Phase C: Masking and Transformation
    let sanitizedText = rawText;
    const context = options.context || {};
    const placeholderToRaw = context.placeholderToRaw || new Map();
    const rawToPlaceholder = context.rawToPlaceholder || new Map();
    const counters = context.counters || {
        SECRET: 0,
        EMAIL: 0,
        CARD: 0,
        SSN: 0,
        AADHAAR: 0,
        PAN: 0,
        PHONE: 0
    };

    // Replace credentials if "redactCredentials" is true
    if (hasCredentialHit && redactCredentials) {
        for (const cred of credMatches) {
            const rawVal = cred.matchedStr;
            let placeholder = rawToPlaceholder.get(rawVal);
            if (!placeholder) {
                counters.SECRET = (counters.SECRET || 0) + 1;
                placeholder = `[REDACTED_SECRET_${counters.SECRET}]`;
                rawToPlaceholder.set(rawVal, placeholder);
                placeholderToRaw.set(placeholder, rawVal);
            }
            // Idempotent replace: replace all exact matches of the raw value
            sanitizedText = sanitizedText.split(rawVal).join(placeholder);
        }
    }

    // Replace PII with stable placeholders
    if (hasPiiHit && maskPii) {
        for (const pii of piiMatches) {
            const rawVal = pii.matchedStr;
            let placeholder = rawToPlaceholder.get(rawVal);
            if (!placeholder) {
                const prefix = pii.prefix || 'PII';
                counters[prefix] = (counters[prefix] || 0) + 1;
                placeholder = `[REDACTED_${prefix}_${counters[prefix]}]`;
                rawToPlaceholder.set(rawVal, placeholder);
                placeholderToRaw.set(placeholder, rawVal);
            }
            // Idempotent replace: replace all exact matches of the raw value
            sanitizedText = sanitizedText.split(rawVal).join(placeholder);
        }
    }

    const decision = (hasCredentialHit && !redactCredentials)
        ? 'BLOCK'
        : (hasCredentialHit || hasPiiHit ? 'MASK' : 'ALLOW');

    return {
        decision,
        findings,
        sanitizedText,
        truncatedScan
    };
}
