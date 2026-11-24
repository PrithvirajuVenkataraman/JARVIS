# JARVIS

A browser assistant for chat, writing, source-backed research, documents, image understanding, and saved conversations. The interface uses vanilla JavaScript, a Vite production build, and Node/Vercel API routes.

## Development

Requires Node 22.23.4 (the same version used in CI).

```sh
npm ci
npm run dev
```

Copy `.env.example` to `.env.local` and configure the providers you use. API keys stay on the server. Local development serves the UI and API on port 3000.

```sh
npm run build
npm run preview
```

The production frontend is emitted to `dist/`. Vercel builds this directory while retaining the existing `/api/*` functions and rewrites.

See [GitHub upload and Vercel Hobby deployment](docs/github-and-vercel.md) for the exact files to commit, exclusions, and project settings. Commit `package-lock.json`; keep credentials and generated artifacts out of the repository.

## Quality checks

```sh
npm run check
npm run build
npm run test:browser
```

`check` runs syntax checks, ESLint for the extracted modules, incremental JavaScript type checks, and the deterministic behavior suites. Browser tests use a local fixture backend without real provider credentials or paid API calls. Install the browser engines once with `PLAYWRIGHT_BROWSERS_PATH=0 npx playwright install chromium firefox webkit` (PowerShell: set `$env:PLAYWRIGHT_BROWSERS_PATH='0'` first).

The browser suite covers Chromium, Firefox, and WebKit at 320, 390, 768, 1024, and 1440px; IME input; Stop behavior; sanitization; dialog focus; accessibility; lossless clipboard attachments; saved instructions; first-visit and partial permissions; minimal device location; conversation-scoped document recovery; offline reloads; failed worker upgrades; and math rendering. Screenshots, traces, reports, and the throttled loading baseline are saved under `scratch/`. Browser emulation does not replace testing an actual iPhone/Android software keyboard. Playwright service-worker offline network control is Chromium-only; offline emulation is explicitly skipped for Firefox/WebKit, while failed-upgrade behavior is still tested in all three engines. See https://playwright.dev/docs/service-workers.

`npm run test:core` runs the clipboard, permissions, location, retrieval, credential scanning, cancellation, preference, and arithmetic regressions independently. The default browser suite does not download a model. To exercise real local inference and verified cache reuse in all three engines, set `JARVIS_REAL_MODEL_TEST=true` and run `npm run test:browser -- --grep "optional local model"` (PowerShell: `$env:JARVIS_REAL_MODEL_TEST='true'`). This opt-in test downloads public model assets without calling an inference provider.

`npm run test:math` runs the bundled KaTeX regressions. `npm run test:math:browser -- --screenshots` also runs the focused Chrome layout check. Set `CHROME_PATH` when Chrome is not installed in a detected default location.

Release checks require a passing `check`, production build, browser suite, and reviewed screenshots. Core Web Vitals targets are LCP <=2.5s, INP <=200ms, and CLS <=0.1; production performance has not been certified against those targets.

## Architecture

- `index.html`: application markup. `app/main.js`: frontend entrypoint and module lifecycle.
- `app/legacy-runtime.js`: remaining classic application compatibility code. New work belongs in the extracted modules; this file is not a claim that the entire application has been rewritten.
- `app/api-client.js`: JSON requests, merged headers, cancellation, timeout, and response validation.
- `app/request-payload.js`: UTF-8 request-size budgeting and bounded image resizing before upload; oversized messages stop without fallback retries.
- `app/markup-security.js`: locally bundled DOMPurify, math-compatible sanitization, and delegated content actions.
- `app/markdown-renderer.js`, `app/math-renderer.js`, `app/stream-renderer.js`: Markdown, KaTeX, bounded expression caching, and stable DOM updates during streaming.
- `app/composer-controller.js`, `app/dialog-controller.js`: accessible request announcements, composition handling, focus containment, and restoration.
- `app/workspace-durability.js`, `app/persistence-controller.js`: IndexedDB sessions, durable deletion tombstones, coalesced writes, and a 15-session localStorage hot cache.
- `app/capabilities.js`: diagnostics-driven feature visibility. Unavailable features are hidden from normal flows.
- `app/features/`: settings and camera code loaded on demand. Attachments, document parsers, and image generation are also loaded on demand.
- `app/code-runner.js`: isolated, explicitly requested JavaScript execution; code cannot access application storage.
- `app/performance-metrics.js`: bounded local performance measurements without prompt, response, or credential collection.
- `api/chat-groq.js`, `api/vision.js`, `api/search.js`: chat, image understanding, and research endpoints.
- `api/_lib/request-lifecycle.js`: request-wide 52-second deadline, upstream cancellation, and two-model-attempt budget.
- `api/diagnostics.js`: provider configuration and capability availability. It exposes no private keys or provider credentials.
- `vite.config.js`, `sw.js`: hashed production assets and an offline manifest generated from the build. Optional feature chunks are cached after use.
- `tools/local-dev-server.mjs`: Vite development middleware and local API adapter; `--preview` serves `dist/`.

Generated answer replay is disabled. Public retrieval caches and deterministic local replies remain available. No shared answer cache may replay content across preferences, contexts, or images.

