# Unify Assistant - AI Models & Capabilities Architecture

This document provides a comprehensive specification of all AI models integrated into the **Unify Assistant** platform, including provider endpoints, vision processing pipelines, structured output schemas, and multilingual support.

---

## 1. Primary Model Architecture (Groq API Integration)

| Model Name | API Identifier | Role & Usage |
| :--- | :--- | :--- |
| **GPT OSS 120B** | `openai/gpt-oss-120b` | **Flagship Model**: High-capacity general reasoning, multi-turn chat, structured outputs (`strict: true`), and complex problem solving. |
| **GPT OSS 20B** | `openai/gpt-oss-20b` | **Fast Conversational Model**: Low-latency chat responses, fast structured JSON outputs (`strict: true`), and lightweight tasks. |
| **Qwen 3.6 27B** | `qwen/qwen3.6-27b` | **Image Recognition & Vision**: Primary multimodal vision model for object detection, photo understanding, and visual scene analysis. |
| **Llama 3.3 70B** | `llama-3.3-70b-versatile` | **Versatile Reasoning**: Large-scale open weights model for complex problem solving, document analysis, and detailed writing. |
| **Llama 3.1 8B Instant** | `llama-3.1-8b-instant` | **Instant Pre-Pass**: Low-latency model for instant replies, intent classification, and quality verification. |
| **DeepSeek R1 Distill 70B**| `deepseek-r1-distill-llama-70b` | **Deep Reasoning & Math**: Specialized reasoning model for step-by-step logic, mathematics, and architectural analysis. |
| **Qwen 2.5 Coder 32B** | `qwen-2.5-coder-32b` | **Code & Syntax**: Technical coding model for software engineering, refactoring, SQL query drafting, and debugging. |

---

## 2. Multimodal Vision Pipeline (Single-Pass Native Vision)

Image uploads bypass legacy pre-passes and execute in **single pass** directly through vision-capable models:

- **Primary Vision Model**: `qwen/qwen3.6-27b` (Groq API)
- **Google Gemini Native Vision**: `gemini-2.5-pro` & `gemini-2.5-flash` (`inline_data` base64 payload)
- **OpenAI Vision Fallback**: `gpt-4o` & `gpt-4o-mini` (`image_url` base64 payload)

### Client Image Optimization
- Client image attachments are automatically downscaled to a max dimension of **1280px** and compressed as JPEG.
- **Payload reduction**: Reduces multi-megabyte image files by ~85% (to ~180 KB), preventing HTTP 413 errors and reducing response latency to **< 3–5 seconds**.

---

## 3. Groq Structured Outputs (`strict: true` & `strict: false`)

Supported models (`openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `openai/gpt-oss-safeguard-20b`) leverage Groq's constrained decoding:

### A. Safety Safeguard Classification
- **Model**: `openai/gpt-oss-safeguard-20b`
- **Format**: `response_format: { type: "json_object" }`
- Evaluates safety policies while permitting benign education, fiction, and triage requests.

### B. Structured SQL Query Generation
- **Models**: `openai/gpt-oss-120b`, `openai/gpt-oss-20b`
- **Format**: `response_format: { type: "json_schema", json_schema: { name: "sql_query_generation", strict: true, schema: ... } }`
- Generates schema-validated SQL queries containing metadata:
  - `query`: Syntactically valid SQL code.
  - `query_type`: `SELECT`, `INSERT`, `UPDATE`, etc.
  - `tables_used`: List of database tables.
  - `estimated_complexity`: Query complexity estimate.
  - `validation_status`: `is_valid` boolean and `syntax_errors`.

---

## 4. Indic Multilingual & Voice Capabilities

### A. Text Language Support
The AI engine natively reads, understands, and responds fluently in:
- **Tamil (தமிழ்)**
- **Telugu (తెలుగు)**
- **Kannada (ಕನ್ನಡ)**
- **Hindi (हिन्दी)**
- **English** and all major world languages.

### B. Speech Input & Voice Synthesis (Web Speech API)
Native voice dictation and conversation mode support:
- Tamil: `ta-IN`
- Telugu: `te-IN`
- Kannada: `kn-IN`
- Hindi: `hi-IN`
- English: `en-IN` / `en-US`
