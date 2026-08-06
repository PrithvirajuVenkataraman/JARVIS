# JARVIS

JARVIS is a browser-based assistant for chat, writing, planning, translation, weather, live vision, saved chats, local memory, source checking, attachments, and everyday help.

Static frontend + Node/Vercel API routes. No frontend build step.

## Exact Features

- Text chat, explanations, summaries, writing help & planning
- Streaming answers, with JSON fallback for reviewed or structured routes
- Voice-to-text, Live Vision, and file attachments (PDF, DOCX, PPTX, images, text)
- Saved chats with search, restore, rename, pin, share, and delete
- Local Memory Manager for explicit saved memory
- Prompt-based translation and slash command picker
- Weather, location, itinerary, and everyday planning help
- Answer verification against retrieved sources
- Local preferences, chat history, regeneration, interruption, and feedback
- Crawl4AI fallback for readable extraction when configured

## Standout Feature: Context Copilot

Context Copilot resolves follow-ups like "latest on it", "compare it", "tell me more", and "source?" locally.

It is local, deterministic, private, and free-for-life. Models still generate answers; the follow-up decision stays in the app. Specialized transformer APIs (NVIDIA embeddings/rerank) improve search ranking and semantic memory/attachment recall, but they do not replace Context Copilot routing.

## Memory

- **Short-term:** active chat context and follow-ups
- **Saved chats:** each chat keeps its own messages and context
- **Long-term:** only what the user explicitly asks JARVIS to remember, via Memory Manager

## Prompt-Based Translation

Examples: `translate "How much does this cost?" to Tamil`, `say this in Hindi: I need help`, `what does "vanakkam" mean in English`, `translate to Kannada`

## Sidebar And Options

Left sidebar: New chat, Search chats, Vision Analysis, Voice Conversation, Memory, System Instructions, and saved chats. Long-press or right-click a saved chat to rename, pin, share, or delete it.

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
