import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { server, startLocalDevServer } from '../tools/local-dev-server.mjs';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9222;

async function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function fetchJson(url) {
    const res = await fetch(url);
    return res.json();
}

async function runBrowserTests() {
    console.log('=== Starting Real Chrome Browser E2E Verification ===');

    let devServerStarted = false;
    try {
        await fetch('http://127.0.0.1:3000');
    } catch (_) {
        startLocalDevServer();
        devServerStarted = true;
        await sleep(500);
    }

    // 1. Spawn Chrome in headless mode with remote debugging
    const chromeProc = spawn(CHROME_PATH, [
        `--remote-debugging-port=${CDP_PORT}`,
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        'about:blank'
    ], { stdio: 'ignore' });

    chromeProc.on('error', err => {
        console.error('Failed to spawn Chrome:', err);
        process.exit(1);
    });

    try {
        // Wait for CDP to be ready
        let versionInfo = null;
        for (let i = 0; i < 20; i++) {
            await sleep(300);
            try {
                versionInfo = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/version`);
                if (versionInfo) break;
            } catch (_) {}
        }
        assert.ok(versionInfo, 'Chrome CDP did not become ready');
        console.log(`[PASS] Chrome connected: ${versionInfo['Browser']}`);

        // Get target page
        const targets = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
        const pageTarget = targets.find(t => t.type === 'page');
        assert.ok(pageTarget, 'No page target found in Chrome');
        const wsUrl = pageTarget.webSocketDebuggerUrl;

        // Connect via native WebSocket
        const ws = new WebSocket(wsUrl);
        await new Promise((resolve, reject) => {
            ws.onopen = resolve;
            ws.onerror = reject;
        });

        let msgId = 1;
        const pending = new Map();
        const consoleErrors = [];

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.id && pending.has(data.id)) {
                pending.get(data.id)(data);
                pending.delete(data.id);
            }
            if (data.method === 'Runtime.consoleAPICalled') {
                const type = data.params?.type;
                if (type === 'error') {
                    const text = data.params?.args?.map(a => a.value || a.description || '').join(' ');
                    consoleErrors.push(text);
                }
            }
            if (data.method === 'Runtime.exceptionThrown') {
                const desc = data.params?.exceptionDetails?.exception?.description || data.params?.exceptionDetails?.text || '';
                consoleErrors.push(desc);
            }
        };

        function sendCommand(method, params = {}) {
            return new Promise((resolve) => {
                const id = msgId++;
                pending.set(id, resolve);
                ws.send(JSON.stringify({ id, method, params }));
            });
        }

        // Enable domains
        await sendCommand('Runtime.enable');
        await sendCommand('Page.enable');

        // Navigate to local dev server
        console.log('[Navigating to http://127.0.0.1:3000]');
        await sendCommand('Page.navigate', { url: 'http://127.0.0.1:3000' });
        
        // Wait for page to finish loading modules
        for (let i = 0; i < 30; i++) {
            const check = await sendCommand('Runtime.evaluate', {
                expression: `Boolean(window.JarvisLiveResearch && window.JarvisMarkdownRenderer && window.JarvisApi)`,
                returnByValue: true
            });
            if (check?.result?.result?.value || check?.result?.value) {
                break;
            }
            await sleep(250);
        }

        // Check for JS SyntaxErrors / module errors
        console.log(`Console error count during load: ${consoleErrors.length}`);
        if (consoleErrors.length > 0) {
            console.error('Captured console errors:', consoleErrors);
        }
        assert.equal(consoleErrors.filter(e => e.includes('SyntaxError') || e.includes('does not provide an export')).length, 0, 'No module syntax errors allowed');
        console.log('[PASS] Module loading verified with 0 syntax errors');

        // Verify window.JarvisLiveResearch and window.JarvisApi in real browser runtime
        const evalGlobals = await sendCommand('Runtime.evaluate', {
            expression: `(() => ({
                hasLiveResearch: typeof window.JarvisLiveResearch === 'object',
                hasRenderVisualHeader: typeof window.JarvisLiveResearch?.renderOrUpdateVisualEntityHeader === 'function',
                hasMarkdownRenderer: typeof window.JarvisMarkdownRenderer === 'object',
                hasRenderSourceLogo: typeof window.JarvisMarkdownRenderer?.renderSourceLogoBadge === 'function',
                hasJarvisApi: typeof window.JarvisApi === 'object',
                hasPostJson: typeof window.JarvisApi?.postJson === 'function',
                hasEmergencySos: typeof window.JarvisEmergencySOS === 'object'
            }))()`,
            returnByValue: true
        });

        console.log('evalGlobals raw:', JSON.stringify(evalGlobals));
        const globals = evalGlobals?.result?.result?.value || evalGlobals?.result?.value;
        console.log('Global namespaces inspection:', globals);
        assert.equal(globals?.hasLiveResearch, true, 'window.JarvisLiveResearch must exist');
        assert.equal(globals?.hasRenderVisualHeader, true, 'renderOrUpdateVisualEntityHeader must be a function');
        assert.equal(globals?.hasMarkdownRenderer, true, 'window.JarvisMarkdownRenderer must exist');
        assert.equal(globals?.hasRenderSourceLogo, true, 'renderSourceLogoBadge must be a function');
        assert.equal(globals?.hasJarvisApi, true, 'window.JarvisApi must exist');
        assert.equal(globals?.hasPostJson, true, 'window.JarvisApi.postJson must exist');
        assert.equal(globals?.hasEmergencySos, true, 'window.JarvisEmergencySOS must exist');
        console.log('[PASS] All critical global APIs verified in browser runtime');

        // Test Visual Entity Header DOM Rendering
        const evalVisualRender = await sendCommand('Runtime.evaluate', {
            expression: `(() => {
                const container = document.getElementById('chat-messages') || document.body;
                const row = document.createElement('div');
                row.className = 'chat-row assistant-row';
                row.innerHTML = '<div class="chat-bubble-assistant"><div class="assistant-message-text">Composer biography goes here.</div></div>';
                container.appendChild(row);

                window.JarvisLiveResearch.renderOrUpdateVisualEntityHeader(row, {
                    name: 'Hans Zimmer',
                    type: 'musician',
                    description: 'German film score composer and music producer.',
                    pageUrl: 'https://en.wikipedia.org/wiki/Hans_Zimmer',
                    image: { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/cc/Hans_Zimmer_at_the_2010_TIFF.jpg/440px-Hans_Zimmer_at_the_2010_TIFF.jpg' }
                }, [
                    { title: 'Inception', year: '2010', image: { url: 'https://upload.wikimedia.org/wikipedia/en/2/2e/Inception_%282010%29_theatrical_poster.jpg' } },
                    { title: 'Interstellar', year: '2014', image: { url: 'https://upload.wikimedia.org/wikipedia/en/b/bc/Interstellar_film_poster.jpg' } },
                    { title: 'Gladiator', year: '2000', image: { url: 'https://upload.wikimedia.org/wikipedia/en/f/fb/Gladiator_%282000_film_poster%29.png' } }
                ]);

                const heroCard = row.querySelector('.entity-hero-card');
                const avatar = row.querySelector('.entity-hero-avatar');
                const name = row.querySelector('.entity-hero-name')?.textContent;
                const badge = row.querySelector('.entity-hero-badge')?.textContent;
                const worksTray = row.querySelector('.notable-works-tray');
                const workCards = row.querySelectorAll('.notable-work-card');
                const sourceBtn = row.querySelector('.entity-hero-source-btn');

                return {
                    hasHeroCard: Boolean(heroCard),
                    hasAvatar: Boolean(avatar && avatar.src.includes('Hans_Zimmer')),
                    name,
                    badge,
                    hasWorksTray: Boolean(worksTray),
                    worksCount: workCards.length,
                    hasSourceBtn: Boolean(sourceBtn)
                };
            })()`,
            returnByValue: true
        });

        const visualResult = evalVisualRender?.result?.result?.value || evalVisualRender?.result?.value;
        console.log('Visual entity render verification:', visualResult);
        assert.equal(visualResult?.hasHeroCard, true, 'Hero card must be rendered in DOM');
        assert.equal(visualResult?.hasAvatar, true, 'Avatar image must have valid src');
        assert.equal(visualResult?.name, 'Hans Zimmer', 'Entity name must match');
        assert.equal(visualResult?.badge, 'Musician', 'Badge must match entity type');
        assert.equal(visualResult?.hasWorksTray, true, 'Notable works tray must be present');
        assert.equal(visualResult?.worksCount, 3, 'Must render 3 notable work cards');
        assert.equal(visualResult?.hasSourceBtn, false, 'Verified Reference button must be removed per user specification');
        console.log('[PASS] Real browser visual entity hero card & notable works tray verified');

        // Test In-Text Citation Source Logo Rendering
        const evalCitationRender = await sendCommand('Runtime.evaluate', {
            expression: `(() => {
                const sampleText = 'The soundtrack was recorded at Abbey Road Studios [1] and released by Reprise Records [2].';
                const sources = [
                    { id: 1, title: 'Abbey Road Studios', domain: 'abbeyroad.com', url: 'https://www.abbeyroad.com' },
                    { id: 2, title: 'Reprise Records', domain: 'repriserecords.com', url: 'https://www.repriserecords.com' }
                ];
                const html = window.JarvisMarkdownRenderer.renderMarkdown(sampleText, { sources });
                const div = document.createElement('div');
                div.className = 'assistant-message-text';
                div.innerHTML = html;
                document.body.appendChild(div);

                const logoBadges = div.querySelectorAll('.citation-source-logo');
                const logoImages = div.querySelectorAll('.citation-logo-icon');
                const rawBrackets = div.innerHTML.includes('[1]') && !div.innerHTML.includes('citation-source-logo');

                return {
                    logoBadgesCount: logoBadges.length,
                    logoImagesCount: logoImages.length,
                    firstLogoDomain: logoImages[0]?.getAttribute('alt'),
                    firstLogoSrc: logoImages[0]?.getAttribute('src'),
                    rawBracketsRemaining: rawBrackets
                };
            })()`,
            returnByValue: true
        });

        const citationResult = evalCitationRender?.result?.result?.value || evalCitationRender?.result?.value;
        console.log('In-text citation source logo verification:', citationResult);
        assert.equal(citationResult?.logoBadgesCount, 2, 'Must render 2 source logo badges in place of [1] and [2]');
        assert.equal(citationResult?.logoImagesCount, 2, 'Must render 2 logo image tags');
        assert.equal(citationResult?.firstLogoDomain, 'abbeyroad.com', 'Logo alt must match source domain');
        assert.ok(citationResult?.firstLogoSrc.includes('domain=abbeyroad.com'), 'Logo src must request domain favicon');
        console.log('[PASS] In-text citation logos rendered in place of [1] and [2]');

        // Test Citation Link Underline: citations must NOT have underline text decoration
        const evalCitationUnderline = await sendCommand('Runtime.evaluate', {
            expression: `(() => {
                const testDiv = document.createElement('div');
                testDiv.className = 'assistant-message-text';
                const sampleMarkdown = 'Recorded at Abbey Road [1](https://abbeyroad.com) and mastered in London [2].';
                testDiv.innerHTML = window.JarvisMarkdownRenderer.renderMarkdown(sampleMarkdown, {
                    sources: [
                        { id: 1, title: 'Abbey Road', domain: 'abbeyroad.com', url: 'https://abbeyroad.com' },
                        { id: 2, title: 'Mastering Studio', domain: 'mastering.com', url: 'https://mastering.com' }
                    ]
                });
                document.body.appendChild(testDiv);
                const logos = testDiv.querySelectorAll('.citation-source-logo');
                let hasUnderline = false;
                logos.forEach(logo => {
                    const style = window.getComputedStyle(logo);
                    if (style.textDecorationLine === 'underline' || style.textDecoration.includes('underline')) {
                        hasUnderline = true;
                    }
                });
                return {
                    logoCount: logos.length,
                    hasUnderline
                };
            })()`,
            returnByValue: true
        });
        const citationUnderlineResult = evalCitationUnderline?.result?.result?.value || evalCitationUnderline?.result?.value;
        console.log('Citation underline check:', citationUnderlineResult);
        assert.equal(citationUnderlineResult?.logoCount, 2, 'Must render citation badges as logo icons');
        assert.equal(citationUnderlineResult?.hasUnderline, false, 'Citation logo badge must NEVER have an underline');
        console.log('[PASS] Verified citations have ZERO underlines');

        // Test Favicon Endpoint (mixonline.com must return 200 OK, never 404)
        const evalFaviconFetch = await sendCommand('Runtime.evaluate', {
            expression: `(async () => {
                const res = await fetch('/favicons?domain=mixonline.com&sz=64');
                const contentType = res.headers.get('content-type') || '';
                return {
                    status: res.status,
                    ok: res.ok,
                    isSvgOrPng: contentType.includes('svg') || contentType.includes('png') || contentType.includes('image')
                };
            })()`,
            awaitPromise: true,
            returnByValue: true
        });
        const faviconResult = evalFaviconFetch?.result?.result?.value || evalFaviconFetch?.result?.value;
        console.log('Favicon proxy endpoint test:', faviconResult);
        assert.equal(faviconResult?.status, 200, 'Favicon endpoint must return 200 OK (never 404)');
        assert.equal(faviconResult?.isSvgOrPng, true, 'Favicon endpoint must return valid image/svg/png');
        console.log('[PASS] Favicon endpoint returns 200 OK with valid image');

        // Test Emergency SOS Card Rendering (No blocked iframe)
        const evalSosRender = await sendCommand('Runtime.evaluate', {
            expression: `(() => {
                const cardHtml = window.JarvisEmergencySOS.buildEmergencyCardHtml({
                    latitude: 12.968876,
                    longitude: 77.770571,
                    accuracy: 102,
                    address: 'Nagondanahalli Main Road, Bengaluru',
                    batteryLevel: 90,
                    locationMapsText: 'Emergency Location: Nagondanalli Main Road\\nCoordinates: 12.968876, 77.770571\\nGoogle Maps: https://maps.google.com/?q=12.968876,77.770571',
                    googleMapsUrl: 'https://maps.google.com/?q=12.968876,77.770571'
                }, { name: 'Emergency Contact', phone: '+91 9876543210' });

                const div = document.createElement('div');
                div.innerHTML = cardHtml;
                document.body.appendChild(div);

                const iframes = div.querySelectorAll('iframe');
                const mapsLinks = div.querySelectorAll('a[href*="maps.google.com"]');
                const dispatchBanner = div.querySelector('.emergency-sos-dispatch-banner');

                return {
                    hasBlockedIframe: iframes.length > 0,
                    mapsLinksCount: mapsLinks.length,
                    bannerText: dispatchBanner?.textContent?.trim()
                };
            })()`,
            returnByValue: true
        });

        const sosResult = evalSosRender?.result?.result?.value || evalSosRender?.result?.value;
        console.log('Emergency SOS card verification:', sosResult);
        assert.equal(sosResult?.hasBlockedIframe, false, 'Card must have NO blocked iframes');
        assert.ok(sosResult?.mapsLinksCount >= 1, 'Card must provide direct Google Maps links');
        console.log('[PASS] Emergency SOS card has direct maps pin and ZERO blocked iframes');

        // Test Full Entity TTS / Speech Synthesis Pipeline
        const evalTtsPipeline = await sendCommand('Runtime.evaluate', {
            expression: `(() => {
                const sampleBio = 'A. R. Rahman is an internationally acclaimed Indian composer, singer, and music producer. Born on January 6, 1967, in Chennai, Tamil Nadu, he integrated Indian classical music with electronic music sounds. In 2008, his work on Slumdog Millionaire won two Academy Awards, two Grammy Awards, a BAFTA Award, and a Golden Globe Award. Former President Dr. A. P. J. Abdul Kalam praised his patriotic melodies.';
                const cleanFull = window.sanitizeTextForConverseSpeech(sampleBio, true);
                const segments = window.splitConverseSpeechSegments(cleanFull, 0);

                // Simulate assistant message button speak toggle
                const testBtn = document.createElement('button');
                testBtn.className = 'assistant-action-btn';
                testBtn.innerHTML = '<span>Speak</span>';
                document.body.appendChild(testBtn);

                // Stub speech synthesis speak to inspect button state and utterance pipeline in headless Chrome
                const origSpeak = window.speechSynthesis.speak;
                let activeUtterance = null;
                window.speechSynthesis.speak = function(utt) {
                    activeUtterance = utt;
                };

                window.speakFullAssistantMessage(cleanFull, { button: testBtn });
                const isSpeakingAfterStart = testBtn.classList.contains('is-speaking');
                const btnTextAfterStart = testBtn.textContent.trim();

                window.stopActiveTtsSpeech();
                const isSpeakingAfterStop = testBtn.classList.contains('is-speaking');
                const btnTextAfterStop = testBtn.textContent.trim();

                // Restore original
                window.speechSynthesis.speak = origSpeak;

                return {
                    hasSanitizer: typeof window.sanitizeTextForConverseSpeech === 'function',
                    hasSegmenter: typeof window.splitConverseSpeechSegments === 'function',
                    hasSpeakFull: typeof window.speakFullAssistantMessage === 'function',
                    hasStopTts: typeof window.stopActiveTtsSpeech === 'function',
                    fullLength: cleanFull.length,
                    segmentCount: segments.length,
                    allUnder180: segments.every(s => s.length <= 180),
                    isSpeakingAfterStart,
                    btnTextAfterStart,
                    isSpeakingAfterStop,
                    btnTextAfterStop
                };
            })()`,
            returnByValue: true
        });

        const ttsResult = evalTtsPipeline?.result?.result?.value || evalTtsPipeline?.result?.value;
        console.log('TTS full speech pipeline verification:', ttsResult);
        assert.equal(ttsResult?.hasSanitizer, true, 'sanitizeTextForConverseSpeech must exist');
        assert.equal(ttsResult?.hasSegmenter, true, 'splitConverseSpeechSegments must exist');
        assert.equal(ttsResult?.hasSpeakFull, true, 'speakFullAssistantMessage must exist');
        assert.equal(ttsResult?.hasStopTts, true, 'stopActiveTtsSpeech must exist');
        assert.ok(ttsResult?.fullLength > 300, 'Full biography must not be truncated to 600 chars or 4 sentences');
        assert.ok(ttsResult?.segmentCount >= 2, 'Must produce multiple speech segments');
        assert.equal(ttsResult?.allUnder180, true, 'All speech segments must be <= 180 chars for 15s Chrome engine safety');
        assert.equal(ttsResult?.isSpeakingAfterStart, true, 'Button must have is-speaking class while speech is active');
        assert.equal(ttsResult?.btnTextAfterStart, 'Stop', 'Button label must toggle to Stop');
        assert.equal(ttsResult?.isSpeakingAfterStop, false, 'Button must lose is-speaking class when stopped');
        assert.equal(ttsResult?.btnTextAfterStop, 'Speak', 'Button label must return to Speak');
        console.log('[PASS] Browser TTS full speech pipeline verified with segment queue and keepalive');

        // Test Table Single Corner Pencil Icon & Dropdown Menu
        const evalTablePencil = await sendCommand('Runtime.evaluate', {
            expression: `(() => {
                const tableMd = '| Drive Letter | Typical Use | Current Status |\\n|---|---|---|\\n| A: | First floppy | Reserved |\\n| C: | Primary OS | Default |';
                const rendered = window.JarvisMarkdownRenderer.renderMarkdown(tableMd);
                const div = document.createElement('div');
                div.innerHTML = rendered;
                document.body.appendChild(div);

                const toolbar = div.querySelector('.assistant-table-toolbar');
                const triggerBtn = toolbar?.querySelector('.table-pencil-trigger-btn');
                const dropdownWrap = toolbar?.querySelector('.table-pencil-dropdown-wrapper');
                const menu = dropdownWrap?.querySelector('.table-pencil-menu');
                const cornerTriggerButtons = toolbar?.querySelectorAll('.assistant-table-actions > .table-pencil-dropdown-wrapper > .table-pencil-trigger-btn');
                const oldDirectButtons = toolbar?.querySelectorAll('.assistant-table-actions > button, .assistant-table-btn');
                const menuItems = menu?.querySelectorAll('.table-pencil-menu-item');

                const hasPencilSvg = Boolean(triggerBtn?.querySelector('svg'));
                const hasCopy = Array.from(menuItems || []).some(b => b.textContent.includes('Copy'));
                const hasDownload = Array.from(menuItems || []).some(b => b.textContent.includes('Download'));

                // Verify menu toggle
                const initialHidden = menu?.classList.contains('hidden');
                window.toggleTablePencilMenu(triggerBtn);
                const openAfterToggle = !menu?.classList.contains('hidden');
                window.toggleTablePencilMenu(triggerBtn, false);
                const closedAfterToggle = menu?.classList.contains('hidden');

                div.remove();

                return {
                    hasToolbar: Boolean(toolbar),
                    hasTriggerBtn: Boolean(triggerBtn),
                    hasPencilSvg,
                    onlyOneCornerButton: cornerTriggerButtons?.length === 1 && oldDirectButtons?.length === 0,
                    hasCopy,
                    hasDownload,
                    initialHidden,
                    openAfterToggle,
                    closedAfterToggle
                };
            })()`,
            returnByValue: true
        });

        const tableResult = evalTablePencil?.result?.result?.value || evalTablePencil?.result?.value;
        console.log('Table pencil menu verification:', tableResult);
        assert.equal(tableResult?.hasToolbar, true, 'Table toolbar must exist');
        assert.equal(tableResult?.hasTriggerBtn, true, 'Pencil trigger button must exist');
        assert.equal(tableResult?.hasPencilSvg, true, 'Pencil SVG icon must exist');
        assert.equal(tableResult?.onlyOneCornerButton, true, 'There must be only ONE button in corner (the pencil button)');
        assert.equal(tableResult?.hasCopy, true, 'Pencil menu must have Copy');
        assert.equal(tableResult?.hasDownload, true, 'Pencil menu must have Download');
        assert.equal(tableResult?.openAfterToggle, true, 'Pencil menu must toggle open');
        assert.equal(tableResult?.closedAfterToggle, true, 'Pencil menu must toggle closed');
        console.log('[PASS] Table corner has only one pencil icon with Copy and Download inside');

        // Test VTT Prompt Box Deduping: spoken prompt must appear only ONCE in the prompt box
        const evalVttDedup = await sendCommand('Runtime.evaluate', {
            expression: `(async () => {
                const textInput = document.getElementById('text-input');
                textInput.value = '';
                textInput.dispatchEvent(new Event('input', { bubbles: true }));

                // Start dictation
                await window.toggleVoiceToText();
                const ctrl = window.JarvisSpeechInput;

                // Simulate interim speech
                ctrl?._callbacks?.onInterim?.('what is the capital of france', ctrl.getState());
                const valAfterInterim = textInput.value;

                // Simulate final speech
                await ctrl?._callbacks?.onFinal?.('what is the capital of france', { source: 'vtt', autoSubmit: false });
                const valAfterFinal = textInput.value;

                // Stop dictation
                await window.toggleVoiceToText();
                const valAfterStop = textInput.value;

                return {
                    valAfterInterim,
                    valAfterFinal,
                    valAfterStop,
                    isCleanSingle: valAfterStop.toLowerCase() === 'what is the capital of france'
                };
            })()`,
            awaitPromise: true,
            returnByValue: true
        });

        const vttResult = evalVttDedup?.result?.result?.value || evalVttDedup?.result?.value;
        console.log('VTT prompt dedup verification:', vttResult);
        assert.equal(vttResult?.isCleanSingle, true, 'Spoken prompt must appear only once in prompt box, never duplicated');
        assert.notEqual(vttResult?.valAfterStop, 'What is the capital of france What is the capital of france', 'Prompt must not be duplicated');
        console.log('[PASS] VTT prompt deduping verified: prompt appears exactly once');

        // Test 11: Settings "Important Info & Architecture" Disclosure Subview & Footer Link
        const evalImportantInfo = await sendCommand('Runtime.evaluate', {
            expression: `(() => {
                const footerBtn = document.querySelector('#footer-disclaimer .composer-disclaimer-btn');
                const hasFooterBtn = Boolean(footerBtn);
                const footerBtnText = footerBtn ? footerBtn.textContent.trim() : '';

                // Click the footer link
                if (footerBtn) {
                    footerBtn.click();
                }

                const helpModal = document.getElementById('help-modal');
                const isModalOpen = Boolean(helpModal);
                const archView = document.getElementById('settings-view-architecture-info');
                const isArchActive = archView && archView.classList.contains('active') && archView.style.display === 'flex';
                const archText = archView ? archView.innerText || archView.textContent : '';

                const hasNodeRuntime = archText.includes('22.x');
                const hasColdStartInfo = archText.includes('Cold Start Prevention') && archText.includes('Disabled');
                const hasServerlessTradeoff = archText.includes('Serverless Cold Starts');
                const hasPrivacyAdvantage = archText.includes('100% Local-First Privacy');
                const hasEnterpriseCompare = archText.includes('ChatGPT') || archText.includes('OpenAI');

                // Return to main view
                const backBtn = archView ? archView.querySelector('.settings-subview-back-btn') : null;
                if (backBtn) {
                    backBtn.click();
                }
                const mainView = document.getElementById('settings-view-main');
                const isMainActive = mainView && mainView.classList.contains('active');

                // Close modal
                if (typeof window.closeHelpModal === 'function') {
                    window.closeHelpModal();
                }

                return {
                    hasFooterBtn,
                    footerBtnText,
                    isModalOpen,
                    isArchActive,
                    hasNodeRuntime,
                    hasColdStartInfo,
                    hasServerlessTradeoff,
                    hasPrivacyAdvantage,
                    hasEnterpriseCompare,
                    isMainActive
                };
            })()`,
            awaitPromise: true,
            returnByValue: true
        });

        const infoResult = evalImportantInfo?.result?.result?.value || evalImportantInfo?.result?.value;
        console.log('Important Info view verification:', infoResult);
        assert.equal(infoResult?.hasFooterBtn, true, 'Footer disclaimer button must exist');
        assert.equal(infoResult?.footerBtnText, 'Check important info.', 'Footer disclaimer button text must be "Check important info."');
        assert.equal(infoResult?.isModalOpen, true, 'Clicking footer button must open Settings modal');
        assert.equal(infoResult?.isArchActive, true, 'Settings modal must navigate directly to Important Info & Architecture subview');
        assert.equal(infoResult?.hasNodeRuntime, true, 'Sub-view must disclose Node.js 22.x runtime');
        assert.equal(infoResult?.hasColdStartInfo, true, 'Sub-view must disclose Cold Start Prevention Disabled');
        assert.equal(infoResult?.hasServerlessTradeoff, true, 'Sub-view must explain Serverless Cold Starts vs dedicated enterprise GPU fleets');
        assert.equal(infoResult?.hasPrivacyAdvantage, true, 'Sub-view must explain 100% Local-First Privacy and zero training retention');
        assert.equal(infoResult?.hasEnterpriseCompare, true, 'Sub-view must compare tradeoffs vs OpenAI/ChatGPT/Anthropic');
        assert.equal(infoResult?.isMainActive, true, 'Back button must return cleanly to main Settings view');
        console.log('[PASS] Settings "Important Info & Architecture" disclosure verified end-to-end');

        // Test Vercel Serverless Function Count limit (must be <= 12 on Hobby plan)
        const fs = await import('node:fs');
        const path = await import('node:path');
        const apiDir = path.resolve(process.cwd(), 'api');
        const apiFiles = fs.readdirSync(apiDir).filter(f => f.endsWith('.js') && !f.startsWith('_'));
        console.log(`Vercel function count: ${apiFiles.length} functions (${apiFiles.join(', ')})`);
        assert.ok(apiFiles.length <= 12, `Vercel Hobby plan allows max 12 functions, found ${apiFiles.length}`);
        console.log('[PASS] Vercel function count is within Hobby plan limit (<= 12)');

        ws.close();
        console.log('=== All Real Chrome Browser E2E Tests PASSED Successfully! ===');
    } finally {
        try { chromeProc.kill('SIGKILL'); } catch (_) {}
        if (devServerStarted) {
            try { server.close(); } catch (_) {}
        }
    }
}

runBrowserTests().catch(err => {
    console.error('Browser E2E test failed:', err);
    process.exit(1);
});
