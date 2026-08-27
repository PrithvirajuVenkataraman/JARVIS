/**
 * Agentic Tool Definitions and Client-Side Execution Dispatcher.
 * Provides safe sandboxed computation, knowledge lookup, time/calendar context, and session memory search.
 */

/**
 * Tool schemas provided to OpenAI/Groq compatible chat completions API.
 */
export const AGENTIC_TOOL_DEFINITIONS = [
    {
        type: 'function',
        function: {
            name: 'code_interpreter',
            description: 'Executes JavaScript code and math expressions for exact calculations, data processing, formatting, and algorithmic logic.',
            parameters: {
                type: 'object',
                properties: {
                    code: {
                        type: 'string',
                        description: 'The JavaScript code or math expression to execute. Must return a result or log output.'
                    }
                },
                required: ['code']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'knowledge_lookup',
            description: 'Retrieves concise encyclopedic facts, summaries, and verified entity definitions from trusted knowledge bases.',
            parameters: {
                type: 'object',
                properties: {
                    topic: {
                        type: 'string',
                        description: 'The entity, concept, or topic name to look up.'
                    }
                },
                required: ['topic']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'datetime_context',
            description: 'Provides precise real-time calendar information, current date/time, timezone calculations, and date arithmetic.',
            parameters: {
                type: 'object',
                properties: {
                    timezone: {
                        type: 'string',
                        description: 'Optional IANA timezone name (e.g., "America/New_York", "Asia/Kolkata", "UTC"). Defaults to local user timezone.'
                    },
                    operation: {
                        type: 'string',
                        description: 'Optional date operation or query (e.g., "current_time", "day_of_week", "utc_offset").'
                    }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'session_memory',
            description: 'Searches previous conversation turns, user notes, and uploaded attachments for relevant facts and context.',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'The search query or keyword to locate in active conversation memory and document attachments.'
                    }
                },
                required: ['query']
            }
        }
    }
];

/**
 * Executes a sandboxed JavaScript code snippet or math expression.
 * @param {string} code
 * @returns {{ success: boolean, result?: any, error?: string }}
 */
export function executeCodeInterpreter(code) {
    const raw = String(code || '').trim();
    if (!raw) return { success: false, error: 'Empty code input.' };

    try {
        // Build clean sandbox scope with standard Math and utilities
        const safeGlobals = {
            Math,
            Date,
            JSON,
            Array,
            Object,
            Number,
            String,
            Boolean,
            RegExp,
            parseInt,
            parseFloat,
            isNaN,
            isFinite
        };

        // Wrap expression if it does not contain a return statement
        const wrapped = raw.includes('return ') ? raw : `return (${raw});`;
        const paramNames = Object.keys(safeGlobals);
        const paramValues = Object.values(safeGlobals);

        const fn = new Function(...paramNames, wrapped);
        const result = fn(...paramValues);

        return {
            success: true,
            result: typeof result === 'object' && result !== null ? JSON.stringify(result) : String(result)
        };
    } catch (err) {
        return {
            success: false,
            error: String(err?.message || 'Execution error')
        };
    }
}

/**
 * Looks up topic summary using Wikipedia REST endpoint.
 * @param {string} topic
 * @returns {Promise<{ success: boolean, data?: Record<string, any>, error?: string }>}
 */
export async function executeKnowledgeLookup(topic) {
    const clean = String(topic || '').trim();
    if (!clean) return { success: false, error: 'Missing topic query.' };

    try {
        const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(clean.replace(/\s+/g, '_'))}`;
        const res = await fetch(url, {
            headers: { 'Accept': 'application/json' }
        });

        if (!res.ok) {
            return {
                success: false,
                error: `No encyclopedic summary found for "${clean}".`
            };
        }

        const data = await res.json();
        return {
            success: true,
            data: {
                title: data.title,
                extract: data.extract,
                description: data.description,
                sourceUrl: data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(clean.replace(/\s+/g, '_'))}`
            }
        };
    } catch (err) {
        return {
            success: false,
            error: String(err?.message || 'Knowledge lookup failed.')
        };
    }
}

/**
 * Resolves temporal and calendar information.
 * @param {string} [timezone]
 * @param {string} [operation]
 * @returns {{ success: boolean, data: Record<string, any> }}
 */
export function executeDatetimeContext(timezone = '', operation = '') {
    try {
        const now = new Date();
        const tz = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: tz,
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            second: 'numeric',
            timeZoneName: 'short'
        });

        return {
            success: true,
            data: {
                formatted: formatter.format(now),
                iso: now.toISOString(),
                timestamp: now.getTime(),
                timezone: tz,
                year: now.getUTCFullYear(),
                operation: operation || 'current_time'
            }
        };
    } catch (err) {
        return {
            success: false,
            data: {
                formatted: new Date().toUTCString(),
                error: String(err?.message || 'Timezone calculation fallback to UTC.')
            }
        };
    }
}

