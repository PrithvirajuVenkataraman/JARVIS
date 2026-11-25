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
        }
    };
}
export function publicAnswer(payload) {
    if (!payload || typeof payload !== 'object') return payload;
    const result = { ...payload };
    for (const key of ['thought', 'reasoning', 'reasoning_content']) delete result[key];
    if (typeof result.response === 'string') {
        result.response = result.response.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '').trim();
        result.verification = verifyArithmeticClaims(result.response);
    }
    if (result.selfHealing?.thought) { result.selfHealing = { ...result.selfHealing }; delete result.selfHealing.thought; }
    return result;
}
