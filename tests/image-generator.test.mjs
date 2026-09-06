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
    stripStreamedImageTags
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

console.log('--- Running Image Generator Suite ---');

// 1. Config tests
{
    const cfg = getImageConfig();
    assert.equal(cfg.modelId, 'latent-consistency/lcm-dreamshaper-v7');
    assert.equal(cfg.defaultSteps, 4);
    assert.equal(cfg.defaultWidth, 512);
    assert.equal(cfg.model, 'turbo');

    updateImageConfig({ defaultSteps: 5 });
    assert.equal(getImageConfig().defaultSteps, 5);
    resetImageConfig();
    assert.equal(getImageConfig().defaultSteps, 4);

    const fallbackUrl = buildFallbackImageUrl('a neon futuristic city', { width: 512, height: 512, seed: 42 });
    assert.ok(fallbackUrl.includes('pollinations.ai'));
    assert.ok(fallbackUrl.includes('neon') || fallbackUrl.includes('city'));
    assert.ok(fallbackUrl.includes('width=512'));
    assert.ok(fallbackUrl.includes('seed=42'));
    assert.ok(fallbackUrl.includes('model=turbo'), 'Fallback URL must use fast turbo model');
    assert.ok(fallbackUrl.includes('negative_prompt='), 'Fallback URL must include negative prompt');
    console.log('✔ Image generation config tests passed');
}

// 2. Intent Detection & Routing Tests
{
    // Slash command cases
    assert.equal(isImageGenerationIntent('/image a majestic red fox in snow'), true);
    assert.equal(isImageGenerationIntent('/img anime warrior in battle'), true);

    // Natural language explicit cases
    assert.equal(isImageGenerationIntent('generate an image of a quiet forest at dawn'), true);
    assert.equal(isImageGenerationIntent('create a picture of an ancient stone temple'), true);
    assert.equal(isImageGenerationIntent('draw me a cute robotic cat'), true);
    assert.equal(isImageGenerationIntent('paint a dramatic sunset over rolling hills'), true);
    assert.equal(isImageGenerationIntent('an image of a cyberpunk street market'), true);

    // Conversational prefix natural language requests
    assert.equal(isImageGenerationIntent('can you create an image of a red sports car'), true);
    assert.equal(isImageGenerationIntent('bot please draw me a cute kitten wearing glasses'), true);
    assert.equal(isImageGenerationIntent('jarvis, can you please generate an image of a futuristic city'), true);
    assert.equal(isImageGenerationIntent('i want an image of a tranquil lake at sunset'), true);
    assert.equal(isImageGenerationIntent('could you please create me an image of a flying car'), true);
    assert.equal(isImageGenerationIntent('hey bot draw a cat'), true);

    // Negative cases (educational, diagrams, charts, conversation)
    assert.equal(isImageGenerationIntent('how to draw a chart using canvas in javascript'), false);
    assert.equal(isImageGenerationIntent('draw a conclusion from the sales figures'), false);
    assert.equal(isImageGenerationIntent('can you explain how lenses form an image?'), false);
    assert.equal(isImageGenerationIntent('hello how are you today'), false);
    assert.equal(isImageGenerationIntent('what is the weather in Tokyo'), false);
    assert.equal(isImageGenerationIntent('draw a diagram of the microservice architecture'), false);

    // Prompt extraction
    assert.equal(extractImagePrompt('/image a cyberpunk car'), 'a cyberpunk car');
    assert.equal(extractImagePrompt('/img anime warrior'), 'anime warrior');
    assert.equal(extractImagePrompt('generate an image of a quiet forest'), 'a quiet forest');
    assert.equal(extractImagePrompt('draw me a cute robotic cat'), 'a cute robotic cat');
    assert.equal(extractImagePrompt('paint a dramatic sunset'), 'a dramatic sunset');
    assert.equal(extractImagePrompt('can you create an image of a red sports car'), 'a red sports car');
    assert.equal(extractImagePrompt('bot please draw me a cute kitten wearing glasses'), 'a cute kitten wearing glasses');
    assert.equal(extractImagePrompt('i want an image of a tranquil lake at sunset'), 'a tranquil lake at sunset');

    // Route decision
    const routeRes = decideFrontendRoute('generate an image of a neon cyber city');
    assert.equal(routeRes.route, 'image_generation');
    assert.equal(routeRes.reason, 'image_generation_intent');
    assert.equal(routeRes.prompt, 'a neon cyber city');

    const slashRes = decideFrontendRoute('/image mystical glowing dragon');
    assert.equal(slashRes.route, 'image_generation');
    assert.equal(slashRes.prompt, 'mystical glowing dragon');

    const convoRes = decideFrontendRoute('can you create an image of a red sports car');
    assert.equal(convoRes.route, 'image_generation');
    assert.equal(convoRes.prompt, 'a red sports car');

    console.log('✔ Image intent detection and routing tests passed');
}

