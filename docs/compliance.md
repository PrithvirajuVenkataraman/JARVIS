# Compliance, Data Loss Prevention (DLP) & Observability

This document defines the threat model, architecture, policy modes, rule specifications, and operational controls for the compliance and data governance layer in Unify (JARVIS).

---

## 1. Threat Model & Non-Goals

### 1.1 Authority & Security Boundary
- **The server is the sole enforcement authority.** Client-side inspections (`dlpGateway` in browser) are purely for user experience (instant feedback, draft preservation, non-blocking redaction) and cost/latency reduction. The client environment is user-controlled; therefore, serverless endpoints (`api/chat-groq.js`, `api/search.js`, etc.) re-scan every request payload independently.
- The local browser audit log is a **diagnostics aid**, *not* SOC2/HIPAA-grade immutable evidence. Real compliance audit logs are recorded in server-side structured stdout logs and forwarded to enterprise SIEM/observability systems (Datadog, CloudWatch, Langfuse, OpenTelemetry).

### 1.2 In Scope
- Accidental leakage of high-risk security credentials (API keys, private keys, database connection strings, JWTs, cloud provider secrets) to upstream model providers (Groq, Google Gemini) and web search engines (Brave, public SearXNG instances, DuckDuckGo).
- Accidental transmission of sensitive personally identifiable information (PII) including credit card numbers, US Social Security Numbers, Indian Aadhaar numbers, PAN cards, phone numbers, and email addresses.
- Accidental persistence of raw credentials in long-term conversational memory (`app/memory/`) or local storage.
- Accidental leakage of matched secret values in audit logs, telemetry spans, or error payloads (zero secret exposure invariant).

### 1.3 Non-Goals & Limitations
- **Malicious user evasion**: A user determined to exfiltrate secrets by intentionally inserting obfuscating punctuation, Morse code, base64 fragments, or ROT13 is out of scope.
- **Semantic leakage**: Indirect paraphrasing or contextual hints about a secret (e.g. "my password is the third word in Hamlet") cannot be caught by regex or syntax-level pattern analysis.
- **Pre-existing upstream data**: Data previously transmitted to third-party providers before DLP activation is outside of scope.

---

## 2. Inventory of Outbound Text Call Sites

Every place where user-originated text leaves the device or is passed to external systems:

| Call Site | Location | Upstream Destination | Data Sent | DLP Gateway Channel |
| :--- | :--- | :--- | :--- | :--- |
| **Composer Submit** | `index.html` (`sendTextInput`) | `api/chat-groq.js` | User prompt & conversational context | `composer` |
| **Voice / STT Dictation** | `app/speech-input.js` | `api/stt.js` (Groq Whisper) & Web Speech | Audio / Transcribed user prompt | `voice` |
| **Memory Extraction** | `app/memory/memory-extractor.mjs` | Local storage (`jarvis_unified_memory_v1`) | Extracted facts, preferences | `memory` |
| **Reminders & Alarms** | `app/agent-workflows.js` | Local alarms / notifications | Extracted task / reminder text | `reminder` |
| **Custom Instructions** | `index.html` (Settings) | `api/chat-groq.js` (System Prompt) | User persona & response rules | `settings` |
| **Live Web Search** | `app/bounded-live-research.js` | `api/search.js` | Search query & sub-queries | `search_query` |
| **Brave Search** | `api/search.js` | `api.search.brave.com` | Live search query | `search_query` (server) |
| **SearXNG Instances** | `api/_lib/free-live/providers.js` | Public SearXNG pool endpoints | Live search query | `search_query` (server) |
| **DuckDuckGo Search** | `api/_lib/free-live/providers.js` | `html.duckduckgo.com` | Live search query | `search_query` (server) |
| **LLM Chat Synthesis** | `api/chat-groq.js` | Groq API / Gemini API | Full prompt, history, citations | `llm_dispatch` (server) |
| **Image Generation** | `app/image-generator.js` | `api/image-proxy.js` (Imagen/Pollinations)| Image generation prompt | `image_prompt` |
| **URL Content Extract** | `api/extract-url.js` | Crawl4AI Docker | Target URL | `web_fetch` (server) |
| **Feedback Comments** | `index.html` (Feedback Popover) | `api/_lib/feedback-handler.js` (routed via `api/diagnostics`) | User review commentary | `feedback_comment` |

---

## 3. Policy Modes

Configured via the environment variable `DLP_POLICY_MODE`:

1. **`personal` (Default)**:
   - **Credential Blocking**: ALWAYS enforced on the server; cannot be disabled by user or client.
   - **PII Masking**: Enabled by default; the user may toggle PII masking in Settings. The server honors the client's preference for PII masking while maintaining strict credential blocking.
2. **`enforced` (Enterprise Managed)**:
   - Both Credential Blocking AND PII Masking are strictly enforced server-side.
   - Settings toggles in the UI render as read-only with a message: *"Managed by your organization"*.
   - Client preference flags are ignored by the server.

---

## 4. Rule Specification

### 4.1 Credential Rules (Action: BLOCK, Severity: Critical)

