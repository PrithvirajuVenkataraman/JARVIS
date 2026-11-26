import { resolvePersonPhotoRequest } from './person-photo-query.js';

let epoch = 0;
const stamps = new WeakMap();
const attempted = new WeakSet();
const pending = new Map();

export function track(row) { if (row && !stamps.has(row)) stamps.set(row, epoch); }
export function cancelAll() { epoch++; for (const controller of pending.values()) controller.abort(); pending.clear(); }

function publicImage(value) {
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
        const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
        if (!host || !host.includes('.')) return false;
        if (/^(?:localhost|127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|0\.|169\.254\.|::1$|fc|fd|fe80)|(?:^|\.)(?:localhost|local|internal|invalid)$/i.test(host)) return false;
        return true;
    } catch { return false; }
}

export async function enrich(row, input, options = {}) {
    const reqSpec = resolvePersonPhotoRequest(input, options);
    const query = reqSpec?.query || '';
    if (!row?.isConnected || !query || attempted.has(row) || options.failureCode) return;
    track(row);
    const stamp = stamps.get(row);
    if (stamp !== epoch) return;
    attempted.add(row);
    const controller = new AbortController();
    pending.set(row, controller);
    const timer = setTimeout(() => controller.abort(), 14000);
    const image = new Image();
    const abortImage = () => { image.removeAttribute('src'); };
    controller.signal.addEventListener('abort', abortImage, { once: true });
    try {
        const payload = { action: 'person_photo', query };
        if (reqSpec.resolvedName) payload.resolvedName = reqSpec.resolvedName;
        if (reqSpec.contextHint) payload.contextHint = reqSpec.contextHint;
        const response = await fetch('/api/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal });
        if (!response.ok) return;
        const data = await response.json();
        const entity = data?.entity;
        const photo = entity?.image;
        if (!entity?.isPerson || !publicImage(photo?.url) || !publicImage(photo?.sourceUrl)) return;
        image.className = 'person-photo-image';
        image.alt = String(entity.name || query);
        image.decoding = 'async'; image.referrerPolicy = 'no-referrer';
        if (Number(photo.width) > 0 && Number(photo.height) > 0) { image.width = Number(photo.width); image.height = Number(photo.height); }
        image.src = photo.url;
        await image.decode();
        if (controller.signal.aborted || stamp !== epoch || !row.isConnected || !image.naturalWidth) return;
        const bubble = row.querySelector('.chat-bubble-assistant');
        const answer = bubble?.querySelector('.assistant-message-text');
        if (!answer || !answer.textContent?.trim()) return;
        const figure = document.createElement('figure'); figure.className = 'person-photo';
        const link = document.createElement('a'); link.href = photo.sourceUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.append(image);
        figure.append(link);
        const caption = document.createElement('figcaption');
        const source = document.createElement('a'); source.href = photo.sourceUrl; source.target = '_blank'; source.rel = 'noopener noreferrer'; source.textContent = String(photo.sourceName || 'Image source');
        const date = /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(photo.imageDate || '') ? photo.imageDate : '';
        caption.append(document.createTextNode(date ? `Image dated ${date} · ` : 'Reference portrait · '), source);
        const attribution = [photo.author, photo.license].filter(Boolean).join(' · ');
        if (attribution) { const credit = document.createElement('span'); credit.className = 'person-photo-credit'; credit.textContent = attribution; caption.append(credit); }
        figure.append(caption);
        let container = bubble.querySelector('.chat-entity-visual-container');
        if (!container) { container = document.createElement('div'); container.className = 'chat-entity-visual-container'; answer.before(container); }
        const related = [...container.children].filter(child => !child.matches('.entity-hero-card, .person-photo'));
        container.replaceChildren(figure, ...related);
    } catch { /* Optional images never replace a successful answer with an error. */ }
    finally { clearTimeout(timer); controller.signal.removeEventListener('abort', abortImage); if (pending.get(row) === controller) pending.delete(row); }
}

export function install() {
    for (const name of ['sendTextInput', 'startNewChatSession', 'restoreChatSession', 'stopActiveGeneration']) {
        const original = window[name];
        if (typeof original !== 'function') continue;
        window[name] = function (...args) {
            cancelAll();
            return original.apply(this, args);
        };
    }
    window.addEventListener('pagehide', cancelAll);
}
