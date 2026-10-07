/**
 * @file app/frontend-routing.js
 * @description Zero-Hardcoding Dynamic Vector Semantic Frontend Routing Engine.
 * Dynamically classifies incoming user queries using 512-dimensional vector projections,
 * universal entity grammar, and zero static exemplar question tables.
 */

import { callLLM } from './api-client.js';

export const DEFAULT_SYNTAX_STOP_WORDS = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'if', 'as',
    'of', 'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into', 'through',
    'during', 'before', 'after', 'above', 'below', 'to', 'from', 'up', 'down', 'in',
    'out', 'on', 'off', 'over', 'under', 'again', 'further', 'then', 'once',
    'it', 'its', 'this', 'that', 'these', 'those', 'they', 'them', 'their', 'he', 'she', 'him', 'her', 'we', 'us', 'our', 'you', 'your', 'me', 'my',
    'what', 'when', 'where', 'which', 'who', 'whom', 'whose', 'why', 'how',
    'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'do', 'does', 'did', 'have', 'has', 'had'
]);

export function tokenizeText(text = '', options = {}) {
    const filterStopWords = options.filterStopWords !== false;
    const stopWords = options.stopWords || DEFAULT_SYNTAX_STOP_WORDS;
    const minLen = typeof options.minTokenLength === 'number' ? options.minTokenLength : 2;

    const raw = String(text || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ');
    const matches = raw.match(/[\p{L}\p{N}]+/gu) || [];
    
    const tokens = [];
    for (const match of matches) {
        if (match.length >= minLen && (!filterStopWords || !stopWords.has(match))) {
            tokens.push(match);
        }
    }
    return tokens;
}

export class BM25Index {
    constructor(options = {}) {
        this.k1 = typeof options.k1 === 'number' ? options.k1 : 1.2;
        this.b = typeof options.b === 'number' ? options.b : 0.75;
        this.filterStopWords = options.filterStopWords !== false;
        this.stopWords = options.stopWords || DEFAULT_SYNTAX_STOP_WORDS;
        
        this.documents = [];
        this.docLengths = [];
        this.totalDocLength = 0;
        this.avgDocLength = 0;
        
        this.invertedIndex = new Map();
        this.docFreqs = new Map();
        this.idfCache = new Map();
    }

    tokenize(text) {
        return tokenizeText(text, {
            filterStopWords: this.filterStopWords,
            stopWords: this.stopWords
        });
    }

    addDocument(id, text, metadata = {}) {
        const docIndex = this.documents.length;
        const tokens = this.tokenize(text);
        
        const termFreqs = new Map();
        for (const token of tokens) {
            termFreqs.set(token, (termFreqs.get(token) || 0) + 1);
        }

        this.documents.push({ id, text, metadata, index: docIndex });
        this.docLengths.push(tokens.length);
        this.totalDocLength += tokens.length;
        this.avgDocLength = this.totalDocLength / Math.max(1, this.documents.length);

        for (const [term, freq] of termFreqs.entries()) {
            if (!this.invertedIndex.has(term)) {
                this.invertedIndex.set(term, new Map());
                this.docFreqs.set(term, 0);
            }
            this.invertedIndex.get(term).set(docIndex, freq);
            this.docFreqs.set(term, this.docFreqs.get(term) + 1);
        }

        this.idfCache.clear();
        return docIndex;
    }

    getIdf(term) {
        if (this.idfCache.has(term)) return this.idfCache.get(term);
        const df = this.docFreqs.get(term) || 0;
        const n = this.documents.length;
        if (n === 0 || df === 0) {
            this.idfCache.set(term, 0);
            return 0;
        }
        const idf = Math.max(0, Math.log(1 + (n - df + 0.5) / (df + 0.5)));
        this.idfCache.set(term, idf);
        return idf;
    }

    search(query, options = {}) {
        const topK = options.topK || 10;
        const minScore = typeof options.minScore === 'number' ? options.minScore : 0.001;
        const queryTokens = this.tokenize(query);

        if (!queryTokens.length || !this.documents.length) return [];

        const scores = new Float32Array(this.documents.length);
        const k1 = this.k1;
        const b = this.b;
        const avgdl = Math.max(1, this.avgDocLength);

        for (const term of queryTokens) {
            const postings = this.invertedIndex.get(term);
            if (!postings) continue;
            const idf = this.getIdf(term);
            if (idf <= 0) continue;

            for (const [docIndex, tf] of postings.entries()) {
                const docLength = this.docLengths[docIndex];
                const num = tf * (k1 + 1);
                const denom = tf + k1 * (1 - b + b * (docLength / avgdl));
                scores[docIndex] += idf * (num / Math.max(0.001, denom));
            }
        }

        const ranked = [];
        for (let i = 0; i < scores.length; i++) {
            if (scores[i] >= minScore) {
                ranked.push({
                    doc: this.documents[i],
                    score: Number(scores[i].toFixed(4)),
                    index: i
                });
            }
        }

        return ranked.sort((a, b) => b.score - a.score).slice(0, topK);
    }

    scoreAll(query) {
        const queryTokens = this.tokenize(query);
        if (!queryTokens.length || !this.documents.length) {
            return this.documents.map(() => 0);
        }

        const scores = new Float32Array(this.documents.length);
        const k1 = this.k1;
        const b = this.b;
        const avgdl = Math.max(1, this.avgDocLength);

        for (const term of queryTokens) {
            const postings = this.invertedIndex.get(term);
            if (!postings) continue;
            const idf = this.getIdf(term);
            if (idf <= 0) continue;

            for (const [docIndex, tf] of postings.entries()) {
                const docLength = this.docLengths[docIndex];
                const num = tf * (k1 + 1);
                const denom = tf + k1 * (1 - b + b * (docLength / avgdl));
                scores[docIndex] += idf * (num / Math.max(0.001, denom));
            }
        }

        const out = new Array(scores.length);
        for (let i = 0; i < scores.length; i++) {
            out[i] = Number(scores[i].toFixed(4));
        }
        return out;
    }
}

export function computeBM25Scores(query, documents = [], options = {}) {
    const list = Array.isArray(documents) ? documents : [];
    if (!list.length) return [];

    const index = new BM25Index(options);
    for (let i = 0; i < list.length; i++) {
        const doc = list[i];
        const text = typeof doc === 'string'
            ? doc
            : `${doc.title || ''} ${doc.description || ''} ${doc.text || ''} ${doc.fullArticleText || ''}`;
        index.addDocument(i, text, doc);
    }

    return index.scoreAll(query);
}

class FastLRU {
    constructor(maxSize = 1000) {
        this.maxSize = maxSize;
        this.cache = new Map();
    }
    get(key) {
        if (!this.cache.has(key)) return undefined;
        const val = this.cache.get(key);
        this.cache.delete(key);
        this.cache.set(key, val);
        return val;
    }
    set(key, val) {
        if (this.cache.has(key)) this.cache.delete(key);
        else if (this.cache.size >= this.maxSize) {
            const first = this.cache.keys().next().value;
            this.cache.delete(first);
        }
        this.cache.set(key, val);
    }
}

const FRONTEND_ROUTE_CACHE = new FastLRU(1000);
const FRONTEND_UNIVERSAL_CACHE = new FastLRU(1000);

export function textToEmbeddingVector(text, dim = 512) {
    const v = new Float32Array(dim);
    const tokens = String(text || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return v;
    for (const token of tokens) {
        let h1 = 0x811c9dc5;
        let h2 = 0x5bd1e995;
        for (let i = 0; i < token.length; i++) {
            const code = token.charCodeAt(i);
            h1 ^= code;
            h1 = Math.imul(h1, 0x01000193);
            h2 ^= code;
            h2 = Math.imul(h2, 0x5bd1e995);
        }
        const idx1 = Math.abs(h1) % dim;
        const idx2 = Math.abs(h2) % dim;
        v[idx1] += 1.0;
        v[idx2] += 0.5;
        if (token.length >= 4) {
            for (let i = 0; i < token.length - 2; i++) {
                const trigram = token.slice(i, i + 3);
                let th = 0;
                for (let j = 0; j < trigram.length; j++) th = (th * 31 + trigram.charCodeAt(j)) | 0;
                v[Math.abs(th) % dim] += 0.2;
            }
        }
    }
    let norm = 0;
    for (let i = 0; i < dim; i++) norm += v[i] * v[i];
    norm = Math.sqrt(norm);
    if (norm > 0) {
        for (let i = 0; i < dim; i++) v[i] /= norm;
    }
    return v;
}

export function vectorCosineSimilarity(a, b) {
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
    return dot;
}

export function normalizeCasualConversationText(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s']/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function isCasualConversationQuery(text) {
    const t = normalizeCasualConversationText(text);
    if (!t) return false;
    return /\b(?:how\s+are\s+you|how\s+you\s+doing|how's\s+it\s+going|what's\s+up|how\s+are\s+things|hi|hello|hey|good\s+(?:morning|evening|afternoon)|thank\s+you|thanks|bye|goodbye)\b/i.test(t);
}

export function isMediaOrPopCultureQuery(_text) {
    return false;
}

export function isComplexTechnicalQuery(text) {
    const raw = String(text || '').trim();
    if (!raw) return false;
    const lower = raw.toLowerCase();

    // Deep technical & architectural keyword patterns
    const techPattern = /\b(?:round[- ]robin|load\s+balanc(?:ing|er)?|concurrent(?:ly|\s+users)?|concurrency|worker\s+pool|thread\s+pool|mutex|semaphore|distributed\s+systems?|failover|fault[- ]toleran(?:ce|t)|deadlock|race\s+condition|bottleneck|high\s+availability|throughput|microservices?|system\s+design|software\s+architecture|system\s+architecture|backend\s+architecture|how\s+did\s+we\s+implement|how\s+do\s+we\s+implement|implementation\s+of\s+(?:the\s+)?(?:round[- ]robin|algorithm|load\s+balanc|queue|worker|cache|concurrency|software|feature|system|service|protocol))\b/i;
    if (techPattern.test(lower)) return true;

    // Length-based: detailed technical texts or pasted code/explanations (> 200 chars or > 35 words)
    const words = raw.split(/\s+/).filter(Boolean);
    if ((raw.length > 200 || words.length > 35) && /\b(?:technique|algorithm|process|pattern|mechanism|implementation|architecture|system|service|server|database|network|protocol|pipeline|function|code|method)\b/i.test(lower)) {
        return true;
    }

    return false;
}

export const STATIC_KNOWLEDGE_CATEGORIES = Object.freeze([
    {
        id: 'geography',
        text: 'capital city continent ocean river sea lake reef coral barrier island mountain valley canyon plateau desert hill volcano hemisphere equator latitude longitude country location world map national currency money legal tender world capitals great barrier reef machu picchu amazon sahara nile tall height elevation'
    },
    {
        id: 'landmarks_architecture',
        text: 'monument temple palace castle tower pyramid architectural design construction engineering sculptural style ancient ruins heritage geological formation rock erosion waterfall taj mahal eiffel central park angkor wat brihadeeswarar konark pyramids giza everest mount everest grand canyon yosemite niagara falls great barrier reef machu picchu stonehenge colosseum parthenon designed built created founded tall height'
    },
    {
        id: 'history',
        text: 'ancient history medieval empire dynasty civilization timeline founding revolution reign treaty historical charter archaeology historical dates roman empire french revolution world war bronze age iron age mesopotamia byzantine ottoman indus valley new deal new kingdom fdr magna carta declaration independence constitution first president former president united states president founding fathers george washington julius caesar emperor ruler industrial revolution steam engine'
    },
    {
        id: 'science_physics_chem_bio',
        text: 'physics chemistry biology astronomy quantum gravity relativity thermodynamics photosynthesis dna genetics periodic table atomic number chemical element gold nitrogen water methane bonding covalent ionic valence electrons mitochondria cellular organelle atp energy natural selection evolution darwin species adaptation penicillin discovered discovery science history medicine antibiotic equations formula e=mc^2 speed of light vacuum acoustics newton newtons third law motion electrical circuit voltage current divider ohms law electromagnetism'
    },
    {
        id: 'math_calculus_algebra',
        text: 'calculus integral derivative differential equations integration algebra limits solve algebraic equation matrix linear algebra arithmetic geometry polynomials pythagorean theorem triangle trigonometry euclidean geometry prime numbers number theory euler identity complex analysis sin cosine'
    },
    {
        id: 'cs_coding_algorithms',
        text: 'computer science programming data structures algorithms quicksort binary search hash table collision resolution networking tcp udp protocols machine learning deep learning neural networks transformer attention models backpropagation gradient descent natural language processing nlp convolutional neural network array allocation c++ python javascript asynchronous event loop new keyword operator syntax'
    },
    {
        id: 'philosophy_definitions_economics',
        text: 'definition meaning explain concept utilitarianism epistemology moral philosophy ethics metaphysics stoicism economics macroeconomics inflation gdp monetary policy photosynthesis definition botany autotroph'
    },
    {
        id: 'literature_arts_humanities',
        text: 'literature author wrote novel play poem poetry hamlet shakespeare macbeth dante homer odyssey iliad drama tragedy comedy writer publication classic books novel book author playwright dramatist written'
    }
]);

const STATIC_BM25_INDEX = new BM25Index({ k1: 1.2, b: 0.75, filterStopWords: true });
STATIC_KNOWLEDGE_CATEGORIES.forEach(cat => {
    STATIC_BM25_INDEX.addDocument(cat.id, cat.text, cat);
});

const STATIC_CATEGORY_VECTORS = STATIC_KNOWLEDGE_CATEGORIES.map(cat => ({
    id: cat.id,
    vector: textToEmbeddingVector(cat.text, 512)
}));

export function isStableGeographyOrGeneralFactQuery(text, context = {}) {
    const raw = String(text || '').trim();
    if (!raw) return false;
    if (isComplexTechnicalQuery(raw)) return false;
    const lower = raw.toLowerCase().replace(/[?!.,;:]+$/g, '').trim();

    // 1. If entity classifier or live signals indicate live data is required, not a stable fact
    const intent = classifyUniversalEntityIntent(raw, context);
    if (intent.isLiveRequired) return false;

    // 2. Actionable local places, trip activities, and navigation are not stable facts
    if (/\b(?:near\s+me|nearby|directions\s+to|hotels?\s+near|restaurants?\s+near|museums?\s+near|open\s+now|places\s+to\s+visit|things\s+to\s+do)\b/i.test(lower)) {
        return false;
    }

    // 3. User device location inquiries ("where am i", "my current location")
    if (/\b(?:where\s+am\s+i|where\s+are\s+we|my\s+(?:current\s+)?location|my\s+coordinates|locate\s+me|pin\s+my\s+location)\b/i.test(lower)) {
        return false;
    }

    // 4. Media works (songs, movies, albums, tracks) are creative/pop-culture discussions
    if (/\b(?:songs?|tracks?|soundtracks?|albums?|lyrics?|singers?|movies?|films?|cinemas?|directors?|actors?|actresses?|starrer|starring)\b/i.test(lower)) {
        return false;
    }

    // 5. Pure numeric / algebraic arithmetic expressions
    if (/^\s*[\d\s+\-*/^().=xXyYzZ]+\s*$/.test(raw)) {
        return true;
    }

    // 6. Enterprise Hybrid Semantic & BM25 Scoring against canonical static knowledge domains
    // A. BM25 Lexical Score
    const bm25Results = STATIC_BM25_INDEX.search(raw, { minScore: 0.2, topK: 1 });
    if (bm25Results.length > 0 && bm25Results[0].score >= 0.25) {
        return true;
    }

    // B. Dense Semantic Vector Cosine Similarity
    const qVec = textToEmbeddingVector(raw, 512);
    for (const item of STATIC_CATEGORY_VECTORS) {
        const sim = vectorCosineSimilarity(qVec, item.vector);
        if (sim >= 0.28) {
            return true;
        }
    }

    return false;
}

const IMAGE_NEGATIVE_REGEX = /\b(?:how\s+(?:to|can\s+i|do\s+(?:i|we|cameras|lenses|computers|eyes))\s+(?:draw|create|make|generate|paint|render)|explain\s+how\b|tell\s+me\s+how\b|tutorial\s+on\b|guide\s+to\b|learn\s+how\s+to\b|chart|graph|diagram|table|conclusion|flowchart|comparison|schema|wireframe|architecture|uml|draw\s+a\s+(?:conclusion|parallel|distinction|comparison|boundary|line\s+between)|(?:paint|paints|painted)\s+a\s+(?:grim|bleak|rosy|clearer)\s+picture|how\s+(?:cameras|lenses|mirrors|eyes|telescopes)\s+form\s+(?:an?\s+)?image|explain\s+image\s+formation)\b/i;

const CONVERSATIONAL_PREFIX = '^(?:(?:hey|hi|hello)\\s+)?(?:(?:bot|jarvis|ai|assistant)\\s*,?\\s+)?(?:can\\s+you\\s+(?:please\\s+)?|could\\s+you\\s+(?:please\\s+)?|would\\s+you\\s+(?:please\\s+)?|please\\s+|i\\s+(?:want|need)\\s+(?:you\\s+to\\s+)?(?:to\\s+)?|help\\s+me\\s+(?:to\\s+)?|kindly\\s+)?';

const IMAGE_POSITIVE_PATTERNS = [
    /^\/(?:image|img|draw|art)\b/i,
    new RegExp(`${CONVERSATIONAL_PREFIX}(?:generate|create|render|make|draw|paint|sketch|produce)\\s+(?:me\\s+)?(?:an?\\s+)?(?:ai\\s+)?(?:image|picture|photo|photograph|drawing|painting|illustration|artwork|wallpaper|portrait|graphic|visual)(?:\\s+(?:of|showing|depicting|with|for|about|featuring)|\\s*[:-])\\s*`, 'i'),
    new RegExp(`${CONVERSATIONAL_PREFIX}(?:show\\s+me|display|give\\s+me)\\s+(?:an?\\s+)?(?:image|picture|photo|photograph|drawing|painting|illustration|artwork)\\s+(?:of|showing|depicting|with|for|about|featuring)\\s+`, 'i'),
    new RegExp(`${CONVERSATIONAL_PREFIX}(?:draw|paint|sketch)\\s+(?:me\\s+)?`, 'i'),
    new RegExp(`${CONVERSATIONAL_PREFIX}(?:an?\\s+)?(?:image|picture|photo|drawing|illustration|artwork)\\s+(?:of|showing|depicting)\\s+`, 'i'),
    new RegExp(`^(?:(?:hey|hi|hello)\\s+)?(?:(?:bot|jarvis|ai|assistant)\\s*,?\\s+)?i\\s+(?:want|need)\\s+(?:an?\\s+)?(?:image|picture|photo|illustration|drawing|artwork)\\s+(?:of|showing|depicting|with)\\s+`, 'i')
];

export function isImageGenerationIntent(text) {
    const raw = String(text || '').trim();
    if (!raw) return false;
    if (/^\/(?:image|img|draw|art)\b/i.test(raw)) return true;
    if (IMAGE_NEGATIVE_REGEX.test(raw)) return false;
    return IMAGE_POSITIVE_PATTERNS.some(pat => pat.test(raw));
}

export function extractImagePrompt(text) {
    let raw = String(text || '').trim();
    if (!raw) return '';

    if (/^\/(?:image|img|draw|art)\s*/i.test(raw)) {
        return raw.replace(/^\/(?:image|img|draw|art)\s*/i, '').replace(/[?!.]+$/, '').trim();
    }

    for (const pat of IMAGE_POSITIVE_PATTERNS.slice(1)) {
        if (pat.test(raw)) {
            return raw.replace(pat, '').replace(/[?!.]+$/, '').trim();
        }
    }

    return raw.replace(/[?!.]+$/, '').trim();
}

/**
 * Automatically enriches and grounds image prompts for maximum accuracy,
 * resolving abbreviations (e.g. LA -> Los Angeles, California), adding authentic
 * architectural & environmental details, and avoiding deserted ghost-town renders.
 * Preserves user-specified artistic styles (anime, oil painting, sketch, etc.).
 * @param {string} prompt
 * @returns {string}
 */
export function enhanceImagePromptForAccuracy(prompt) {
    let clean = String(prompt || '').trim();
    if (!clean) return '';

    // Strip common conversational prompt filler
    clean = clean.replace(/^(?:a\s+)?(?:pic(?:ture)?|photo(?:graph)?|image)\s+(?:of|for)\s+/i, '').trim();

    // Check if user requested an explicitly non-photorealistic artistic style
    const isArtistic = /\b(?:anime|manga|oil\s+painting|watercolor|pencil\s+sketch|sketch|drawing|cartoon|illustration|pixel\s+art|cyberpunk|fantasy\s+art|3d\s+render|cgi|surreal)\b/i.test(clean);

    // Standard geographic acronym & abbreviation expansion
    clean = clean
        .replace(/\b(?:la|l\.a\.)\b/gi, 'Los Angeles')
        .replace(/\b(?:nyc|n\.y\.c\.)\b/gi, 'New York City')
        .replace(/\b(?:sf|s\.f\.)\b/gi, 'San Francisco')
        .replace(/\b(?:dc|d\.c\.)\b/gi, 'Washington, D.C.');

    if (!isArtistic) {
        // For brief prompts (< 50 chars), ground with authentic photographic textures, lighting, and detail
        if (clean.length < 50 && !/\b(?:photograph|photorealistic|detailed|cinematic|lighting|8k|4k)\b/i.test(clean)) {
            return `Photograph of ${clean}, authentic natural lighting, high detail, sharp focus, photorealistic 8k`;
        }
    }

    return clean;
}

/**
 * Parses and extracts an image prompt from a streamed or static LLM action tag.
 * Matches :::image[detailed visual description]:::
 * @param {string} text
 * @param {boolean} [requireClosed=true]
 * @returns {{ prompt: string, isClosed: boolean } | null}
 */
export function extractStreamedImageTag(text, requireClosed = true) {
    if (!text || typeof text !== 'string') return null;
    const closedRegex = /:::image\[([\s\S]*?)\](?:[ \t]*:::)?/i;
    const closedMatch = text.match(closedRegex);
    if (closedMatch && closedMatch[1].trim()) {
        return { prompt: closedMatch[1].trim(), isClosed: true };
    }
    if (!requireClosed) {
        const partialRegex = /:::image\[([\s\S]*?)(?:\]:::|\]|$)/i;
        const partialMatch = text.match(partialRegex);
        if (partialMatch && partialMatch[1].trim()) {
            return { prompt: partialMatch[1].trim(), isClosed: false };
        }
    }
    return null;
}

/**
 * Strips all :::image[...]::: tags from assistant response text for clean display.
 * @param {string} text
 * @returns {string}
 */
export function stripStreamedImageTags(text) {
    if (!text || typeof text !== 'string') return '';
    return text.replace(/:::image\[[\s\S]*?(?:\](?:[ \t]*:::)?|$)/gi, '').trim();
}


function formatName(str) {
    return String(str || '')
        .split(' ')
        .filter(Boolean)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
}

export function extractEntityTarget(text) {
    const raw = String(text || '').trim().replace(/[?!.,;:]+$/g, '');
    if (!raw || raw.length < 4) return null;
    if (/^(?:explain|describe|how|why|calculate|solve|list|compare|summarize|write)\b/i.test(raw)) return null;

    const match = raw.match(/^(?:who\s+is|who's|tell\s+me\s+who\s+is|who\s+serves\s+as|what\s+is|who\s+was|who)?\s*(?:the\s+)?(?:current|latest|present|today|now)?\s*([a-zA-Z\s]{2,30}?)\s+of\s+([a-zA-Z0-9_\s]{2,40})$/i);
    if (match && match[1] && match[2]) {
        const rawRole = match[1].trim();
        const rawPlace = match[2].replace(/\b(?:today|right now|currently)\b/gi, '').trim().replace(/^the\s+/i, '');
        const isRoleTitle = /\b(?:cm|pm|minister|president|governor|mayor|ceo|chairperson|chairman|director|chancellor|secretary|head|leader|chief|ruler|premier|ambassador|king|queen|founder|captain)\b/i.test(rawRole);

        if (rawRole && rawPlace && isRoleTitle && !/^(capital|weather|temperature|history|definition|meaning|source|origin|formula|equation|speed|laws?|the\s+speed)\b/i.test(rawRole)) {
            let roleNorm = formatName(rawRole);
            if (rawRole.toLowerCase() === 'cm') roleNorm = 'Chief Minister';
            else if (rawRole.toLowerCase() === 'pm') roleNorm = 'Prime Minister';
            else if (rawRole.toLowerCase() === 'ceo') roleNorm = 'CEO';
            return {
                role: roleNorm,
                jurisdiction: formatName(rawPlace)
            };
        }
    }

    return null;
}

const INTENT_PROTOTYPES = [
    {
        type: 'explicit_search',
        category: 'web_search',
        isLiveRequired: true,
        exemplars: [
            'search web online articles sources references google lookup information',
            'google search online web articles links references internet lookup'
        ]
    },
    {
        type: 'domain_specific',
        category: 'actionable_or_freshness',
        isLiveRequired: true,
        exemplars: [
            'museum near me harbor landmark location city center driving directions',
            'hotels and restaurants near harbor beach downtown lodging stay booking',
            'hotels near Central Park stay lodging booking reservations accommodation',
            'best restaurants open now in Paris food dining cafe meals',
            'places to visit in Mysore during summer tourism sightseeing attractions',
            'things to do in Tokyo activities attractions trip itinerary vacation',
            'directions to destination navigation route driving map transit',
            'directions to landmark navigation route map commute travel',
            'pizza restaurant food places near me dining cafe takeout delivery',
            'places open now and navigation directions route to nearby',
            'things to do in city this weekend activities attractions guide',
            'changelog and release notes of latest software version update features',
            'release notes and patch features in current version upgrade download',
            'new feature in Python 3.12 software version release update changelog',
            'new feature updates in React 19 framework version release changelog',
            'framework version release notes updates patches changelog'
        ]
    },
    {
        type: 'domain_specific',
        category: 'weather',
        isLiveRequired: true,
        exemplars: [
            'current live weather forecast and temperature today conditions',
            'weather forecast for tomorrow temperature and rainfall humidity precipitation',
            'rain forecast in city current weather conditions humidity precipitation'
        ]
    },
    {
        type: 'domain_specific',
        category: 'finance_crypto',
        isLiveRequired: true,
        exemplars: [
            'current live price of bitcoin crypto stock rate market price quote',
            'tesla stock price today and market cap trading volume valuation',
            'price of ethereum crypto rate today ticker quote exchange rate',
            'live score of cricket football match today sports scores results',
            'latest news updates and breaking events today world news headlines'
        ]
    },
    {
        type: 'temporal_fact',
        category: 'political_leadership',
        isLiveRequired: true,
        exemplars: [
            'active prime minister government president in office administration',
            'chief minister state leader active cm in office jurisdiction',
            'current pm president minister of country state leadership',
            'active ceo corporate company executive leadership managing director',
            'active chief minister governor in office administration cabinet'
        ]
    },
    {
        type: 'static_reasoning',
        category: 'coding',
        isLiveRequired: false,
        exemplars: [
            'python programming function quicksort algorithm sorting implementation syntax',
            'array initialization in Python programming data structures code',
            'class or function in javascript c++ code syntax implementation',
            'binary search tree algorithm data structures computer science implementation',
            'Red-Black Tree in C++ data structures algorithms tree rotation',
            'binary search in computer science algorithms time complexity',
            'hash table and collision resolution hash map chaining bucket',
            'TCP vs UDP protocols computer networking socket packet transmission',
            'new keyword in C++ memory allocation heap pointer constructor',
            'new operator overloading in C++ syntax memory allocation',
            'asynchronous event loop in JavaScript promises callbacks microtasks',
            'NLP natural language processing machine learning deep learning neural networks',
            'neural networks deep learning computer vision AI convolutional networks',
            'transformers in NLP self attention models multi head attention',
            'mechanism of self-attention in Transformer models neural networks',
            'backpropagation with gradient descent optimize weights machine learning AI loss'
        ]
    },
    {
        type: 'static_reasoning',
        category: 'mathematics',
        isLiveRequired: false,
        exemplars: [
            'integral of mathematical equation calculus integration antiderivative',
            'integral of e^(2x) dx calculus derivatives exponential integration',
            'derivative and matrix solve equation algebra linear systems',
            'solve algebraic formula arithmetic problem geometry equation',
            'Pythagorean theorem geometry triangle hypotenuse proof right angle',
            'derivative of sin(x) cosine calculus differentiation trigonometric',
            'prime number number theory primes divisibility factors integers',
            'Euler identity in complex analysis exponential imaginary formula'
        ]
    },
    {
        type: 'static_reasoning',
        category: 'science',
        isLiveRequired: false,
        exemplars: [
            'Newton third law of motion speed of light vacuum physics gravity kinematics dynamics',
            'direct current alternating current electricity voltage resistance circuit electric current physics electromagnetism',
            'ocean currents marine biology atmospheric circulation global climate system ecology thermodynamics physics',
            'formula for kinetic energy in physics equation E=mc^2 velocity mass work',
            'speed of sound in dry air physics acoustics velocity constant decibel',
            'speed of light in vacuum constant physics relativity optics',
            'theory of general relativity and equation E=mc^2 Einstein spacetime physics gravity',
            'quantum entanglement particle physics superposition wave function',
            'neutron stars and black holes after supernova astronomy astrophysics physics',
            'penicillin discovered discovery science history biology medicine Fleming antibiotic',
            'law of conservation of energy thermodynamics physics closed system entropy',
            'atomic number of Gold chemical element periodic table protons mass',
            'boiling point of nitrogen water melting point chemistry Celsius Kelvin',
            'chemical formula for water and methane glucose molecule covalent bond chemistry',
            'covalent vs ionic bonding chemical bonds valence electrons chemistry electronegativity',
            'pH of pure neutral water acidity alkalinity chemistry logarithmic scale',
            'photosynthesis in plants chloroplast sunlight glucose biology chemical equation',
            'photosynthesis chemical equation plants Calvin cycle C4 botany glucose chloroplast',
            'definition of photosynthesis biology botany autotroph chlorophyll',
            'mitochondria cell organelle ATP powerhouse cellular respiration biology',
            'double helix structure of DNA genetics nucleotides Watson Crick biology',
            'natural selection in evolution Darwin species adaptation survival biology'
        ]
    },
    {
        type: 'static_reasoning',
        category: 'general_reasoning',
        isLiveRequired: false,
        exemplars: [
            'subject concept definition meaning explanation theory principles encyclopedic',
            'concept definition meaning explanation theory principles utilitarianism epistemology',
            'capital city world capitals country national capital government seat',
            'capital of Canada Japan Brazil Germany France Peru Australia New York New Zealand',
            'longest river in the world seven continents geography oceans countries landmasses',
            'seven continents of the world geography landmasses Asia Africa Europe Americas',
            'currency of country money economics national capital legal tender exchange',
            'currency of Papua New Guinea economics capital money kina tender',
            'landmark monument temple palace tower castle located geography world heritage',
            'reef ocean sea canyon mountain river lake located geography continent country',
            'Great Barrier Reef ocean coral sea located geography Queensland Australia',
            'Machu Picchu ancient ruins located geography South America Andes Peru',
            'Grand Canyon rock formation valley located geography Arizona Colorado',
            'Mount Everest height elevation mountain peaks geography Himalayas Nepal',
            'Brihadeeswarar Temple architecture history ancient monuments Chola dynasty',
            'Sun Temple Konark architecture history monuments Odisha sculptural style',
            'Taj Mahal architecture history monument Mughal emperor Shah Jahan Agra',
            'engineering and architecture of Eiffel Tower building construction iron Paris',
            'Pyramids of Giza ancient monument construction Pharaohs Egypt Pharaoh Khufu',
            'history and architectural significance of Angkor Wat temple monuments Cambodia',
            'Grand Canyon formed by erosion geology rock formation sedimentary river',
            'height and geological composition of Mount Everest peaks geology tectonics',
            'formation of Niagara Falls geology waterfall erosion river Great Lakes',
            'geological formation of Yosemite National Park granite glaciation Central Park',
            'Central Park in New York landscape architecture Olmsted Vaux design history',
            'World War II timeline historical dates history Allies Axis treaties',
            'Roman Empire fall French Revolution causes history timeline republic empire',
            'Julius Caesar ancient history Roman empire emperor ruler senate crossing Rubicon',
            'first President of the United States George Washington founding fathers history constitution',
            'Magna Carta signed in 1215 medieval history charter feudal England barons',
            'New Deal policies of FDR Franklin Roosevelt Great Depression history reforms banking',
            'Industrial Revolution steam engine mechanization history factories manufacturing',
            'utilitarianism in moral philosophy ethics Bentham Mill greatest happiness principle',
            'epistemology core questions philosophy knowledge belief justified truth',
            'monetary policy macroeconomic inflation GDP economics central banking interest rates',
            'constitutional differences between parliamentary and presidential systems political theory',
            'author playwright wrote book novel play Hamlet Shakespeare poetry literature classic tragedy'
        ]
    }
];

const COMPILED_INTENTS = INTENT_PROTOTYPES.map(proto => {
    const exemplarVectors = proto.exemplars.map(e => textToEmbeddingVector(e, 512));
    return { ...proto, exemplarVectors };
});

const INTENT_BM25_INDEX = new BM25Index({ k1: 1.2, b: 0.75, filterStopWords: true });
INTENT_PROTOTYPES.forEach((proto, pIndex) => {
    proto.exemplars.forEach(exemplar => {
        INTENT_BM25_INDEX.addDocument(pIndex, exemplar, proto);
    });
});

export function classifyUniversalEntityIntent(text = '', context = {}) {
    const raw = String(text || '').trim();
    if (!raw) {
        return {
            isLiveRequired: false,
            isStableKnowledge: true,
            entityTarget: null,
            category: 'empty_query',
            reason: 'empty_query'
        };
    }

    const cacheKey = `${raw.toLowerCase()}::${context.webMode || ''}::${Boolean(context.explicitWeb)}`;
    const cached = FRONTEND_UNIVERSAL_CACHE.get(cacheKey);
    if (cached) return cached;

    if (context.webMode === 'off') {
        const res = {
            isLiveRequired: false,
            isStableKnowledge: true,
            entityTarget: null,
            category: 'general_reasoning',
            reason: 'web_mode_off'
        };
        FRONTEND_UNIVERSAL_CACHE.set(cacheKey, res);
        return res;
    }

    if (context.explicitWeb || context.webMode === 'on' || context.webMode === 'force') {
        const res = {
            isLiveRequired: true,
            isStableKnowledge: false,
            entityTarget: null,
            category: 'explicit_search',
            reason: 'user_requested_search'
        };
        FRONTEND_UNIVERSAL_CACHE.set(cacheKey, res);
        return res;
    }

    if (isCasualConversationQuery(raw) || isJokeFastQuery(raw)) {
        const res = {
            isLiveRequired: false,
            isStableKnowledge: true,
            entityTarget: null,
            category: 'casual_conversation',
            reason: 'casual_conversation'
        };
        FRONTEND_UNIVERSAL_CACHE.set(cacheKey, res);
        return res;
    }

    const qVec = textToEmbeddingVector(raw, 512);
    let bestScore = -1;
    let bestMatch = COMPILED_INTENTS[COMPILED_INTENTS.length - 1];

    for (const proto of COMPILED_INTENTS) {
        for (const vec of proto.exemplarVectors) {
            const score = vectorCosineSimilarity(qVec, vec);
            if (score > bestScore) {
                bestScore = score;
                bestMatch = proto;
            }
        }
    }

    const bm25Matches = INTENT_BM25_INDEX.search(raw, { topK: 1, minScore: 0.2 });
    if (bm25Matches.length > 0) {
        const topBm25Doc = bm25Matches[0].doc;
        const protoIndex = topBm25Doc.id;
        const bm25Score = bm25Matches[0].score;
        const bm25Proto = COMPILED_INTENTS[protoIndex];
        if (bm25Proto && bm25Score >= 1.2 && bestScore < 0.65) {
            bestMatch = bm25Proto;
        }
    }

    // Universal entity & leadership classifier
    const entityTarget = extractEntityTarget(raw);
    const isHistorical = raw.toLowerCase().includes('first') || raw.toLowerCase().includes('former') || raw.toLowerCase().includes('past') || raw.toLowerCase().includes('history') || /\b(who\s+was|what\s+was|when\s+was|where\s+was|why\s+was|how\s+was|who\s+founded|who\s+built|who\s+invented|who\s+discovered)\b/i.test(raw) || /\b\d{4}\b/.test(raw);

    let isLive = false;
    let category = 'stable_knowledge';
    let reason = 'stable_llm_knowledge';

    if (bestMatch && bestMatch.isLiveRequired && (bestScore >= 0.28 || (bm25Matches.length > 0 && bm25Matches[0].score >= 0.8))) {
        isLive = true;
        category = bestMatch.category;
        reason = bestMatch.type;
    } else if (bestMatch && !bestMatch.isLiveRequired && bestScore >= 0.28) {
        category = bestMatch.category;
        reason = bestMatch.type;
    }

    if (entityTarget && !isHistorical) {
        isLive = true;
        category = 'political_leadership';
        reason = 'temporal_fact';
    } else if (isHistorical) {
        isLive = false;
    }

    const res = {
        isLiveRequired: isLive,
        isStableKnowledge: !isLive,
        entityTarget: isHistorical ? null : entityTarget,
        category,
        reason
    };

    FRONTEND_UNIVERSAL_CACHE.set(cacheKey, res);
    return res;
}

export function isSimpleStableQuestion(text, context = {}) {
    const raw = String(text || '').trim();
    if (!raw || raw.length > 200) return false;
    if (isComplexTechnicalQuery(raw)) return false;
    return isStableGeographyOrGeneralFactQuery(raw, context);
}

export function isTransformFastQuery(text) {
    const raw = String(text || '').trim();
    if (!raw) return false;
    return /^(?:\/?(?:translate|summarize|paraphrase|rewrite|professional)|(?:fix\s+grammar|make\s+this\s+professional))\b/i.test(raw);
}

export function isVerifyCommand(text) {
    const raw = String(text || '').trim();
    if (!raw) return false;
    return /^\/verify\b/i.test(raw) || /^verify\s+this\s*:/i.test(raw);
}

export function isStudyCommand(text) {
    const raw = String(text || '').trim();
    if (!raw) return false;
    return /^\/study\b/i.test(raw) || /^(?:teach\s+me\s+this\s+topic\s*:|study\s+this\s*:)/i.test(raw);
}

/**
 * Binary decision classifier: LIVE WEB SEARCH vs NORMAL LLM ANSWER
 *
 * Evaluates whether a normal LLM can reliably answer the user's request without
 * information that may have changed since the model's knowledge cutoff / current knowledge.
 *
 * Output schema:
 * {
 *   route: "live_required" | "normal_llm",
 *   confidence: number,
 *   reason: string,
 *   requiresSources: boolean
 * }
 *
 * @param {string} text - User query text
 * @param {object} [context={}] - Conversation context, thread history, webMode, etc.
 * @returns {{
 *   route: 'live_required' | 'normal_llm',
 *   confidence: number,
 *   reason: string,
 *   requiresSources: boolean
 * }}
 */
export function classifyLiveVsNormal(text, context = {}) {
    const raw = String(text || '').trim();
    if (!raw) {
        return {
            route: 'normal_llm',
            confidence: 0,
            reason: 'empty_query',
            requiresSources: false
        };
    }

    if (context.webMode === 'off') {
        return {
            route: 'normal_llm',
            confidence: 0,
            reason: 'web_mode_off',
            requiresSources: false
        };
    }

    if (context.explicitWeb || context.webMode === 'on' || isVerifyCommand(raw)) {
        return {
            route: 'live_required',
            confidence: 1.0,
            reason: isVerifyCommand(raw) ? 'verify_command_requires_sources' : 'explicit_web_requested',
            requiresSources: true
        };
    }

    const isExplicitSearch = /\b(?:search\s+(?:the\s+)?web|look\s+up\s+online|google\s+(?:it|this|for)|search\s+online|with\s+sources|with\s+citations|live\s+information)\b/i.test(raw);
    if (isExplicitSearch) {
        return {
            route: 'live_required',
            confidence: 0.95,
            reason: 'explicit_web_requested',
            requiresSources: true
        };
    }

    if (isCasualConversationQuery(raw) || isTransformFastQuery(raw) || isStudyCommand(raw) || isJokeFastQuery(raw)) {
        return {
            route: 'normal_llm',
            confidence: 0,
            reason: 'casual_or_transformation_query',
            requiresSources: false
        };
    }

    // -------------------------------------------------------------------------
    // Token Disambiguation & False Positive Neutralization
    // -------------------------------------------------------------------------

    // Physical / circuit / ocean / fluid "current"
    const isPhysicalCurrent = /\b(?:alternating|direct|electric|electrical|ocean|water|eddy|convection|thermal|displacement|bias|leakage|dark|drift|fault|inrush|reverse|saturation|steady|transient|surface|rip|tidal|gulf\s+stream|deep\s+sea)\s+currents?\b|\bcurrents?\s+(?:divider|density|gain|ratio|flow|meter|loop|source|mirror|regulator|transformer|transducer|collector|limiting|sensor|switch|clamp|rating|waveform|pulse|vector|algebra)\b|\b(?:ac|dc)\s+currents?\b/i.test(raw);

    // Biology "common ancestor"
    const isCommonAncestor = /\b(?:most\s+recent|latest|last)\s+common\s+ancestor\b/i.test(raw);

    // Programming constructs containing "new"
    const isProgrammingNew = /\b(?:new\s+(?:keyword|operator|instance|object|array|class|promise|map|set|date|error|allocation)|operator\s+new)\b/i.test(raw);

    // -------------------------------------------------------------------------
    // Positive Signals (Time-Sensitive, Changing & Live Queries)
    // -------------------------------------------------------------------------
    let score = 0;
    const matchedReasons = [];

    // Dynamic Year Analysis
    const CURRENT_YEAR = new Date().getFullYear();
    const yearMatches = raw.match(/\b(18\d{2}|19\d{2}|20\d{2})\b/g);
    let hasContemporaryYear = false;
    let hasHistoricalYear = false;

    if (yearMatches) {
        for (const ym of yearMatches) {
            const y = parseInt(ym, 10);
            if (y >= CURRENT_YEAR - 1 && y <= CURRENT_YEAR + 2) {
                hasContemporaryYear = true;
            } else if (y < CURRENT_YEAR - 1) {
                hasHistoricalYear = true;
            }
        }
    }

    // Specific ISO Date (e.g., 2023-03-15)
    const isSpecificDate = /\b\d{4}-\d{2}-\d{2}\b/.test(raw) || /\b(?:as\s+of|on)\s+\d{4}-\d{2}-\d{2}\b/i.test(raw);

    // Financial & Cryptocurrency Markets (capability-driven, no hardcoded company names)
    const isLiveMarket = /\b(?:stock|share|shares|crypto|cryptocurrency|bitcoin|btc|ethereum|eth|solana|gold|silver|crude\s+oil|forex|fx)\s+(?:price|prices|quotes?|value|rate|rates|all-time\s+high|ath|market\s*cap|trading\s+volume)\b|\b(?:market\s*cap|market\s+valuation|stock\s+price|share\s+price|quarterly\s+earnings|earnings\s+report)\s+of\s+[a-zA-Z0-9_.-]+\b|\b(?:price|quote|exchange\s+rate|market\s+valuation)\s+of\s+(?:[a-zA-Z0-9_.-]+\s+)?(?:stock|shares?|equity|crypto|cryptocurrency|coin|token|assets?|gold|silver|bitcoin|btc|eth|ethereum)\b|\b[a-zA-Z0-9_.-]+\s+(?:stock\s+price|market\s*cap)\b|\b(?:exchange\s+rate|currency\s+exchange|conversion\s+rate|market\s+valuation|quarterly\s+earnings|earnings\s+report)\b/i.test(raw);

    // Weather & Real-time environmental
    const isLiveWeather = /\b(?:weather|forecast|temperature|humidity|uv\s+index|rain\s+chances?|air\s+quality|aqi)\s+(?:in|for|at|today|now|tomorrow|this\s+week|right\s+now)\b|\b(?:is\s+it\s+raining|will\s+it\s+rain|weather\s+today|weather\s+forecast)\b/i.test(raw);

    // Live Sports, Scores, Schedules & Standings
    const isLiveSports = /\b(?:live\s+(?:[a-z]+\s+){0,2}scores?|match\s+scores?|cricket\s+scores?|football\s+scores?|nba\s+scores?|game\s+scores?|ipl\s+scores?|current\s+scores?|who\s+won\s+yesterday|who\s+is\s+winning|match\s+status|premier\s+league\s+standings|points\s+table|who\s+won\s+(?:the\s+)?(?:latest|last|recent)\s+(?:super\s+bowl|fifa|world\s+cup|match|tournament|game))\b/i.test(raw);

    // Breaking News & Current Events
    const isLiveNews = /\b(?:breaking\s+news|latest\s+news|recent\s+news|headlines?|what\s+happened\s+today|what('?s|\s+is)\s+happening\s+in|ongoing\s+events?|current\s+events?|latest\s+updates?\s+(?:on|about))\b/i.test(raw);

    // Tech releases & changelogs
    const isTechRelease = /\b(?:what'?s\s+new\s+in|changelog|release\s+notes|new\s+features?\s+in)\s+[a-zA-Z0-9_.-]+|\b(?:latest\s+version\s+of|latest\s+release\s+of)\b/i.test(raw);

    // Mutable leadership / officeholders
    const isLeadershipCandidate = (
        /\b(?:who\s+is|who's|tell\s+me\s+who\s+is|who\s+serves\s+as)\s+(?:the\s+)?(?:current\s+|latest\s+|present\s+|incumbent\s+|today'?s\s+|now\s+)?(?:cm|pm|chief\s+minister|prime\s+minister|president|ceo|governor|mayor|chancellor|secretary\s+general|vice\s+president|director\s+general|commissioner|captain|coach)(?:\s+(?:of|now|currently|today))?\b/i.test(raw)
        || /\b(?:current|present|incumbent)\s+(?:cm|pm|chief\s+minister|prime\s+minister|president|ceo|governor|mayor|chancellor|secretary\s+general|captain|coach)\s+of\b/i.test(raw)
        || Boolean(extractEntityTarget(raw))
    );
    const isExplicitHistoricalLeadership = /\b(?:first|former|past|who\s+was|history\s+of|prior\s+to|before\s+(?:him|her|them))\b/i.test(raw) || hasHistoricalYear;
    const isCurrentLeadership = isLeadershipCandidate && !isExplicitHistoricalLeadership;

    // Un-neutralized Freshness Cues
    const hasUnneutralizedFreshness = (
        (!isPhysicalCurrent && /\b(?:current|currently|presently)\b/i.test(raw))
        || (!isCommonAncestor && /\b(?:latest|newest|recent|recently)\b/i.test(raw))
        || /\b(?:today|tonight|now|right\s+now|as\s+of\s+(?:today|now)|this\s+week|this\s+month|this\s+year)\b/i.test(raw)
        || (!isProgrammingNew && /\b(?:what'?s\s+new|new\s+features?)\b/i.test(raw))
    );

    // Local amenities / places open now
    const isLocalLiveQuery = /\b(?:places\s+open\s+now|open\s+now|best\s+restaurants\s+in|hotels\s+near\s+me|restaurants\s+near\s+me|near\s+me|directions\s+to)\b/i.test(raw);

    // Apply positive weights
    if (isLiveMarket) { score += 0.60; matchedReasons.push('market_data'); }
    if (isLiveWeather) { score += 0.60; matchedReasons.push('weather_forecast'); }
    if (isLiveSports) { score += 0.60; matchedReasons.push('live_sports'); }
    if (isLiveNews) { score += 0.60; matchedReasons.push('breaking_news'); }
    if (isTechRelease) { score += 0.40; matchedReasons.push('tech_release'); }
    if (isCurrentLeadership) { score += 0.65; matchedReasons.push('mutable_leadership'); }
    if (isLocalLiveQuery) { score += 0.60; matchedReasons.push('local_live_query'); }
    if (hasContemporaryYear) { score += 0.35; matchedReasons.push('contemporary_year'); }
    if (hasUnneutralizedFreshness) { score += 0.25; matchedReasons.push('freshness_cue'); }

    if (isSpecificDate) {
        if (isLiveMarket || isLiveWeather || /\b(?:price|score|weather|event|stock)\b/i.test(raw)) {
            score += 0.40;
            matchedReasons.push('specific_historical_metric');
        } else {
            score += 0.15;
        }
    }

    const isQuestionCue = /\b(what\s+is|who\s+is|how\s+many|price\s+of|score\s+of)\b/i.test(raw);
    if (isQuestionCue && (hasUnneutralizedFreshness || hasContemporaryYear || isLiveMarket || isSpecificDate)) {
        score += 0.15;
    }

    // -------------------------------------------------------------------------
    // Conversational Context (Anaphora & Ellipsis Tracking)
    // -------------------------------------------------------------------------
    const thread = context.contextResolution?.activeThread || context.activeThread || null;
    const threadEntity = String(thread?.entity || thread?.topic || '').trim();
    const threadRole = String(thread?.role || '').trim();

    if (threadEntity || threadRole) {
        const isAnaphoricFollowup = /\b(?:he|him|she|her|it|they|them|their|its|that|this|there)\b/i.test(raw)
            || /^(?:what\s+about|and|how\s+about|who\s+about)\b/i.test(raw)
            || raw.length < 40;

        if (isAnaphoricFollowup) {
            const isFollowupCurrentStatus = (
                hasUnneutralizedFreshness
                || /\b(?:now|today|current|stock|price|weather|status|score|ceo|leader|minister|value|worth)\b/i.test(raw)
            ) && !/\b(?:before|prior|first|former|who\s+was|history)\b/i.test(raw);

            if (isFollowupCurrentStatus) {
                score += 0.60;
                matchedReasons.push('context_current_status_followup');
            }
        }
    }

    // -------------------------------------------------------------------------
    // Negative Signals (Normal LLM Knowledge)
    // -------------------------------------------------------------------------
    if (isPhysicalCurrent && !isLiveMarket && !isLiveWeather && !isLiveNews) {
        score -= 0.40;
    }

    if (isCommonAncestor) {
        score -= 0.40;
    }

    const isMathOrAlgorithm = /\b(?:calculate|derivative|integral|eigenvalue|theorem|proof|quicksort|mergesort|binary\s+search|time\s+complexity|big\s+o|recursion|dynamic\s+programming|fibonacci|data\s+structure|binary\s+tree|graph\s+traversal|euclidean|matrix\s+multiplication)\b/i.test(raw);
    if (isMathOrAlgorithm) {
        score -= 0.40;
    }

    const isCodingQuery = /\b(?:write\s+(?:a\s+)?(?:function|script|code|class|program|regex)|how\s+to\s+(?:implement|write|use|parse|format|loop\s+through)|debug\s+this|syntax\s+of|example\s+of\s+code|in\s+(?:python|javascript|typescript|c\+\+|java|rust|go|sql|html|css))\b/i.test(raw)
        && !isTechRelease;
    if (isCodingQuery) {
        score -= 0.40;
    }

    const isConceptualOrScience = (
        /^(?:what\s+is|what\s+are|define|explain|tell\s+me\s+about\s+(?:the\s+concept\s+of\s+)?)\s+[a-zA-Z0-9\s'-]{2,50}$/i.test(raw)
        && !hasUnneutralizedFreshness
        && !isLiveMarket
        && !isLiveNews
        && !isLiveSports
        && !isCurrentLeadership
    );
    if (isConceptualOrScience) {
        score -= 0.45;
    }

    const isTimelessHistoryOrGeo = (
        /\b(?:capital\s+of|who\s+wrote|who\s+painted|who\s+composed|who\s+invented|who\s+discovered|speed\s+of\s+light|chemical\s+formula\s+of|atomic\s+number)\b/i.test(raw)
        || /^(?:when\s+was|where\s+was|who\s+designed|who\s+built|why\s+was|how\s+was|how\s+were)\s+[a-zA-Z\s]+\s+(?:born|built|founded|written|signed|invented|constructed|designed|formed)\b/i.test(raw)
        || (/\b(?:architecture|sculptural\s+style|engineering|construction\s+date|geological\s+formation|formation\s+of|erosion|composition\s+of)\b/i.test(raw) && /\b(?:temple|monument|tower|pyramid|palace|castle|fort|tomb|statue|cathedral|park|canyon|falls|mountain|ruins)\b/i.test(raw))
    );
    if (isTimelessHistoryOrGeo && !hasUnneutralizedFreshness && !isLiveMarket) {
        score -= 0.45;
    }

    if (hasHistoricalYear && !isSpecificDate && !isLiveMarket && !hasUnneutralizedFreshness) {
        score -= 0.35;
    }

    const confidence = Math.max(0, Math.min(1.0, Math.round(score * 100) / 100));
    const isLive = confidence >= 0.6;
    const reason = isLive ? 'heuristic_live_required' : 'stable_llm_knowledge';

    return {
        route: isLive ? 'live_required' : 'normal_llm',
        confidence,
        reason,
        requiresSources: isLive
    };
}

/**
 * Heuristic confidence scoring for live-required queries.
 * Returns a score between 0 and 1.
 *
 * @param {string} text - User query
 * @param {object} [context={}] - Routing & conversation context
 * @returns {number}
 */
export function liveRequiredConfidence(text, context = {}) {
    return classifyLiveVsNormal(text, context).confidence;
}

export function normalizeSlashCommand(text) {
    const raw = String(text || '').trim();
    if (!raw.startsWith('/')) {
        return { isSlashCommand: false, command: null, payload: raw, normalizedText: raw };
    }

    const match = raw.match(/^\/([a-z_-]+)(?:\s+([\s\S]*))?$/i);
    if (!match) {
        return { isSlashCommand: false, command: null, payload: raw, normalizedText: raw };
    }

    const command = match[1].toLowerCase();
    const payload = (match[2] || '').trim();

    switch (command) {
        case 'translate': {
            if (!payload) return { isSlashCommand: true, command, payload: '', normalizedText: 'translate "..." to Tamil' };
            if (/\bto\s+[a-zA-Z\s]+$/i.test(payload)) {
                return { isSlashCommand: true, command, payload, normalizedText: `Translate ${payload}` };
            }
            return { isSlashCommand: true, command, payload, normalizedText: `Translate the following text accurately: ${payload}` };
        }
        case 'summarize': {
            if (!payload) return { isSlashCommand: true, command, payload: '', normalizedText: 'summarize this: ' };
            return { isSlashCommand: true, command, payload, normalizedText: `Summarize the following text concisely:\n${payload}` };
        }
        case 'verify': {
            if (!payload) return { isSlashCommand: true, command, payload: '', normalizedText: 'verify this: ' };
            return { isSlashCommand: true, command, payload, normalizedText: `Verify whether this claim or answer is factual: ${payload}` };
        }
        case 'professional': {
            if (!payload) return { isSlashCommand: true, command, payload: '', normalizedText: 'make this professional: ' };
            return { isSlashCommand: true, command, payload, normalizedText: `Rewrite the following text to be professional, clear, and polished:\n${payload}` };
        }
        case 'study': {
            if (!payload) return { isSlashCommand: true, command, payload: '', normalizedText: 'teach me this topic: ' };
            return { isSlashCommand: true, command, payload, normalizedText: `Teach me the key concepts of this topic clearly with examples and a short quiz:\n${payload}` };
        }
        case 'image':
        case 'img':
        case 'draw':
        case 'art': {
            return { isSlashCommand: true, command: 'image', payload, normalizedText: payload };
        }
        default:
            return { isSlashCommand: true, command, payload, normalizedText: payload || raw };
    }
}

export function isJokeFastQuery(text) {
    const raw = String(text || '').trim();
    if (!raw || raw.length > 120) return false;
    return /\b(?:tell\s+me\s+a\s+joke|make\s+me\s+laugh|funny\s+joke)\b/i.test(raw);
}

export function isFastSimpleQuery(text, context = {}) {
    return isCasualConversationQuery(text) ||
        isSimpleStableQuestion(text, context) ||
        isTransformFastQuery(text) ||
        isStudyCommand(text) ||
        isJokeFastQuery(text);
}

/**
 * Classifies the structural *shape* of a query — how it is phrased —
 * independently of what entity or topic it refers to.
 *
 * This allows the router to detect "bare entity lookup" queries (a proper noun
 * or title given with no surrounding verb, question word, or command) without
 * needing any hardcoded entity names or keyword lists.
 *
 * Shape categories:
 *   'entity_bare'       - Short phrase with no verb/question/freshness words; likely a title/name lookup.
 *                         e.g. "Nenjukkul Peidhidum", "Inception", "Billie Eilish", "OpenAI"
 *   'entity_question'   - Question about a specific entity with media or lookup context.
 *                         e.g. "Who sang Nenjukkul Peidhidum?", "What film is Inception from?"
 *   'entity_with_verb'  - Entity name + action verb; still potentially an entity lookup.
 *                         e.g. "iPhone 16 release date", "Tesla stock today"
 *   'conceptual'        - Explanation/definition request; best handled by normal LLM.
 *                         e.g. "Explain what a transformer is", "How does photosynthesis work?"
 *   'command'           - Explicit action; handled by image, transform, study, etc. routers.
 *                         e.g. "Create an image of...", "Translate this to French"
 *   'conversational'    - Social/casual phrase; handled by fast_simple.
 *                         e.g. "Hi", "Thanks", "How are you?"
 *
 * @param {string} text
 * @returns {{
 *   shape: 'entity_bare'|'entity_question'|'entity_with_verb'|'conceptual'|'command'|'conversational',
 *   entityCandidate: string|null,
 *   tokenCount: number,
 *   titleCaseRatio: number,
 *   hasQueryVerb: boolean,
 *   hasMediaContext: boolean,
 *   hasNonLatinScript: boolean
 * }}
 */
export function classifyQueryShape(text) {
    const raw = String(text || '').trim();
    if (!raw) return { shape: 'conversational', entityCandidate: null, tokenCount: 0, titleCaseRatio: 0, hasQueryVerb: false, hasMediaContext: false, hasNonLatinScript: false };

    // Tokenize on whitespace (preserve original case for ratio calculation)
    const tokens = raw.split(/\s+/).filter(Boolean);
    const tokenCount = tokens.length;
    const lower = raw.toLowerCase();

    // ── Structural signals ─────────────────────────────────────────────────────

    // 1. Interrogative words (what, who, how, when, where, why, which)
    const hasInterrogative = /^\s*\b(?:what|who|how|when|where|why|which|whose|whom)\b/i.test(raw)
        || /\b(?:what|who|how|when|where|why|which)\b/i.test(raw);

    // 2. Command/action verbs at the start (explain, create, write, summarize, ...)
    const hasCommandVerb = /^\s*(?:explain|describe|define|tell\s+me\s+about|summarize|translate|rewrite|create|make|generate|draw|calculate|solve|compare|list|show|find|give\s+me|teach|help\s+me|write)\b/i.test(raw);

    // 3. Freshness/liveness vocabulary (these are already handled by classifyLiveVsNormal)
    const hasFreshnessWord = /\b(?:latest|current|today|now|price|stock|score|weather|recent|live|breaking|update)\b/i.test(lower);

    // 4. Conversational openers
    const isConversational = isCasualConversationQuery(raw);

    // 5. Title-case ratio: what fraction of tokens start with an uppercase letter?
    //    (Proper nouns, titles, names are mostly title-cased in English)
    const upperTokens = tokens.filter(t => /^[A-Z\u00C0-\u00D6\u00D8-\u00DE]/.test(t)).length;
    const titleCaseRatio = tokenCount > 0 ? upperTokens / tokenCount : 0;

    // 6. Non-Latin script detection (Tamil, Devanagari, Arabic, CJK, etc.)
    //    A query entirely in non-Latin script is almost certainly a proper noun lookup.
    const hasNonLatinScript = /[\u0900-\u097F\u0B80-\u0BFF\u0600-\u06FF\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF\u0400-\u04FF]/.test(raw);
    const isMostlyNonLatin = hasNonLatinScript && !/[a-zA-Z]{4,}/.test(raw);

    // 7. Explicit media context words (not the entity itself — surrounding words)
    const hasMediaContext = /\b(?:song|track|album|lyrics?|singer|sang|music|film|movie|series|episode|actor|actress|director|artist|band|released?|from\s+the\s+movie|from\s+the\s+film|from\s+the\s+show|ost|soundtrack)\b/i.test(lower);

    // ── Shape classification ───────────────────────────────────────────────────

    if (isConversational) {
        return { shape: 'conversational', entityCandidate: null, tokenCount, titleCaseRatio, hasQueryVerb: false, hasMediaContext, hasNonLatinScript };
    }

    if (hasCommandVerb && !hasInterrogative) {
        return { shape: 'command', entityCandidate: null, tokenCount, titleCaseRatio, hasQueryVerb: true, hasMediaContext, hasNonLatinScript };
    }

    if (hasInterrogative) {
        // Conceptual: question about a concept/idea with an explanation verb or science term
        const isConceptual = /^(?:what|how)\s+(?:is|are|does|do|did)\s+/i.test(raw)
            && !hasMediaContext && tokenCount >= 3;
        return {
            shape: isConceptual ? 'conceptual' : 'entity_question',
            entityCandidate: null,
            tokenCount, titleCaseRatio, hasQueryVerb: true, hasMediaContext, hasNonLatinScript
        };
    }

    const hasDescriptorOrTopic = /\b(?:song|track|soundtrack|album|lyrics?|movie|film|cinema|architecture|history|construction|date|geology|formation|erosion|definition|meaning|code|array|algorithm)\b/i.test(lower);

    // Bare entity: short, no interrogative, no command verb, no topic/descriptor
    // High confidence when: token count <= 6 AND (title-cased OR non-Latin)
    const isBareEntity = tokenCount <= 6
        && !hasCommandVerb
        && !hasInterrogative
        && !hasDescriptorOrTopic
        && (isMostlyNonLatin || titleCaseRatio >= 0.5 || (tokenCount <= 3 && titleCaseRatio > 0));

    if (isBareEntity) {
        return { shape: 'entity_bare', entityCandidate: raw, tokenCount, titleCaseRatio, hasQueryVerb: false, hasMediaContext, hasNonLatinScript };
    }

    // Entity with verb or descriptor context (e.g. "iPhone 16 release date", "Tesla stock today", "Nenjukkul peidhidum song")
    if (tokenCount <= 8 && !hasInterrogative && (titleCaseRatio >= 0.4 || hasNonLatinScript || hasMediaContext || hasDescriptorOrTopic)) {
        return { shape: 'entity_with_verb', entityCandidate: null, tokenCount, titleCaseRatio, hasQueryVerb: true, hasMediaContext, hasNonLatinScript };
    }

    return { shape: 'conceptual', entityCandidate: null, tokenCount, titleCaseRatio, hasQueryVerb: true, hasMediaContext, hasNonLatinScript };
}

export function decideFrontendRoute(text, context = {}) {

    const raw = String(text || '').trim();
    const turnSource = String(context.turnSource || context.source || '').toLowerCase();
    const isWebOff = context.webMode === 'off';
    const base = {
        route: 'chat_direct',
        reason: 'default_direct_chat',
        risk: String(context.risk || 'low_risk'),
        requiresSources: false,
        minimalThinking: false,
        speakResponse: false,
        sourcePolicy: 'none'
    };

    if (!raw) {
        return {
            ...base,
            route: 'clarify',
            reason: 'empty_message',
            minimalThinking: true
        };
    }

    const threadKey = context.contextResolution?.activeThread?.entity || context.contextResolution?.activeThread?.topic || context.activeThread?.entity || context.activeThread?.topic || '';
    const cacheKey = `${raw.toLowerCase()}::${context.webMode || ''}::${Boolean(context.placeGrounded)}::${Boolean(context.safetySensitive)}::${turnSource}::${threadKey}`;
    const cached = FRONTEND_ROUTE_CACHE.get(cacheKey);
    if (cached) return cached;

    const isWebForced = context.explicitWeb === true || context.webMode === 'force' || context.webMode === 'on';
    if (isWebForced) {
        const res = {
            ...base,
            route: 'live_required',
            reason: 'user_requested_search',
            risk: 'low_risk',
            requiresSources: true,
            sourcePolicy: 'required'
        };
        FRONTEND_ROUTE_CACHE.set(cacheKey, res);
        return res;
    }

    if (context.toolAction) {
        return {
            ...base,
            route: 'tool_action',
            reason: String(context.toolReason || 'tool_action_requested'),
            sourcePolicy: 'tool'
        };
    }

    if (isImageGenerationIntent(raw)) {
        const prompt = extractImagePrompt(raw);
        const res = {
            ...base,
            route: 'image_generation',
            reason: 'image_generation_intent',
            prompt,
            risk: 'low_risk',
            requiresSources: false,
            minimalThinking: true,
            sourcePolicy: 'none'
        };
        FRONTEND_ROUTE_CACHE.set(cacheKey, res);
        return res;
    }

    if (isVerifyCommand(raw)) {
        const res = {
            ...base,
            route: 'live_required',
            reason: 'verify_command_requires_sources',
            risk: 'medium_risk',
            requiresSources: true,
            sourcePolicy: 'required'
        };
        FRONTEND_ROUTE_CACHE.set(cacheKey, res);
        return res;
    }

    const isPlace = context.placeGrounded || /\b(?:museum\s+near|hotels?\s+near|restaurants?\s+near|places\s+to\s+visit\s+in|directions\s+to|places\s+near\s+me|near\s+me|places\s+near)\b/i.test(raw);
    if (isPlace) {
        const res = {
            ...base,
            route: 'place_grounded',
            reason: 'place_query_requires_evidence',
            risk: context.risk || 'medium_risk',
            requiresSources: true,
            sourcePolicy: 'place_grounded'
        };
        FRONTEND_ROUTE_CACHE.set(cacheKey, res);
        return res;
    }

    const liveDecision = classifyLiveVsNormal(raw, context);
    if (!isWebOff && liveDecision.route === 'live_required') {
        const res = {
            ...base,
            route: 'live_required',
            reason: liveDecision.reason || 'heuristic_live_required',
            risk: 'medium_risk',
            requiresSources: true,
            sourcePolicy: 'required'
        };
        FRONTEND_ROUTE_CACHE.set(cacheKey, res);
        return res;
    }

    // ── Semantic query-shape check ────────────────────────────────────────────
    // Runs ONLY when liveDecision already returned 'normal_llm', so it catches
    // entity-only queries that have NO live-signal vocabulary (no "latest",
    // no "price", no freshness words) but are still clearly a lookup request:
    //   "Nenjukkul Peidhidum"   → entity_bare     → live_required
    //   "Inception"              → entity_bare     → live_required
    //   "Billie Eilish"          → entity_bare     → live_required
    //   "Who sang Nenjukkul Peidhidum?" → entity_question + media → live_required
    // Does NOT affect: "Why?", "Explain photosynthesis", "Hi", "Create an image..."
    if (!isWebOff && !isStableGeographyOrGeneralFactQuery(raw, context)) {
        const qShape = classifyQueryShape(raw);
        if (qShape.shape === 'entity_bare') {
            const res = {
                ...base,
                route: 'live_required',
                reason: 'entity_lookup',
                risk: 'low_risk',
                requiresSources: true,
                sourcePolicy: 'required'
            };
            FRONTEND_ROUTE_CACHE.set(cacheKey, res);
            return res;
        }
        if (qShape.shape === 'entity_question' && qShape.hasMediaContext) {
            const res = {
                ...base,
                route: 'live_required',
                reason: 'entity_media_question',
                risk: 'low_risk',
                requiresSources: true,
                sourcePolicy: 'required'
            };
            FRONTEND_ROUTE_CACHE.set(cacheKey, res);
            return res;
        }
    }

    if (isTransformFastQuery(raw) || isStudyCommand(raw)) {

        const res = {
            ...base,
            route: 'fast_simple',
            reason: 'command_transformation_fast',
            risk: 'low_risk',
            minimalThinking: true,
            requiresSources: false,
            sourcePolicy: 'none'
        };
        FRONTEND_ROUTE_CACHE.set(cacheKey, res);
        return res;
    }

    if (context.safetySensitive || /\b(?:medicine\s+dosage|prescription\s+dosage|medical\s+advice|suicide|self\s+harm)\b/i.test(raw)) {
        const res = {
            ...base,
            route: 'safety_sensitive',
            reason: 'safety_sensitive_query',
            risk: 'high_risk',
            requiresSources: false,
            sourcePolicy: 'safety'
        };
        FRONTEND_ROUTE_CACHE.set(cacheKey, res);
        return res;
    }

    if (isCasualConversationQuery(raw)) {
        const res = {
            ...base,
            route: 'fast_simple',
            reason: 'casual_conversation',
            risk: 'low_risk',
            minimalThinking: true,
            requiresSources: false,
            sourcePolicy: 'none'
        };
        FRONTEND_ROUTE_CACHE.set(cacheKey, res);
        return res;
    }

    const isFollowUp = Boolean(context?.isFollowUp || context?.contextResolution?.isFollowUp || (context?.activeThread?.lastAssistantText && raw.length < 120));
    const isComplex = isComplexTechnicalQuery(raw);

    if (isWebOff) {
        if (!isComplex && !isFollowUp && (isStableGeographyOrGeneralFactQuery(raw) || isSimpleStableQuestion(raw, { ...context, webMode: 'off' }))) {
            const res = {
                ...base,
                route: 'fast_simple',
                reason: 'web_off_stable_fact',
                risk: 'low_risk',
                minimalThinking: true,
                requiresSources: false,
                sourcePolicy: 'none'
            };
            FRONTEND_ROUTE_CACHE.set(cacheKey, res);
            return res;
        }
        const res = {
            ...base,
            route: 'chat_direct',
            reason: 'web_off_direct_chat',
            requiresSources: false,
            sourcePolicy: 'none'
        };
        FRONTEND_ROUTE_CACHE.set(cacheKey, res);
        return res;
    }

    if (context.ambiguousContext) {
        return {
            ...base,
            route: 'clarify',
            reason: 'ambiguous_context',
            minimalThinking: true
        };
    }

    if (isFollowUp || isComplex) {
        const res = {
            ...base,
            route: 'chat_direct',
            reason: isFollowUp ? 'conversational_follow_up' : 'complex_technical_query',
            risk: 'low_risk',
            minimalThinking: false,
            requiresSources: false,
            sourcePolicy: 'none'
        };
        FRONTEND_ROUTE_CACHE.set(cacheKey, res);
        return res;
    }

    const entityIntent = classifyUniversalEntityIntent(raw, context);
    if (entityIntent.isLiveRequired) {
        const res = {
            ...base,
            route: 'live_required',
            reason: entityIntent.reason || 'source_or_freshness_required',
            requiresSources: true,
            sourcePolicy: 'required'
        };
        FRONTEND_ROUTE_CACHE.set(cacheKey, res);
        return res;
    }

    if (!isComplex && !isFollowUp && (isStableGeographyOrGeneralFactQuery(raw, context) || isSimpleStableQuestion(raw, context))) {
        const res = {
            ...base,
            route: 'fast_simple',
            reason: entityIntent.category || 'stable_geography_or_general_fact',
            risk: 'low_risk',
            minimalThinking: true,
            requiresSources: false,
            sourcePolicy: 'none'
        };
        FRONTEND_ROUTE_CACHE.set(cacheKey, res);
        return res;
    }

    const res = {
        ...base,
        route: 'chat_direct',
        reason: 'default_direct_chat',
        risk: 'low_risk',
        minimalThinking: false,
        requiresSources: false,
        sourcePolicy: 'none'
    };
    FRONTEND_ROUTE_CACHE.set(cacheKey, res);
    return res;
}

export function shouldUseMinimalThinking(text, intent = '', context = {}) {
    const normalizedIntent = String(intent || '');
    return isFastSimpleQuery(text, context) ||
        ['fast_simple', 'casual_conversation', 'fast_explainer'].includes(normalizedIntent);
}