## Features and availability

Chat, writing, translation, document/image questions, and research depend on configured providers and their quotas. There is no promise of unlimited inference. Deterministic context routing and local persistence do not require paid infrastructure.

Automatic text chat and research prefer `gemini-4-hydrogen`, with Groq retained as a bounded fallback. Explicit supported model selections are respected. Older `GEMINI_MODEL` settings do not displace Hydrogen in Automatic text chat. Provider labels report the model that actually answered, including fallback responses. Google Search grounding requires the explicit `SEARCH_GEMINI_GROUNDING_FREE_ALLOWANCE=true` opt-in; public retrieval remains separate. A model upgrade does not by itself verify every factual claim.

Image creation uses the anonymous AI Horde community queue directly from the browser. No account, payment, Puter sign-in, Gemini image billing, or Vercel polling function is used. Volunteer capacity and anonymous limits can cause delays or failures. Stop cancels the job; the app never switches to a paid provider. Prompts are sent to community workers, so avoid sensitive information. Set `JARVIS_IMAGE_GENERATION_ENABLED=false` to hide image creation (the legacy disable flag is also respected).

The idle workspace has a centered JARVIS title, a visible sidebar button at the top left, and a composer. The sidebar provides New chat, Search, Memory, Custom instructions, Image library, Settings, and saved conversations. Select `+` for composer tools, including image attachments and supported camera/OCR actions. Generated images have no permanent action buttons: hold or right-click an image for Copy and Download. Keyboard users can focus the image and press Shift+F10 or the context-menu key; Enter opens its preview. Copy exports actual PNG image data to supported clipboards.

Interface text uses locally bundled Inter Variable with system fallbacks. Equations and code retain their own fonts. Font assets and their license are included in the production build; no external font service is required.

Generated conversational replies can use brief, context-aware humour and reasoned opinions. The same voice policy applies to fast and normal replies; it uses recent dialogue for references, respects formal/no-jokes custom instructions, and stays serious for sensitive or high-stakes topics. It adds no separate personality-classification request or fixed joke bank. Source excerpts and OCR retain their factual wording.

Busy image requests keep the prompt and temporarily disable Retry. Server-exposed retry delays are honored, with a one-minute fallback for rate limits. Retrying is always explicit; the app does not resubmit automatically or switch to paid image generation.

Document parsing is bundled locally and loaded when needed. Image OCR/understanding still requires a configured vision provider. A dismissible first-visit permission introduction has one Enable permissions action; the browser controls the individual microphone, camera, and location approval prompts. Features remain usable independently when only some permissions are granted.

Voice typing currently requests English (`en-US`). Browser recognition can use the browser's remote speech service; the recording fallback sends audio through `/api/stt` to Groq Whisper. Dictation stays in the composer for review and manual sending. Stop releases the microphone; cancel, a new capture, or an edit ignores obsolete transcription results. Audio requests use the same 4 MB JSON budget as other uploads. Browser simulations test control flow, not accent accuracy or real iPhone/Android microphone behaviour.

Short, named-person lookups can add a sourced photograph after the answer finishes. Wikipedia resolves the subject, Wikidata verifies that it is a person, and Wikimedia Commons supplies photographs, capture dates, and attribution. The newest dated photograph among the retrieved candidates is preferred; this does not guarantee the newest photograph on the web. Undated fallbacks say “Reference portrait.” Photo loading never holds the answer open, and Stop, New chat, or a subsequent turn cancels unfinished photo work. Explicit requests for a latest or real photograph use retrieval rather than image generation. No paid image-search API is added.

Short role-qualified profiles, such as `Actor <name>`, return a linked Wikipedia introduction after identity resolution. The app does not append model-generated business, award, or charity claims to these excerpts. Unavailable sources produce a clear verification failure. This does not independently verify every source statement or change longer, attachment-based, or creative questions.

Vision honors `GEMINI_VISION_MODEL` and `GROQ_VISION_MODEL`. With both providers configured, a Gemini compatibility failure leaves the second attempt available for Groq. Quota failures are reported as quota failures, and OCR reports the provider that actually succeeded. Unsupported camera bytes must be converted by the browser before reaching the vision API; changing a MIME label alone does not convert an image.

Long clipboard text (8,000 characters or 80 lines) becomes a UTF-8 attachment. Short formulas stay inline, and indentation/LaTeX are preserved. Attachments can be previewed or moved back into the composer. Text retrieval runs in a worker; selected passages explicitly disclose partial coverage instead of claiming an entire large document was read.

Image attachments are checked by their file signatures and prepared locally before upload. A converted preview uses its actual format, filename extension, and encoded size; the original source file is retained. Camera RAW (including NEF, DNG, CR2/CR3, ARW), HEIC/AVIF, TIFF, PSD/PSB, JPEG XL, JPEG 2000, and other supported raster formats use a locally bundled ImageMagick/LibRaw WASM decoder when native decoding is insufficient. The decoder loads lazily in a worker and converts the first frame to an oriented, metadata-stripped JPEG for the vision model. Input limits: 50 MB, 64 megapixels, one decoder at a time, and 45 seconds. Newer camera variants, damaged, encrypted, or unknown formats can still fail; this is broad format support, not a guarantee for every file. No RAW source is uploaded to Vercel. An expired preview falls back to a file badge rather than a broken image.

