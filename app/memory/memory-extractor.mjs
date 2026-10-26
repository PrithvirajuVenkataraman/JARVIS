/**
 * Pure Fact & Preference Extraction Engine for JARVIS (Schema v1)
 * Extracts personal user facts and preferences from natural conversational turns.
 * Includes strict negative filters, canonical normalization, Jaccard dedup, and slot conflict resolution.
 */

const STOP_WORDS = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'to', 'in',
    'on', 'at', 'by', 'for', 'with', 'about', 'of', 'as', 'it', 'its', 'my', 'your',
    'his', 'her', 'their', 'our', 'this', 'that', 'these', 'those', 'am', 'been',
    'being', 'have', 'has', 'had', 'do', 'does', 'did', 'very', 'really', 'so', 'too',
    'bit', 'little', 'today', 'now', 'right', 'just', 'still', 'always', 'currently'
]);

// Non-occupational predicate descriptors that follow "I am a/an ..."
const NON_OCCUPATION_WORDS = new Set([
    'fan', 'bit', 'little', 'lot', 'big', 'huge', 'supporter', 'follower', 'believer',
    'person', 'human', 'guy', 'girl', 'man', 'woman', 'kid', 'teen', 'amateur', 'beginner',
    'novice', 'user', 'member', 'resident', 'native', 'citizen', 'traveler', 'tourist',
    'tired', 'happy', 'sad', 'hungry', 'sick', 'fine', 'good', 'bad', 'proud', 'glad'
]);

/**
 * Computes token Jaccard similarity between two strings.
 * @param {string} a
 * @param {string} b
 * @returns {number} Value between 0.0 and 1.0
 */
export function calculateTokenJaccard(a, b) {
    const tokensA = new Set(tokenize(a));
    const tokensB = new Set(tokenize(b));
    if (!tokensA.size && !tokensB.size) return 1.0;
    if (!tokensA.size || !tokensB.size) return 0.0;

    let intersectionCount = 0;
    for (const t of tokensA) {
        if (tokensB.has(t)) intersectionCount++;
    }
    const unionSize = tokensA.size + tokensB.size - intersectionCount;
    return unionSize > 0 ? intersectionCount / unionSize : 0;
}

