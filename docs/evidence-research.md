# Evidence-driven live research

The live-search composer now sends one streaming POST to `/api/search` with
`stream: true`. The server owns planning, bounded retrieval rounds, page reading,
coverage review and synthesis. The browser displays `status`, `sources`, `token`
and canonical `done` events. It does not restart failed research using model memory.
`mode: "rag"` JSON callers use the same engine; `answer: false` skips synthesis.

## Free-resource operation

No new account, database, paid search API or external reranker is required.
Search uses DuckDuckGo, the existing SearXNG health/circuit-breaker pool,
Wikipedia and relevant news feeds. Ranking uses local BM25, relevance, domain
trust and query-sensitive freshness. The existing Groq/Gemini text credentials
support planning, evidence review and synthesis. Each turn has a maximum of four
model requests, including provider fallback attempts. Rate-limited model providers
enter a cooldown; the pipeline retains evidence if synthesis is unavailable.
Large pages are reduced to relevant passages and adjacent context before model
calls, with at most 12,000 characters of source excerpts per prompt.

Google search grounding is disabled unless the operator explicitly sets
`SEARCH_GEMINI_GROUNDING_FREE_ALLOWANCE=true` after verifying that allowance.
It is never required by the new pipeline. Crawl4AI is optional and uses only an
explicitly configured `CRAWL4AI_URL`/`CRAWL4AI_ENDPOINT`, with
`CRAWL4AI_API_TOKEN`/`CRAWL4AI_TOKEN` for authentication. The app neither provisions
hosting nor upgrades any provider plan. Account quotas still apply.

## Research and evidence contract

- Preserve punctuation-bearing entity identities such as Next.js, C++ and .NET.
  Domain authority cannot override subject relevance.
- Resolve follow-up references from relevant user context. Return a clarification
  when the subject remains ambiguous; do not fabricate an interpretation.
- Treat explicit factual claims as requests to verify and explain them. An alleged
  count, imperfect grammar or the choice between identifying subjects and checking
  a myth must not produce an interpretation menu before searching. The planner
  and execution boundary both enforce this; genuinely absent referents still need
  clarification. Discard the planner's unrelated facets when correcting this error.
- Plan requested facets, collect evidence, and perform focused follow-up searches
  for missing details. Stop on adequate evidence, three rounds, six queries, ten
  page fetches, cancellation or the shared deadline.
- Read HTML first. When configured, use browser extraction for important pages
  that could not be read. Follow a bounded number of relevant same-origin links.
- Keep `snippet`, `fullArticleText`, `evidenceKind`, `extractionStatus`, `pageFetched`,
  `originalUrl`, `url` and `fetchedAt` distinct. Text belongs only to the URL fetched,
  including its validated redirect destination; never copy it to sibling articles.
- Check requested facets and explicit counts. A requested count may be incorrect.
  Review source excerpts for contradictions and missing names/values. Source count
  and domain diversity alone do not establish factual correctness.
- Assign final stable source IDs before synthesis. Require inline citations, remove
  unknown IDs and fall back to explicitly labelled evidence excerpts if synthesis
  fails or contains no valid citations. Coverage and model reviews are heuristics,
  not a guarantee of truth; unresolved evidence must remain explicit.

## Timing, cancellation and caching

`app/search/research-contract.mjs` defines a 50-second server deadline, at most
24 seconds of retrieval and 20 seconds of synthesis. The client allows three
seconds of transport grace and has no separate five-second source cutoff for
the server research path. The server remains within the configured Vercel
60-second function duration. Provider, page and model requests receive child
abort signals; disconnecting or stopping the turn cancels outstanding work.

Retrieved results are cached in bounded warm-instance memory for one minute for
explicitly changing facts and five minutes otherwise. Concurrent identical
retrievals are shared; cancellation of one subscriber does not cancel another.
Generated answers, credentials and conversation histories are not cached. These
caches are opportunistic in serverless deployments and are not durable storage.

## Verification

Run `npm run test:research` for deterministic coverage of entity collisions,
provenance, real follow-up dispatch, evidence gaps, deadlines, cancellation,
source IDs, chunked SSE, extraction and model-budget behaviour. The repository's
other search suites remain available through `npm run test:live-search`; some
older suites require real network access. Live provider availability is a separate
canary concern and cannot be guaranteed by fixture tests.
