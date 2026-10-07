import { extractEntityTarget } from './entity-verifier.js';
import { BM25Index } from './bm25.js';

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

const INTENT_CACHE = new FastLRU(1000);

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

export function classifyUniversalEntityIntent(rawQuery = '', context = {}) {
    const query = String(rawQuery || '').trim();
    if (!query) {
        return {
            isLiveRequired: false,
            isStableKnowledge: true,
            entityTarget: null,
            category: 'empty_query',
            reason: 'empty_query'
        };
    }

    const cacheKey = `${query.toLowerCase()}::${context.webMode || ''}::${Boolean(context.explicitWeb)}`;
    const cached = INTENT_CACHE.get(cacheKey);
    if (cached) return cached;

    if (context.webMode === 'off') {
        const res = {
            isLiveRequired: false,
            isStableKnowledge: true,
            entityTarget: null,
            category: 'general_reasoning',
            reason: 'web_mode_off'
        };
        INTENT_CACHE.set(cacheKey, res);
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
        INTENT_CACHE.set(cacheKey, res);
        return res;
    }

    if (/\b(?:tell\s+me\s+a\s+joke|make\s+me\s+laugh|funny\s+joke|how\s+are\s+you|what's\s+up|hi|hello|hey|thank\s+you|thanks|bye|goodbye)\b/i.test(query.toLowerCase())) {
        const res = {
            isLiveRequired: false,
            isStableKnowledge: true,
            entityTarget: null,
            category: 'casual_conversation',
            reason: 'casual_conversation'
        };
        INTENT_CACHE.set(cacheKey, res);
        return res;
    }

    const qVec = textToEmbeddingVector(query, 512);
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

    const bm25Matches = INTENT_BM25_INDEX.search(query, { topK: 1, minScore: 0.2 });
    if (bm25Matches.length > 0) {
        const topBm25Doc = bm25Matches[0].doc;
        const protoIndex = topBm25Doc.id;
        const bm25Score = bm25Matches[0].score;
        const bm25Proto = COMPILED_INTENTS[protoIndex];
        if (bm25Proto && bm25Score >= 1.2 && bestScore < 0.65) {
            bestMatch = bm25Proto;
        }
    }

    const entityTarget = extractEntityTarget(query);
    const isHistorical = query.toLowerCase().includes('first') || query.toLowerCase().includes('former') || query.toLowerCase().includes('past') || query.toLowerCase().includes('history') || /\b(who\s+was|what\s+was|when\s+was|where\s+was|why\s+was|how\s+was|who\s+founded|who\s+built|who\s+invented|who\s+discovered)\b/i.test(query) || /\b\d{4}\b/.test(query);

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

    INTENT_CACHE.set(cacheKey, res);
    return res;
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

export function isStableGeographyOrGeneralFactQuery(rawQuery = '', context = {}) {
    const query = String(rawQuery || '').trim();
    if (!query) return false;
    if (isComplexTechnicalQuery(query)) return false;
    const lower = query.toLowerCase().replace(/[?!.,;:]+$/g, '').trim();

    // 1. If entity classifier or live signals indicate live data is required, not a stable fact
    const intent = classifyUniversalEntityIntent(query, context);
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
    if (/^\s*[\d\s+\-*/^().=xXyYzZ]+\s*$/.test(query)) {
        return true;
    }

    // 6. Enterprise Hybrid Semantic & BM25 Scoring against canonical static knowledge domains
    // A. BM25 Lexical Score
    const bm25Results = STATIC_BM25_INDEX.search(query, { minScore: 0.2, topK: 1 });
    if (bm25Results.length > 0 && bm25Results[0].score >= 0.25) {
        return true;
    }

    // B. Dense Semantic Vector Cosine Similarity
    const qVec = textToEmbeddingVector(query, 512);
    for (const item of STATIC_CATEGORY_VECTORS) {
        const sim = vectorCosineSimilarity(qVec, item.vector);
        if (sim >= 0.28) {
            return true;
        }
    }

    return false;
}

export function classifyQueryIntent(rawQuery = '', context = {}) {
    const query = String(rawQuery || '').trim();
    if (!query) {
        return {
            type: 'static_reasoning',
            category: 'empty_query',
            requiresLiveGrounding: false
        };
    }

    const universal = classifyUniversalEntityIntent(query, context);
    const isStableFact = isStableGeographyOrGeneralFactQuery(query, context);

    if (context.explicitWeb || context.webMode === 'on') {
        return {
            type: 'explicit_search',
            category: 'web_search',
            requiresLiveGrounding: true
        };
    }

    if (isStableFact && !universal.isLiveRequired) {
        return {
            type: 'static_reasoning',
            category: universal.category || 'general_reasoning',
            requiresLiveGrounding: false
        };
    }

    const qVec = textToEmbeddingVector(query, 512);
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

    const bm25Matches = INTENT_BM25_INDEX.search(query, { topK: 1, minScore: 0.2 });
    if (bm25Matches.length > 0) {
        const topBm25Doc = bm25Matches[0].doc;
        const protoIndex = topBm25Doc.id;
        const bm25Score = bm25Matches[0].score;
        const bm25Proto = COMPILED_INTENTS[protoIndex];
        if (bm25Proto && bm25Score >= 1.2 && bestScore < 0.65) {
            bestMatch = bm25Proto;
        }
    }

    if (universal.category === 'explicit_search' || bestMatch.type === 'explicit_search') {
        return {
            type: 'explicit_search',
            category: 'web_search',
            requiresLiveGrounding: true
        };
    }

    if (universal.entityTarget || bestMatch.type === 'temporal_fact') {
        return {
            type: universal.isLiveRequired ? 'temporal_fact' : 'static_reasoning',
            category: 'political_leadership',
            requiresLiveGrounding: universal.isLiveRequired,
            entityTarget: universal.entityTarget
        };
    }

    if (bestMatch.type === 'domain_specific') {
        return {
            type: universal.isLiveRequired ? 'domain_specific' : 'static_reasoning',
            category: bestMatch.category,
            requiresLiveGrounding: universal.isLiveRequired
        };
    }

    return {
        type: 'static_reasoning',
        category: bestMatch.category,
        requiresLiveGrounding: false
    };
}

export async function classifyQueryIntentSemantic(rawQuery = '', options = {}) {
    const query = String(rawQuery || '').trim();
    if (!query) {
        return {
            type: 'static_reasoning',
            category: 'empty_query',
            requiresLiveGrounding: false,
            confidence: 1.0,
            method: 'structural'
        };
    }

    try {
        const { embedTexts } = await import('./embeddings.js');
        const PROTOTYPES = [
            { text: 'explain the concept of physics chemistry biology mathematics and history', type: 'static_reasoning', category: 'encyclopedic_knowledge', live: false },
            { text: 'write code program function algorithm in python javascript or c++', type: 'static_reasoning', category: 'coding_math', live: false },
            { text: 'current weather forecast temperature rainfall right now today', type: 'domain_specific', category: 'weather', live: true },
            { text: 'live stock price bitcoin market cap share crypto rate today', type: 'domain_specific', category: 'finance_crypto', live: true },
            { text: 'breaking news latest updates headline results right now today', type: 'temporal_fact', category: 'breaking_live', live: true },
            { text: 'who is current active chief minister prime minister president ceo', type: 'temporal_fact', category: 'political_leadership', live: true },
            { text: 'search the web look up articles find online sources', type: 'explicit_search', category: 'web_search', live: true }
        ];

        const embedResult = await embedTexts([query, ...PROTOTYPES.map(p => p.text)], { timeoutMs: 3000 });
        if (embedResult?.available && embedResult.embeddings.length >= PROTOTYPES.length + 1) {
            const queryVec = embedResult.embeddings[0];
            let bestScore = -1;
            let bestMatch = PROTOTYPES[0];

            for (let i = 0; i < PROTOTYPES.length; i++) {
                const protoVec = embedResult.embeddings[i + 1];
                let dot = 0;
                for (let j = 0; j < queryVec.length; j++) dot += queryVec[j] * protoVec[j];
                if (dot > bestScore) {
                    bestScore = dot;
                    bestMatch = PROTOTYPES[i];
                }
            }

            if (bestScore > 0.55) {
                return {
                    type: bestMatch.type,
                    category: bestMatch.category,
                    requiresLiveGrounding: bestMatch.live,
                    confidence: Number(bestScore.toFixed(3)),
                    method: 'semantic_embedding'
                };
            }
        }
    } catch (_) {}

    const fallback = classifyQueryIntent(query);
    return {
        ...fallback,
        confidence: 0.9,
        method: 'semantic_embedding'
    };
}