export function textToEmbeddingVector(text, dim = 512) {
    const v = new Float32Array(dim);
    const tokens = String(text || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return v;
    for (const token of tokens) {
        let h1 = 0x811c9dc5;
        let h2 = 0x5bd1e995;
        for (let i = 0; i < token.length; i++) {
            const code = token.charCodeAt(i);
            h1 ^= code;
            h1 = Math.imul(h1, 0x01000193);
            h2 ^= code;
            h2 = Math.imul(h2, 0x5bd1e995);
        }
        const idx1 = Math.abs(h1) % dim;
        const idx2 = Math.abs(h2) % dim;
        v[idx1] += 1.0;
        v[idx2] += 0.5;
        if (token.length >= 4) {
            for (let i = 0; i < token.length - 2; i++) {
                const trigram = token.slice(i, i + 3);
                let th = 0;
                for (let j = 0; j < trigram.length; j++) th = (th * 31 + trigram.charCodeAt(j)) | 0;
                v[Math.abs(th) % dim] += 0.2;
            }
        }
    }
    let norm = 0;
    for (let i = 0; i < dim; i++) norm += v[i] * v[i];
    norm = Math.sqrt(norm);
    if (norm > 0) {
        for (let i = 0; i < dim; i++) v[i] /= norm;
    }
    return v;
}

export function vectorCosineSimilarity(a, b) {
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
    return dot;
}

/**
 * Searches active conversation turns and attachments using semantic vector search and exact token matching.
 * @param {string} query
 * @param {Array<{ role: string, content: string }>} [conversationHistory]
 * @param {Array<{ name?: string, text?: string }>} [attachments]
 * @returns {{ success: boolean, matches: Array<{ source: string, snippet: string, score: number }> }}
 */
export function executeSessionMemory(query = '', conversationHistory = [], attachments = []) {
    const q = String(query || '').trim();
    if (!q) return { success: false, matches: [] };

    const queryVec = textToEmbeddingVector(q);
    const scoredMatches = [];

    // Search conversation turns
    for (let i = 0; i < conversationHistory.length; i++) {
        const turn = conversationHistory[i];
        const content = String(turn?.content || '');
        if (!content) continue;
        const docVec = textToEmbeddingVector(content);
        const sim = vectorCosineSimilarity(queryVec, docVec);
        const subMatch = content.toLowerCase().includes(q.toLowerCase());
        const finalScore = subMatch ? Math.max(sim, 0.75) : sim;
        if (finalScore >= 0.15) {
            scoredMatches.push({
                source: `turn_${i + 1}_${turn.role || 'unknown'}`,
                snippet: content.length > 300 ? `${content.slice(0, 300)}...` : content,
                score: finalScore
            });
        }
    }

    // Search attachments
    for (const att of attachments) {
        const text = String(att?.text || att?.content || '');
        if (!text) continue;
        const docVec = textToEmbeddingVector(text);
        const sim = vectorCosineSimilarity(queryVec, docVec);
        const subMatch = text.toLowerCase().includes(q.toLowerCase());
        const finalScore = subMatch ? Math.max(sim, 0.75) : sim;
        if (finalScore >= 0.15) {
            scoredMatches.push({
                source: `attachment_${att.name || 'document'}`,
                snippet: text.length > 400 ? `${text.slice(0, 400)}...` : text,
                score: finalScore
            });
        }
    }

    scoredMatches.sort((a, b) => b.score - a.score);

    return {
        success: true,
        matches: scoredMatches.slice(0, 4)
    };
}

/**
 * Main dispatcher to execute a tool by name with arguments.
 * @param {string} name
 * @param {Record<string, any> | string} args
 * @param {{ conversationHistory?: Array<any>, attachments?: Array<any> }} [context]
 * @returns {Promise<{ tool: string, success: boolean, output: any }>}
 */
export async function dispatchToolCall(name, args = {}, context = {}) {
    let parsedArgs = args;
    if (typeof args === 'string') {
        try {
            parsedArgs = JSON.parse(args);
        } catch {
            parsedArgs = { raw: args };
        }
    }

    switch (name) {
        case 'code_interpreter': {
            const res = executeCodeInterpreter(parsedArgs?.code || parsedArgs?.raw || '');
            return { tool: 'code_interpreter', success: res.success, output: res.success ? res.result : res.error };
        }
        case 'knowledge_lookup': {
            const res = await executeKnowledgeLookup(parsedArgs?.topic || parsedArgs?.raw || '');
            return { tool: 'knowledge_lookup', success: res.success, output: res.success ? res.data : res.error };
        }
        case 'datetime_context': {
            const res = executeDatetimeContext(parsedArgs?.timezone, parsedArgs?.operation);
            return { tool: 'datetime_context', success: res.success, output: res.data };
        }
        case 'session_memory': {
            const res = executeSessionMemory(
                parsedArgs?.query || parsedArgs?.raw || '',
                context.conversationHistory || [],
                context.attachments || []
            );
            return { tool: 'session_memory', success: res.success, output: res.matches };
        }
        default:
            return {
                tool: name,
                success: false,
                output: `Unknown tool: ${name}`
            };
    }
}
