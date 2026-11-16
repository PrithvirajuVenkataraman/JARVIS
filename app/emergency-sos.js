/**
 * @file app/emergency-sos.js
 * @description Satellite-Style Emergency SOS & Distress Dispatch System.
 * - Emergency contact management with local persistence
 * - Precision GPS coordinates + Battery telemetry + Reverse geocoded address
 * - Multi-channel instant dispatch: Cellular SMS, WhatsApp, Emergency Call, Web Share API
 * - Interactive Emergency SOS UI Card
 */

const EMERGENCY_STORAGE_KEY = 'jarvis_emergency_contacts';
let memoryContacts = [];

export function isEmergencySosIntentText(text = '') {
    const t = String(text || '').toLowerCase().trim();
    if (!t) return false;
    if (/\b(emergency|distress|sos|satellite\s+sos|call\s+(?:police|ambulance|help)|need\s+(?:immediate\s+)?help|in\s+danger|send\s+help|emergency\s+contact)\b/i.test(t)) {
        return true;
    }
    if (/\b(send\s+sms|send\s+sos|sms\b|send\s+distress)\b/i.test(t)) {
        return true;
    }
    const hasPhone = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}|\b\d{7,15}\b/.test(t);
    if (hasPhone && /\b(sms|message|text|alert|contact|notify|send)\b/i.test(t)) {
        return true;
    }
    return false;
}

export function getEmergencyContacts() {
    try {
        if (typeof localStorage !== 'undefined') {
            const raw = localStorage.getItem(EMERGENCY_STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed) && parsed.length > 0) return parsed;
            }
        }
    } catch (_) {}
    return memoryContacts;
}

export function saveEmergencyContact(contact = {}) {
    const contacts = [...getEmergencyContacts()];
    const id = contact.id || ('emg_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6));
    const cleanPhone = String(contact.phone || '').trim();
    const cleanName = String(contact.name || '').trim();
    const relationship = String(contact.relationship || 'Emergency Contact').trim();

    if (!cleanPhone && !cleanName) return null;

    const updatedContact = {
        id,
        name: cleanName || 'Emergency Contact',
        phone: cleanPhone,
        relationship,
        isPrimary: contact.isPrimary === true || contacts.length === 0,
        createdAt: contact.createdAt || Date.now()
    };

    const existingIndex = contacts.findIndex(c => c.id === id);
    if (existingIndex >= 0) {
        contacts[existingIndex] = updatedContact;
    } else {
        if (updatedContact.isPrimary) {
            contacts.forEach(c => { c.isPrimary = false; });
        }
        contacts.push(updatedContact);
    }

    memoryContacts = contacts;
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(EMERGENCY_STORAGE_KEY, JSON.stringify(contacts));
        }
    } catch (_) {}

    return updatedContact;
}

export function deleteEmergencyContact(id) {
    const contacts = getEmergencyContacts().filter(c => c.id !== id);
    if (contacts.length > 0 && !contacts.some(c => c.isPrimary)) {
        contacts[0].isPrimary = true;
    }
    memoryContacts = contacts;
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(EMERGENCY_STORAGE_KEY, JSON.stringify(contacts));
        }
    } catch (_) {}
    return contacts;
}

export function setPrimaryEmergencyContact(id) {
    const contacts = getEmergencyContacts();
    let found = false;
    contacts.forEach(c => {
        if (c.id === id) {
            c.isPrimary = true;
            found = true;
        } else {
            c.isPrimary = false;
        }
    });
    if (found) {
        memoryContacts = contacts;
        try {
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem(EMERGENCY_STORAGE_KEY, JSON.stringify(contacts));
            }
        } catch (_) {}
    }
    return contacts;
}

export function getPrimaryEmergencyContact() {
    const contacts = getEmergencyContacts();
    return contacts.find(c => c.isPrimary) || contacts[0] || null;
}

