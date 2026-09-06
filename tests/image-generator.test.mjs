import assert from 'node:assert/strict';
import {
    DEFAULT_IMAGE_CONFIG,
    getImageConfig,
    updateImageConfig,
    resetImageConfig,
    buildFallbackImageUrl
} from '../app/image-generation-config.js';
import {
    isImageGenerationIntent,
    extractImagePrompt,
    decideFrontendRoute,
    extractStreamedImageTag,
    stripStreamedImageTags,
    normalizeSlashCommand,
    enhanceImagePromptForAccuracy
} from '../app/frontend-routing.js';
import {
    AGENTIC_TOOL_DEFINITIONS,
    dispatchToolCall
} from '../app/tool-dispatcher.js';
import {
    openImageDatabase,
    saveImage,
    getAllImages,
    deleteImage
} from '../app/image-storage.js';
import { imageProxyHandler } from '../api/index.js';

console.log('--- Running Image Generator Suite ---');

// 1. Dynamic Configuration Contract & URL Builder Invariants
{
    const cfg = getImageConfig();
    const requiredConfigKeys = ['model', 'defaultSteps', 'defaultWidth', 'defaultHeight', 'fallbackEndpointTemplate', 'storageKey'];
    for (const key of requiredConfigKeys) {
        assert.ok(key in cfg, `Configuration must define property: "${key}"`);
        assert.equal(typeof cfg[key], typeof DEFAULT_IMAGE_CONFIG[key], `Type mismatch for config property: "${key}"`);
    }
    assert.ok(cfg.defaultSteps > 0 && Number.isInteger(cfg.defaultSteps), 'defaultSteps must be a positive integer');
    assert.ok(cfg.defaultWidth > 0 && cfg.defaultHeight > 0, 'Dimensions must be positive integers');

    // Dynamic config overrides & restoration roundtrip
    const testOverrides = { defaultSteps: cfg.defaultSteps + 3, defaultWidth: cfg.defaultWidth + 128 };
    updateImageConfig(testOverrides);
    const updatedCfg = getImageConfig();
    assert.equal(updatedCfg.defaultSteps, testOverrides.defaultSteps);
    assert.equal(updatedCfg.defaultWidth, testOverrides.defaultWidth);

    resetImageConfig();
    const restoredCfg = getImageConfig();
    assert.equal(restoredCfg.defaultSteps, DEFAULT_IMAGE_CONFIG.defaultSteps);
    assert.equal(restoredCfg.defaultWidth, DEFAULT_IMAGE_CONFIG.defaultWidth);

    // Dynamic fallback URL builder contract
    const testCases = [
        { prompt: 'a neon futuristic city', options: { width: 768, height: 512, seed: 42, model: 'turbo' } },
        { prompt: 'chidambaram town in aerial view, golden hour', options: { width: 512, height: 512, seed: 999 } }
    ];

    for (const tc of testCases) {
        const urlStr = buildFallbackImageUrl(tc.prompt, tc.options);
        const parsedUrl = new URL(urlStr);
        assert.equal(parsedUrl.protocol, 'https:');
        assert.ok(parsedUrl.pathname.includes(encodeURIComponent(tc.prompt)) || parsedUrl.search.includes(encodeURIComponent(tc.prompt)));
        assert.equal(parsedUrl.searchParams.get('width'), String(tc.options.width));
        assert.equal(parsedUrl.searchParams.get('height'), String(tc.options.height));
        if (tc.options.seed !== undefined) {
            assert.equal(parsedUrl.searchParams.get('seed'), String(tc.options.seed));
        }
        assert.equal(parsedUrl.searchParams.get('model'), tc.options.model || cfg.model);
        assert.equal(parsedUrl.searchParams.get('nologo'), 'true');
        assert.ok(parsedUrl.searchParams.has('negative_prompt'));
    }
    console.log('✔ Image generation config & URL builder contract tests passed');
}

