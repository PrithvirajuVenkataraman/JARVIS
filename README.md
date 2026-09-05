# JARVIS
JARVIS is a browser-based assistant for chat, writing, planning, translation, weather, attachments, and everyday help.

## File Map

- `README.md` - Documents features, setup notes, environment variables, and this file map.
- `models.md` - Technical specification of all AI models, provider hierarchies, Vision/Voice/RAG cascades, and token speeds.
- `system_design.md` - System architecture specification, concurrency models, circuit breakers, and RAG pipelines.
- `index.html` - Main browser UI and inline app logic for chat, Live Vision, voice, routing, history, and tools.
- `package.json` - Project metadata, dependencies, Vercel settings, and npm scripts.
- `science-format.js` - Deterministic formatting helpers for scientific notation, formulas, and units.
- `styles.css` - Shared styling for the assistant UI, composer, modals, chat, vision preview, and responsive layout.
- `vercel.json` - Vercel routing, function duration, and permissions headers.
- `api/index.js` - API router that dispatches serverless requests to supported route handlers.
- `api/chat-groq.js` - Main chat/model endpoint with routing, streaming, safety, memory/context use, and quality review.
- `api/current-facts.js` - Current-fact endpoint for live/public-source fact resolution.
- `api/diagnostics.js` - Deployment diagnostics endpoint for configured providers and feature availability.
- `api/extract-url.js` - URL extraction endpoint backed by the Crawl4AI client.
- `api/ingest-attachment.js` - Server-side attachment ingestion endpoint for files and OCR fallback.
- `api/markets.js` - Market-style lookup endpoint for financial or asset queries.
- `api/rank-texts.js` - Text ranking endpoint used to select relevant attachment chunks.
- `api/search.js` - Search and retrieval endpoint with live-source routing and answer synthesis helpers.
- `api/vision.js` - Vision endpoint for scene understanding, OCR, translation, math solving, and paper overlays.
- `api/_lib/attachment-ingest.js` - Shared server attachment parsing and image/PDF OCR fallback helpers.
- `api/_lib/cost-controls.js` - Shared request budgeting and token/cost guard helpers.
- `api/_lib/crawl4ai-client.js` - Crawl4AI integration and readable webpage extraction helpers.
- `api/_lib/embeddings.js` - Embedding and reranking helpers for semantic retrieval.
- `api/_lib/query-target-cleanup.js` - Query subject cleanup and metadata extraction helpers.
- `api/_lib/security.js` - Shared API security headers, CORS, body limits, and rate limiting.
- `api/_lib/vision-extract.js` - Lightweight image OCR helper used by attachment ingestion.
- `api/_lib/free-live/classifier.js` - Free live-search intent classifier.
- `api/_lib/free-live/providers.js` - Free/public live-source provider integrations.
- `api/_lib/free-live/source-registry.js` - Registry of public live-source categories and metadata.
- `api/_lib/latest/latest-cache.js` - Cache helpers for latest/current-source items.
- `api/_lib/latest/latest-ingest.js` - Latest-source ingestion helpers.
- `api/_lib/latest/latest-sources.js` - Latest-source definitions and source metadata.
- `api/_lib/latest/router.js` - Latest/current-intent routing helpers.
- `app/agent-workflows.js` - Client workflow detection and multimodal follow-up prompt builders.
- `app/api-client.js` - Browser API client wrapper for JSON requests and timeouts.
- `app/attachments.js` - Client attachment selection, local extraction, server fallback, and tray rendering.
- `app/bootstrap.js` - Browser module bootstrap that wires app modules onto `window`.
- `app/context-copilot-ui.js` - Ambiguous-context clarification UI builders.
- `app/context-engine.js` - Local conversation context engine for follow-ups, topic switches, and pending clarifications.
- `app/converse-state.js` - Converse/voice state tracker.
- `app/emergency-sos.js` - Satellite-style Emergency SOS and distress dispatch system with precision GPS and battery telemetry.
- `app/failure-policy.js` - Failure classification and recovery-card policy helpers.
- `app/frontend-routing.js` - Client-side route decisions for fast answers, live search, and sensitive requests.
- `app/instant-replies.js` - Local instant replies for simple app/about/greeting prompts.
- `app/memory-quality.js` - Memory cleanup, forgetting, and used-memory display helpers.
- `app/observability.js` - Lightweight client event and diagnostic logging helpers.
- `app/place-grounding.js` - Place-result scoring and relevance helpers.
- `app/session-recovery.js` - Draft and active-session recovery helpers.
- `app/source-transparency.js` - Source footer rendering and answer/source splitting helpers.
- `app/speech-input.js` - Browser speech recognition and voice input orchestration.
- `app/state.js` - Shared client state container and reset helpers.
- `app/storage.js` - Browser storage helpers for persisted app data.
- `tests/api-contracts.test.mjs` - API contract and behavior tests for server routes.
- `tests/check-inline-script.mjs` - Syntax check for the inline script embedded in `index.html`.
- `tests/context-engine.test.mjs` - Unit tests for local context resolution behavior.
- `tests/deterministic-checks.mjs` - Deterministic source-contract checks for key app behavior and regressions.
- `tests/emergency-sos.test.mjs` - Unit tests for emergency contacts CRUD, distress telemetry, and dispatch URL formatting.
- `tests/hygiene-scanner.test.mjs` - Tests for hardcoded-content hygiene scanning.
- `tests/speech-input.test.mjs` - Unit tests for speech input behavior.
- `tools/hardcoded-content-allowlist.mjs` - Allowlist for intentional hardcoded content scanner matches.
- `tools/hardcoded-content-scanner.mjs` - Scanner for unwanted hardcoded user-facing content.
- `tools/local-dev-server.mjs` - Local static/API development server.