// 3. Streamed Image Action Tag Tests (Zero-Hardcoding Protocol)
{
    // Closed tag with trailing colons
    const tag1 = extractStreamedImageTag('Here is your art: :::image[a breathtaking cyber city at night, 8k]::: Enjoy!');
    assert.ok(tag1);
    assert.equal(tag1.prompt, 'a breathtaking cyber city at night, 8k');
    assert.equal(tag1.isClosed, true);

    // Closed tag without trailing colons
    const tag2 = extractStreamedImageTag(':::image[a cute kitten wearing glasses]');
    assert.ok(tag2);
    assert.equal(tag2.prompt, 'a cute kitten wearing glasses');
    assert.equal(tag2.isClosed, true);

    // Multi-line visual description
    const tag3 = extractStreamedImageTag(':::image[\n  a golden retriever puppy\n  in a wildflower meadow, cinematic\n]:::\nHope you like it!');
    assert.ok(tag3);
    assert.ok(tag3.prompt.includes('golden retriever puppy'));
    assert.equal(tag3.isClosed, true);

    // Partial stream with requireClosed=true (waits for closing bracket)
    const partialWaiting = extractStreamedImageTag(':::image[a fast red car', true);
    assert.equal(partialWaiting, null);

    // Partial stream with requireClosed=false (e.g. stream ended early)
    const partialAllowed = extractStreamedImageTag(':::image[a fast red car', false);
    assert.ok(partialAllowed);
    assert.equal(partialAllowed.prompt, 'a fast red car');
    assert.equal(partialAllowed.isClosed, false);

    // Non-matching text
    assert.equal(extractStreamedImageTag('Can you draw a conclusion from this?'), null);
    assert.equal(extractStreamedImageTag(''), null);

    // Stripping tags for clean UI display
    const stripped1 = stripStreamedImageTags('Here is your art:\n\n:::image[a majestic dragon]:::\n\nEnjoy!');
    assert.ok(!stripped1.includes(':::image'));
    assert.ok(stripped1.includes('Here is your art:'));
    assert.ok(stripped1.includes('Enjoy!'));

    const strippedOnlyTag = stripStreamedImageTags(':::image[a majestic dragon]:::');
    assert.equal(strippedOnlyTag, '');

    console.log('✔ Streamed image action tag tests passed (Zero-Hardcoding protocol)');
}

// 4. Tool Dispatcher Registration & Execution
{
    const imgTool = AGENTIC_TOOL_DEFINITIONS.find(t => t.function?.name === 'generate_image');
    assert.ok(imgTool, 'generate_image tool must be registered in AGENTIC_TOOL_DEFINITIONS');
    assert.equal(imgTool.function.parameters.required.includes('prompt'), true);

    // Dispatch without global window mock
    const res = await dispatchToolCall('generate_image', { prompt: 'a sunset on mars', aspectRatio: '16:9' });
    assert.equal(res.tool, 'generate_image');
    assert.equal(res.success, true);
    assert.ok(res.output);

    // Dispatch with global mock
    globalThis.JarvisImageGenerator = {
        generateImage: async ({ prompt, aspectRatio }) => ({
            id: 'mock-1',
            prompt,
            aspectRatio,
            dataUrl: 'data:image/png;base64,mock',
            engine: 'webgpu',
            durationMs: 1250
        })
    };

    const resMock = await dispatchToolCall('generate_image', { prompt: 'a sunset on mars', aspectRatio: '16:9' });
    assert.equal(resMock.tool, 'generate_image');
    assert.equal(resMock.success, true);
    assert.equal(resMock.output.prompt, 'a sunset on mars');
    assert.equal(resMock.output.engine, 'webgpu');
    assert.equal(resMock.output.durationMs, 1250);
    delete globalThis.JarvisImageGenerator;

    console.log('✔ Tool dispatcher image generation tests passed');
}

// 4. Storage Graceful Non-Browser Fallback
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

console.log('--- All Image Generator Tests Passed Successfully! ---');