// 2. Dynamic Intent Detection & Routing Invariants (Combinatorial Property-Based Testing)
{
    const conversationalPrefixes = [
        '',
        'can you ',
        'please ',
        'hey bot, ',
        'could you please ',
        'i want you to ',
        'bot please ',
        'kindly '
    ];

    const intentPatterns = [
        (prefix, subject) => `${prefix}generate an image of ${subject}`,
        (prefix, subject) => `${prefix}create a picture of ${subject}`,
        (prefix, subject) => `${prefix}draw me ${subject}`,
        (prefix, subject) => `${prefix}paint ${subject}`,
        (prefix, subject) => `${prefix}show me a photo of ${subject}`,
        (prefix, subject) => `${prefix}an image of ${subject}`
    ];

    const invariantTestSubjects = [
        'chidambaram town in aerial view',
        'a futuristic cyberpunk city at dusk',
        'a serene bamboo forest in the morning fog',
        'an ancient stone temple covered in moss',
        'a cute robotic cat with glowing eyes'
    ];

    let intentCombinationsTested = 0;
    for (const prefix of conversationalPrefixes) {
        for (const patternFn of intentPatterns) {
            for (const subject of invariantTestSubjects) {
                const query = patternFn(prefix, subject);
                assert.equal(isImageGenerationIntent(query), true, `Expected image generation intent for: "${query}"`);

                const extractedPrompt = extractImagePrompt(query);
                assert.ok(extractedPrompt.length > 0, `Extracted prompt must not be empty for: "${query}"`);
                assert.ok(
                    extractedPrompt.includes(subject) || subject.includes(extractedPrompt),
                    `Extracted prompt "${extractedPrompt}" should contain subject "${subject}" in "${query}"`
                );

                const routeDecision = decideFrontendRoute(query);
                assert.equal(routeDecision.route, 'image_generation', `Frontend route must be image_generation for: "${query}"`);
                assert.equal(routeDecision.prompt, extractedPrompt, `Frontend route prompt must match extracted prompt for: "${query}"`);
                intentCombinationsTested++;
            }
        }
    }
    console.log(`  -> Validated ${intentCombinationsTested} dynamic combinatorial intent variants`);

    // Slash command dynamic matrix
    const slashCommands = ['/image', '/img', '/draw', '/art'];
    const slashSubjects = [
        'cyberpunk racing vehicle',
        'majestic phoenix rising from ashes',
        'hyper-realistic waterfall in lush jungle',
        'chidambaram temple aerial architecture'
    ];

    let slashCombinationsTested = 0;
    for (const cmd of slashCommands) {
        for (const subj of slashSubjects) {
            const query = `${cmd} ${subj}`;
            assert.equal(isImageGenerationIntent(query), true, `Slash command must trigger intent: "${query}"`);
            assert.equal(extractImagePrompt(query), subj, `Slash command prompt mismatch for: "${query}"`);

            const route = decideFrontendRoute(query);
            assert.equal(route.route, 'image_generation', `Slash route mismatch for: "${query}"`);
            assert.equal(route.prompt, subj, `Slash prompt mismatch for: "${query}"`);
            slashCombinationsTested++;
        }
    }
    console.log(`  -> Validated ${slashCombinationsTested} dynamic slash command variations`);

    // Semantic boundary & negative category invariants
    const negativeSemanticCategories = {
        metaphorsAndIdioms: [
            'draw a conclusion from the sales figures',
            'paint a grim picture of the current economy',
            'draw a parallel between the two events',
            'draw a distinction between correlation and causation'
        ],
        codingAndCanvas: [
            'how to draw a chart using canvas in javascript',
            'how can i render an image with html5 canvas',
            'tutorial on how to create a bar chart',
            'guide to drawing graphics in python'
        ],
        technicalAndArchitecture: [
            'draw a diagram of the microservice architecture',
            'create a flowchart for user registration',
            'draw a wireframe for the dashboard layout',
            'draw a uml sequence diagram'
        ],
        scienceAndOptics: [
            'can you explain how lenses form an image?',
            'explain how optical cameras form an image on film',
            'how do telescopes capture an image of stars?'
        ],
        casualConversation: [
            'hello how are you today',
            'what is the weather in Tokyo',
            'tell me the capital of France',
            'who won the world cup in 2022'
        ]
    };

    let negativeQueriesTested = 0;
    for (const [category, queries] of Object.entries(negativeSemanticCategories)) {
        for (const query of queries) {
            assert.equal(isImageGenerationIntent(query), false, `Negative invariant failed for [${category}]: "${query}"`);
            assert.notEqual(decideFrontendRoute(query).route, 'image_generation', `Negative route invariant failed for: "${query}"`);
            negativeQueriesTested++;
        }
    }
    console.log(`  -> Validated ${negativeQueriesTested} negative boundary queries across ${Object.keys(negativeSemanticCategories).length} semantic categories`);

    console.log('✔ Image intent detection and routing tests passed (zero hardcoding)');
}

