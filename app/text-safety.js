import { scanDlp } from './dlp-engine.js';
export function hasCredentials(text) {
    for (let at = 0; at < text.length; at += 30000) {
        if (scanDlp(text.slice(Math.max(0, at - 512), at + 30512), { maskPii: false }).decision === 'BLOCK') return true;
    }
    return false;
}
