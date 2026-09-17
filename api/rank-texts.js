export const config = { maxDuration: 30 };

import { applyApiSecurity } from './_lib/security.js';
import {
    chunkTextForEmbedding,
    hasNvidiaEmbeddingKey,
    rankTextsByRelevance
} from './_lib/embeddings.js';

const MAX_ITEMS = 48;
const MAX_ITEM_CHARS = 2000;
const MAX_QUERY_CHARS = 1000;

export default async function handler(req, res) {
    const guard = applyApiSecurity(req, res, {
        methods: ['POST'],
        routeKey: 'rank-texts',
        maxBodyBytes: 400 * 1024,
        rateLimit: { max: 30, windowMs: 60 * 1000 }
    });
    if (guard.handled) return;

    try {
        const query = String(req.body?.query || '').trim().slice(0, MAX_QUERY_CHARS);
        const limit = Math.max(1, Math.min(12, Number(req.body?.limit) || 5));
        const useRerank = req.body?.useRerank !== false;
        if (!query) {
            return res.status(400).json({
                success: false,
                error: { code: 'invalid_request', message: 'query is required.' }
            });
        }

        let items = normalizeRankItems(req.body?.items);
        const sourceText = String(req.body?.text || '').trim();
        if (!items.length && sourceText) {
            items = chunkTextForEmbedding(sourceText, {
                maxChunks: Math.min(MAX_ITEMS, Number(req.body?.maxChunks) || 16),
                maxChars: 1200
            }).map((chunk, index) => ({
                id: `chunk_${index}`,
                text: chunk
            }));
        }

        if (!items.length) {
            return res.status(400).json({
                success: false,
                error: { code: 'invalid_request', message: 'items or text is required.' }
            });
        }

        if (!hasNvidiaEmbeddingKey()) {
            return res.status(200).json({
                success: true,
                available: false,
                ranked: items.slice(0, limit),
                embeddingEnhanced: false,
                rerankEnhanced: false,
                reason: 'nvidia_embeddings_unavailable'
            });
        }

        const ranked = await rankTextsByRelevance(query, items, {
            useRerank,
            rerankLimit: Math.min(20, items.length)
        });

        return res.status(200).json({
            success: true,
            available: ranked.available,
            ranked: (ranked.ranked || []).slice(0, limit),
            embeddingEnhanced: Boolean(ranked.embeddingEnhanced),
            rerankEnhanced: Boolean(ranked.rerankEnhanced),
            embeddingModel: ranked.embeddingModel || undefined,
            rerankModel: ranked.rerankModel || undefined,
            warning: ranked.warning || undefined
        });
    } catch (error) {
        return res.status(502).json({
            success: false,
            error: {
                code: 'rank_failed',
                message: String(error?.message || 'Text ranking failed.')
            }
        });
    }
}

function normalizeRankItems(rawItems) {
    if (!Array.isArray(rawItems)) return [];
    return rawItems
        .slice(0, MAX_ITEMS)
        .map((item, index) => {
            if (typeof item === 'string') {
                const text = item.replace(/\s+/g, ' ').trim().slice(0, MAX_ITEM_CHARS);
                return text ? { id: `item_${index}`, text } : null;
            }
            if (!item || typeof item !== 'object') return null;
            const text = String(item.text || item.description || item.value || item.title || '')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, MAX_ITEM_CHARS);
            if (!text) return null;
            return {
                ...item,
                id: String(item.id || item.key || `item_${index}`),
                text
            };
        })
        .filter(Boolean);
}
