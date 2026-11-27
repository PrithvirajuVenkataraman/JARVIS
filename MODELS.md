# JARVIS — Model Hierarchy, Routing & Inference Engine Specification

This document details all AI models, inference providers, routing hierarchies, fallback cascades, and specialized task engines integrated into JARVIS.

---

## 1. Primary Model Routing & Provider Hierarchy

JARVIS uses an **autonomous, single-pass routing cascade** with multi-key load balancing and millisecond failover:

```mermaid
graph TD
    Query["User Prompt / Upload"] --> Classifier{"Single-Pass Intent Router"}
    
    Classifier -->|Text / Reasoning / Coding| GroqLPU["Groq LPU Engine"]
    Classifier -->|Vision / Image / PDF OCR| GeminiPool["Google Gemini / Groq Vision Pool"]
    Classifier -->|Voice Speech Input| WhisperSTT["Groq Whisper STT"]
    Classifier -->|Live Fact / Web Search| WebRAG["Deep Web RAG Engine"]

    subgraph GroqLPU["Groq LPU Cascade"]
        G1["openai/gpt-oss-120b (Flagship Reasoning & Text)"] --> G2["openai/gpt-oss-20b (Fast Speed Tier)"]
        G2 --> G3["qwen/qwen3.8-27b (Vision & Tool Use)"]
        G3 --> G4["openai/safety-gpt-oss-20b (Safety Moderation)"]
        G4 --> GemFallback["Gemini 2.5 Flash (Cloud Fallback)"]
    end

    subgraph GeminiPool["Multimodal Vision Cascade + Local Fallback"]
        M1["gemini-4-hydrogen / gemini-2.5-flash"] --> M2["qwen/qwen3.8-27b (Groq Vision)"]
        M2 --> M3["Tesseract.js WASM (Local OCR)"]
        M3 --> M4["Browser ONNX Vision Worker (Transformers.js)"]
    end

    subgraph WebRAG["Deep Web Grounding Engine"]
        W1["DuckDuckGo / SearXNG / Google News / Wiki"] --> W2["Chronological & Hybrid Reranker"]
        W2 --> W3["openai/gpt-oss-120b -> qwen/qwen3.8-27b"]
        W3 --> W4["Gemini 2.5 Flash Failover"]
    end
```

---

## 2. Model Inventory & Capabilities

### ⚡ Text, Reasoning & Tool Use Models (Groq LPU)

| Model Name | Parameter Size | Provider | Primary Use Case | Output Speed |
| :--- | :--- | :--- | :--- | :--- |
| **`openai/gpt-oss-120b`** | 120 Billion | Groq | **Primary Flagship**: Complex reasoning, function calling / tool use, multilingual synthesis. | ~130–180 tok/s |
| **`openai/gpt-oss-20b`** | 20 Billion | Groq | **Fast Direct**: Low-latency turns, fast instant tier, function calling, multilingual. | ~250–350 tok/s |
| **`qwen/qwen3.8-27b`** | 27 Billion | Groq | **Vision & Reasoning**: Visual analysis, function calling, deep reasoning. | ~200–260 tok/s |
| **`openai/safety-gpt-oss-20b`** | 20 Billion | Groq | **Safety & Content Moderation**: Enterprise safety classification and policy guardrails. | ~300+ tok/s |

---

### 👁️ Multimodal & Vision Models (Google Gemini & Groq Vision)

| Model Name | Provider | Primary Use Case | Features |
| :--- | :--- | :--- | :--- |
| **`qwen/qwen3.8-27b`** | Groq | **Primary LPU Vision**: Rapid image analysis, visual document extraction, OCR. | Native vision on Groq LPUs. |
| **`gemini-2.5-flash`** | Google Gemini | **Multimodal Vision & Document OCR**: Image description, chart analysis, diagram understanding. | Native multimodal, 1M+ token context window. |
| **`gemini-2.0-flash`** | Google Gemini | **Vision Fallback**: Secondary high-speed visual processing. | Low latency, robust scene reasoning. |
| **`gemini-3.7-flash`** | Google Gemini | **Coding & Deep Multimodal**: Advanced spatial visual reasoning. | High multimodal precision. |

---

### 🎙️ Speech & Audio Models