Enhanced local recall is optional per device. It uses the pinned quantized `Xenova/all-MiniLM-L6-v2` model: roughly 23 MB of English model weights plus additional locally bundled WASM runtime assets. Downloads are verified against fixed hashes and cached when browser storage permits. Chat never waits for model downloading. Unsupported devices, offline downloads, or unavailable caches use lightweight retrieval. This feature does not add a server inference service or an ANN database. Browser caches can be evicted; cached availability is not guaranteed.

Custom Instructions apply when Done is selected. Other dismissal paths warn about unsaved edits. Saved instructions are reply preferences, while current explicit requests, security controls, and evidence requirements retain precedence.

Follow-ups retain the original question and carry reference IDs alongside the relevant dialogue. Clear references continue automatically; unresolved ties ask one short clarification before research. Context retrieval honors the caller's window and budget, and repeated finalization updates an existing turn instead of duplicating it. Optional embeddings assist retrieval; they do not establish that a reference is unambiguous.

Image output is decoded before saving. If browser storage fails, the image remains usable in the current session and JARVIS asks you to download it to keep it. A queue being enabled does not prove a worker is available. Image editing that preserves the original pixels is not currently supported.

Type `/` to filter available commands. Arrow keys choose a result; Enter inserts its editable prompt starter without sending. Web search has one per-chat on/off setting, an inline composer control, and a blue animated outline while enabled. Reduced-motion preferences use a static outline. Other core menus and settings use neutral colors. Browser zoom gestures remain available.

Vision distinguishes missing deployment credentials from provider authentication, quota, timeout, and temporary failures. When both providers are configured, generation reserves an attempt for each provider within the two-attempt request budget. Explicit vision model environment settings are honored; model names are not silently mapped to older models. Hosted provider credentials and model access still need to be valid.

“Where am I?” uses the device position and one reverse-geocoding lookup, returning a place name and coordinates. It does not fetch weather, air quality, or an IP-based estimate. Precise positioning can be unavailable even after browser permission is granted.

The answer UI does not display private model reasoning or fabricated thinking narratives. Optional verification metadata covers supported arithmetic equalities only; it does not certify an entire proof. Failed checks preserve the original claim rather than silently changing its numbers.

Saved chats support search, rename, pin, deletion, and backup/restore. Deletions are retained as durable tombstones. Storage failures produce a visible notification; a browser refusing persistence cannot be treated as a successful save.

Refreshing or reopening starts on a fresh chat rather than automatically displaying the previous answer. Previous conversations remain in the sidebar and can be opened explicitly. Unsent composer drafts and their empty-session mode are preserved.

## Configuration

Set server variables in Vercel or `.env.local`:

- Chat: `GROQ_API_KEY` / `GROQ_KEY`, `GROQ_API_KEYS`, `GEMINI_API_KEY` / `GOOGLE_API_KEY`.
- Models: `GROQ_MODEL`, `GEMINI_MODEL`, `GROQ_VISION_MODEL`, `GEMINI_VISION_MODEL`.
- Retrieval: `LIVE_RETRIEVAL_ENABLED`, `JARVIS_PUBLIC_FACT_SEARCH`, `SEARXNG_URL`, `CRAWL4AI_URL` / `CRAWL4AI_ENDPOINT`, `CRAWL4AI_TOKEN`; optional provider keys as documented in `.env.example`.
- Limits: `JARVIS_QUALITY_CRITIC_ENABLED`, `JARVIS_STREAM_QUALITY_REVIEW`, token limits, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`, `CORS_ALLOWED_ORIGINS`.
- Saved BYOK: `JARVIS_BYOK_PRIVATE_KEY` and `JARVIS_BYOK_PUBLIC_KEY`, a matching RSA keypair of at least 2048 bits. Both are required before the saved-key UI is offered.

Diagnostics adds `capabilities.chat`, `.search`, `.vision`, `.images`, and `.byok`, each containing `available` and `reasonCode`. Existing API routes and diagnostics fields remain compatible. Unreadable sealed credentials return `byok_reconfiguration_required` rather than silently using platform credentials.

## Privacy and credentials

Saved BYOK credentials use client-side RSA-OAEP/AES-GCM sealing. Plaintext fallback storage is prohibited. Keep the server keypair stable across instances and deployments; a lost keypair requires users to save their provider key again. Existing encrypted values are retained when reconfiguration is necessary.

Encrypted values can still be read and replayed by scripts with access to the origin. A masked, write-only settings field is a UX property, not protection against a compromised origin or browser extension.

Chat history, drafts, memory, and preferences remain on the device when persistence is enabled. Local performance diagnostics contain only timings and stage names. Optional external telemetry integrations require separate configuration.

The supported baseline is the current and previous major Chrome, Edge, Firefox, and Safari versions, including low-end hardware. Optional local inference is a progressive enhancement, not a guarantee for every device. No paid hosting, telemetry, browser grid, or model service was introduced by this modernization.