| Rule ID | Category | Pattern / Anchored Regex | Validation Logic |
| :--- | :--- | :--- | :--- |
| `cred_aws_key` | `cloud_credential` | `\b(AKIA\|ASIA)[0-9A-Z]{16}\b` | 20-char AWS prefix & charset check |
| `cred_anthropic` | `ai_api_key` | `\bsk-ant-[A-Za-z0-9_-]{20,}\b` | Anthropic key prefix & length |
| `cred_openai` | `ai_api_key` | `\bsk-(proj-)?[A-Za-z0-9_-]{32,}\b` | OpenAI key prefix; rejects "risk-free" |
| `cred_groq` | `ai_api_key` | `\bgsk_[A-Za-z0-9]{40,}\b` | Groq key prefix & 40+ char check |
| `cred_github` | `vcs_token` | `\b(gh[pousr]_[A-Za-z0-9]{36,}\|github_pat_[A-Za-z0-9_]{50,})\b` | GitHub PAT / OAuth token formats |
| `cred_slack` | `chat_token` | `\bxox[abprs]-[A-Za-z0-9-]{10,}\b` | Slack bot / user token format |
| `cred_google` | `cloud_credential` | `\bAIza[0-9A-Za-z_-]{35}\b` | Google API key format (39 chars) |
| `cred_jwt` | `auth_token` | `\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b` | Base64URL-encoded three-part JWT |
| `cred_private_key` | `crypto_key` | `-----BEGIN (RSA \|OPENSSH \|EC \|DSA \|PGP )?PRIVATE KEY-----` | Header anchor; non-backtracking body |
| `cred_db_uri` | `database_uri` | `\b(postgres(ql)?\|mysql\|mongodb(\+srv)?\|redis\|amqp)://[^\s:@/]+:[^\s@/]+@` | URI with embedded user:pass@ only |
| `cred_generic` | `generic_secret` | `\b(api[_-]?key\|secret\|token\|password)\s*[:=]\s*['"]?([A-Za-z0-9/+_-]{16,})` | Shannon entropy check threshold (>= 3.2) |

### 4.2 PII Rules (Action: MASK, Severity: Medium/High)

| Rule ID | Category | Placeholder Token | Validation Algorithm |
| :--- | :--- | :--- | :--- |
| `pii_email` | `email` | `[REDACTED_EMAIL_n]` | RFC-pragmatic regex with TLD length |
| `pii_phone` | `phone_number` | `[REDACTED_PHONE_n]` | International & +91 bounded digits (10-15) |
| `pii_card` | `financial` | `[REDACTED_CARD_n]` | 13-19 digit candidate + Luhn algorithm |
| `pii_ssn` | `government_id` | `[REDACTED_SSN_n]` | `\b\d{3}-\d{2}-\d{4}\b`, rejects 000/666/9xx/00/0000 |
| `pii_aadhaar` | `government_id` | `[REDACTED_AADHAAR_n]` | 12 digits + Verhoeff checksum algorithm |
| `pii_pan` | `government_id` | `[REDACTED_PAN_n]` | `\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b` |

---

## 5. Architectural Data Flow

```
[ User Input ]
      │
      ▼
[ Unicode Normalizer ] (NFKC, zero-width/bidi strip, digit separator collapse)
      │
      ▼
[ dlpGateway() ]
      │
      ├─► [ Credential Detected ] ──► Decision: BLOCK
      │                                   │
      │                                   ├─► Restore draft to composer
      │                                   ├─► Display inline DLP banner
      │                                   └─► Offer "Redact and Send" option
      │
      ├─► [ PII Detected ] ──────────► Decision: MASK
      │                                   │
      │                                   ├─► Generate stable tokens ([REDACTED_EMAIL_1])
      │                                   ├─► Save reversible map in client memory only
      │                                   └─► Transmit sanitized text
      │
      └─► [ Clean ] ─────────────────► Decision: ALLOW (Transmit unmodified)
                                          │
                                          ▼
                               [ Serverless API Endpoint ]
                                          │
                                          ▼
                               [ Server DLP Enforcement ] (Independent Re-Scan)
                                          │
                                          ├─► Credential: 400 { code: "dlp_violation" }
                                          └─► Forward sanitized payload to LLM/Search
```

---

## 6. Audit Logging & Observability

### 6.1 Data Privacy Invariant
**Under no circumstances is matched sensitive text, a partial secret, or a hash of the secret ever logged, stored, or transmitted.**

### 6.2 Local Diagnostics Ring Buffer (`app/observability.js`)
- Stored in browser `localStorage` under `jarvis_compliance_audit_v1`.
- Max ring buffer size: 100 events.
- Event schema:
  - `dlp_inspection`: `{ ts, channel, ruleId, category, action: 'block' | 'mask' | 'redact', count }`
  - `feedback`: `{ ts, turnId, rating: 1 | -1, tags: string[], hasComment: boolean }`
  - `routing`: `{ ts, route, model, latencyMs }`
- Accessible via Settings modal with JSON download and clear options.

### 6.3 Server-Side Structured Logging (Vercel stdout)
- Outputs single-line JSON logs for SIEM ingestion:
  ```json
  { "tag": "DLP", "ts": 1793118900000, "route": "/api/chat-groq", "ruleId": "cred_aws_key", "category": "cloud_credential", "action": "block", "count": 1, "requestId": "req_xyz" }
  ```

### 6.4 External Exporter (OpenTelemetry / Langfuse)
- Activated only when `TELEMETRY_EXPORT_ENABLED !== "0"` AND server env vars (`OTEL_EXPORTER_OTLP_ENDPOINT` or `LANGFUSE_PUBLIC_KEY`) are present.
- Exports metadata-only spans (latency, model, token count estimates, DLP action counts, feedback scores).
- Non-blocking execution using serverless flush guards.

---

## 7. Rollback & Feature Flags

Three environment / client configuration flags allow instantaneous rollback:
1. `DLP_ENABLED`: When `false` / `0`, bypasses DLP scanning and restores legacy pass-through.
2. `FEEDBACK_ENABLED`: When `false` / `0`, hides message evaluation thumbs and popovers.
3. `TELEMETRY_EXPORT_ENABLED`: When `false` / `0`, disables external OTel/Langfuse webhook dispatches.
