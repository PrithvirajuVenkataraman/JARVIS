import assert from 'node:assert/strict';
import {
    saveEmergencyContact,
    getEmergencyContacts,
    deleteEmergencyContact,
    getPrimaryEmergencyContact,
    cleanPhoneDigits,
    generateDistressPayload,
    buildSmsUrl,
    buildWhatsAppUrl,
    buildTelUrl,
    buildEmergencyCardHtml
} from '../app/emergency-sos.js';

console.log('=== Testing Satellite Emergency SOS & Distress Dispatch Suite ===\n');

// Section 1: Phone Digit Cleaning & Sanitization
console.log('--- Section 1: Phone Formatting & Cleaning ---');
assert.equal(cleanPhoneDigits('+1 (555) 234-5678'), '+15552345678');
assert.equal(cleanPhoneDigits('9876543210'), '9876543210');
assert.equal(cleanPhoneDigits(''), '');
console.log('  [PASS] 1.1 Phone number digits properly normalized');

// Section 2: Contact Management & Persistence
console.log('\n--- Section 2: Contact Storage & Retrieval ---');
const c1 = saveEmergencyContact({ name: 'Alice Test', phone: '+15551112222', relationship: 'Sister' });
assert.ok(c1);
assert.equal(c1.name, 'Alice Test');
assert.equal(c1.phone, '+15551112222');
assert.equal(c1.isPrimary, true);

const c2 = saveEmergencyContact({ name: 'Bob Friend', phone: '+15553334444', relationship: 'Friend' });
assert.ok(c2);
assert.equal(c2.name, 'Bob Friend');

const primary = getPrimaryEmergencyContact();
assert.ok(primary);
assert.equal(primary.name, 'Alice Test');

const remaining = deleteEmergencyContact(c1.id);
assert.equal(remaining.length, 1);
assert.equal(remaining[0].id, c2.id);
assert.equal(remaining[0].isPrimary, true);
console.log('  [PASS] 2.1 Emergency contacts saved, prioritized, and deleted properly');

// Section 3: Distress Telemetry Payload Generation
console.log('\n--- Section 3: Distress Payload Generation ---');
const payload = generateDistressPayload({
    latitude: 12.969286,
    longitude: 77.770689,
    accuracy: 15.4,
    address: 'Whitefield Main Road, Bengaluru',
    batteryLevel: 84,
    timestamp: 1725300000000
});

assert.equal(payload.latitude, 12.969286);
assert.equal(payload.longitude, 77.770689);
assert.equal(payload.batteryLevel, 84);
assert.ok(payload.distressText.includes('EMERGENCY SOS'));
assert.ok(payload.distressText.includes('12.969286, 77.770689'));
assert.ok(payload.distressText.includes('±15m'));
assert.ok(payload.distressText.includes('84%'));
assert.ok(payload.distressText.includes('Whitefield Main Road'));
assert.ok(payload.distressText.includes('maps.google.com'));
assert.ok(payload.distressText.includes('maps.apple.com'));
console.log('  [PASS] 3.1 Distress payload contains coordinates, accuracy, battery, address, and maps links');

// Section 4: Multi-Channel Dispatch URL Builders
console.log('\n--- Section 4: Multi-Channel Dispatch URLs ---');
const smsUrl = buildSmsUrl('+15551112222', payload.distressText);
assert.ok(smsUrl.startsWith('sms:+15551112222?body='));
assert.ok(smsUrl.includes(encodeURIComponent('EMERGENCY SOS')));

const waUrl = buildWhatsAppUrl('+15551112222', payload.distressText);
assert.ok(waUrl.startsWith('https://api.whatsapp.com/send?phone=15551112222&text='));
assert.ok(waUrl.includes(encodeURIComponent('12.969286')));

const telUrl = buildTelUrl('+15551112222');
assert.equal(telUrl, 'tel:+15551112222');

const defaultTelUrl = buildTelUrl('');
assert.equal(defaultTelUrl, 'tel:112');
console.log('  [PASS] 4.1 SMS, WhatsApp, and Phone dialer URLs formatted accurately');

// Section 5: Emergency Distress Card HTML Generation
console.log('\n--- Section 5: Emergency Distress Card HTML ---');
const cardHtml = buildEmergencyCardHtml(payload, c2);
assert.ok(cardHtml.includes('emergency-sos-card'));
assert.ok(cardHtml.includes('🚨 Satellite Emergency SOS Active'));
assert.ok(cardHtml.includes('12.969286, 77.770689'));
assert.ok(cardHtml.includes('Whitefield Main Road'));
assert.ok(cardHtml.includes('🔋 84%'));
assert.ok(cardHtml.includes('Send SMS'));
assert.ok(cardHtml.includes('WhatsApp'));
assert.ok(cardHtml.includes('Call SOS'));
assert.ok(cardHtml.includes('Share Location'));
assert.ok(cardHtml.includes('iframe'));
assert.ok(cardHtml.includes('openstreetmap.org/export/embed.html'));
console.log('  [PASS] 5.1 Emergency SOS Card HTML rendered with telemetry, 4 action buttons, and OpenStreetMap pin');

console.log('\n================================================================');
console.log('=== All Satellite Emergency SOS Tests PASSED ===');
console.log('================================================================\n');
