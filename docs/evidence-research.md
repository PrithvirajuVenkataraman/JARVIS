# Evidence-backed live research

Live Web Search stays enabled in its conversation until switched off. New chats start with search off; restoring a chat restores its setting. Only the active chat supplies context. Stop, starting a chat and switching chats abort research, settle the outer request and ignore late callbacks. A previous answer remains visible until a supported replacement is ready.

The browser sends one streaming POST to `/api/search` with `stream: true`. JSON callers use `mode: "rag"`. Both use the same engine. Existing SSE event names remain `status`, `sources`, `token` and `done`. Progress streams during retrieval; provisional model text is buffered. Only validated final text can replace the answer.

Legacy search and answer-then-cite entry points now delegate to this same pipeline. They cannot generate an unsourced answer after failed retrieval. `/api/chat-groq` also selects an evidence contract before generation: source-dependent factual questions use the research engine, attachments remain supplied material, and ordinary conversation stays model knowledge. Explicit Web-off requests requiring evidence return an honest limitation. Ambiguous follow-ups clarify before retrieval. Historical assistant statements, recalled memories and summaries resolve references but never establish factual truth.

Provider conversations are bound on the server after retrieval, including when the browser supplies structured messages. The server owns the policy, current question and evidence block; client system messages cannot replace them. Model-knowledge replies report `verified: false` and `verificationScope: "none"`. Supported research reports `verificationScope: "retrieved_passages"`, which denotes traceability rather than guaranteed real-world truth.

## Evidence contract

A deterministic pass turns the request into requirements for names, dates, values, explanations or comparison attributes. Explicit claims and imperfect grammar trigger investigation; an absent subject or unbound reference requires clarification. An alleged count is a hypothesis, not an instruction to invent that many items.

The answer model returns structured facts, each with a requirement ID, source ID, exact value and supporting quotation. The validator checks the passage against the retrieved record and checks the value against the requirement. It renders accepted facts with citations, rejects unknown IDs, and reports the precise remaining requirements. Generic passport descriptions, repeated headlines and unrelated dates cannot satisfy a request for named individuals. Claims about unrestricted travel need separate supporting evidence about entry restrictions.

The entire quotation must match, not just its beginning. Free-form `answer` text and `answerSegments` cannot introduce unsupported prose, satisfy an explanation requirement, or manufacture a fact from a source title. Facts are rendered as literal source text with application-owned citations; partial answers retain missing details. This deliberately favors supported passages over an unchecked fluent rewrite. Source publication dates remain unknown when missing.

`answerStatus` is `complete`, `partial`, `unavailable` or `clarification` in JSON and SSE completion results. `verified: true` requires all requirements to be supported. A partial answer cites supported facts and identifies what is missing. `provenance: "web_grounded"` alone never means complete. Exact quote matching establishes traceability, not independent truth: source quality, conflicting reports and temporal changes still matter.

Sources retain separate snippet, article text, extraction status, publisher, original URL, fetched URL and fetch time fields. Article text belongs only to the page actually read. Citation IDs remain stable throughout the request. Relevant official documentation is preferred for technical questions. Geographic aliases are normalized; comparison sources may cover one subject, but their combined facts must cover all requested attributes and subjects.

## Free resources and generation budget

General search uses the existing free DuckDuckGo/SearXNG providers first. News feeds supplement insufficient direct results. Wikipedia is supplementary reference material. Redirect wrappers preserve publisher information; unreadable wrappers can recover an original through an exact-title and publisher search. Extraction reads public HTML and bounded same-origin references. Optional browser extraction runs only against an explicitly configured existing `CRAWL4AI_URL` or `CRAWL4AI_ENDPOINT` service; no service is provisioned.

No separate planning or review generation runs on the production research path. Retrieval gathers passages before one final structured generation with at most two provider attempts across the turn. Empty retrieval makes no generation call. Automatic research synthesis prioritizes Groq (`openai/gpt-oss-120b`, then `qwen/qwen3.8-27b`, then `openai/gpt-oss-20b`) with failover to Google Gemini (`gemini-2.5-flash`, `gemini-2.5-flash-lite`) using existing credentials and allowances, without paid search tools, external reranking or credential rotation; explicit Gemini model selections run Gemini first. Chronological reranking (`rankResearchEvidence`, `hybridRerank`, `rankSources`) infers explicit years from source URLs/snippets on partial month-day dates and applies exponential day-scale recency decay plus staleness penalties so current reports outrank old archives. Configured accounts still have quotas; this code cannot guarantee that an account itself is unbilled.

Each attempt has its own timeout. A slow primary leaves time for a fallback. HTTP failures, quota responses, timeouts, malformed responses and rejected facts have safe diagnostic reasons. Cooldowns are scoped to credential and model; credentials and response bodies are excluded from diagnostic records. Production research uses retrieval-only providers, so Google Search grounding cannot consume the two answer attempts even if its allowance flag is set.

## Timing and caching

`app/search/research-contract.mjs` defines the 45-second server deadline. Final answering reserves 12 seconds. Retrieval is bounded to three rounds, six queries, ten pages and three concurrent page reads. Optional portraits never delay completion and unfinished enrichment is cancelled. The client has three seconds of transport grace. The Vercel function limit remains 60 seconds.

Only retrieval is cached: one minute for explicitly changing facts and five minutes otherwise, with bounded warm-instance memory. Concurrent identical retrievals are coalesced. Cancelling one subscriber does not cancel another. Generated answers, credentials and chat history are never cached. This cache is opportunistic rather than durable in serverless deployments.

## Verification and rollout

`npm run test:research` runs deterministic evidence, actual HTTP response-parsing/provider-budget, extraction, orchestration, stream and conversation lifecycle regressions. `npm run check` runs the broader repository checks. Some older suites make real network requests and can fail when upstream services block the runner.

`npm run test:research:live -- --base-url https://jarvisjr.vercel.app --output scratch/research-live-evaluation.json` runs the small opt-in deployed acceptance set. It records pipeline version, status, requested-fact completeness, quote/citation support, latency and failure reasons. It exits unsuccessfully for the old pipeline, missing status, incomplete answers or unverified citations. Raw generated answers and public passages in this local artifact can be inspected; no model credentials are recorded. Live tests consume only a few requests but still use the configured existing allowances.

Local passing tests do not establish deployment recovery. Compare the same acceptance queries on Vercel after deployment and retain the resulting artifact. Browser visual testing requires an available browser automation surface; fake-DOM lifecycle tests do not establish visual correctness.