// 3. Streamed Image Action Tag Dynamic Invariants (Zero-Hardcoding Protocol)
{
    const samplePrompts = [
        'a breathtaking cyber city at night, 8k',
        'a cute kitten wearing glasses',
        'golden retriever puppy in wildflower meadow, cinematic, photorealistic',
        'aerial photography of chidambaram temple complex, ancient architecture'
    ];

    for (const prompt of samplePrompts) {
        // Closed tag with trailing colons
        const closedWithColons = extractStreamedImageTag(`Here is your art: :::image[${prompt}]::: Enjoy!`);
        assert.ok(closedWithColons, `Tag extraction failed for prompt: "${prompt}"`);
        assert.equal(closedWithColons.prompt, prompt);
        assert.equal(closedWithColons.isClosed, true);

        // Closed tag without trailing colons
        const closedBare = extractStreamedImageTag(`:::image[${prompt}]`);
        assert.ok(closedBare);
        assert.equal(closedBare.prompt, prompt);
        assert.equal(closedBare.isClosed, true);

        // Streaming partial tag with requireClosed=true vs false
        const partialTag = `:::image[${prompt}`;
        assert.equal(extractStreamedImageTag(partialTag, true), null, 'Incomplete tag must return null when requireClosed is true');
        const partialAllowed = extractStreamedImageTag(partialTag, false);
        assert.ok(partialAllowed);
        assert.equal(partialAllowed.prompt, prompt);
        assert.equal(partialAllowed.isClosed, false);

        // Stripping tag from conversational message
        const wrapped = `Leading message text\n\n:::image[${prompt}]:::\n\nClosing remarks`;
        const stripped = stripStreamedImageTags(wrapped);
        assert.ok(!stripped.includes(':::image'));
        assert.ok(!stripped.includes(prompt));
        assert.ok(stripped.includes('Leading message text'));
        assert.ok(stripped.includes('Closing remarks'));

        // Stripping standalone tag
        assert.equal(stripStreamedImageTags(`:::image[${prompt}]:::`), '');
    }

    // Negative non-matching tag invariant
    assert.equal(extractStreamedImageTag('Can you draw a conclusion from this?'), null);
    assert.equal(extractStreamedImageTag('An image of a cat without delimiters'), null);
    assert.equal(extractStreamedImageTag(''), null);

    console.log('✔ Streamed image action tag dynamic invariant tests passed (Zero-Hardcoding protocol)');
}

// 4. Tool Dispatcher Registration & Dynamic Execution Contract
{
    const imgTool = AGENTIC_TOOL_DEFINITIONS.find(t => t.function?.name === 'generate_image');
    assert.ok(imgTool, 'generate_image tool must be registered in AGENTIC_TOOL_DEFINITIONS');
    assert.equal(imgTool.type, 'function');
    assert.ok(Array.isArray(imgTool.function.parameters.required));
    assert.ok(imgTool.function.parameters.required.includes('prompt'), 'prompt must be a required tool parameter');

    // Dispatch without global window mock (graceful fallback)
    const res = await dispatchToolCall('generate_image', { prompt: 'a sunset on mars', aspectRatio: '16:9' });
    assert.equal(res.tool, 'generate_image');
    assert.equal(res.success, true);
    assert.ok(res.output);

    // Dispatch with global mock
    const mockPayload = {
        id: 'mock-img-test',
        prompt: 'a sunset on mars',
        aspectRatio: '16:9',
        dataUrl: 'data:image/png;base64,mock',
        engine: 'cloud-turbo',
        durationMs: 950
    };

    globalThis.JarvisImageGenerator = {
        generateImage: async (opts) => ({
            ...mockPayload,
            ...opts
        })
    };

    const resMock = await dispatchToolCall('generate_image', { prompt: mockPayload.prompt, aspectRatio: mockPayload.aspectRatio });
    assert.equal(resMock.tool, 'generate_image');
    assert.equal(resMock.success, true);
    assert.equal(resMock.output.prompt, mockPayload.prompt);
    assert.equal(resMock.output.engine, mockPayload.engine);
    assert.equal(resMock.output.durationMs, mockPayload.durationMs);
    delete globalThis.JarvisImageGenerator;

    console.log('✔ Tool dispatcher image generation tests passed');
}