| Model Name | Provider | Primary Use Case | Supported Languages |
| :--- | :--- | :--- | :--- |
| **`whisper-large-v3-turbo`** | Groq | **Enterprise Voice-to-Text (VTT / Dictation)**: Real-time spoken dictation, professional punctuation parsing, and technical acronym auto-capitalization. | English, Kannada, Tamil, Telugu, Hindi, Malayalam, Spanish, French, German, Japanese, etc. |
| **`whisper-large-v3`** | Groq | **High-Accuracy Audio Transcription**: Long audio file processing and noisy background audio. | 99+ spoken languages with automatic punctuation and language detection. |

---

### 🔍 Semantic Retrieval & Reranking Models (NVIDIA NIM)

| Model Name | Provider | Primary Use Case | Dimensionality / Metrics |
| :--- | :--- | :--- | :--- |
| **`nvidia/nv-embedqa-e5-v5`** | NVIDIA NIM | **Semantic Search & Memory Embeddings**: Contextual memory recall and attachment chunk ranking. | 1024-dim dense embeddings with cosine similarity. |
| **`nvidia/reranking-mistral-4b`** | NVIDIA NIM | **Neural Document Reranker**: Cross-encoder reranking for attachment chunks and retrieved documents. | High-precision passage relevance scoring. |

---

### In-Browser Offline & Quota Fallback Models (`@huggingface/transformers` + WASM)

| Model / Engine | Runtime | Purpose | Storage / Behavior |
| :--- | :--- | :--- | :--- |
| **`Xenova/all-MiniLM-L6-v2`** (`q8`) | Browser Web Worker (`app/recall-worker.js`) | **On-Device Semantic Memory**: Private semantic search over prior turns & attachments | Opt-in (~23 MB hashed download) |
| **`Xenova/vit-gpt2-image-captioning`** (`q8`) | Browser Web Worker (`app/vision-worker.js`) | **On-Device Vision Captioning Fallback**: Scene description when cloud vision quotas exhaust | On-demand via Settings (`#local-vision-enabled`) |
| **`Xenova/vit-base-patch16-224`** (`q8`) | Browser Web Worker (`app/vision-worker.js`) | **On-Device Image Classification**: Top-5 visual object classes when cloud vision fails | On-demand & cached locally in CacheStorage |
| **`tesseract.js@5`** (`eng` traineddata) | Browser Web Worker (`app/attachments.js`) | **On-Device OCR Fallback**: Extracts text from images & scanned PDFs without server keys | Loaded dynamically when cloud OCR fails |

---

## 3. Real-Time Web RAG, Chronological Ranking & Research Synthesis

1. **Research Synthesis Priority (`api/_lib/research-model.js`)**:
   - Automatic live web search synthesis prioritizes Groq **`openai/gpt-oss-120b` → `qwen/qwen3.8-27b` → `openai/gpt-oss-20b`**, automatically failing over to **`gemini-2.5-flash`** / **`gemini-2.5-flash-lite`** if Groq limits are reached. Explicit `gemini-*` user selections honor Gemini first.
2. **Chronological Date Inference & Decay (`api/_lib/hybrid-reranker.js`, `api/_lib/research-evidence.js`, `api/search.js`)**:
   - Partial dates (`Month DD`) infer explicit years present in URLs/titles/snippets instead of defaulting to the current year, preventing 2014/legacy pages from masquerading as fresh updates.
   - Exponential recency decay (`exp(-ageDays / 45)`) and staleness penalties (`>365d` / `>540d`) ensure current reporting outranks stale archives.
3. **Deep Reasoning (`Think`) Allocation (`api/chat-groq.js`)**:
   - When `#composer-think-btn` (`Think`) is enabled, requests preserve `forceReasoning: true` / `tier: 'deep'` through the centralized LLM router (`api/_lib/llm-router.js`) and allocate `thinkingBudget: 8192` on Gemini thinking calls.

---

## 4. Multi-Key Concurrency & Circuit Breaker Architecture

- **Multi-Key Pool (`GROQ_API_KEYS`)**: Round-robin key rotation across up to 10+ API keys.
- **Failover Threshold**: 3,500ms timeout threshold before automatically cascading to the next provider.
- **Circuit Breaker**: In-memory state machine isolating rate-limited keys for 30 seconds to maintain 0ms latency for subsequent requests.