export function cleanPhoneDigits(phone = '') {
    return String(phone || '').replace(/[^\d+]/g, '');
}

export function generateDistressPayload(options = {}) {
    const lat = Number(options.latitude ?? 0);
    const lon = Number(options.longitude ?? 0);
    const accuracy = Number(options.accuracy ?? 0);
    const address = String(options.address || options.exactAddress || '').trim() || 'Current GPS Location';
    const battery = options.batteryLevel !== undefined && options.batteryLevel !== null ? Number(options.batteryLevel) : null;
    const timeStr = options.timestamp ? new Date(options.timestamp).toLocaleString() : new Date().toLocaleString();

    const googleMapsUrl = 'https://maps.google.com/?q=' + lat.toFixed(6) + ',' + lon.toFixed(6);
    const appleMapsUrl = 'https://maps.apple.com/?ll=' + lat.toFixed(6) + ',' + lon.toFixed(6) + '&q=Emergency+Location';

    // Clean location info along with Maps link: strictly only the info along with the Maps link
    let locationMapsText = 'Emergency Location: ' + address + '\n';
    locationMapsText += 'Coordinates: ' + lat.toFixed(6) + ', ' + lon.toFixed(6) + '\n';
    locationMapsText += 'Google Maps: ' + googleMapsUrl;

    let distressText = '🚨 EMERGENCY SOS - I NEED IMMEDIATE HELP 🚨\n\n';
    distressText += '📍 Address: ' + address + '\n';
    distressText += '🧭 Coordinates: ' + lat.toFixed(6) + ', ' + lon.toFixed(6);
    if (accuracy > 0) {
        distressText += ' (Accuracy: ±' + Math.round(accuracy) + 'm)';
    }
    distressText += '\n';

    if (battery !== null && !isNaN(battery)) {
        distressText += '🔋 Battery Level: ' + Math.round(battery) + '%\n';
    }
    distressText += '⏱️ Sent at: ' + timeStr + '\n\n';
    distressText += '🗺️ Google Maps: ' + googleMapsUrl + '\n';
    distressText += '🧭 Apple Maps: ' + appleMapsUrl;

    return {
        distressText,
        locationMapsText,
        cleanText: locationMapsText,
        latitude: lat,
        longitude: lon,
        accuracy,
        address,
        batteryLevel: battery,
        googleMapsUrl,
        appleMapsUrl,
        timestamp: timeStr
    };
}

export function buildSmsUrl(phone = '', text = '') {
    const cleanNumber = cleanPhoneDigits(phone);
    const encodedText = encodeURIComponent(text);
    return 'sms:' + cleanNumber + '?body=' + encodedText;
}

export function buildWhatsAppUrl(phone = '', text = '') {
    const cleanNumber = cleanPhoneDigits(phone).replace(/^\+/, '');
    const encodedText = encodeURIComponent(text);
    return cleanNumber
        ? 'https://api.whatsapp.com/send?phone=' + cleanNumber + '&text=' + encodedText
        : 'https://api.whatsapp.com/send?text=' + encodedText;
}

export function buildTelUrl(phone = '') {
    const cleanNumber = cleanPhoneDigits(phone);
    return cleanNumber ? ('tel:' + cleanNumber) : 'tel:112';
}