// 5. Storage Graceful Non-Browser Fallback Contract
{
    const db = await openImageDatabase();
    assert.equal(db, null);

    const saved = await saveImage({ prompt: 'test' });
    assert.equal(saved, null);

    const savedWithId = await saveImage({ id: 'img-1', prompt: 'test' });
    assert.ok(savedWithId);
    assert.equal(savedWithId.id, 'img-1');

    const all = await getAllImages();
    assert.ok(Array.isArray(all));

    const deleted = await deleteImage('test-id');
    assert.equal(deleted, false);

    console.log('✔ Image storage fallback tests passed');
}

// 6. Slash Command Normalization & Zero-Latency Route Verification
{
    const translationCases = [
        {
            input: '/translate "How much does this cost?" to Tamil',
            expectedCommand: 'translate',
            expectedPattern: /Translate "How much does this cost\?" to Tamil/i
        },
        {
            input: '/translate Hello world to Spanish',
            expectedCommand: 'translate',
            expectedPattern: /Translate Hello world to Spanish/i
        },
        {
            input: '/translate vanakkam',
            expectedCommand: 'translate',
            expectedPattern: /Translate the following text accurately: vanakkam/i
        }
    ];

    for (const tc of translationCases) {
        const res = normalizeSlashCommand(tc.input);
        assert.equal(res.isSlashCommand, true, `Expected ${tc.input} to be recognized as slash command`);
        assert.equal(res.command, tc.expectedCommand);
        assert.match(res.normalizedText, tc.expectedPattern);
    }

    const commandCases = [
        {
            input: '/summarize In a recent study, researchers found that sleep improves memory retention and cognitive focus.',
            expectedCommand: 'summarize',
            expectedPattern: /Summarize the following text concisely/i
        },
        {
            input: '/verify The Great Wall of China is visible from the Moon with the naked eye.',
            expectedCommand: 'verify',
            expectedPattern: /Verify whether this claim or answer is factual/i
        },
        {
            input: '/professional hey man send me the report asap thx',
            expectedCommand: 'professional',
            expectedPattern: /Rewrite the following text to be professional/i
        },
        {
            input: '/study Quantum Computing basics',
            expectedCommand: 'study',
            expectedPattern: /Teach me the key concepts of this topic/i
        },
        {
            input: '/image a glowing cyberpunk metropolis in rain',
            expectedCommand: 'image',
            expectedPayload: 'a glowing cyberpunk metropolis in rain'
        }
    ];

    for (const tc of commandCases) {
        const res = normalizeSlashCommand(tc.input);
        assert.equal(res.isSlashCommand, true);
        assert.equal(res.command, tc.expectedCommand);
        if (tc.expectedPattern) {
            assert.match(res.normalizedText, tc.expectedPattern);
        }
        if (tc.expectedPayload) {
            assert.equal(res.payload, tc.expectedPayload);
        }
    }

    // Fast routing & minimal thinking invariants
    const fastSimpleQueries = [
        '/translate hello to French',
        'translate "How much does this cost?" to Tamil',
        '/summarize This is a long article about space exploration and orbital dynamics.',
        'summarize this: The experiment proved that light behaves as both a particle and a wave.',
        '/professional I want to follow up on our talk yesterday.',
        'make this professional: see you tomorrow',
        '/study photosynthesis in plants',
        'teach me this topic: photosynthesis'
    ];

    for (const q of fastSimpleQueries) {
        const route = decideFrontendRoute(q);
        assert.equal(route.route, 'fast_simple', `Expected ${q} to route to fast_simple, got ${route.route}`);
        assert.equal(route.minimalThinking, true, `Expected ${q} to have minimalThinking=true`);
        assert.equal(route.requiresSources, false, `Expected ${q} to have requiresSources=false`);
    }

    const verifyQueries = [
        '/verify The Earth is flat',
        'verify this: Apple was founded in 1976'
    ];
    for (const q of verifyQueries) {
        const route = decideFrontendRoute(q);
        assert.equal(route.route, 'live_required', `Expected ${q} to route to live_required`);
        assert.equal(route.requiresSources, true, `Expected ${q} to have requiresSources=true`);
    }

    console.log('✔ Slash command normalization and zero-latency routing tests passed');
}

