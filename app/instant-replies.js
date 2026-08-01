import { isCasualConversationQuery } from './frontend-routing.js';

const CAPABILITY_REPLIES = Object.freeze({
    tamil: 'Yes, I can understand Tamil in text. Voice transcription depends on your browser, but you can type or speak and I will do my best.',
    default: 'Yes, I can help with that when it is within my supported features.'
});

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
        return 'I am JARVIS — a live-fact and vision helper. I can check current sources, read your camera or attachments, remember what you save, verify answers, and help with planning or fixes from screenshots.';
    }

    if (/^do you understand tamil\??$/i.test(lower)) {
        return CAPABILITY_REPLIES.tamil;
    }

    if (/^(are you there|you there)\??$/i.test(lower)) {
        return 'Yes, I am here.';
    }

    return null;
}
 
