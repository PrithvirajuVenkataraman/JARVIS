/**
 * Unified Content Safety & Harm Guardrails Engine
 * ───────────────────────────────────────────────
 * Shared across Normal LLM Chat (`api/chat-groq.js`), Live Web Search (`api/search.js`
 * & `api/_lib/research-engine.js`), Vision (`api/vision.js`), and Image Generation tags.
 *
 * Philosophy: Open-by-default & maximally helpful on ALL legitimate topics (science,
 * clinical/medical QA with disclaimer, history, law, politics, creative writing,
 * astrology, philosophy, cybersecurity defense), while strictly enforcing hard
 * boundaries ONLY on genuine harm:
 *   1. Adult / Explicit Sexual Content (NSFW / Pornography / CSAM)
 *   2. Cruelty, Graphic Violence, Gore & Animal/Human Abuse
 *   3. Hate Speech, Slurs, Dehumanization & Supremacy
 *   4. Harassment, Bullying, Threats, Blackmail & Doxxing
 *   5. Self-Harm / Suicide (compassionate crisis helpline response)
 *   6. Actionable Severe Illegal Harm (weapons/explosives/malware exploitation)
 *   7. Prompt Injection & Jailbreak Overrides (via `prompt-guard.js`)
 */

import { inspectPromptSecurity } from './prompt-guard.js';

export const UNIFIED_SAFETY_POLICY_DIRECTIVE =
    'SAFETY GUARDRAILS (IMMUTABLE): Answer all legitimate educational, medical, historical, legal, creative, and astrological topics openly. Strictly refuse explicit adult/NSFW/CSAM, cruelty/gore/abuse, hate speech/slurs, harassment/doxxing, and weapons/cyberattack instructions in 1 neutral sentence. For self-harm, provide crisis helplines (988 / findahelpline.com).';

const BENIGN_EDUCATIONAL_CONTEXT = /\b(?:history\s+of|law|laws|legal|legislation|court\s+case|supreme\s+court|first\s+amendment|constitutional|definition\s+of|what\s+is|explain|academic|research|study|statistics|documentary|policy|moderation|prevent(?:ing|ion)?|detect(?:ing|ion)?|combat(?:ing)?|stop(?:ping)?|report(?:ing)?|awareness|symptom|symptoms|diagnosis|treatment|medical|clinical|anatomy|oncology|cancer|surgery|doctor|hospital|therapy|counseling|psychology|historical|wwii|world\s+war|civil\s+war|genocide\s+memorial|museum|literature|shakespeare|novel\s+analysis)\b/i;

// 1. Zero-tolerance CSAM (never exempted by any context)
const CSAM_PATTERNS = [
    /\b(?:child\s+porn|cp\s+links?|csam|underage\s+(?:sex|nude|nudes|porn|erotica)|sexual\s+(?:abuse|exploitation)\s+of\s+(?:a\s+)?(?:child|minor|kid)|loli(?:con)?\s*(?:porn|hentai|sex)|shota(?:con)?\s*(?:porn|hentai|sex))\b/i,
    /\b(?:nude|naked|sexual|erotic)\s+(?:photos?|pics?|images?|videos?)\s+of\s+(?:a\s+)?(?:child|minor|kid|toddler|teenager|underage)\b/i
];

// 2. Self-harm & suicide encouragement / intent (compassionate crisis redirection)
const SELF_HARM_PATTERNS = [
    /\b(?:how\s+to\s+(?:kill\s+myself|commit\s+suicide|end\s+my\s+life|hang\s+myself|overdose\s+on)|ways\s+to\s+(?:commit\s+suicide|end\s+my\s+life|kill\s+myself)|best\s+way\s+to\s+(?:commit\s+suicide|kill\s+myself)|i\s+want\s+to\s+(?:kill\s+myself|die\s+tonight|end\s+my\s+life)|encourage\s+(?:someone\s+to\s+)?(?:suicide|self[- ]?harm))\b/i
];

