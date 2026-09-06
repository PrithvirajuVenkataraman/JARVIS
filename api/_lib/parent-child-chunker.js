/**
 * Parent-Child & Hierarchical Context Chunker for Enterprise Production RAG
 * - Generates granular child spans (100-200 chars) for high-precision retrieval matching
 * - Expands matched child hits to surrounding parent blocks (500-800 chars) for LLM context
 * - Prevents "Lost in the Middle" degradation and eliminates context window bloat
 */

const DEFAULT_PARENT_SIZE = 650;
const DEFAULT_PARENT_OVERLAP = 100;
const DEFAULT_CHILD_SIZE = 150;
const DEFAULT_CHILD_OVERLAP = 30;

export function buildParentChildChunks(documentText, metadata = {}, options = {}) {
    const raw = String(documentText || '').replace(/\s+/g, ' ').trim();
    if (!raw) return [];

    const parentSize = Math.max(300, Math.min(1500, Number(options.parentSize) || DEFAULT_PARENT_SIZE));
    const parentOverlap = Math.max(0, Math.min(200, Number(options.parentOverlap) || DEFAULT_PARENT_OVERLAP));
    const childSize = Math.max(80, Math.min(300, Number(options.childSize) || DEFAULT_CHILD_SIZE));
    const childOverlap = Math.max(0, Math.min(60, Number(options.childOverlap) || DEFAULT_CHILD_OVERLAP));

    const parents = [];
    let pIdx = 0;
    let parentCount = 0;

    while (pIdx < raw.length && parentCount < (options.maxParents || 20)) {
        const pSlice = raw.slice(pIdx, pIdx + parentSize);
        const pBoundary = pSlice.length === parentSize ? Math.max(pSlice.lastIndexOf('. '), pSlice.lastIndexOf(' ')) : pSlice.length;
        const pEnd = pBoundary > parentSize * 0.6 ? pIdx + pBoundary + 1 : pIdx + pSlice.length;
        const parentText = raw.slice(pIdx, pEnd).trim();

        if (parentText) {
            const parentId = `parent_${metadata.url || metadata.id || 'doc'}_${parentCount}`;
            const children = [];
            let cIdx = 0;
            let childCount = 0;

            while (cIdx < parentText.length && childCount < 10) {
                const cSlice = parentText.slice(cIdx, cIdx + childSize);
                const cBoundary = cSlice.length === childSize ? Math.max(cSlice.lastIndexOf('. '), cSlice.lastIndexOf(' ')) : cSlice.length;
                const cEnd = cBoundary > childSize * 0.6 ? cIdx + cBoundary + 1 : cIdx + cSlice.length;
                const childText = parentText.slice(cIdx, cEnd).trim();

                if (childText) {
                    children.push({
                        childId: `${parentId}_c${childCount}`,
                        parentId,
                        text: childText,
                        parentText,
                        metadata: { ...metadata, parentId }
                    });
                    childCount += 1;
                }

                if (cEnd >= parentText.length) break;
                cIdx = Math.max(cEnd - childOverlap, cIdx + 1);
            }

            parents.push({
                parentId,
                parentText,
                children,
                metadata: { ...metadata, parentId }
            });
            parentCount += 1;
        }

        if (pEnd >= raw.length) break;
        pIdx = Math.max(pEnd - parentOverlap, pIdx + 1);
    }

    return parents;
}

export function expandChildMatchesToParentContext(childMatches = []) {
    const parentMap = new Map();
    for (const match of childMatches) {
        const parentId = match?.parentId || match?.metadata?.parentId;
        const parentText = match?.parentText || match?.text;
        if (!parentId || parentMap.has(parentId)) continue;
        parentMap.set(parentId, {
            ...match,
            text: parentText,
            expandedFromChild: true
        });
    }
    return Array.from(parentMap.values());
}