export function tokenize(str) {
    return String(str || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter(t => t.length > 1 && !STOP_WORDS.has(t));
}

/**
 * Checks if candidate capture group is valid (1-4 words, not stop-word-only, no trailing clauses).
 * @param {string} captured
 * @returns {string|null}
 */
export function sanitizeCapturedGroup(captured) {
    if (!captured || typeof captured !== 'string') return null;
    let clean = captured.trim().replace(/^[,\s;:]+|[,\s;:.]+$/g, '');
    // Cut off trailing conversational clauses starting with "and", "but", "because", "when", etc.
    clean = clean.split(/\b(?:and|but|because|when|while|since|although|though|however|so|if|where|who|at\s+(?:a|an|the)|for\s+(?:a|an|the))\b/i)[0].trim();
    // Cut off trailing temporal adverbs and frequency phrases like "recently", "every day", "daily"
    clean = clean.replace(/\b(?:recently|lately|now|currently|today|yesterday|this\s+year|last\s+year|every\s+day|daily|all\s+the\s+time|a\s+few\s+months\s+ago|a\s+while\s+ago)\b/gi, '').trim();
    clean = clean.replace(/^[,\s;:]+|[,\s;:.]+$/g, '');

    const words = clean.split(/\s+/).filter(Boolean);
    if (words.length === 0 || words.length > 5) return null;

    // Reject if all words are stop words
    const nonStop = words.filter(w => !STOP_WORDS.has(w.toLowerCase()));
    if (!nonStop.length) return null;

    return clean;
}

/**
 * Evaluates whether an utterance violates negative guardrails.
 * Returns true if the statement should be IGNORED for automatic extraction.
 * @param {string} text
 * @returns {boolean}
 */
export function shouldIgnoreForExtraction(text) {
    const raw = String(text || '').trim();
    if (!raw || raw.length < 5 || raw.length > 400) return true;

    // 1. Question checks: ends with ? or starts with question phrasing
    if (/\?$/.test(raw)) return true;
    if (/^(?:can\s+you|could\s+you|would\s+you|should\s+i|what\s+is|what\s+are|where\s+is|where\s+are|why\s+is|why\s+do|how\s+do|how\s+can|how\s+is|who\s+is|do\s+i|do\s+you|are\s+you|is\s+it|tell\s+me\s+if)\b/i.test(raw)) {
        return true;
    }

    // 2. Hypothetical checks ("if I were", "suppose I was", "imagine if")
    if (/\b(?:if\s+i\s+(?:were|was)|imagine\s+(?:if|that)\s+i|suppose\s+i|what\s+if\s+i|pretend\s+(?:that\s+)?i|as\s+if\s+i)\b/i.test(raw)) {
        return true;
    }

    // 3. Quoted text checks: entire utterance is inside quotes
    if (/^["'“‘].+["'”’]$/.test(raw)) return true;

    // 4. Third-person statements ("he works as", "she lives in", "they are", "my friend is")
    if (/^(?:he|she|they|my\s+(?:friend|colleague|brother|sister|dad|mom|father|mother|cousin|boss|roommate)|someone)\s+(?:is|works|lives|moved|has|eats|codes)\b/i.test(raw)) {
        return true;
    }

    // 5. Temporary feeling / states: "I am a bit tired", "I am feeling sick", "I am happy"
    if (/\b(?:i\s+am|i'm)\s+(?:a\s+bit|feeling|just|so|pretty|really|super)\s+(?:tired|exhausted|sleepy|sick|ill|happy|sad|upset|hungry|bored|busy)\b/i.test(raw)) {
        return true;
    }

    return false;
}

/**
 * Checks for negation in the clause.
 * @param {string} clause
 * @returns {boolean}
 */
export function hasNegation(clause) {
    return /\b(?:not|don'?t|do\s+not|never|no\s+longer|quit|stopped|ain'?t)\b/i.test(clause);
}

/**
 * Pure function: Extracts candidate personal memories from user utterance.
 * @param {string} utterance
 * @returns {Array<{ text: string, category: string, slot?: string, sensitive?: boolean, confidence: number }>}
 */
export function extract(utterance = '') {
    const raw = String(utterance || '').trim();
    if (shouldIgnoreForExtraction(raw)) return [];

    const candidates = [];

    // --- 1. LOCATION PATTERNS ---
    // "I live in Seattle", "I'm based in Berlin", "I moved to Toronto", "I am living in Austin"
    const locationMatch = raw.match(/\b(?:i\s+(?:currently\s+)?live\s+in|i'm\s+based\s+in|i\s+am\s+based\s+in|i\s+(?:recently\s+)?moved\s+to|i\s+am\s+living\s+in|i'm\s+living\s+in)\s+([^.!?,\n]+)/i);
    if (locationMatch && !hasNegation(raw.slice(0, locationMatch.index + 15))) {
        const place = sanitizeCapturedGroup(locationMatch[1]);
        if (place && !/\b(?:here|there|home|a\s+house|an\s+apartment)\b/i.test(place)) {
            candidates.push({
                text: `Lives in ${capitalizeWords(place)}`,
                category: 'location',
                slot: 'location',
                sensitive: false,
                confidence: 0.95
            });
        }
    }

    // --- 2. PROFESSION / OCCUPATION PATTERNS ---
    // "I work as a software engineer", "I am a dentist", "my job is architect", "my profession is teacher"
    const professionMatch = raw.match(/\b(?:i\s+work\s+as\s+(?:an?|the)?|my\s+job\s+is\s+(?:an?|the)?|my\s+profession\s+is\s+(?:an?|the)?)\s+([^.!?,\n]+)/i);
    if (professionMatch && !hasNegation(raw.slice(0, professionMatch.index + 15))) {
        const job = sanitizeCapturedGroup(professionMatch[1]);
        if (job) {
            candidates.push({
                text: `Works as a ${capitalizeWords(job)}`,
                category: 'occupation',
                slot: 'occupation',
                sensitive: false,
                confidence: 0.95
            });
        }
    } else {
        // "I am a [Job]" — strictly guarded against non-occupations ("I am a bit tired", "I am a fan of X")
        const iAmMatch = raw.match(/\b(?:i\s+am|i'm)\s+(?:an?)\s+([a-zA-Z\s-]+?)(?:[.,;!?\n]|$)/i);
        if (iAmMatch && !hasNegation(raw.slice(0, iAmMatch.index + 10))) {
            const rawJob = sanitizeCapturedGroup(iAmMatch[1]);
            if (rawJob) {
                const firstWord = rawJob.split(/\s+/)[0].toLowerCase();
                if (!NON_OCCUPATION_WORDS.has(firstWord)) {
                    candidates.push({
                        text: `Works as a ${capitalizeWords(rawJob)}`,
                        category: 'occupation',
                        slot: 'occupation',
                        sensitive: false,
                        confidence: 0.85
                    });
                }
            }
        }
    }

    // --- 3. DIET & HEALTH PATTERNS (Flagged sensitive: true) ---
    // "I am vegetarian", "I'm vegan", "I am allergic to peanuts", "I'm gluten-free", "I am lactose intolerant"
    if (/\b(?:i\s+am|i'm)\s+(?:a\s+)?(?:vegetarian|pescatarian)\b/i.test(raw) && !hasNegation(raw)) {
        candidates.push({
            text: 'Diet: Vegetarian',
            category: 'diet_health',
            slot: 'diet',
            sensitive: true,
            confidence: 0.95
        });
    } else if (/\b(?:i\s+am|i'm)\s+(?:a\s+)?vegan\b/i.test(raw) && !hasNegation(raw)) {
        candidates.push({
            text: 'Diet: Vegan',
            category: 'diet_health',
            slot: 'diet',
            sensitive: true,
            confidence: 0.95
        });
    }

    const allergyMatch = raw.match(/\b(?:i\s+am|i'm|i\s+have\s+an?)\s+allergic\s+to\s+([^.!?,\n]+)/i);
    if (allergyMatch && !hasNegation(raw.slice(0, allergyMatch.index + 15))) {
        const allergen = sanitizeCapturedGroup(allergyMatch[1]);
        if (allergen) {
            candidates.push({
                text: `Allergic to ${allergen.toLowerCase()}`,
                category: 'diet_health',
                slot: `allergy_${allergen.toLowerCase().replace(/\s+/g, '_')}`,
                sensitive: true,
                confidence: 0.95
            });
        }
    }

    if (/\b(?:i\s+am|i'm)\s+(?:strictly\s+)?gluten[-\s]?free\b/i.test(raw) && !hasNegation(raw)) {
        candidates.push({
            text: 'Diet: Gluten-free',
            category: 'diet_health',
            slot: 'diet_gluten',
            sensitive: true,
            confidence: 0.95
        });
    }

    // --- 4. PETS & FAMILY PATTERNS ---
    // "I have a dog named Barnaby", "my cat's name is Luna", "have a golden retriever named Max"
    const petNamedMatch = raw.match(/\b(?:i\s+have\s+an?|my)\s+([a-zA-Z]+)(?:'s\s+name\s+is|\s+named|\s+called)\s+([a-zA-Z]+)\b/i);
    if (petNamedMatch && !hasNegation(raw.slice(0, petNamedMatch.index + 15))) {
        const petType = petNamedMatch[1].toLowerCase().trim();
        const petName = capitalizeWords(petNamedMatch[2].trim());
        if (['dog', 'cat', 'puppy', 'kitten', 'parrot', 'hamster', 'rabbit', 'horse', 'golden retriever', 'labrador'].includes(petType) || ['pet'].includes(petType)) {
            candidates.push({
                text: `Has a ${petType} named ${petName}`,
                category: 'pet_family',
                slot: `pet_${petType}`,
                sensitive: false,
                confidence: 0.95
            });
        }
    }

    // --- 5. TECH STACK & PROGRAMMING PATTERNS ---
    // "I code in Python", "my stack is React and Node", "I develop in TypeScript", "I use Go for coding"
    const codeInMatch = raw.match(/\b(?:i\s+code\s+in|i\s+(?:mostly\s+)?develop\s+in|i\s+write\s+code\s+in|i\s+program\s+in)\s+([a-zA-Z0-9#+._\s]+?)(?:[.,;!?\n]|$)/i);
    if (codeInMatch && !hasNegation(raw.slice(0, codeInMatch.index + 15))) {
        const lang = sanitizeCapturedGroup(codeInMatch[1]);
        if (lang) {
            candidates.push({
                text: `Codes in ${lang}`,
                category: 'tech',
                slot: 'primary_language',
                sensitive: false,
                confidence: 0.95
            });
        }
    }

    const myStackMatch = raw.match(/\bmy\s+stack\s+is\s+([^.!?\n]+)/i);
    if (myStackMatch && !hasNegation(raw.slice(0, myStackMatch.index + 15))) {
        const stack = sanitizeCapturedGroup(myStackMatch[1]);
        if (stack) {
            candidates.push({
                text: `Tech stack: ${stack}`,
                category: 'tech',
                slot: 'tech_stack',
                sensitive: false,
                confidence: 0.92
            });
        }
    }

    // --- 6. PREFERENCES & CONSTRAINTS ---
    // "always format as bullets", "be concise", "don't use markdown tables", "never include emojis"
    if (/\b(?:be\s+(?:more\s+)?concise|keep\s+(?:your\s+)?answers?\s+(?:very\s+)?brief|no\s+fluff|give\s+direct\s+answers?)\b/i.test(raw)) {
        candidates.push({
            text: 'Preference: Direct and concise answers with no fluff',
            category: 'preference',
            slot: 'conciseness',
            sensitive: false,
            confidence: 0.95
        });
    }

    const negativeConstraintMatch = raw.match(/\b(?:don'?t|do\s+not|never|avoid|stop)\s+(?:use|using|include|including|give|giving|write|writing)\s+([^.!?\n]{3,80})/i);
    if (negativeConstraintMatch) {
        const subject = sanitizeCapturedGroup(negativeConstraintMatch[1]);
        if (subject) {
            candidates.push({
                text: `Constraint: Avoid ${subject}`,
                category: 'constraint',
                slot: `avoid_${subject.toLowerCase().replace(/\s+/g, '_').slice(0, 30)}`,
                sensitive: false,
                confidence: 0.90
            });
        }
    }

    const alwaysFormatMatch = raw.match(/\b(?:always|from\s+now\s+on\s*,?\s*always|prefer)\s+(?:format\s+(?:in|as)|respond\s+in|answer\s+in)\s+([^.!?\n]{3,80})/i);
    if (alwaysFormatMatch && !hasNegation(raw.slice(0, alwaysFormatMatch.index + 10))) {
        const style = sanitizeCapturedGroup(alwaysFormatMatch[1]);
        if (style) {
            candidates.push({
                text: `Preference: Always format as ${style}`,
                category: 'preference',
                slot: `format_${style.toLowerCase().replace(/\s+/g, '_').slice(0, 30)}`,
                sensitive: false,
                confidence: 0.90
            });
        }
    }

    return candidates;
}

/**
 * Resolves candidates against existing memory list.
 * Applies token Jaccard deduplication (>= 0.8) and slot collision conflict resolution.
 *
 * @param {Array<Object>} candidates - Newly extracted candidates
 * @param {Array<Object>} existingMemories - Active memories from store
 * @returns {{
 *   toAdd: Array<Object>,
 *   toUpdate: Array<{ id: string, patch: Object }>,
 *   toSupersede: Array<{ oldId: string, newCandidate: Object }>
 * }}
 */
export function resolveConflictsAndDedup(candidates = [], existingMemories = []) {
    const toAdd = [];
    const toUpdate = [];
    const toSupersede = [];

    for (const cand of candidates) {
        let isDuplicate = false;
        let slotConflictMatch = null;

        for (const existing of existingMemories) {
            // Check exact text match or high Jaccard similarity (>= 0.8)
            const similarity = calculateTokenJaccard(cand.text, existing.text);
            if (similarity >= 0.8 || cand.text.toLowerCase().trim() === existing.text.toLowerCase().trim()) {
                isDuplicate = true;
                toUpdate.push({
                    id: existing.id,
                    patch: { updatedAt: new Date().toISOString() }
                });
                break;
            }

            // Check slot collision (same category + same slot, e.g. location, occupation, diet)
            if (cand.slot && existing.category === cand.category) {
                // If same slot or slot matches category name
                if (cand.slot === 'location' && existing.text.toLowerCase().startsWith('lives in')) {
                    slotConflictMatch = existing;
                } else if (cand.slot === 'occupation' && existing.text.toLowerCase().startsWith('works as')) {
                    slotConflictMatch = existing;
                } else if (cand.slot === 'diet' && existing.text.toLowerCase().startsWith('diet:')) {
                    slotConflictMatch = existing;
                }
            }
        }

        if (isDuplicate) continue;

        if (slotConflictMatch) {
            toSupersede.push({
                oldId: slotConflictMatch.id,
                newCandidate: cand
            });
        } else {
            toAdd.push(cand);
        }
    }

    return { toAdd, toUpdate, toSupersede };
}

function capitalizeWords(str) {
    return String(str || '')
        .split(/\s+/)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}