// 7. Image Proxy API Contract & Failover
{
    // Test 7.1 Missing prompt returns 400
    let badStatusCode = 0;
    let badResponse = null;
    await imageProxyHandler({
        method: 'GET',
        url: '/api/image-proxy'
    }, {
        status(c) { badStatusCode = c; return { json(j) { badResponse = j; } }; }
    });
    assert.equal(badStatusCode, 400);
    assert.equal(badResponse.error.code, 'missing_prompt');

    // Test 7.2 Proxy executes and returns valid image buffer with headers
    let goodStatusCode = 0;
    let goodHeaders = {};
    let goodBuffer = null;
    await imageProxyHandler({
        method: 'GET',
        url: '/api/image-proxy?prompt=blue%20circle&width=256&height=256&model=flux&seed=42'
    }, {
        setHeader(k, v) { goodHeaders[k] = v; },
        status(c) {
            goodStatusCode = c;
            return {
                send(b) { goodBuffer = b; },
                json(j) { goodBuffer = j; }
            };
        }
    });
    assert.equal(goodStatusCode, 200, `Expected 200 from image proxy, got ${goodStatusCode}`);
    assert.ok(Buffer.isBuffer(goodBuffer) && goodBuffer.length > 500, 'Expected image buffer payload');
    assert.equal(goodHeaders['Content-Type'], 'image/jpeg');

    console.log('✔ Image proxy API contract & upstream proxy fetch tests passed');
}

// 8. Image Prompt Accuracy & Photorealistic Grounding Engine
{
    // 8.1 Geographic Acronym & Place Expansions
    const laExpanded = enhanceImagePromptForAccuracy('la');
    assert.match(laExpanded, /Los Angeles/i);
    assert.match(laExpanded, /photograph/i);
    assert.match(laExpanded, /photorealistic/i);

    const picForLa = enhanceImagePromptForAccuracy('a pic for la');
    assert.match(picForLa, /Los Angeles/i);

    const nycExpanded = enhanceImagePromptForAccuracy('nyc');
    assert.match(nycExpanded, /New York City/i);

    const sfExpanded = enhanceImagePromptForAccuracy('sf');
    assert.match(sfExpanded, /San Francisco/i);

    const chidambaramExpanded = enhanceImagePromptForAccuracy('chidambaram town in aerial view');
    assert.match(chidambaramExpanded, /Chidambaram/i);
    assert.match(chidambaramExpanded, /Nataraja/i);

    // 8.2 Preserves Artistic Intent
    const animePrompt = enhanceImagePromptForAccuracy('anime warrior with glowing blue sword');
    assert.equal(animePrompt, 'anime warrior with glowing blue sword');

    const oilPainting = enhanceImagePromptForAccuracy('oil painting of a sailboat at sea');
    assert.equal(oilPainting, 'oil painting of a sailboat at sea');

    // 8.3 Brief Prompt Grounding
    const shortPrompt = enhanceImagePromptForAccuracy('cute golden retriever');
    assert.match(shortPrompt, /cute golden retriever/i);
    assert.match(shortPrompt, /photorealistic|lighting|detail/i);

    console.log('✔ Image prompt accuracy, entity grounding, and artistic preservation tests passed');
}

console.log('--- All Image Generator & Command Tests Passed Successfully! ---');

