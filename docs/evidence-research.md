# Evidence-backed live research

Live Web Search stays enabled in its conversation until switched off. New chats start with search off; restoring a chat restores its setting. Only the active chat supplies context. Stop, starting a chat and switching chats abort research, settle the outer request and ignore late callbacks. A previous answer remains visible until a supported replacement is ready.

The browser sends one streaming POST to `/api/search` with `stream: true`. JSON callers use `mode: "rag"`. Both use the same engine. Existing SSE event names remain `status`, `sources`, `token` and `done`. Progress streams during retrieval; provisional model text is buffered. Only validated final text can replace the answer.

## Evidence contract

A deterministic pass turns the request into requirements for names, dates, values, explanations or comparison attributes. Explicit claims and imperfect grammar trigger investigation; an absent subject or unbound reference requires clarification. An alleged count is a hypothesis, not an instruction to invent that many items.

The answer model returns structured facts, each with a requirement ID, source ID, exact value and supporting quotation. The validator checks the passage against the retrieved record and checks the value against the requirement. It renders accepted facts with citations, rejects unknown IDs, and reports the precise remaining requirements. Generic passport descriptions, repeated headlines and unrelated dates cannot satisfy a request for named individuals. Claims about unrestricted travel need separate supporting evidence about entry restrictions.

`answerStatus` is `complete`, `partial`, `unavailable` or `clarification` in JSON and SSE completion results. `verified: true` requires all requirements to be supported. A partial answer cites supported facts and identifies what is missing. `provenance: "web_grounded"` alone never means complete. Exact quote matching establishes traceability, not independent truth: source quality, conflicting reports and temporal changes still matter.

Sources retain separate snippet, article text, extraction status, publisher, original URL, fetched URL and fetch time fields. Article text belongs only to the page actually read. Citation IDs remain stable throughout the request. Relevant official documentation is preferred for technical questions. Geographic aliases are normalized; comparison sources may cover one subject, but their combined facts must cover all requested attributes and subjects.

## Free resources and generation budget

General search uses the existing free DuckDuckGo/SearXNG providers first. News feeds supplement insufficient direct results. Wikipedia is supplementary reference material. Redirect wrappers preserve publisher information; unreadable wrappers can recover an original through an exact-title and publisher search. Extraction reads public HTML and bounded same-origin references. Optional browser extraction runs only against an explicitly configured existing `CRAWL4AI_URL` or `CRAWL4AI_ENDPOINT` service; no service is provisioned.

No separate planning or review generation runs on the ordinary research path. One answer generation can return supported facts or precise gaps. Targeted retrieval may be followed by one additional generation. Each generation allows at most two provider attempts; the entire turn allows four actual HTTP attempts. Text uses existing Groq/Gemini credentials and allowances, without paid search tools, external reranking or credential rotation. Configured accounts still have quotas; this code cannot guarantee that an account itself is unbilled.

Each attempt has its own timeout. A slow primary leaves time for a fallback. HTTP failures, quota responses, timeouts, malformed responses and rejected facts have safe diagnostic reasons. Cooldowns are scoped to credential and model; credentials and response bodies are excluded from diagnostic records. Google search grounding remains disabled unless explicitly enabled with `SEARCH_GEMINI_GROUNDING_FREE_ALLOWANCE=true`; it is never necessary for this pipeline.

## Timing and caching

`app/search/research-contract.mjs` defines the 45-second server deadline. Final answering reserves 12 seconds. An initial generation starts only with at least 30 seconds remaining. Retrieval is bounded to three rounds, six queries, ten pages and three concurrent page reads. The client has three seconds of transport grace. The Vercel function limit remains 60 seconds.

Only retrieval is cached: one minute for explicitly changing facts and five minutes otherwise, with bounded warm-instance memory. Concurrent identical retrievals are coalesced. Cancelling one subscriber does not cancel another. Generated answers, credentials and chat history are never cached. This cache is opportunistic rather than durable in serverless deployments.

## Verification and rollout

`npm run test:research` runs deterministic evidence, actual HTTP response-parsing/provider-budget, extraction, orchestration, stream and conversation lifecycle regressions. `npm run check` runs the broader repository checks. Some older suites make real network requests and can fail when upstream services block the runner.

`npm run test:research:live -- --base-url https://jarvisjr.vercel.app --output scratch/research-live-evaluation.json` runs the small opt-in deployed acceptance set. It records pipeline version, status, requested-fact completeness, quote/citation support, latency and failure reasons. It exits unsuccessfully for the old pipeline, missing status, incomplete answers or unverified citations. Raw generated answers and public passages in this local artifact can be inspected; no model credentials are recorded. Live tests consume only a few requests but still use the configured existing allowances.

Local passing tests do not establish deployment recovery. Compare the same acceptance queries on Vercel after deployment and retain the resulting artifact. Browser visual testing requires an available browser automation surface; fake-DOM lifecycle tests do not establish visual correctness.
