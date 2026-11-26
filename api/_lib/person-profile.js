import { personPhotoSubject } from '../../app/person-photo-query.js';
import { resolvePersonProfile, metadataText } from './person-photos.js';

function literalMarkdown(text) {
    return String(text).replace(/\\/g, '\\\\').replace(/[[\]`*_<>:{}~]/g, character => `\\${character}`);
}

export async function personProfileReply(message, options = {}) {
    if (options.isWebForced || options.webMode === 'force' || options.images?.length || options.grounding?.kind || options.grounding?.selectedText || options.grounding?.sourceAnswer || !['chat', 'pop_culture_reference', 'fast_simple', ''].includes(String(options.intent || ''))) return null;
    const subject = personPhotoSubject(message);
    if (!subject.query || !subject.role) return null;
    const profile = await resolvePersonProfile(subject.query, { signal: options.signal });
    const unavailable = { success: true, intent: 'person_profile_unavailable', response: 'I could not verify this profile from available sources. Please check the full name or try again shortly.', sourceBased: false, failureCode: 'profile_source_unavailable', provider: 'public_sources', sources: [] };
    if (!profile?.extract) return unavailable;
    let url;
    try { url = new URL(profile.source?.url); } catch { return unavailable; }
    if (url.protocol !== 'https:' || url.hostname !== 'en.wikipedia.org' || !url.pathname.startsWith('/wiki/')) return unavailable;
    let excerpt = metadataText(profile.extract, 1400);
    if (/(?:\.{3}|…)$/.test(excerpt)) {
        const complete = excerpt.replace(/(?:\.{3}|…)$/, '').match(/^[\s\S]*[.!?]["”’']?(?=\s)/)?.[0];
        if (complete) excerpt = complete.trim();
    }
    if (!excerpt) return unavailable;
    // Render the retrieved excerpt itself, without unsupported generated additions.
    const text = literalMarkdown(excerpt);
    const link = url.href.replace(/\(/g, '%28').replace(/\)/g, '%29');
    return { success: true, intent: 'person_profile', response: `${text}\n\n[Source: Wikipedia — ${literalMarkdown(profile.name)}](${link})`, sourceBased: true, provider: 'public_sources', sources: [{ id: 1, title: profile.name, url: url.href }], profileEntityId: profile.wikidataId };
}