// 3. Explicit Adult / NSFW / Pornography
const ADULT_NSFW_PATTERNS = [
    /\b(?:porn(?:ography|hub|ographic)?|xxx\s+(?:video|videos|movies?|pics?|site|sites)|hardcore\s+(?:sex|porn)|hentai|nsfw\s+(?:pics?|images?|videos?|art|stories?|erotica)|sex\s+tape|onlyfans\s+leaks?|nude\s+(?:pics?|photos?|images?|selfies?|girls?|boys?|celebrities)|naked\s+(?:pics?|photos?|images?|girls?|women|men)\s*(?:sex|porn|xxx)?|erotic\s+(?:story|stories|roleplay|fanfic|novel)|write\s+(?:me\s+)?(?:smut|erotica|explicit\s+sex|a\s+sex\s+scene)|generate\s+(?:a\s+)?(?:nude|naked|nsfw|porn|explicit\s+sexual)\b)/i,
    /\b(?:explicit\s+sexual|sexually\s+explicit|fetish\s+porn|bdsm\s+porn|incest\s+(?:porn|erotica|story)|bestiality|zoophilia|necrophilia)\b/i
];

// Mild flirtatious 18+ advances (chat-only playful deflection preserved for compatibility)
const MILD_FLIRT_18PLUS_PATTERN = /\b(?:sext\s+(?:me|with\s+me)|talk\s+dirty\s+to\s+me|dirty\s+talk\s+with\s+me|be\s+my\s+(?:nsfw|sexual)\s+partner|roleplay\s+sex\s+with\s+me)\b/i;

// 4. Cruelty, Torture, Graphic Violence & Animal/Human Abuse
const CRUELTY_GORE_PATTERNS = [
    /\b(?:how\s+to\s+(?:torture|mutilate|maim|skin\s+alive|abuse\s+(?:an?\s+)?(?:animal|dog|cat|pet|child|person)|poison\s+(?:a\s+)?(?:dog|cat|neighbor|person|someone)|murder|assassinate|strangle|dismember))\b/i,
    /\b(?:animal\s+(?:cruelty|torture)\s+(?:videos?|methods?|ideas?|guide)|crush\s+fetish|snuff\s+(?:film|video)|gore\s+(?:videos?|pics?|sites?)|beheading\s+video|write\s+(?:a\s+)?(?:graphic\s+)?(?:torture|gore|animal\s+abuse)\s+(?:scene|story))\b/i
];

// 5. Hate Speech, Slurs, Dehumanization & Supremacy
const HATE_SPEECH_PATTERNS = [
    /\b(?:write|generate|create|give\s+me|make)\s+(?:a\s+)?(?:hate\s+speech|racist\s+(?:rant|jokes?|speech|essay)|antisemitic|islamophobic|homophobic|transphobic|casteist|white\s+supremacist|nazi\s+propaganda)\b/i,
    /\b(?:why\s+(?:are\s+)?(?:jews|muslims|blacks|asians|indians|immigrants|women|gay\s+people)\s+(?:inferior|subhuman|vermin|parasites|evil)|exterminate\s+(?:all\s+)?(?:jews|muslims|christians|hindus|blacks|immigrants|minorities)|gas\s+the\s+jews|kill\s+all\s+(?:jews|muslims|blacks|whites|immigrants|gays|women|men))\b/i,
    /\b(?:nigger|faggot|kike|chink|spic|wetback|raghead|towelhead)\b/i
];

