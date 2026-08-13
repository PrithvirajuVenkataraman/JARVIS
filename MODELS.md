# JARVIS - AI Models & Value Proposition Architecture

> ### **Master Value Proposition**
> **"Unify Assistant: The Privacy-First, Hybrid Multilingual AI Copilot — Live Web Intelligence & Local Vision in Your Language."**

---

## 🏛️ The 3 Core Pillars of Unify Assistant

```
                                ┌────────────────────────────────────────┐
                                │            UNIFY ASSISTANT             │
                                └───────────────────┬────────────────────┘
                                                    │
          ┌─────────────────────────────────────────┼─────────────────────────────────────────┐
          ▼                                         ▼                                         ▼
┌───────────────────┐                     ┌───────────────────┐                     ┌───────────────────┐
│     PILLAR 1      │                     │     PILLAR 2      │                     │     PILLAR 3      │
│   Hybrid Local    │                     │   Verified Live   │                     │   Native Indic    │
│   Vision Engine   │                     │   Intelligence    │                     │ Multilingual Voice│
└─────────┬─────────┘                     └─────────┬─────────┘                     └─────────┬─────────┘
          │                                         │                                         │
          ├─ Local ResNet-style classifier          ├─ Live web verification                  ├─ Voice dictation & TTS
          ├─ U-Net ROI document cropping            ├─ Source citation badges                 ├─ Tamil, Telugu, Kannada,
          └─ Offline fallback (<30ms)               └─ Schema SQL (strict: true)              │  Hindi & English
                                                                                            └─ Regional food & travel
```

---

## 1. Primary Model Architecture (Groq LPU Hardware Acceleration)

Inference is accelerated via **Groq LPU (Language Processing Unit)** hardware using the following specialized models:

| Model Name | API Identifier | Architecture & Tech | Role & Usage |
| :--- | :--- | :--- | :--- |
| **GPT OSS 120B** | `openai/gpt-oss-120b` | Large Transformer LLM | **Flagship Model**: High-capacity general reasoning, multi-turn chat, structured outputs (`strict: true`), and complex problem solving. |
| **GPT OSS 20B** | `openai/gpt-oss-20b` | Lightweight Transformer LLM | **Fast Conversational Model**: Low-latency chat responses, fast structured JSON outputs (`strict: true`), and instant tasks. |
| **Llama 3.3 70B** | `llama-3.3-70b-versatile` | Open-Weights Meta Llama 3 | **Versatile Reasoning**: Large-scale open weights model for complex reasoning, document analysis, and detailed writing. |
| **Llama 3.1 8B Instant** | `llama-3.1-8b-instant` | Compact Meta Llama 3 | **Instant Pre-Pass**: Low-latency model for instant replies, intent classification, and quality verification. |
| **DeepSeek R1 Distill 70B** | `deepseek-r1-distill-llama-70b` | Reasoning-Distilled Transformer | **Deep Reasoning & Math**: Specialized reasoning model for step-by-step logic, mathematics, and architectural analysis. |
| **Qwen 2.5 Coder 32B** | `qwen-2.5-coder-32b` | Code-Specialized Transformer | **Code & Syntax**: Technical coding model for software engineering, refactoring, SQL query drafting, and debugging. |
| **Llama 3.2 11B/90B Vision** | `llama-3.2-11b-vision-preview` / `llama-3.2-90b-vision-preview` | Multimodal Vision Transformer | **Cloud Vision**: Multimodal image analysis, visual scene understanding, and OCR text extraction. |

---

## 2. Google Gemini & Cloud Vision Integration

- **Google Gemini API**: `gemini-2.5-flash`, `gemini-2.0-flash`, `gemini-2.5-pro` (`inlineData` base64 visual payload).
- **RAG & Search Grounding**: Leverages Gemini multimodal vision and web retrieval for real-time live fact verification, weather forecasts, market prices, and news ingestion.

---

## 3. Pillar 1: Hybrid Local Vision Engine (ResNet-50 & U-Net Style Vision)

To guarantee zero-dependency offline fallback, instantaneous local processing, and visual anti-hallucination:

### A. Local Feature Classifier (ResNet-50 Style Architecture)
- **Module**: [`api/_lib/local-vision-classifier.js`](file:///c:/Users/drkan/Desktop/AI%20Projects/unify-assistant/api/_lib/local-vision-classifier.js)
- **Technology**: Feature vector extraction analyzing color moments, spatial edge-contrast density, UI grid patterns, text density, and aspect ratios.
- **Function**: Classifies image subjects into `device`, `document`, `product`, `scene`, or `object` locally in Node.js when cloud APIs are unconfigured or offline.

### B. Local ROI Bounding Box Segmenter (U-Net Style Architecture)
- **Module**: [`app/local-vision-engine.js`](file:///c:/Users/drkan/Desktop/AI%20Projects/unify-assistant/app/local-vision-engine.js)
- **Technology**: Spatial contour region-of-interest (ROI) segmentation using HTML5 Canvas pixel analysis.
- **Function**: Auto-detects and crops bounding boxes `{ x, y, width, height }` for document text regions, paper worksheets, and electronic screens prior to OCR extraction.

### C. Device & Display Anti-Hallucination Guardrails
- Enforces visual priority rules for electronic hardware (iPads, tablets, smartphones, laptops).
- Explicitly prevents wallpapers, app icons, stock headers, or screen graphics inside a display from being misclassified as outdoor physical landscapes (such as "mountains").

---

## 4. Pillar 2: Pillar 2: Verified Live Intelligence & Constrained Decoding (`strict: true`)

Supported models (`openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `openai/gpt-oss-safeguard-20b`) leverage Groq's constrained grammar decoding:

### A. Safety Safeguard Classification
- **Model**: `openai/gpt-oss-safeguard-20b`
- **Format**: `response_format: { type: "json_object" }`
- Evaluates safety policies while permitting benign educational, creative, and triage requests.

### B. Schema-Validated SQL Query Generation
- **Models**: `openai/gpt-oss-120b`, `openai/gpt-oss-20b`
- **Format**: `response_format: { type: "json_schema", json_schema: { name: "sql_query_generation", strict: true, schema: ... } }`
- Generates schema-validated SQL queries containing:
  - `query`: Syntactically valid SQL code.
  - `query_type`: `SELECT`, `INSERT`, `UPDATE`, `DELETE`, etc.
  - `tables_used`: List of database tables involved.
  - `estimated_complexity`: Query complexity rating.
  - `validation_status`: Boolean `is_valid` flag and syntax error details.

---

## 5. Pillar 3: Native Indic Multilingual & Speech Stack

### A. Text Language Support
Native multilingual understanding and natural text generation across:
- **Tamil (தமிழ்)**
- **Telugu (తెలుగు)**
- **Kannada (ಕನ್ನಡ)**
- **Hindi (हिन्दी)**
- **English** and major international languages.

### B. Voice Input & Speech Synthesis
Web Speech API integration supporting native speech recognition and Text-to-Speech (TTS):
- Tamil: `ta-IN`
- Telugu: `te-IN`
- Kannada: `kn-IN`
- Hindi: `hi-IN`
- English: `en-IN` / `en-US`