## Exact Features

- Text chat, explanations, summaries, writing help & planning
- Streaming answers, with JSON fallback for reviewed or structured routes
- Enterprise Voice-to-Text (VTT / Dictation) with spoken punctuation parsing and tech acronym auto-capitalization
- Modern circular send button (32px disc with vertical upward arrow `↑` and dynamic active/disabled/stop states)
- Emergency SOS with emergency contacts management, precision GPS & battery telemetry, and multi-channel distress dispatch (SMS, WhatsApp, Phone, Web Share)
- Live Vision, and file attachments (PDF, DOCX, PPTX, images, text)
- Saved chats with search, restore, rename, pin, share, and delete
- Local Memory Manager for explicit saved memory
- Prompt-based translation and slash command picker
- Weather, location, itinerary, and everyday planning help
- Answer verification against retrieved sources
- Local preferences, chat history, regeneration, interruption, and feedback
- **Parallel Deep Webpage Article Scraper**: Concurrent 2.5s HTML body reader extracting full article text for live news and leadership facts.
- **Strict Zero-Parametric Anti-Hallucination Grounding**: Overrides model pre-training knowledge cutoffs for live political leaders, direct incumbent name resolution, and dynamic past-tense predecessor filtering.
- Crawl4AI fallback for readable extraction when configured

## Standout Feature: Context Copilot & Deep Web RAG

Context Copilot resolves follow-ups like "latest on it", "compare it", "tell me more", and "source?" locally.

For live world queries (e.g. "Who is the CM of Tamil Nadu?"), the retrieval pipeline automatically routes around static encyclopedia overviews, deep-crawls top news/government body paragraphs in parallel, and applies zero-parametric prompt pinning so the current leader is named immediately in sentence 1.

It is local, deterministic, private, and free-for-life. Models still generate answers; the follow-up decision stays in the app. Specialized transformer APIs (NVIDIA embeddings/rerank) improve search ranking and semantic memory/attachment recall, but they do not replace Context Copilot routing.

## Memory

- **Short-term:** active chat context and follow-ups
- **Saved chats:** each chat keeps its own messages and context
- **Long-term:** only what the user explicitly asks JARVIS to remember, via Memory Manager

## Prompt-Based Translation

Examples: `translate "How much does this cost?" to Tamil`, `say this in Hindi: I need help`, `what does "vanakkam" mean in English`, `translate to Kannada`

## Sidebar And Options

Left sidebar: New chat, Search chats, Vision Analysis, Memory, System Instructions, Emergency SOS, and saved chats. Long-press or right-click a saved chat to rename, pin, share, or delete it.

Help & Options holds custom system instructions only.

## Fast Answers And Verification

Normal answers stream. Press `/` for Translate, Verify, Vision, Summarize, Professional, and Study templates.

Prompts like `in n words` and `under n words` are treated as explicit word-count requirements.

**Verification** checks the previous answer against retrieved evidence and returns a short report. Users do not need to provide links.

## Feedback, Quality Review, and RLAIF

RLAIF-style signals stay inside this app. They do not train Groq, Gemini, Exa, NVIDIA, or any underlying model.

- **Thumbs up/down:** stored in browser `localStorage` as topic/query preference signals for later soft hints
- **Local style learning:** shorter / simpler / structured preferences from how you ask
- **AI quality critic:** optional second-pass review/rewrite for risky answers before you see them

Local keys: `jarvis_learned_preferences`, `jarvis_local_answer_style_learning`

## Environment

Live search is disabled by default. Use `LIVE_RETRIEVAL_ENABLED=true` with search/model keys for source-backed current-fact flows.

Set vars in Vercel (or local `.env`). Keep API keys server-side.

**Chat**
- `GROQ_API_KEY` / `GROQ_KEY`
- `GEMINI_API_KEY` / `GOOGLE_API_KEY`
- `GROQ_MODEL`, `GEMINI_MODEL`, `GROQ_VISION_MODEL`, `GEMINI_VISION_MODEL`
- `GROQ_QUALITY_MODEL`, `GEMINI_QUALITY_MODEL`, `GROQ_SAFETY_MODEL`, `GEMINI_SEARCH_MODEL`
- `CHAT_ROUTER_MODE`

**Live search / retrieval**
- `LIVE_RETRIEVAL_ENABLED`, `JARVIS_PUBLIC_FACT_SEARCH`
- `EXA_API_KEY` / `EXA_KEY`, `SERPER_API_KEY` / `SERPER_KEY`
- `NVIDIA_API_KEY` / `NVIDIA_NIM_API_KEY`, `NVIDIA_EMBEDDING_MODEL`, `NVIDIA_RERANK_MODEL`, `NVIDIA_RERANK_ENABLED`
- `CRAWL4AI_URL` / `CRAWL4AI_ENDPOINT`, `CRAWL4AI_TOKEN`
- `SEARXNG_URL`, `WEB_SEARCH_ENABLED`, `REDIS_URL`

**Cost / quality / guards**
- `JARVIS_QUALITY_CRITIC_ENABLED`, `JARVIS_STREAM_QUALITY_REVIEW`
- `JARVIS_DEFAULT_MAX_TOKENS`, `JARVIS_FAST_MAX_TOKENS`, `JARVIS_STREAM_MAX_TOKENS`
- `CORS_ALLOWED_ORIGINS`, `JARVIS_CSP`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`, `NODE_ENV`

## Privacy Notes

- Chat history, memory, preferences, and feedback use browser localStorage when persistence is enabled
- Camera, microphone, and location need browser permission
- Provider API keys must stay server-side