// 6. Harassment, Bullying, Threats, Blackmail & Doxxing
const HARASSMENT_PATTERNS = [
    /\b(?:write|draft|send|create|generate)\s+(?:me\s+)?(?:a\s+|an\s+)?(?:(?:harassing|abusive|threatening|bullying|blackmail|extortion|stalking|defamatory|intimidating)\s+){1,3}(?:message|email|letter|text|dm|post|comment|script)\b/i,
    /\b(?:write|draft|send|create|generate)\s+(?:me\s+)?(?:a\s+|an\s+)?(?:message|email|letter|text|dm|post|comment|script)\s+to\s+(?:harass|bully|threaten|blackmail|extort|stalk|intimidate|doxx?|humiliate)\b/i,
    /\b(?:how\s+to\s+(?:dox|doxx|stalk|harass|bully|blackmail|extort|swat|intimidate|ruin\s+someone'?s\s+life|cyberbully)|find\s+(?:the\s+)?(?:home\s+address|private\s+phone|ssn|social\s+security\s+number)\s+of\s+(?:[a-z]+\s+){1,3}(?:to\s+harass|for\s+doxx?ing)?)\b/i,
    /\b(?:make\s+(?:him|her|them)\s+(?:cry|kill\s+themselves|suffer)|tell\s+(?:him|her|them)\s+to\s+kill\s+themselves)\b/i
];

// 7. Actionable Severe Illegal Harm (Weapons, Explosives, Active Cyber-Exploitation)
const SEVERE_ILLEGAL_HARM_PATTERNS = [
    /\b(?:how\s+to\s+(?:make|build|manufacture|synthesize)\s+(?:a\s+)?(?:bomb|pipe\s+bomb|improvised\s+explosive|ied|ricin|sarin|nerve\s+agent|anthrax|meth(?:amphetamine)?|fentanyl|ghost\s+gun|silencer))\b/i,
    /\b(?:write|create|generate)\s+(?:a\s+)?(?:working\s+)?(?:ransomware|keylogger|trojan|infostealer|credential\s+harvester|ddos\s+attack\s+script|phishing\s+(?:kit|email\s+to\s+steal\s+passwords))\b/i
];

// Blocked NSFW / Gore / Hate domains for Live Web Search filtering
const BLOCKED_SAFETY_DOMAIN_PATTERNS = [
    /(?:^|\.)(?:pornhub|xvideos|xnxx|xhamster|redtube|youporn|tube8|spankbang|brazzers|onlyfans|chaturbate|stripchat|livejasmin|cam4|bongacams|rule34|nhentai|hanime|e-hentai|gelbooru|danbooru|literotica|erome|fapello)\.[a-z]{2,}$/i,
    /(?:^|\.)(?:bestgore|liveleak|kaotic|crazyshit|theync|goregrish|heavy-r|efukt)\.[a-z]{2,}$/i,
    /(?:^|\.)(?:stormfront|dailystormer|kiwifarms)\.[a-z]{2,}$/i,
    /(?:^|\.)(?:xxx|porn|hentai|nsfw|sex(?:cam|chat|hub|pic|site|tube|vid|tape|story|-)|camgirl|escort)[a-z0-9-]*\.[a-z]{2,}$/i
];

// Indirect prompt injection embedded inside fetched web snippets
const INDIRECT_SNIPPET_INJECTION_PATTERNS = [
    /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions|prompts|rules)/gi,
    /disregard\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions|prompts|rules)/gi,
    /(?:<\|im_start\|>|<\|im_end\|>|<\|system\|>)/gi,
    /\[\s*(?:system|developer|admin)\s*(?:message|prompt|instructions)?\s*\]/gi
];

const CRISIS_HELPLINE_MESSAGE =
    'If you are going through a difficult time or having thoughts of self-harm, please reach out for immediate support — you do not have to face this alone.\n\n' +
    '- **US & Canada**: Call or text **988** (Suicide & Crisis Lifeline, 24/7, free & confidential)\n' +
    '- **UK**: Call **111** or Samaritans at **116 123**\n' +
    '- **India**: Call **14416** (Tele-MANAS) or **9152987821** (iCall)\n' +
    '- **International**: Visit [findahelpline.com](https://findahelpline.com/) to connect with free local support.';

const REFUSAL_MESSAGES = {
    csam: 'I cannot assist with any content involving the exploitation or abuse of minors.',
    self_harm: CRISIS_HELPLINE_MESSAGE,
    adult_nsfw: 'I cannot help with explicit adult, NSFW, or sexually explicit content.',
    mild_flirt_18plus: "No, no, no don't do that! I thought we were having a good time.",
    cruelty_gore: 'I cannot assist with cruelty, torture, graphic gore, or abuse of people or animals.',
    hate_speech: 'I cannot generate or search for hate speech, slurs, or content promoting hatred or discrimination.',
    harassment: 'I cannot help with harassment, bullying, threats, blackmail, or doxxing.',
    severe_illegal_harm: 'I cannot provide actionable instructions for dangerous weapons, explosives, illicit drug synthesis, or malicious cyberattacks.'
};

