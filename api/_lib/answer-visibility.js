import { verifyArithmeticClaims } from './arithmetic.js';
export function createAnswerFilter() {
    let buffer = '', hidden = false;
    const open = '<think>', close = '</think>';
    return {
        push(text) {
            buffer += String(text || ''); let output = '';
            while (buffer) {
                const tag = hidden ? close : open, index = buffer.toLowerCase().indexOf(tag);
                if (index >= 0) { if (!hidden) output += buffer.slice(0, index); buffer = buffer.slice(index + tag.length); hidden = !hidden; continue; }
                let keep = 0;
                for (let length = 1; length < tag.length; length++) if (buffer.toLowerCase().endsWith(tag.slice(0, length))) keep = length;
                if (!hidden) output += buffer.slice(0, buffer.length - keep);
                buffer = keep ? buffer.slice(-keep) : ''; break;
            }
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
