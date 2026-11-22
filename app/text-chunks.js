export function chunkText(text, size = 2400) {
    const source = String(text || '');
    const blocks = source.match(/```[\s\S]*?(?:```|$)|\$\$[\s\S]*?(?:\$\$|$)|\\\[[\s\S]*?(?:\\\]|$)|[^\n]+(?:\n|$)|\n/g) || [];
    const chunks = []; let current = '', offset = 0, start = 0;
    const flush = () => { if (current) { chunks.push({ id: String(chunks.length), text: current, start, end: start + current.length }); current = ''; } };
    for (const block of blocks) {
        const atomic = /^(?:```|\$\$|\\\[)/.test(block);
        if (current.length + block.length > size) flush();
        if (!current) start = offset;
        if (!atomic && block.length > size) {
            let at = 0;
            while (at < block.length) {
                let end = Math.min(at + size, block.length);
                if (end < block.length) { const space = block.lastIndexOf(' ', end); if (space > at + size / 2) end = space + 1; if (/[\uD800-\uDBFF]/.test(block[end - 1])) end--; }
                chunks.push({ id: String(chunks.length), text: block.slice(at, end), start: offset + at, end: offset + end }); at = end;
            }
        } else current += block;
        offset += block.length;
    }
    flush(); return chunks;
}

const tokens = text => String(text || '').toLowerCase().match(/[\p{L}\p{N}_]+/gu) || [];
export function rankChunks(chunks, query) {
    const terms = [...new Set(tokens(query))];
    const documents = chunks.map(chunk => tokens(chunk.text));
    const average = documents.reduce((sum, doc) => sum + doc.length, 0) / Math.max(1, documents.length);
    const frequencies = new Map(terms.map(term => [term, documents.filter(doc => doc.includes(term)).length]));
    return chunks.map((chunk, index) => {
        const doc = documents[index]; const counts = new Map(); for (const term of doc) counts.set(term, (counts.get(term) || 0) + 1);
        const score = terms.reduce((sum, term) => { const count = counts.get(term) || 0; const df = frequencies.get(term); return sum + Math.log(1 + (chunks.length - df + 0.5) / (df + 0.5)) * count * 2.2 / (count + 1.2 * (0.25 + 0.75 * doc.length / Math.max(1, average))); }, 0);
        return { ...chunk, score };
    }).sort((a, b) => b.score - a.score || Number(b.id) - Number(a.id));
}

export function selectDocumentText(text, query, budget = 30000, semanticRanking = null) {
    if (text.length <= budget) return { text, coverage: 1, partial: false, chunks: chunkText(text) };
    const chunks = chunkText(text);
    const ranked = semanticRanking || rankChunks(chunks, query);
    const selected = []; let used = 0;
    // Reserve coverage across the source, including its beginning and end. A broad
    // request with no specific matches must not accidentally select only the end.
    const slots = Math.max(2, Math.floor(budget / 2400 * (ranked.some(row => row.score > 0) ? 0.3 : 1)));
    for (let index = 0; index < slots; index++) {
        const chunk = chunks[Math.round(index * (chunks.length - 1) / (slots - 1))];
        if (chunk && !selected.includes(chunk) && used + chunk.text.length <= budget) { selected.push(chunk); used += chunk.text.length; }
    }
    for (const chunk of ranked) { if (!selected.some(row => row.id === chunk.id) && used + chunk.text.length <= budget) { selected.push(chunk); used += chunk.text.length; } }
    selected.sort((a, b) => a.start - b.start);
    return { text: `[Selected passages: ${Math.round(used / text.length * 100)}% of the source. This is not the entire document.]\n\n` + selected.map(chunk => `[Source characters ${chunk.start}–${chunk.end}]\n${chunk.text}`).join('\n\n'), coverage: used / text.length, partial: true, chunks };
}