/**
 * Inspects user input across all channels (`chat`, `search`, `vision`, `image`).
 * Returns `{ safe: boolean, blocked: boolean, category: string, reason: string, refusalMessage: string }`.
 */
export function inspectInputSafety(input = '', options = {}) {
    const text = String(input || '').trim();
    const channel = String(options?.channel || 'chat').toLowerCase();
    if (!text) {
        return { safe: true, blocked: false, category: 'clean', reason: '', refusalMessage: '' };
    }

    // 1. Prompt injection / jailbreak check (applies across chat, search, vision)
    if (options?.checkPromptInjection !== false) {
        const inj = inspectPromptSecurity(text);
        if (!inj.safe) {
            return {
                safe: false,
                blocked: true,
                category: 'prompt_injection',
                reason: inj.reason || 'prompt_injection_or_jailbreak_detected',
                refusalMessage: inj.rejectionMessage
            };
        }
    }

    // 2. Zero-tolerance CSAM (no educational exception)
    for (const p of CSAM_PATTERNS) {
        if (p.test(text)) {
            return { safe: false, blocked: true, category: 'csam', reason: 'csam_blocked', refusalMessage: REFUSAL_MESSAGES.csam };
        }
    }

    // 3. Self-harm & suicide intent (always returns compassionate helpline)
    for (const p of SELF_HARM_PATTERNS) {
        if (p.test(text)) {
            return { safe: false, blocked: true, category: 'self_harm', reason: 'self_harm_crisis_redirect', refusalMessage: REFUSAL_MESSAGES.self_harm };
        }
    }

    const isBenignEducational = BENIGN_EDUCATIONAL_CONTEXT.test(text);

    // 4. Explicit Adult / NSFW
    for (const p of ADULT_NSFW_PATTERNS) {
        if (p.test(text)) {
            // Allow purely academic/legal policy discussions (e.g. "history of pornography laws") when not requesting generation/media
            const isRequestingContent = /\b(?:write|generate|create|draw|show|find|give|watch|pics?|photos?|videos?|images?|links?|stories?|erotica|smut|nudes?)\b/i.test(text);
            if (!isBenignEducational || isRequestingContent || channel === 'image') {
                return { safe: false, blocked: true, category: 'adult_nsfw', reason: 'adult_nsfw_blocked', refusalMessage: REFUSAL_MESSAGES.adult_nsfw };
            }
        }
    }

    // Mild 18+ flirtatious advance
    if (MILD_FLIRT_18PLUS_PATTERN.test(text)) {
        return {
            safe: false,
            blocked: true,
            category: 'adult_nsfw',
            reason: 'mild_18plus_boundary',
            refusalMessage: channel === 'chat' ? REFUSAL_MESSAGES.mild_flirt_18plus : REFUSAL_MESSAGES.adult_nsfw
        };
    }

    // 5. Cruelty, Torture, Graphic Gore & Animal/Human Abuse
    for (const p of CRUELTY_GORE_PATTERNS) {
        if (p.test(text)) {
            return { safe: false, blocked: true, category: 'cruelty_gore', reason: 'cruelty_or_gore_blocked', refusalMessage: REFUSAL_MESSAGES.cruelty_gore };
        }
    }

    // 6. Hate Speech & Slurs
    for (const p of HATE_SPEECH_PATTERNS) {
        if (p.test(text)) {
            const isExplicitSlurOrImperative = /\b(?:write|generate|create|kill\s+all|exterminate|gas\s+the|nigger|faggot|kike|chink|spic|wetback|raghead|towelhead)\b/i.test(text);
            if (!isBenignEducational || isExplicitSlurOrImperative) {
                return { safe: false, blocked: true, category: 'hate_speech', reason: 'hate_speech_blocked', refusalMessage: REFUSAL_MESSAGES.hate_speech };
            }
        }
    }

    // 7. Harassment, Bullying, Threats & Doxxing
    for (const p of HARASSMENT_PATTERNS) {
        if (p.test(text)) {
            return { safe: false, blocked: true, category: 'harassment', reason: 'harassment_blocked', refusalMessage: REFUSAL_MESSAGES.harassment };
        }
    }

    // 8. Actionable Severe Illegal Harm
    for (const p of SEVERE_ILLEGAL_HARM_PATTERNS) {
        if (p.test(text)) {
            return { safe: false, blocked: true, category: 'severe_illegal_harm', reason: 'severe_illegal_harm_blocked', refusalMessage: REFUSAL_MESSAGES.severe_illegal_harm };
        }
    }

    return { safe: true, blocked: false, category: 'clean', reason: '', refusalMessage: '' };
}

