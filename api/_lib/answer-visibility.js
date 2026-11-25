import { verifyArithmeticClaims } from './arithmetic.js';
export function createAnswerFilter(onThought = null) {
    let buffer = '', hidden = false;
    const open = '<think>', close = '</think>';
    const emitThought = typeof onThought === 'function' ? onThought : null;
    return {
        push(text) {
            buffer += String(text || ''); let output = ''; let thoughtOut = '';
            while (buffer) {
                const tag = hidden ? close : open, index = buffer.toLowerCase().indexOf(tag);
                if (index >= 0) {
                    const part = buffer.slice(0, index);
                    if (hidden) thoughtOut += part; else output += part;
                    buffer = buffer.slice(index + tag.length); hidden = !hidden; continue;
                }
                let keep = 0;
                for (let length = 1; length < tag.length; length++) if (buffer.toLowerCase().endsWith(tag.slice(0, length))) keep = length;
                const safeSlice = buffer.slice(0, buffer.length - keep);
                if (hidden) thoughtOut += safeSlice; else output += safeSlice;
                buffer = keep ? buffer.slice(-keep) : ''; break;
            }
            if (thoughtOut && emitThought) emitThought(thoughtOut);
            return output;
        },
        // Flush any remaining buffered content at stream end.
        // Buffered partial <think> tags that never closed are discarded (they're CoT);
        // non-hidden buffered content is emitted as output.
        flush() {
            if (!buffer) return '';
            const remaining = buffer;
            buffer = '';
            if (hidden) {
                // We were inside a <think> block that never closed — discard as CoT
                if (emitThought) emitThought(remaining);
                return '';
            }
            // We were in visible output — emit it
            return remaining;
        }
    };
}
export function publicAnswer(payload) {
    if (!payload || typeof payload !== 'object') return payload;
    const result = { ...payload };
    for (const key of ['thought', 'reasoning', 'reasoning_content']) delete result[key];
    const stripThink = s => s.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '').trim();
    if (typeof result.response === 'string') {
        result.response = stripThink(result.response);
        result.verification = verifyArithmeticClaims(result.response);
    }
    // Also strip CoT from result.text to prevent <think> blocks leaking via SSE text field
    if (typeof result.text === 'string') {
        result.text = stripThink(result.text);
    }
    if (result.selfHealing?.thought) { result.selfHealing = { ...result.selfHealing }; delete result.selfHealing.thought; }
    return result;
}
