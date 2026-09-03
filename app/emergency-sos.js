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
    const text = payload.distressText || '';

    const contactName = contact?.name || 'Emergency Contacts';
    const contactPhone = contact?.phone || '';

    const smsUrl = buildSmsUrl(contactPhone, text);
    const waUrl = buildWhatsAppUrl(contactPhone, text);
    const telUrl = buildTelUrl(contactPhone);

    const minLon = (lon - 0.008).toFixed(6);
    const minLat = (lat - 0.005).toFixed(6);
    const maxLon = (lon + 0.008).toFixed(6);
    const maxLat = (lat + 0.005).toFixed(6);
    const osmEmbedUrl = 'https://www.openstreetmap.org/export/embed.html?bbox=' + minLon + '%2C' + minLat + '%2C' + maxLon + '%2C' + maxLat + '&layer=mapnik&marker=' + lat.toFixed(6) + '%2C' + lon.toFixed(6);

    return `
        <div class="emergency-sos-card" style="margin-top:8px; padding:18px; background:linear-gradient(135deg, rgba(220,38,38,0.2) 0%, rgba(15,23,42,0.85) 100%); border:2px solid #ef4444; border-radius:16px; color:#f8fafc; font-family:inherit; box-shadow:0 0 30px rgba(239,68,68,0.25);">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; flex-wrap:wrap; gap:8px;">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="display:inline-block; width:12px; height:12px; border-radius:50%; background:#ef4444; animation:pulse 1.2s infinite ease-in-out;"></span>
                    <h3 style="margin:0; font-size:16px; font-weight:800; color:#fca5a5; letter-spacing:0.02em; text-transform:uppercase;">🚨 Satellite Emergency SOS Active</h3>
                </div>
                <div style="display:flex; gap:6px;">
                    ${accuracy > 0 ? `<span style="background:rgba(239,68,68,0.2); border:1px solid rgba(239,68,68,0.4); padding:2px 8px; border-radius:999px; font-size:11px; font-weight:600; color:#fca5a5;">±${Math.round(accuracy)}m GPS</span>` : ''}
                    ${battery !== null ? `<span style="background:rgba(56,189,248,0.15); border:1px solid rgba(56,189,248,0.3); padding:2px 8px; border-radius:999px; font-size:11px; font-weight:600; color:#38bdf8;">🔋 ${Math.round(battery)}%</span>` : ''}
                </div>
            </div>

            <div style="background:rgba(0,0,0,0.35); border:1px solid rgba(239,68,68,0.25); border-radius:10px; padding:12px; margin-bottom:14px;">
                <div style="font-size:13px; color:#e2e8f0; line-height:1.5; margin-bottom:6px;">
                    <strong>Emergency Location:</strong> ${escapeSosHtml(address)}
                </div>
                <div style="font-size:12px; color:#94a3b8; font-family:monospace;">
                    Coordinates: <strong>${lat.toFixed(6)}, ${lon.toFixed(6)}</strong>
                </div>
                ${contactPhone ? `<div style="font-size:12px; color:#fca5a5; margin-top:6px;">Target Contact: <strong>${escapeSosHtml(contactName)}</strong> (${escapeSosHtml(contactPhone)})</div>` : ''}
            </div>

            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:8px; margin-bottom:14px;">
                <a href="${smsUrl}" target="_blank" rel="noopener noreferrer" style="background:#dc2626; color:#ffffff; padding:10px 12px; border-radius:8px; text-decoration:none; font-weight:700; font-size:13px; display:flex; align-items:center; justify-content:center; gap:6px; box-shadow:0 2px 10px rgba(220,38,38,0.4);">
                    <span>📱</span>
                    <span>Send SMS</span>
                </a>
                <a href="${waUrl}" target="_blank" rel="noopener noreferrer" style="background:#16a34a; color:#ffffff; padding:10px 12px; border-radius:8px; text-decoration:none; font-weight:700; font-size:13px; display:flex; align-items:center; justify-content:center; gap:6px; box-shadow:0 2px 10px rgba(22,163,74,0.4);">
                    <span>💬</span>
                    <span>WhatsApp</span>
                </a>
                <a href="${telUrl}" style="background:#2563eb; color:#ffffff; padding:10px 12px; border-radius:8px; text-decoration:none; font-weight:700; font-size:13px; display:flex; align-items:center; justify-content:center; gap:6px; box-shadow:0 2px 10px rgba(37,99,235,0.4);">
                    <span>📞</span>
                    <span>Call SOS</span>
                </a>
                <button type="button" onclick="if(navigator.share){navigator.share({title:'EMERGENCY SOS',text:${JSON.stringify(text)}});}else{navigator.clipboard.writeText(${JSON.stringify(text)});alert('Emergency distress message copied to clipboard.');}" style="background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.2); color:#ffffff; padding:10px 12px; border-radius:8px; font-weight:600; font-size:13px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px;">
                    <span>📤</span>
                    <span>Share Location</span>
                </button>
            </div>

            <div style="border-radius:10px; overflow:hidden; border:1px solid rgba(239,68,68,0.3); margin-top:8px;">
                <iframe
                    src="${osmEmbedUrl}"
                    width="100%"
                    height="200"
                    style="border:0; display:block; filter:contrast(1.05) brightness(0.9);"
                    loading="lazy"
                    title="Emergency Location Pin">
                </iframe>
            </div>

            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px; font-size:12px; color:#94a3b8; flex-wrap:wrap; gap:8px;">
                <span>Navigation Links:</span>
                <div style="display:flex; gap:12px;">
                    <a href="${payload.googleMapsUrl || ('https://maps.google.com/?q=' + lat + ',' + lon)}" target="_blank" rel="noopener noreferrer" style="color:#38bdf8; text-decoration:none; font-weight:600;">Google Maps</a>
                    <a href="${payload.appleMapsUrl || ('https://maps.apple.com/?ll=' + lat + ',' + lon)}" target="_blank" rel="noopener noreferrer" style="color:#38bdf8; text-decoration:none; font-weight:600;">Apple Maps</a>
                </div>
            </div>
        </div>
    `;
}