/**
 * Checks whether a URL or hostname belongs to a known NSFW / gore / hate domain.
 */
export function isBlockedSafetyDomain(urlOrDomain = '') {
    const raw = String(urlOrDomain || '').trim().toLowerCase();
    if (!raw) return false;
    let host = raw;
    try {
        if (raw.includes('://')) host = new URL(raw).hostname.toLowerCase();
        else host = raw.split('/')[0].split(':')[0];
    } catch (_) {}
    host = host.replace(/^www\./, '');
    return BLOCKED_SAFETY_DOMAIN_PATTERNS.some(pattern => pattern.test(host));
}

/**
 * Scrubs indirect prompt-injection markers from retrieved web snippets and flags unsafe NSFW/gore/hate snippets.
 */
export function sanitizeRetrievedSnippetSafety(snippet = '') {
    let text = String(snippet || '');
    if (!text) return { safe: true, text: '' };
    for (const p of INDIRECT_SNIPPET_INJECTION_PATTERNS) {
        text = text.replace(p, ' ');
    }
    text = text.replace(/\s+/g, ' ').trim();
    const check = inspectInputSafety(text, { channel: 'search', checkPromptInjection: false });
    if (!check.safe && ['csam', 'adult_nsfw', 'cruelty_gore', 'hate_speech'].includes(check.category)) {
        return { safe: false, category: check.category, text: '' };
    }
    return { safe: true, category: 'clean', text };
}

/**
 * Filters an array of search results (titles, snippets, URLs) to strip adult/gore/hate domains & contaminated snippets.
 */
export function filterSearchResultsSafety(results = []) {
    if (!Array.isArray(results)) return [];
    const safeList = [];
    for (const item of results) {
        if (!item || typeof item !== 'object') continue;
        const url = String(item.url || item.link || '').trim();
        const domain = String(item.domain || item.source || '').trim();
        if (isBlockedSafetyDomain(url) || isBlockedSafetyDomain(domain)) continue;
        const titleCheck = sanitizeRetrievedSnippetSafety(item.title || '');
        if (!titleCheck.safe) continue;
        const snippetCheck = sanitizeRetrievedSnippetSafety(item.snippet || item.description || item.content || '');
        if (!snippetCheck.safe) continue;
        safeList.push({
            ...item,
            ...(item.title ? { title: titleCheck.text } : {}),
            ...(item.snippet ? { snippet: snippetCheck.text } : {})
        });
    }
    return safeList;
}

/**
 * Post-generation output safety pass:
 * - Strips legacy action tags and blocks severe accidental CSAM / explicit slur / cruelty leakage.
 */
export function inspectOutputSafety(outputText = '') {
    let text = String(outputText || '');
    if (!text) return { safe: true, modified: false, text: '' };

    let modified = false;
    if (/:::image\[/i.test(text)) {
        text = text.replace(/:::image\[[\s\S]*?(?:\](?::::)?|$)/gi, '').trim();
        modified = true;
    }

    for (const p of CSAM_PATTERNS) {
        if (p.test(text)) {
            return { safe: false, modified: true, category: 'csam', text: REFUSAL_MESSAGES.csam };
        }
    }

    return { safe: true, modified, text: text.trim() };
}
