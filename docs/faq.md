# FAQ Section in Settings

This document mirrors and documents the **FAQ** section inside **Settings → About → FAQ** (`#settings-row-faq` and `#settings-view-faq` in `app/features/settings-runtime.js`), plus technical implementation notes for each answer.

---

## Questions & Answers

### 1. How does Live Web Search prioritize recent updates and avoid stale results?
- Public retrieval races zero-cost providers (DuckDuckGo HTML/Lite, SearXNG, Google News RSS, Wikipedia/Wikidata, Yahoo Finance, and GDELT) via `api/search.js` and `api/_lib/free-live/providers.js`.
- Chronological reranking (`api/_lib/hybrid-reranker.js`, `api/_lib/research-evidence.js`, and `rankSources` in `api/search.js`) infers explicit context years from URLs/titles/snippets when partial `"Month DD"` strings omit a year, lowers undated temporal scores on `"latest"` queries, decays article recency (`exp(-ageDays / 45)`), and penalizes stale `>365d` / `>540d` archives when current evidence exists.
- Research answer synthesis (`api/_lib/research-model.js`) runs Groq **`openai/gpt-oss-120b`** and **`qwen/qwen3.8-27b`** (`openai/gpt-oss-20b` fallback) first with automatic Google Gemini (`gemini-2.5-flash` / `gemini-2.5-flash-lite`) failover unless a specific Gemini model is selected.

### 2. What happens when cloud API or vision quotas run out?
- **Text & Chat**: You can add personal keys anytime under **Settings → API Keys (BYOK)** using client-side RSA-OAEP/AES-GCM sealing.
- **Readable Text (OCR)**: When `/api/vision` returns a quota error, timeout, or non-text metadata fallback, `app/attachments.js` automatically runs client-side **Tesseract.js WASM OCR** (`extractTextViaTesseract`) in the browser.
- **Visual Understanding (No PyTorch/OpenCV Required)**: If cloud vision quotas exhaust on non-text photos or diagrams, **`On-Device Vision Fallback (ONNX)`** (`app/local-vision-engine.js` + `app/vision-worker.js`) runs quantized `@huggingface/transformers` ONNX models (`Xenova/vit-gpt2-image-captioning` and `Xenova/vit-base-patch16-224`) in a browser Web Worker alongside optional Tesseract OCR, cached in `jarvis-local-vision-model-v1`. You can toggle or clear its cache in **Settings**.

### 3. Why doesn't JARVIS run server-side PyTorch or OpenCV?
- The backend deploys on Node.js 22 Vercel Hobby serverless functions (`maxDuration: 60`), which have no GPUs and strict ~250 MB bundle limits. Heavy Python vision stacks (`torch`, `opencv-python`) exceed those limits, whereas WASM (`tesseract.js`, `@imagemagick/magick-wasm`, and `onnxruntime-web` via `@huggingface/transformers`) executes client-side in the browser at zero server cost.

### 4. How does the Think button work on mobile and desktop?
- Tapping the brain icon (`#composer-think-btn`) toggles **Deep Reasoning Mode** (`window.toggleDeepReasoningMode`) and renders a dismissible **`Think ×`** pill above the composer (`#composer-mode-chips`).
- Requests send `forceReasoning: true` / `tier: 'deep'` to `api/chat-groq.js`, preserving deeper reasoning budget (`thinkingBudget: 8192`) across centralized LLM routing (`api/_lib/llm-router.js`).

### 5. Where are my chats, attachments, and saved memories stored?
- JARVIS is local-first: chats, custom instructions, unified memories (`jarvis_unified_memories_v1`), and optional ONNX model caches stay in your browser (`IndexedDB`, `CacheStorage`, `localStorage`).
- Use **Export Conversation** or **Settings → Backup & storage** to download AES-256-GCM encrypted `.jarvis.json` archives. BYOK secrets are excluded from backups.

### 6. How does Saved Memory handle follow-ups, and does JARVIS enforce DLP?
- Saved memories run MEMO-inspired reflection normalization (`normalizeReflectionMemory` in `app/memory/memory-extractor.mjs`), resolving ambiguous leading pronouns against recent dialogue turns and surfacing named entities before saving.
- Credentials (API keys, JWTs, DB URIs) and PII are scanned by client and server Data Loss Prevention (`app/dlp-engine.js`, `api/_lib/pii-redactor.js`, configurable under **Settings → Compliance & Observability**).

### 7. Which image formats, file sizes, and tools are supported?
- Images (JPEG, PNG, WebP, GIF, plus HEIC/AVIF, TIFF, PSD, JPEG XL/2000, and RAW files like NEF/DNG/CR2/ARW up to 50 MB / 64 MP) are checked and decoded locally via ImageMagick/LibRaw WASM before upload.
- Tool execution connects over standard **MCP JSON-RPC 2.0** on `/api/search` (`tools/list`, `tools/call` for `web_search`, `web_fetch`, and `datetime_context`) via `app/tool-dispatcher.js` (`runAgenticToolLoop`) and `app/agent-orchestrator.js`.
