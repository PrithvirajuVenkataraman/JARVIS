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
        assert.equal(globals?.hasEmergencySos, false, 'window.JarvisEmergencySOS must be removed');
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

        // Verify Circular Citation Logo Badges & Emergency SOS Removal
        const evalRoundBadgeAndSosRemoval = await sendCommand('Runtime.evaluate', {
            expression: `(() => {
                const probe = document.createElement('a');
                probe.className = 'citation-source-logo';
                const img = document.createElement('img');
                img.className = 'citation-logo-icon';
                probe.appendChild(img);
                document.body.appendChild(probe);
                const badgeRadius = getComputedStyle(probe).borderRadius;
                const iconRadius = getComputedStyle(img).borderRadius;
                probe.remove();
                return {
                    badgeRadius,
                    iconRadius,
                    hasSosModal: Boolean(document.getElementById('sos-contact-modal'))
                };
            })()`,
            returnByValue: true
        });
        const roundCheck = evalRoundBadgeAndSosRemoval?.result?.result?.value || evalRoundBadgeAndSosRemoval?.result?.value;
        console.log('Citation badge shape & SOS removal verification:', roundCheck);
        assert.ok(parseFloat(roundCheck?.badgeRadius) >= 10 || roundCheck?.badgeRadius === '50%', `Citation badge must be circular, got ${roundCheck?.badgeRadius}`);
        assert.ok(parseFloat(roundCheck?.iconRadius) >= 10 || roundCheck?.iconRadius === '50%', `Citation icon must be circular, got ${roundCheck?.iconRadius}`);
        assert.equal(roundCheck?.hasSosModal, false, 'Emergency SOS modal must be completely removed from DOM');
        console.log('[PASS] Citation logo badges are circular and Emergency SOS is completely removed');

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

        // Test 12: Real Browser Math Problem Rendering (KaTeX, Steps, Display Delimiters, Zero <br> Artifacts)
        const evalMathRender = await sendCommand('Runtime.evaluate', {
            expression: `(() => {
                const sampleMathMd = 'Here is the step-by-step solution:\\n\\nStep 1: Solve quadratic formula\\n$$\\nx = \\\\frac{-b \\\\pm \\\\sqrt{b^2 - 4ac}}{2a}\\n$$\\n\\nStep 2: Calculate discriminant for roots\\n$$\\\\Delta = (-5)^2 - 4(1)(6) = 1$$\\n\\nStep 3: Final roots\\n$$\\\\boxed{x = 2, 3}$$';

                const testContainer = document.createElement('div');
                testContainer.id = 'browser-math-test-container';
                testContainer.innerHTML = window.JarvisMarkdownRenderer.renderMarkdown(sampleMathMd);
                document.body.appendChild(testContainer);

                const hasKatex = typeof window.katex !== 'undefined';
                const hasKatexHtml = Boolean(testContainer.querySelector('.katex-html'));
                const displayBlocks = testContainer.querySelectorAll('.math-display-block');
                const stepLabels = testContainer.querySelectorAll('.math-step-label');
                const rawHtml = testContainer.innerHTML;

                // Critical Invariants:
                // 1. Zero <br> tags leaked into KaTeX TeX annotations or math formulas
                const mathAnnotationTexts = Array.from(testContainer.querySelectorAll('annotation')).map(a => a.textContent || '');
                const hasBrInAnnotation = mathAnnotationTexts.some(t => t.includes('<br>') || t.includes('&lt;br&gt;'));
                // 2. Zero invalid <p><div> DOM nesting
                const hasDivInsideP = rawHtml.includes('<p class="assistant-md-p"><div class="math-display-block">');
                // 3. Step labels properly matched
                const stepsCount = stepLabels.length;

                testContainer.remove();

                return {
                    hasKatex,
                    hasKatexHtml,
                    displayBlockCount: displayBlocks.length,
                    stepsCount,
                    hasBrInAnnotation,
                    hasDivInsideP
                };
            })()`,
            returnByValue: true
        });

        const mathResult = evalMathRender?.result?.result?.value || evalMathRender?.result?.value;
        console.log('Real browser math problem verification:', mathResult);
        assert.equal(mathResult?.hasKatex, true, 'KaTeX must be loaded in browser environment');
        assert.equal(mathResult?.hasKatexHtml, true, 'KaTeX HTML elements must be rendered');
        assert.equal(mathResult?.displayBlockCount, 3, 'Must render 3 display math blocks');
        assert.equal(mathResult?.stepsCount, 3, 'Must detect all 3 step labels');
        assert.equal(mathResult?.hasBrInAnnotation, false, 'Must have ZERO <br> artifacts leaked into math annotations');
        assert.equal(mathResult?.hasDivInsideP, false, 'Must have ZERO invalid <p><div> DOM nestings');
        console.log('[PASS] Real browser math problems verified: KaTeX display rendering, steps, and zero <br> artifacts');

        // Test 13: Perplexity-Style Research Sources Bar & Citation Synchronization
        const evalResearchBar = await sendCommand('Runtime.evaluate', {
            expression: `(() => {
                const testMsgId = 'test-msg-' + Date.now();
                const chatContainer = document.getElementById('chat-messages') || document.body;
                const row = document.createElement('div');
                row.className = 'chat-row chat-message-row assistant';
                row.setAttribute('data-message-id', testMsgId);
                row.innerHTML = \`
                    <div class="chat-bubble-assistant">
                        <div class="assistant-message-text">
                            Evidence verified in the clinical literature
                            <a href="javascript:void(0)" class="citation-source-logo" data-source-id="1" title="Nature (nature.com)">
                                <img class="citation-logo-icon" src="/api/favicon?domain=nature.com" alt="nature.com" />
                            </a>.
                        </div>
                    </div>
                \`;
                chatContainer.appendChild(row);

                // Step 1: Render shimmer skeleton while searching
                window.renderResearchSourcesBar(testMsgId, [], true);
                const barAfterSearch = row.querySelector('.research-dossier-bar');
                const shimmers = row.querySelectorAll('.research-source-card-shimmer');
                const shimmerCount = shimmers.length;

                // Step 2: Render completed sources carousel (10 sources to test 8 visible + 2 overflow)
                const mockSources = Array.from({ length: 10 }, (_, i) => ({
                    id: i + 1,
                    title: 'Research Paper ' + (i + 1),
                    url: 'https://nature.com/articles/s41586-026-0' + (i + 1),
                    domain: 'nature.com'
                }));
                window.renderResearchSourcesBar(testMsgId, mockSources, false);

                const sourceCards = row.querySelectorAll('.research-source-card:not(.research-source-overflow-btn)');
                const hiddenOverflowCards = row.querySelectorAll('.research-source-card.is-overflow-hidden');
                const overflowBtn = row.querySelector('.research-source-overflow-btn');
                const firstCardIndex = row.querySelector('.research-source-card[data-source-id="1"] .research-source-card-index')?.textContent?.trim();

                // Step 3: Test overflow button click unhiding cards
                if (overflowBtn) {
                    overflowBtn.click();
                }
                const hiddenAfterClick = row.querySelectorAll('.research-source-card.is-overflow-hidden').length;

                // Step 4: Click citation badge to test synchronized highlight
                const citationBadge = row.querySelector('.citation-source-logo[data-source-id="1"]');
                if (citationBadge) {
                    citationBadge.click();
                }
                const firstCardHighlighted = row.querySelector('.research-source-card[data-source-id="1"]')?.classList.contains('is-highlighted');

                row.remove();

                return {
                    hasBar: Boolean(barAfterSearch),
                    shimmerCount,
                    totalSourceCards: sourceCards.length,
                    initialOverflowHidden: hiddenOverflowCards.length,
                    hasOverflowBtn: Boolean(overflowBtn),
                    firstCardIndex,
                    hiddenAfterClick,
                    firstCardHighlighted: Boolean(firstCardHighlighted)
                };
            })()`,
            returnByValue: true
        });

        const researchResult = evalResearchBar?.result?.result?.value || evalResearchBar?.result?.value;
        console.log('Perplexity-style research bar verification:', researchResult);
        assert.equal(researchResult?.hasBar, true, 'Research dossier bar must be created in assistant bubble');
        assert.equal(researchResult?.shimmerCount, 4, 'Must show 4 animated shimmer cards while searching');
        assert.equal(researchResult?.totalSourceCards, 10, 'Must render all 10 source cards');
        assert.equal(researchResult?.initialOverflowHidden, 2, 'Must hide 2 overflow cards initially (max 8 visible)');
        assert.equal(researchResult?.hasOverflowBtn, true, 'Must display +2 more overflow button');
        assert.equal(researchResult?.firstCardIndex, '1', 'First card index badge must display "1"');
        assert.equal(researchResult?.hiddenAfterClick, 0, 'Clicking overflow button must unhide all overflow cards');
        assert.equal(researchResult?.firstCardHighlighted, true, 'Clicking in-text citation badge must add is-highlighted to matching source card');
        console.log('[PASS] Perplexity-style research sources carousel, shimmers, overflow expansion, and synchronized citation highlighting verified');

        // Test 14: Thumbs Up/Down Feedback Loop, Closed-Loop Self-Improving Memory & Semantic Weather Routing
        const evalFeedbackAndRouting = await sendCommand('Runtime.evaluate', {
            expression: `(async () => {
                // 1. Semantic Weather Routing (Zero Negative Blocklist Whack-a-Mole)
                const weatherFn = window.JarvisFrontendRouting?.isMeteorologicalWeatherIntent;
                const astroWeather = weatherFn('Give me a brief 2027 relationship astrology forecast for Sagittarius');
                const salesWeather = weatherFn('Q3 sales forecast for EMEA');
                const boxOfficeWeather = weatherFn('box office forecast for Avatar');
                const tokyoWeather = weatherFn('weather forecast for Tokyo');
                const rainWeather = weatherFn('will it rain today');
                const aqiWeather = weatherFn('AQI in Delhi');

                // 2. Thumbs Up / Thumbs Down + Closed-Loop Self-Improving Memory
                await window.JarvisSelfImprovingMemory.clear();
                const msgId = 'fb-test-' + Date.now();
                const host = document.createElement('div');
                host.innerHTML = buildAssistantActionsHtml(msgId, true, { label: 'Gemini 4 Hydrogen' });
                document.body.appendChild(host);

                const btnUp = host.querySelector('[data-assistant-action="feedback_up"]');
                const btnDown = host.querySelector('[data-assistant-action="feedback_down"]');

                // Click Thumbs Up
                btnUp.click();
                await new Promise(r => setTimeout(r, 80));
                const upActive = btnUp.classList.contains('is-feedback-up') && btnUp.getAttribute('aria-pressed') === 'true';
                const statsAfterUp = window.JarvisSelfImprovingMemory.getStats();

                // Click Thumbs Down to open viewport-clamped popover
                btnDown.click();
                await new Promise(r => setTimeout(r, 80));
                const popover = document.getElementById('assistant-feedback-popover-' + msgId);
                const popoverVisible = Boolean(popover && !popover.classList.contains('hidden'));
                const popoverPos = popover ? getComputedStyle(popover).position : '';
                const hasRegenBtn = Boolean(popover?.querySelector('.feedback-regen-btn'));

                // Select Inaccurate + Too Long tags and submit
                const chips = Array.from(popover.querySelectorAll('.feedback-tag-chip'));
                chips.find(c => c.textContent.trim() === 'Inaccurate')?.click();
                chips.find(c => c.textContent.trim() === 'Too Long')?.click();
                const commentBox = document.getElementById('feedback-comment-' + msgId);
                if (commentBox) commentBox.value = 'Keep math explanations concise without fluff';
                await window.submitAssistantNegativeFeedback(msgId, false);

                const popoverClosedAfterSubmit = Boolean(popover?.classList.contains('hidden'));
                const downActive = btnDown.classList.contains('is-feedback-down') && !btnUp.classList.contains('is-feedback-up');
                const statsAfterDown = window.JarvisSelfImprovingMemory.getStats();

                // Verify global rules inject even on an unrelated query (Two-Tier Injection)
                const injectedPrompt = window.JarvisSelfImprovingMemory.injectIntoSystemPrompt('BASE_PROMPT', 'Solve x^2 - 5x + 6 = 0');
                const injectedHasLearned = injectedPrompt.includes('USER LEARNED PREFERENCES');

                // Verify conflict superseding (Incomplete/depth_and_rigor supersedes conciseness)
                await window.JarvisSelfImprovingMemory.distillNegativeFeedback('Incomplete answer', 'test', 'resp', { tags: ['Incomplete'] });
                const categoriesAfterConflict = window.JarvisSelfImprovingMemory.getAll().map(r => r.category);
                const concisenessSuperseded = !categoriesAfterConflict.includes('conciseness') && categoriesAfterConflict.includes('depth_and_rigor');

                popover?.remove();
                host.remove();
                await window.JarvisSelfImprovingMemory.clear();

                return {
                    astroWeather,
                    salesWeather,
                    boxOfficeWeather,
                    tokyoWeather,
                    rainWeather,
                    aqiWeather,
                    upActive,
                    positiveCount: statsAfterUp.positiveCount,
                    popoverVisible,
                    popoverPos,
                    hasRegenBtn,
                    popoverClosedAfterSubmit,
                    downActive,
                    negativeCount: statsAfterDown.negativeCount,
                    activeRulesAfterDown: statsAfterDown.activeRules,
                    injectedHasLearned,
                    concisenessSuperseded
                };
            })()`,
            awaitPromise: true,
            returnByValue: true
        });

        const fbResult = evalFeedbackAndRouting?.result?.result?.value || evalFeedbackAndRouting?.result?.value;
        console.log('Feedback loop & semantic routing verification:', fbResult);
        assert.equal(fbResult?.astroWeather, false, 'Astrology forecast must NOT route to weather');
        assert.equal(fbResult?.salesWeather, false, 'Sales forecast must NOT route to weather');
        assert.equal(fbResult?.boxOfficeWeather, false, 'Box office forecast must NOT route to weather');
        assert.equal(fbResult?.tokyoWeather, true, 'Weather forecast for Tokyo must route to weather');
        assert.equal(fbResult?.rainWeather, true, 'Will it rain today must route to weather');
        assert.equal(fbResult?.aqiWeather, true, 'AQI in Delhi must route to weather');
        assert.equal(fbResult?.upActive, true, 'Thumbs up must visibly activate with emerald state');
        assert.equal(fbResult?.positiveCount, 1, 'Thumbs up must record positive reinforcement');
        assert.equal(fbResult?.popoverVisible, true, 'Thumbs down must open feedback popover');
        assert.equal(fbResult?.popoverPos, 'fixed', 'Feedback popover must use viewport-safe fixed positioning');
        assert.equal(fbResult?.hasRegenBtn, true, 'Feedback popover must include Fix & Regenerate action');
        assert.equal(fbResult?.popoverClosedAfterSubmit, true, 'Submitting negative feedback must close popover cleanly without errors');
        assert.equal(fbResult?.downActive, true, 'Thumbs down must activate rose state and deactivate thumbs up');
        assert.equal(fbResult?.negativeCount, 1, 'Thumbs down must record negative count');
        assert.ok(fbResult?.activeRulesAfterDown >= 2, 'Thumbs down tags must distill actionable rules');
        assert.equal(fbResult?.injectedHasLearned, true, 'Global learned rules must inject even on unrelated queries');
        assert.equal(fbResult?.concisenessSuperseded, true, 'Conflicting depth_and_rigor rule must cleanly supersede conciseness');
        console.log('[PASS] Thumbs up/down, closed-loop self-improving memory, conflict superseding & semantic weather routing verified');

        // Test 15: Premium Typography, Code Blocks (Wrap/Collapse/Copy Icon), Sticky Header & Floating Top-Center Toast
        const evalUiPolish = await sendCommand('Runtime.evaluate', {
            expression: `(() => {
                const header = document.getElementById('app-header');
                const headerPosition = header ? getComputedStyle(header).position : '';

                // Floating top-center toast must NOT append inside #chat-container
                const chatCountBeforeToast = document.getElementById('chat-container')?.children.length || 0;
                showTemporaryMessage('Toast polish check');
                const chatCountAfterToast = document.getElementById('chat-container')?.children.length || 0;
                const toastRegion = document.getElementById('jarvis-toast-region');
                const toastPosition = toastRegion ? getComputedStyle(toastRegion).position : '';
                const hasToastPill = Boolean(toastRegion?.querySelector('.jarvis-toast-pill'));
                toastRegion?.remove();

                // Developer-grade code block (32 lines -> auto-collapsed + Wrap + Copy icon)
                const longCode = Array.from({ length: 32 }, (_, i) => 'const line_' + (i + 1) + ' = "value_' + (i + 1) + '";').join('\\n');
                const md = '# Main Title\\n\\n## Section Heading\\n\\n> Key architectural note\\n\\n\`\`\`javascript\\n' + longCode + '\\n\`\`\`';
                const box = document.createElement('div');
                box.className = 'assistant-message-text';
                box.innerHTML = window.JarvisMarkdownRenderer.renderMarkdown(md);
                document.body.appendChild(box);

                const h2Size = parseFloat(getComputedStyle(box.querySelector('h2')).fontSize);
                const h3Size = parseFloat(getComputedStyle(box.querySelector('h3')).fontSize);
                const bqBorderLeft = parseFloat(getComputedStyle(box.querySelector('blockquote')).borderLeftWidth);

                const codeContainer = box.querySelector('.assistant-md-code-container');
                const codeLinesText = box.querySelector('.assistant-md-code-lines')?.textContent?.trim() || '';
                const hasCopyIconSpan = Boolean(box.querySelector('.code-copy-icon svg'));
                const startsCollapsed = Boolean(codeContainer?.classList.contains('is-collapsed'));
                const pre = box.querySelector('.assistant-md-code-block');
                const initialWhiteSpace = pre ? getComputedStyle(pre).whiteSpace : '';

                // Click Wrap & Expand
                box.querySelector('.code-wrap-btn')?.click();
                const wrappedAfterClick = Boolean(pre?.classList.contains('is-wrapped'));
                box.querySelector('.code-collapse-btn')?.click();
                const collapsedAfterExpand = Boolean(codeContainer?.classList.contains('is-collapsed'));

                box.remove();

                return {
                    headerPosition,
                    toastLeftChatClean: chatCountBeforeToast === chatCountAfterToast,
                    toastPosition,
                    hasToastPill,
                    h1GreaterThanH2: h2Size > h3Size,
                    bqHasLeftAccent: bqBorderLeft >= 2.5,
                    codeLinesText,
                    hasCopyIconSpan,
                    startsCollapsed,
                    initialWhiteSpace,
                    wrappedAfterClick,
                    collapsedAfterExpand
                };
            })()`,
            returnByValue: true
        });

        const uiPolish = evalUiPolish?.result?.result?.value || evalUiPolish?.result?.value;
        console.log('Premium UI polish verification:', uiPolish);
        assert.equal(uiPolish?.headerPosition, 'sticky', 'Top header must be truly sticky');
        assert.equal(uiPolish?.toastLeftChatClean, true, 'Floating toast must not inject into #chat-container');
        assert.equal(uiPolish?.toastPosition, 'fixed', 'Floating toast region must use fixed top-center positioning');
        assert.equal(uiPolish?.hasToastPill, true, 'Floating toast pill must render');
        assert.equal(uiPolish?.h1GreaterThanH2, true, 'H1 heading must be visibly larger than H2');
        assert.equal(uiPolish?.bqHasLeftAccent, true, 'Blockquote must have cyan left accent border');
        assert.equal(uiPolish?.codeLinesText, '32 lines', 'Code block header must display accurate line count');
        assert.equal(uiPolish?.hasCopyIconSpan, true, 'Code block copy button must wrap SVG in .code-copy-icon for animated checkmark');
        assert.equal(uiPolish?.startsCollapsed, true, 'Long code blocks (>28 lines) must start collapsed when not streaming');
        assert.equal(uiPolish?.initialWhiteSpace, 'pre', 'Code blocks must preserve horizontal scroll by default');
        assert.equal(uiPolish?.wrappedAfterClick, true, 'Clicking Wrap toggle must enable word wrap');
        assert.equal(uiPolish?.collapsedAfterExpand, false, 'Clicking Expand must reveal full code block');
        console.log('[PASS] Premium typography, developer code blocks, sticky header, and top-center floating toast verified');

        // Test 16: Single Thumbs Bar (No Duplicate Legacy Feedback Pill) + End-to-End Personalized Experience Verification
        const evalPersonalizationAndFeedback = await sendCommand('Runtime.evaluate', {
            expression: `(() => {
                // 16A: Verify addFeedbackButtons does NOT append duplicate legacy .feedback-container
                addFeedbackButtons('test query', 'test answer', 'msg_single_thumb_check');
                const legacyFeedbackCount = document.querySelectorAll('.feedback-container').length;

                // 16B: Verify Personalized Experience end-to-end (init, extract, persist, conflict update, prompt build, toggle pause)
                const um = window.JarvisUnifiedMemory;
                const store = um.unifiedMemoryStore;
                store.clear();
                setPersonalizationEnabled(true);
                um.setMemoryActive(true);

                // Auto-learn from natural conversation
                processUnifiedMemoryTurn('My name is Aarav and I live in Chennai. I code in TypeScript.');
                const learnedCount = store.getEnabled().length;

                // Simulate full page reload by resetting in-memory array and calling init()
                store.memories = [];
                store.isInitialized = false;
                store.init();
                const persistedCountAfterReload = store.getEnabled().length;

                // Conflict update: moved city replaces previous location cleanly
                processUnifiedMemoryTurn('I recently moved to Bangalore.');
                const locationsAfterMove = store.getEnabled().filter(m => m.category === 'location').map(m => m.text);

                // Prompt injection must include relevant memories
                const normalPrompt = um.buildRelevantMemoryPrompt('Help me write a TypeScript function', store.getEnabled());
                const metaPrompt = um.buildRelevantMemoryPrompt('What do you know about me?', store.getEnabled());

                // Pause Personalized Experience -> must block new learning while preserving existing memories
                handlePersonalizationToggleChange({ checked: false, setAttribute() {} });
                const isPausedInPage = !isPersonalizationEnabled();
                const isPausedInModule = !um.isMemoryActive();
                processUnifiedMemoryTurn('I live in London and I am vegan.');
                const locationsWhilePaused = store.getEnabled().filter(m => m.category === 'location').map(m => m.text);
                const countWhilePaused = store.getEnabled().length;

                // Restore clean state
                handlePersonalizationToggleChange({ checked: true, setAttribute() {} });
                store.clear();
                document.getElementById('jarvis-toast-region')?.remove();

                return {
                    legacyFeedbackCount,
                    hasExtractMemories: typeof um.extractMemories === 'function',
                    hasBuildRelevantMemoryPrompt: typeof um.buildRelevantMemoryPrompt === 'function',
                    learnedCount,
                    persistedCountAfterReload,
                    locationsAfterMove,
                    normalPromptHasProfile: normalPrompt.includes('Aarav') && normalPrompt.includes('Bangalore') && normalPrompt.includes('TypeScript'),
                    metaPromptHasProfile: metaPrompt.includes('Aarav') && metaPrompt.includes('Bangalore'),
                    isPausedInPage,
                    isPausedInModule,
                    locationsWhilePaused,
                    countWhilePaused
                };
            })()`,
            returnByValue: true
        });

        const persRes = evalPersonalizationAndFeedback?.result?.result?.value || evalPersonalizationAndFeedback?.result?.value;
        console.log('Single thumbs & Personalized Experience verification:', persRes);
        assert.equal(persRes?.legacyFeedbackCount, 0, 'Duplicate legacy .feedback-container must not render');
        assert.equal(persRes?.hasExtractMemories, true, 'JarvisUnifiedMemory.extractMemories must be exported');
        assert.equal(persRes?.hasBuildRelevantMemoryPrompt, true, 'JarvisUnifiedMemory.buildRelevantMemoryPrompt must be exported');
        assert.ok(persRes?.learnedCount >= 3, 'Natural conversation turn must auto-extract name, location, and coding language');
        assert.equal(persRes?.persistedCountAfterReload, persRes?.learnedCount, 'Saved memories must persist across reload via store.init()');
        assert.deepEqual(persRes?.locationsAfterMove, ['Lives in Bangalore'], 'Moving cities must supersede old location cleanly');
        assert.equal(persRes?.normalPromptHasProfile, true, 'buildRelevantMemoryPrompt must inject relevant profile & tech memories');
        assert.equal(persRes?.metaPromptHasProfile, true, 'Meta-query prompt must list all saved memories');
        assert.equal(persRes?.isPausedInPage, true, 'Toggle OFF must pause isPersonalizationEnabled()');
        assert.equal(persRes?.isPausedInModule, true, 'Toggle OFF must pause JarvisUnifiedMemory.isMemoryActive()');
        assert.deepEqual(persRes?.locationsWhilePaused, ['Lives in Bangalore'], 'Paused personalization must NOT overwrite or learn new facts');
        assert.equal(persRes?.countWhilePaused, persRes?.persistedCountAfterReload, 'Paused personalization must preserve existing memories without adding new ones');
        console.log('[PASS] Single thumbs bar & full Personalized Experience lifecycle verified end-to-end');

        // Test 17: Fast-Stream RAF Race & Zero Lingering Vertical Blinker Caret
        const evalStreamBlinkerRace = await sendCommand('Runtime.evaluate', {
            expression: `(async () => {
                const msgId = createStreamingAssistantMessage({ userMessage: 'Hey' });
                // Simulate fast Groq token chunk followed immediately by done before next animation frame
                updateStreamingAssistantMessage(msgId, 'How can I', { userMessage: 'Hey', streaming: true });
                await new Promise(r => setTimeout(r, 5));
                updateStreamingAssistantMessage(msgId, 'How can I help you today?', { userMessage: 'Hey', streaming: false });
                await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
                await new Promise(r => setTimeout(r, 80));

                const row = findAssistantMessageRow(msgId);
                const textEl = row?.querySelector('.assistant-message-text');
                const stillHasStreamingClass = Boolean(textEl?.classList?.contains('is-streaming'));
                const renderedText = (textEl?.textContent || '').trim();
                const afterContent = textEl ? getComputedStyle(textEl, '::after').content : '';
                const blinkerNodes = document.querySelectorAll('#chat-synthesizing-blinker, .synthesizing-blinker').length;
                row?.remove();
                return { stillHasStreamingClass, renderedText, afterContent, blinkerNodes };
            })()`,
            awaitPromise: true,
            returnByValue: true
        });
        const raceRes = evalStreamBlinkerRace?.result?.result?.value || evalStreamBlinkerRace?.result?.value;
        console.log('Fast-stream RAF race & blinker elimination verification:', raceRes);
        assert.equal(raceRes?.stillHasStreamingClass, false, 'Finalized message must NEVER retain .is-streaming after pending RAF frames');
        assert.equal(raceRes?.renderedText, 'How can I help you today?', 'Pending streaming RAF must NEVER overwrite finalized reply');
        assert.equal(raceRes?.afterContent, 'none', 'Assistant message must NOT render a blinking ::after vertical caret');
        assert.equal(raceRes?.blinkerNodes, 0, 'Synthesizing blinker must be removed on completion');
        console.log('[PASS] Fast-stream RAF race fixed and lingering vertical caret blinkers eliminated');

        // Test 18: Local-First IndexedDB Durability, Multi-Tab LWW Merge, AES-256-GCM Backup & Settings Sub-View
        const evalDurability = await sendCommand('Runtime.evaluate', {
            expression: `(async () => {
                const dur = window.JarvisWorkspaceDurability;
                if (!dur) return { missing: true };

                // 18A: IndexedDB stores full untruncated messages (>12,000 chars)
                const longText = 'DURABLE_PAYLOAD_' + 'X'.repeat(12000) + '_END';
                const bigSession = {
                    id: 'sess_idb_big_1',
                    title: 'Long Architecture Spec',
                    messages: [
                        { role: 'user', text: 'Write spec', timestamp: '2026-11-18T10:00:00.000Z' },
                        { role: 'assistant', text: longText, timestamp: '2026-11-18T10:00:01.000Z' }
                    ],
                    createdAt: '2026-11-18T10:00:00.000Z',
                    updatedAt: '2026-11-18T10:00:01.000Z',
                    deleted: false
                };
                await dur.workspaceDb.clearAllSessions();
                await dur.workspaceDb.saveSessions([bigSession], []);
                const reloaded = await dur.workspaceDb.loadAllSessions();
                const restoredLen = reloaded.find(s => s.id === 'sess_idb_big_1')?.messages?.[1]?.text?.length || 0;

                // 18B: LWW merge + tombstones + active-stream protection
                const localSessions = [
                    { id: 's1', title: 'Old Title', messages: [{ role: 'user', text: 'Hi' }], updatedAt: '2026-11-18T10:00:00.000Z' },
                    { id: 's_stream', title: 'Streaming Chat', messages: [{ role: 'user', text: 'Q' }, { role: 'assistant', text: 'Live partial' }], updatedAt: '2026-11-18T10:00:00.000Z' }
                ];
                const incomingSessions = [
                    { id: 's1', title: 'Newer Title', messages: [{ role: 'user', text: 'Hi' }, { role: 'assistant', text: 'Updated' }], updatedAt: '2026-11-18T10:05:00.000Z' },
                    { id: 's_deleted', title: 'Ghost', messages: [{ role: 'user', text: 'Ghost' }], updatedAt: '2026-11-18T10:09:00.000Z' },
                    { id: 's_stream', title: 'Streaming Chat', messages: [{ role: 'user', text: 'Q' }], updatedAt: '2026-11-18T10:09:00.000Z' }
                ];
                const merged = dur.mergeChatSessionsLww(localSessions, incomingSessions, ['s_deleted'], { activeStreamingSessionId: 's_stream' });
                const s1Merged = merged.find(s => s.id === 's1');
                const ghostResurrected = merged.some(s => s.id === 's_deleted');
                const streamProtected = merged.find(s => s.id === 's_stream')?.messages?.[1]?.text === 'Live partial';

                // 18C: AES-256-GCM Encrypted Backup & Restore (BYOK strictly excluded)
                const archiveStr = await dur.createWorkspaceBackup({
                    sessions: [bigSession],
                    memories: [{ id: 'm1', text: 'Lives in Chennai', category: 'location', enabled: true }],
                    learnedRules: [{ id: 'r1', directive: 'Be concise', category: 'conciseness', enabled: true }],
                    customSystemPrompt: 'Staff engineer tone',
                    settings: { themeMode: 'dark', groq_api_key: 'gsk_SHOULD_NEVER_EXPORT', jarvis_byok_gemini_sealed: 'SECRET_BLOB' }
                }, { encrypt: true, passphrase: 'TestPass#2026' });

                const envelope = JSON.parse(archiveStr);
                const plaintextLeaked = archiveStr.includes('DURABLE_PAYLOAD_') || archiveStr.includes('gsk_SHOULD_NEVER_EXPORT');
                const wrongPassRes = await dur.parseWorkspaceBackup(archiveStr, 'WrongPass');
                const rightPassRes = await dur.parseWorkspaceBackup(archiveStr, 'TestPass#2026');
                const byokExcluded = !rightPassRes?.payload?.settings?.groq_api_key && !rightPassRes?.payload?.settings?.jarvis_byok_gemini_sealed;

                // 18D: Settings -> Workspace Backup & Storage Health Sub-View UI
                if (!document.getElementById('help-modal')) showHelpModal();
                const rowBtn = document.getElementById('settings-row-workspace-durability');
                rowBtn?.click();
                await new Promise(r => setTimeout(r, 80));
                const subView = document.getElementById('settings-view-workspace-durability');
                const subViewActive = Boolean(subView?.classList?.contains('active'));
                const encryptDefaultOn = Boolean(document.getElementById('backup-encrypt-toggle')?.checked);
                const tabsBadgeText = document.getElementById('durability-active-tabs-badge')?.textContent?.trim() || '';
                const healthStatsText = document.getElementById('durability-health-stats')?.textContent?.trim() || '';
                closeHelpModal();
                await dur.workspaceDb.clearAllSessions();

                return {
                    restoredLen,
                    lwwNewerWon: s1Merged?.title === 'Newer Title' && s1Merged?.messages?.length === 2,
                    ghostResurrected,
                    streamProtected,
                    isEncrypted: envelope.encrypted === true && envelope.cipher === 'AES-256-GCM' && envelope.kdf === 'PBKDF2-SHA256',
                    plaintextLeaked,
                    wrongPassRejected: wrongPassRes?.ok === false && wrongPassRes?.code === 'decrypt_failed',
                    rightPassOk: rightPassRes?.ok === true && rightPassRes?.summary?.sessionCount === 1 && rightPassRes?.summary?.memoryCount === 1,
                    byokExcluded,
                    subViewActive,
                    encryptDefaultOn,
                    tabsBadgeText,
                    hasHealthStats: healthStatsText.includes('IndexedDB Durable Chats')
                };
            })()`,
            awaitPromise: true,
            returnByValue: true
        });
        const durRes = evalDurability?.result?.result?.value || evalDurability?.result?.value;
        console.log('Workspace durability, multi-tab sync & encrypted backup verification:', durRes);
        assert.ok(durRes?.restoredLen > 12000, 'IndexedDB must persist full untruncated messages (>12,000 chars)');
        assert.equal(durRes?.lwwNewerWon, true, 'LWW merge must pick newer session timestamp');
        assert.equal(durRes?.ghostResurrected, false, 'Delete tombstones must prevent stale sessions from resurrecting');
        assert.equal(durRes?.streamProtected, true, 'Multi-tab merge must protect an active streaming session');
        assert.equal(durRes?.isEncrypted, true, 'Workspace backup must encrypt with PBKDF2-SHA256 + AES-256-GCM');
        assert.equal(durRes?.plaintextLeaked, false, 'Encrypted backup must leak zero plaintext chats or secrets');
        assert.equal(durRes?.wrongPassRejected, true, 'Incorrect passphrase must be rejected by AES-GCM auth tag');
        assert.equal(durRes?.rightPassOk, true, 'Correct passphrase must decrypt full workspace snapshot');
        assert.equal(durRes?.byokExcluded, true, 'BYOK API keys must strictly be excluded from workspace backups');
        assert.equal(durRes?.subViewActive, true, 'Settings Workspace Backup & Storage Health sub-view must open cleanly');
        assert.equal(durRes?.encryptDefaultOn, true, 'Backup encryption must default to ON');
        assert.ok(durRes?.tabsBadgeText?.includes('Active Tab'), 'Active tabs badge must display live BroadcastChannel presence');
        assert.equal(durRes?.hasHealthStats, true, 'Storage Health view must display live IndexedDB metrics');
        console.log('[PASS] Dual-Tier IndexedDB durability, LWW multi-tab sync, AES-256-GCM backup/restore & Settings sub-view verified');

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
