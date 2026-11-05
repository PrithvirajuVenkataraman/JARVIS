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
    return /\b(emergency|distress|sos|satellite\s+sos|call\s+(?:police|ambulance|help)|need\s+(?:immediate\s+)?help|in\s+danger|send\s+help|emergency\s+contact)\b/i.test(t);
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

    let distressText = locationMapsText;
    if (battery !== null && !isNaN(battery)) {
        distressText += '\nBattery: ' + Math.round(battery) + '%';
    }

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

    const contactName = contact?.name || 'Emergency Contacts';
    const contactPhone = contact?.phone || '';

    const smsUrl = buildSmsUrl(contactPhone, textToSend);
    const waUrl = buildWhatsAppUrl(contactPhone, textToSend);
    const telUrl = buildTelUrl(contactPhone);

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

            <div style="background:rgba(0,0,0,0.45); border:1px solid rgba(239,68,68,0.3); border-radius:10px; padding:12px; margin-bottom:14px; font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace; font-size:12.5px; line-height:1.6; color:#f1f5f9; white-space:pre-wrap;">${escapeSosHtml(textToSend)}${contactPhone ? `\nRecipient: ${escapeSosHtml(contactName)} (${escapeSosHtml(contactPhone)})` : ''}</div>

            <div class="emergency-sos-dispatch-banner" style="display:flex; align-items:center; justify-content:space-between; gap:8px; background:rgba(56,189,248,0.15); border:1px solid rgba(56,189,248,0.35); border-radius:8px; padding:8px 12px; margin-bottom:12px; font-size:12px; color:#7dd3fc; line-height:1.4;">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="font-size:16px;">📍</span>
                    <span><strong>Location &amp; Maps Link Ready:</strong> Formatted for instant dispatch${contactPhone ? ` to <strong>${escapeSosHtml(contactName)} (${escapeSosHtml(contactPhone)})</strong>` : ''}. Tap <strong>Send SMS</strong> or <strong>WhatsApp</strong> below.</span>
                </div>
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
                <button type="button" class="emergency-share-btn" data-share-text="${encodeURIComponent(textToSend)}" onclick="globalThis.shareEmergencySos?.(decodeURIComponent(this.getAttribute('data-share-text')||''))" style="background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.2); color:#ffffff; padding:10px 12px; border-radius:8px; font-weight:600; font-size:13px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px;">
                    <span>📤</span>
                    <span>Share Location</span>
                </button>
            </div>

            <div style="border-radius:10px; overflow:hidden; border:1px solid rgba(239,68,68,0.3); margin-top:8px; background:#0f172a; position:relative; min-height:150px;">
                <div style="padding:16px; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; background:radial-gradient(circle at center, rgba(239,68,68,0.15) 0%, rgba(15,23,42,0.9) 70%);">
                    <div style="width:44px; height:44px; border-radius:50%; background:rgba(239,68,68,0.2); border:2px solid #ef4444; display:flex; align-items:center; justify-content:center; font-size:22px; margin-bottom:8px; animation:pulse 1.5s infinite ease-in-out;">
                        📍
                    </div>
                    <div style="font-size:13px; font-weight:700; color:#f8fafc; margin-bottom:4px; max-width:90%;">
                        ${escapeSosHtml(address)}
                    </div>
                    <div style="font-size:12px; font-family:monospace; color:#38bdf8; margin-bottom:12px;">
                        ${lat.toFixed(6)}, ${lon.toFixed(6)}
                    </div>
                    <a href="${payload.googleMapsUrl || ('https://maps.google.com/?q=' + lat + ',' + lon)}" target="_blank" rel="noopener noreferrer" style="background:#2563eb; color:#ffffff; padding:7px 16px; border-radius:6px; font-size:12px; font-weight:700; text-decoration:none; display:inline-flex; align-items:center; gap:6px; box-shadow:0 2px 8px rgba(37,99,235,0.4);">
                        🗺️ Open Live Pin in Google Maps
                    </a>
                </div>
            </div>

            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px; font-size:12px; color:#94a3b8; flex-wrap:wrap; gap:8px;">
                <span>Navigation Links:</span>
                <div style="display:flex; gap:12px;">
                    <a href="${payload.googleMapsUrl || ('https://maps.google.com/?q=' + lat + ',' + lon)}" target="_blank" rel="noopener noreferrer" style="color:#38bdf8; text-decoration:none; font-weight:600;">Google Maps</a>
                    <a href="${payload.appleMapsUrl || ('https://maps.apple.com/?ll=' + lat + ',' + lon)}" target="_blank" rel="noopener noreferrer" style="color:#38bdf8; text-decoration:none; font-weight:600;">Apple Maps</a>
                    <a href="https://www.openstreetmap.org/?mlat=${lat.toFixed(6)}&amp;mlon=${lon.toFixed(6)}#map=16/${lat.toFixed(6)}/${lon.toFixed(6)}" target="_blank" rel="noopener noreferrer" style="color:#38bdf8; text-decoration:none; font-weight:600;">OpenStreetMap</a>
                </div>
            </div>
        </div>
    `;
}

export function dispatchImmediateEmergencySms(payload = {}, contact = null) {
    const contactPhone = contact?.phone || '';
    const text = payload.locationMapsText || payload.cleanText || payload.distressText || '';
    const smsUrl = buildSmsUrl(contactPhone, text);

    // 1. Immediately copy telemetry & coordinates to clipboard for instant pasting on laptop/desktop
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
                    banner.innerHTML = `<div style="display:flex; align-items:center; gap:8px;"><span style="font-size:16px;">✅</span><span><strong>SMS Delivered:</strong> Coordinates &amp; Maps link sent to <strong>${escapeSosHtml(contactPhone)}</strong> via carrier gateway.</span></div>`;
                    banner.style.background = 'rgba(34,197,94,0.2)';
                    banner.style.borderColor = 'rgba(34,197,94,0.5)';
                    banner.style.color = '#86efac';
                } else {
                    banner.innerHTML = `<div style="display:flex; align-items:center; gap:8px;"><span style="font-size:16px;">📋</span><span><strong>Location &amp; Maps link copied:</strong> Click <strong>Send SMS</strong> or <strong>WhatsApp</strong> below to send directly${contactPhone ? ` to <strong>${escapeSosHtml(contactPhone)}</strong>` : ''}.</span></div>`;
                    banner.style.background = 'rgba(234,179,8,0.15)';
                    banner.style.borderColor = 'rgba(234,179,8,0.4)';
                    banner.style.color = '#fde047';
                }
            }
        }).catch(() => {});
    }

    // 3. Open native SMS URL on mobile devices
    try {
        if (typeof window !== 'undefined' && typeof document !== 'undefined') {
            const isMobile = /Android|iPhone|iPad|iPod|webOS/i.test(navigator.userAgent || '');
            if (isMobile) {
                const dispatchLink = document.createElement('a');
                dispatchLink.href = smsUrl;
                dispatchLink.style.display = 'none';
                document.body.appendChild(dispatchLink);
                dispatchLink.click();
                setTimeout(() => {
                    try { dispatchLink.remove(); } catch (_) {}
                }, 1000);
            }
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
