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

const STOP_WORDS = new Set(['a', 'an', 'the', 'is', 'are', 'was', 'were', 'of', 'in', 'to', 'for', 'on', 'with', 'at', 'by', 'from', 'about', 'what', 'when', 'where', 'who', 'why', 'how', 'which', 'did', 'do', 'does', 'can', 'could', 'would', 'should']);

export function textToEmbeddingVector(text, dim = 512) {
    const v = new Float32Array(dim);
    const tokens = String(text || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return v;
    for (const token of tokens) {
        const weight = STOP_WORDS.has(token) ? 0.05 : 1.0;
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
        v[idx1] += 1.0 * weight;
        v[idx2] += 0.5 * weight;
        if (token.length >= 4) {
            for (let i = 0; i < token.length - 2; i++) {
                const trigram = token.slice(i, i + 3);
                let th = 0;
                for (let j = 0; j < trigram.length; j++) th = (th * 31 + trigram.charCodeAt(j)) | 0;
                v[Math.abs(th) % dim] += 0.2 * weight;
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

const FRONTEND_INTENT_PROTOTYPES = [
    {
        route: 'casual_convo',
        category: 'casual_conversation',
        isLiveRequired: false,
        exemplars: [
            'hello hi hey good morning good evening how are you greetings',
            'no no i am just generally asking how are you doing today',
            'so how are you doing today what is up are you there',
            'just generally asking how you are doing today',
            'thank you thanks very much appreciate it bye goodbye see you later take care'
        ]
    },
    {
        route: 'fast_simple',
        category: 'joke_request',
        isLiveRequired: false,
        exemplars: [
            'tell me a joke make me laugh funny programming joke'
        ]
    },
    {
        route: 'fast_simple',
        category: 'transform_request',
        isLiveRequired: false,
        exemplars: [
            'translate this sentence into french spanish german japanese italian',
            'summarize this paragraph text rewrite grammar correct paraphrase'
        ]
    },
    {
        route: 'safety_sensitive',
        category: 'safety_sensitive',
        isLiveRequired: false,
        exemplars: [
            'how much medicine dosage should I take prescription drug dose',
            'prescription drug dosage medical advice health emergency symptoms disease diagnosis',
            'give me legal advice for court lawsuit trial dispute',
            'give me financial investment advice stock pick buy sell trade',
            'self harm suicide crisis depression hurt myself'
        ]
    },
    {
        route: 'place_grounded',
        category: 'actionable_or_freshness',
        isLiveRequired: true,
        exemplars: [
            'museum near me harbor landmark location city center directions',
            'hotels and restaurants near harbor beach downtown lodging stay',
            'hotels near Central Park stay lodging booking',
            'best restaurants open now in Paris food dining cafe',
            'places to visit in Mysore during summer tourism sightseeing attractions',
            'things to do in Tokyo activities attractions trip',
            'directions to destination navigation route driving map',
            'directions to landmark navigation route map',
            'pizza restaurant food places near me dining cafe',
            'places open now and navigation directions how to get to nearby',
            'things to do in city this weekend activities attractions',
            'changelog and release notes of latest software version update features',
            'release notes and patch features in current version upgrade',
            'new feature in Python 3.12 software version release update changelog',
            'what is new in React 19 framework version release updates',
            'whats new in framework version release updates'
        ]
    },
    {
        route: 'live_required',
        category: 'weather',
        isLiveRequired: true,
        exemplars: [
            'current live weather forecast and temperature today',
            'weather forecast for tomorrow temperature and rainfall humidity',
            'climate rain forecast in region current conditions'
        ]
    },
    {
        route: 'live_required',
        category: 'finance_crypto',
        isLiveRequired: true,
        exemplars: [
            'current live price of bitcoin crypto stock rate market price',
            'tesla stock price today and market cap trading volume',
            'price of ethereum crypto rate today ticker quote',
            'live score of cricket football match today sports scores',
            'latest news updates and breaking events today world news'
        ]
    },
    {
        route: 'live_required',
        category: 'political_leadership',
        isLiveRequired: true,
        exemplars: [
            'who is active prime minister government president',
            'who is the cm of chief minister state leader',
            'who is current pm president minister of country state',
            'who is active ceo corporate company executive leadership',
            'who is the active chief minister governor in office'
        ]
    },
    {
        route: 'web_search',
        category: 'web_search',
        isLiveRequired: true,
        exemplars: [
            'search the web for articles with sources information',
            'google search online web articles links references'
        ]
    },
    {
        route: 'fast_simple',
        category: 'coding',
        isLiveRequired: false,
        exemplars: [
            'write a python function for quicksort algorithm',
            'how to initialize array in Python programming',
            'how to create a class or function in javascript c++ code',
            'implement a binary search tree algorithm data structures',
            'implement a Red-Black Tree in C++ data structures algorithms',
            'how does binary search work in computer science algorithms',
            'what is a hash table and how does collision resolution work',
            'what is the difference between TCP and UDP protocols computer networking',
            'how does the new keyword work in C++ memory allocation',
            'explain new operator overloading in C++ syntax',
            'explain asynchronous event loop in JavaScript promises callbacks',
            'what is NLP natural language processing machine learning deep learning neural networks',
            'explain neural networks deep learning computer vision AI',
            'how do transformers work in NLP self attention models',
            'explain the mechanism of self-attention in Transformer models neural networks',
            'how does backpropagation with gradient descent optimize weights machine learning AI'
        ]
    },
    {
        route: 'fast_simple',
        category: 'mathematics',
        isLiveRequired: false,
        exemplars: [
            'compute the integral of mathematical equation calculus',
            'compute the integral of e^(2x) dx calculus derivatives',
            'calculate the derivative and matrix solve equation algebra',
            'solve algebraic formula arithmetic problem geometry',
            'what is the Pythagorean theorem geometry triangle',
            'what is the derivative of sin(x) cosine calculus',
            'explain what a prime number is number theory primes',
            'what is Euler identity in complex analysis exponential'
        ]
    },
    {
        route: 'fast_simple',
        category: 'science',
        isLiveRequired: false,
        exemplars: [
            'what is Newton third law of motion speed of light vacuum physics gravity kinematics dynamics',
            'what is the formula for kinetic energy in physics equation E=mc^2 velocity mass',
            'what is the speed of sound in dry air physics acoustics velocity constant',
            'what is the speed of light in vacuum constant physics',
            'explain the theory of general relativity and equation E=mc^2 Einstein spacetime physics',
            'what is quantum entanglement particle physics superposition',
            'how do neutron stars and black holes form after a supernova astronomy astrophysics physics',
            'who discovered penicillin science history biology medicine discovery',
            'what is the law of conservation of energy thermodynamics physics',
            'what is the atomic number of Gold chemical element periodic table',
            'what is the boiling point of nitrogen water melting point chemistry',
            'what is the chemical formula for water and methane glucose molecule chemistry',
            'explain covalent vs ionic bonding chemical bonds valence electrons chemistry',
            'what is the pH of pure neutral water acidity alkalinity chemistry',
            'how does photosynthesis work plant chloroplast sunlight glucose biology',
            'explain how photosynthesis works in plants and its chemical equation C4 botany glucose',
            'what is the definition of photosynthesis biology botany',
            'what is the function of mitochondria in a cell powerhouse organelle ATP biology',
            'explain the double helix structure of DNA genetics nucleotides biology',
            'what is natural selection in evolution Darwin species adaptation biology'
        ]
    },
    {
        route: 'fast_simple',
        category: 'general_reasoning',
        isLiveRequired: false,
        exemplars: [
            'what is subject concept definition meaning explanation theory principles',
            'what is concept definition meaning explanation theory principles utilitarianism epistemology',
            'what is the capital of city country world capitals',
            'what is the capital of Canada Japan Brazil Germany France Peru Australia New York New Zealand',
            'what is the longest river in the world seven continents geography oceans countries',
            'what are the seven continents of the world geography landmasses',
            'what is the currency of money economics country capital',
            'what is the currency of Papua New Guinea economics capital money',
            'where is landmark monument temple palace tower castle located geography in world',
            'where is reef ocean sea canyon mountain river lake located geography continent country',
            'where is Great Barrier Reef ocean coral sea located geography',
            'where is Machu Picchu ancient ruins located geography in South America',
            'where is the Grand Canyon rock formation valley located geography',
            'how tall is Mount Everest height elevation mountain peaks geography',
            'why was ancient temple monument constructed architecture history',
            'why was Brihadeeswarar Temple constructed Sun Temple Konark architecture history monuments',
            'who built ancient monument landmark and why history architecture',
            'who built the Taj Mahal and why history architecture monument',
            'explain the engineering and architecture of monument building construction',
            'how were the ancient pyramids built monument construction',
            'how were the Pyramids of Giza built ancient monument construction',
            'history and architectural significance of ancient temple monuments',
            'history and architectural significance of Angkor Wat temple monuments',
            'how was the canyon valley formed by erosion geology rock formation',
            'what is the height and geological composition of mountain peaks geography',
            'explain the formation of waterfall geology nature',
            'explain the formation of Niagara Falls geology waterfall',
            'explain the geological formation of national park geography nature',
            'explain the geological formation of Yosemite National Park Central Park geography nature',
            'who designed famous city park architecture history',
            'who designed Central Park in New York architecture history',
            'when did historical war end start timeline history',
            'when did World War II end start timeline historical dates',
            'why did historical empire fall revolution causes history timeline',
            'why did the Roman Empire fall French Revolution causes history timeline',
            'who was ancient historical emperor ruler president history',
            'who was Julius Caesar ancient history Roman empire emperor ruler',
            'who was the first president founding fathers history',
            'who was the first President of the United States George Washington founding fathers history',
            'what was the historic charter signed in medieval history',
            'what was the Magna Carta signed in 1215 medieval history charter',
            'explain economic depression history reforms',
            'explain the New Deal policies of FDR Franklin Roosevelt Great Depression history reforms',
            'what was the industrial revolution mechanization history',
            'what was the Industrial Revolution steam engine mechanization history',
            'what is utilitarianism in moral philosophy ethics Bentham Mill',
            'define epistemology and its core questions philosophy knowledge belief',
            'how does monetary policy impact macroeconomic inflation and GDP economics macroeconomics',
            'what are the constitutional differences between parliamentary and presidential systems political theory government'
        ]
    }
];

const COMPILED_FRONTEND_INTENTS = FRONTEND_INTENT_PROTOTYPES.map(proto => {
    const exemplarVectors = proto.exemplars.map(e => textToEmbeddingVector(e, 512));
    return { ...proto, exemplarVectors };
});

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
    const qVec = textToEmbeddingVector(t, 512);
    for (const vec of COMPILED_FRONTEND_INTENTS[0].exemplarVectors) {
        if (vectorCosineSimilarity(qVec, vec) > 0.32) return true;
    }
    return false;
}

export function isStableGeographyOrGeneralFactQuery(text, context = {}) {
    const raw = String(text || '').trim();
    if (!raw) return false;
    const intent = classifyUniversalEntityIntent(raw, context);
    return !intent.isLiveRequired;
}

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

    if (context.explicitWeb || context.webMode === 'on') {
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

    const qVec = textToEmbeddingVector(raw, 512);
    let bestScore = -1;
    let bestMatch = COMPILED_FRONTEND_INTENTS[COMPILED_FRONTEND_INTENTS.length - 1];

    for (const proto of COMPILED_FRONTEND_INTENTS) {
        for (const vec of proto.exemplarVectors) {
            const score = vectorCosineSimilarity(qVec, vec);
            if (score > bestScore) {
                bestScore = score;
                bestMatch = proto;
            }
        }
    }

    const isHistorical = raw.toLowerCase().includes('first') || raw.toLowerCase().includes('former') || raw.toLowerCase().includes('past') || raw.toLowerCase().includes('history') || /\b\d{4}\b/.test(raw);
    const isLive = isHistorical ? false : bestMatch.isLiveRequired;

    const res = {
        isLiveRequired: isLive,
        isStableKnowledge: !isLive,
        entityTarget: null,
        category: bestMatch.category,
        reason: bestMatch.route
    };

    FRONTEND_UNIVERSAL_CACHE.set(cacheKey, res);
    return res;
}

export function isSimpleStableQuestion(text, context = {}) {
    const raw = String(text || '').trim();
    if (!raw || raw.length > 200) return false;
    return isStableGeographyOrGeneralFactQuery(raw, context);
}

export function isTransformFastQuery(text) {
    const raw = String(text || '').trim();
    if (!raw || raw.length > 180) return false;
    const qVec = textToEmbeddingVector(raw, 512);
    for (const vec of COMPILED_FRONTEND_INTENTS[2].exemplarVectors) {
        if (vectorCosineSimilarity(qVec, vec) > 0.38) return true;
    }
    return false;
}

export function isJokeFastQuery(text) {
    const raw = String(text || '').trim();
    if (!raw || raw.length > 120) return false;
    const qVec = textToEmbeddingVector(raw, 512);
    for (const vec of COMPILED_FRONTEND_INTENTS[1].exemplarVectors) {
        if (vectorCosineSimilarity(qVec, vec) > 0.38) return true;
    }
    return false;
}

export function isFastSimpleQuery(text, context = {}) {
    return isCasualConversationQuery(text) ||
        isSimpleStableQuestion(text, context) ||
        isTransformFastQuery(text) ||
        isJokeFastQuery(text);
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
        speakResponse: turnSource === 'converse',
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

    const cacheKey = `${raw.toLowerCase()}::${context.webMode || ''}::${Boolean(context.placeGrounded)}::${Boolean(context.safetySensitive)}::${turnSource}`;
    const cached = FRONTEND_ROUTE_CACHE.get(cacheKey);
    if (cached) return cached;

    if (context.toolAction) {
        return {
            ...base,
            route: 'tool_action',
            reason: String(context.toolReason || 'tool_action_requested'),
            sourcePolicy: 'tool'
        };
    }

    if (context.safetySensitive) {
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

    if (isWebOff) {
        if (isStableGeographyOrGeneralFactQuery(raw) || isSimpleStableQuestion(raw, { ...context, webMode: 'off' })) {
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

    const qVec = textToEmbeddingVector(raw, 512);
    let bestScore = -1;
    let bestMatch = COMPILED_FRONTEND_INTENTS[COMPILED_FRONTEND_INTENTS.length - 1];

    for (const proto of COMPILED_FRONTEND_INTENTS) {
        for (const vec of proto.exemplarVectors) {
            const score = vectorCosineSimilarity(qVec, vec);
            if (score > bestScore) {
                bestScore = score;
                bestMatch = proto;
            }
        }
    }

    if (bestMatch.route === 'safety_sensitive') {
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

    const entityIntent = classifyUniversalEntityIntent(raw, context);
    if (entityIntent.isLiveRequired) {
        if (context.placeGrounded || bestMatch.route === 'place_grounded') {
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

    const res = {
        ...base,
        route: 'fast_simple',
        reason: bestMatch.category || 'stable_geography_or_general_fact',
        risk: 'low_risk',
        minimalThinking: true,
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
