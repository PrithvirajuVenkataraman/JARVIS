import { isCasualConversationQuery } from './frontend-routing.js';

export function getInstantReply(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    const lower = raw.toLowerCase();

    if (isCasualConversationQuery(raw)) {
        if (/\b(how are you|how are you doing|how you doing|how is your day|how's your day)\b/.test(lower)) {
            return 'I am doing well, thanks for asking. What would you like help with?';
        }
        if (/^(thanks|thank you|thank u|appreciate it)\b/.test(lower)) {
            return 'You are welcome.';
        }
        if (/^(hi|hello|hey|yo|sup|good morning|good afternoon|good evening)\b/.test(lower)) {
            return 'Hello. How can I help you today?';
        }
    }

    if (/^what can you do\??$/i.test(lower)) {
        return 'I am JARVIS - a live-fact and vision helper. I can check current sources, read your camera or attachments, remember what you save, verify answers, and help with planning or fixes from screenshots.';
    }

    if (/^(i see|oh i see|ah i see|got it|gotcha|makes sense|understood|oh okay|oh ok)\.?$/i.test(lower)) {
        return 'Got it. What would you like to do next?';
    }

    if (/^(are you there|you there)\??$/i.test(lower)) {
        return 'Yes, I am here.';
    }

    return null;
}