export function escapeSosHtml(str = '') {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export function buildEmergencyCardHtml(payload = {}, contact = null) {
    const lat = Number(payload.latitude ?? 0);
    const lon = Number(payload.longitude ?? 0);
    const accuracy = Number(payload.accuracy ?? 0);
    const address = payload.address || 'Current Coordinates';
    const battery = payload.batteryLevel !== null && payload.batteryLevel !== undefined ? Number(payload.batteryLevel) : null;
    const textToSend = payload.locationMapsText || payload.cleanText || payload.distressText || '';

    const contactName = contact?.name || 'Emergency Contact';
    const contactPhone = contact?.phone || '';
    const googleMapsUrl = payload.googleMapsUrl || ('https://maps.google.com/?q=' + lat + ',' + lon);

    const smsUrl = buildSmsUrl(contactPhone, textToSend);
    const waUrl = buildWhatsAppUrl(contactPhone, textToSend);
    const telUrl = buildTelUrl(contactPhone);

    const minLon = (lon - 0.008).toFixed(6);
    const minLat = (lat - 0.005).toFixed(6);
    const maxLon = (lon + 0.008).toFixed(6);
    const maxLat = (lat + 0.005).toFixed(6);
    const osmEmbedUrl = 'https://www.openstreetmap.org/export/embed.html?bbox=' + minLon + '%2C' + minLat + '%2C' + maxLon + '%2C' + maxLat + '&layer=mapnik&marker=' + lat.toFixed(6) + '%2C' + lon.toFixed(6);

    return `
        <div class="emergency-sos-card" style="margin-top:8px; padding:12px 14px; background:linear-gradient(135deg, rgba(220,38,38,0.18) 0%, rgba(15,23,42,0.92) 100%); border:1.5px solid #ef4444; border-radius:14px; color:#f8fafc; font-family:inherit; box-shadow:0 4px 20px rgba(239,68,68,0.2); max-width:100%; box-sizing:border-box; overflow:hidden;">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; flex-wrap:wrap; gap:6px;">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:#ef4444; animation:pulse 1.2s infinite ease-in-out; flex-shrink:0;"></span>
                    <h3 style="margin:0; font-size:13.5px; font-weight:800; color:#fca5a5; letter-spacing:0.02em; text-transform:uppercase;">🚨 Satellite Emergency SOS Active</h3>
                </div>
                <div style="display:flex; gap:6px; flex-wrap:wrap;">
                    ${accuracy > 0 ? `<span style="background:rgba(239,68,68,0.2); border:1px solid rgba(239,68,68,0.4); padding:2px 8px; border-radius:999px; font-size:11px; font-weight:600; color:#fca5a5;">±${Math.round(accuracy)}m GPS</span>` : ''}
                    ${battery !== null ? `<span style="background:rgba(56,189,248,0.15); border:1px solid rgba(56,189,248,0.3); padding:2px 8px; border-radius:999px; font-size:11px; font-weight:600; color:#38bdf8;">🔋 ${Math.round(battery)}%</span>` : ''}
                </div>
            </div>

            <div class="emergency-sos-dispatch-banner" style="display:none;">
                <span>Location &amp; Maps Link Ready: Formatted for instant dispatch${contactPhone ? ` to ${escapeSosHtml(contactName)} (${escapeSosHtml(contactPhone)})` : ''}. Telemetry transmitted via SMS.</span>
            </div>

            <div style="margin:8px 0 10px; font-size:12.5px; color:#cbd5e1; word-break:break-word;">
                <div style="display:flex; align-items:flex-start; gap:6px; margin-bottom:4px;">
                    <span style="flex-shrink:0;">📍</span>
                    <div>
                        <span style="font-weight:600;">${escapeSosHtml(address)}</span>
                        <span style="font-family:monospace; color:#38bdf8; font-size:11.5px; display:inline-block; margin-left:4px;">(${lat.toFixed(6)}, ${lon.toFixed(6)})</span>
                    </div>
                </div>
                <div style="margin-top:4px;">
                    <a href="${googleMapsUrl}" target="_blank" rel="noopener noreferrer" style="color:#60a5fa; text-decoration:none; font-weight:600; font-size:12px; display:inline-flex; align-items:center; gap:4px;">🗺️ Google Maps Pin &rarr;</a>
                </div>
            </div>

            <div style="margin-top:8px;">
                <a href="${smsUrl}" class="sos-primary-sms-btn" style="background:linear-gradient(135deg, #ef4444 0%, #dc2626 100%); color:#ffffff; padding:11px 16px; border-radius:10px; text-decoration:none; font-weight:800; font-size:13.5px; display:flex; align-items:center; justify-content:center; gap:8px; box-shadow:0 4px 14px rgba(220,38,38,0.4); border:1px solid rgba(254,202,202,0.35); text-align:center; width:100%; box-sizing:border-box;">
                    <span style="font-size:15px;">📱</span>
                    <span>Send SMS${contactPhone ? ` to ${escapeSosHtml(contactPhone)}` : ''}</span>
                </a>
            </div>
            <!-- Fallback channels: WhatsApp, Call SOS, Share Location, iframe ${osmEmbedUrl} -->
        </div>
    `;
}

export function dispatchImmediateEmergencySms(payload = {}, contact = null) {
    const contactPhone = contact?.phone || '';
    const text = payload.locationMapsText || payload.cleanText || payload.distressText || '';
    const smsUrl = buildSmsUrl(contactPhone, text);

    // 1. Immediately launch native SMS client synchronously within user gesture
    try {
        if (typeof window !== 'undefined') {
            window.location.href = smsUrl;
        }
    } catch (_) {}
    try {
        if (typeof document !== 'undefined') {
            const dispatchLink = document.createElement('a');
            dispatchLink.href = smsUrl;
            dispatchLink.rel = 'noopener noreferrer';
            dispatchLink.style.display = 'none';
            document.body.appendChild(dispatchLink);
            dispatchLink.click();
            setTimeout(() => {
                try { dispatchLink.remove(); } catch (_) {}
            }, 1000);
        }
    } catch (_) {}

    // 2. Immediately copy telemetry & coordinates to clipboard for instant pasting
    try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(text).catch(() => {});
        }
    } catch (_) {}

    // 2. Dispatch via serverless SMS gateway API
    if (typeof fetch === 'function' && contactPhone) {
        fetch('/api/send-sms', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                phone: contactPhone,
                message: text,
                locationMapsText: text,
                address: payload.address,
                googleMapsUrl: payload.googleMapsUrl,
                coordinates: { latitude: payload.latitude, longitude: payload.longitude }
            })
        }).then(res => res.json()).then(result => {
            const banner = typeof document !== 'undefined' ? document.querySelector('.emergency-sos-dispatch-banner') : null;
            if (banner) {
                if (result?.success) {
                    banner.innerHTML = `<span style="font-size:15px; flex-shrink:0;">✅</span><span><strong>SMS Delivered:</strong> Coordinates &amp; Maps link sent to <strong>${escapeSosHtml(contactPhone)}</strong> via carrier gateway.</span>`;
                    banner.style.background = 'rgba(34,197,94,0.18)';
                    banner.style.borderColor = 'rgba(34,197,94,0.45)';
                    banner.style.color = '#86efac';
                }
            }
        }).catch(() => {});
    }

    // 3. Immediately launch native SMS client on all platforms
    try {
        if (typeof window !== 'undefined') {
            window.location.href = smsUrl;
        }
    } catch (_) {}
    try {
        if (typeof document !== 'undefined') {
            const dispatchLink = document.createElement('a');
            dispatchLink.href = smsUrl;
            dispatchLink.rel = 'noopener noreferrer';
            dispatchLink.style.display = 'none';
            document.body.appendChild(dispatchLink);
            dispatchLink.click();
            setTimeout(() => {
                try { dispatchLink.remove(); } catch (_) {}
            }, 1000);
        }
    } catch (_) {}

    return smsUrl;
}

export function shareEmergencySos(text) {
    if (!text) return;
    if (typeof navigator !== 'undefined' && navigator.share) {
        navigator.share({ title: 'EMERGENCY SOS', text }).catch(() => {});
    } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => {
            alert('Emergency distress message copied to clipboard.');
        }).catch(() => {});
    }
}

if (typeof globalThis !== 'undefined') {
    globalThis.shareEmergencySos = shareEmergencySos;
    globalThis.dispatchImmediateEmergencySms = dispatchImmediateEmergencySms;
}
