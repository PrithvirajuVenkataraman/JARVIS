import assert from 'node:assert/strict';
import {
    isCurrentLocationIntent,
    fetchApproximateLocationByIp,
    buildDynamicLocationSuiteHtml
} from '../app/location-suite.js';

console.log('=== Running Location Intent & IP Fallback Test Suite ===\n');

// ─── Section 1: Semantic Intent Recognition ──────────────────────────────────
console.log('--- Section 1: Semantic Natural-Language Intent Recognition ---');

const positiveQueries = [
    'where am i',
    'Where am I?',
    'where am i right now',
    'where are we',
    'Where are we right now?',
    'where am I currently standing',
    'can you tell me where I am?',
    'tell me where i am',
    'what is my location',
    "what's my location",
    'what is my current location',
    'my current location',
    'which city am I in right now?',
    'what city are we in',
    'what town am i in',
    'which country am i in',
    'what place is this',
    'which place is this',
    'what is my address',
    'locate me',
    'find my location',
    'pin my location',
    'my coordinates',
    'what are my coordinates',
    'tell me my gps coordinates',
    'what are my latitude and longitude'
];

for (const q of positiveQueries) {
    const isIntent = isCurrentLocationIntent(q);
    assert.equal(isIntent, true, `Expected "${q}" to be recognized as current location intent`);
    console.log(`  [PASS] Positive: "${q}" -> recognized`);
}

const negativeQueries = [
    'Where is the Eiffel Tower located?',
    'Where was Albert Einstein born?',
    'Where is Mount Everest?',
    'Where are lions found in the wild?',
    'Directions to Central Park',
    'Where can I find cheap flights to London?',
    'Where is the nearest hospital?',
    'What is the location of the nearest pharmacy?',
    'Where in the code is the function defined?',
    'Where am I in this code loop?',
    'What is the weather in Tokyo today?',
    'Explain how GPS works'
];

for (const q of negativeQueries) {
    const isIntent = isCurrentLocationIntent(q);
    assert.equal(isIntent, false, `Expected "${q}" to NOT be recognized as personal location intent`);
    console.log(`  [PASS] Negative: "${q}" -> cleanly excluded`);
}

// ─── Section 2: IP-Based Approximate Geolocation Fallback ───────────────────
console.log('\n--- Section 2: IP Geolocation Fallback Engine ---');
{
    // Test primary provider (freeipapi) success
    const mockFetchFreeIp = async (url) => {
        if (url.includes('freeipapi')) {
            return {
                ok: true,
                json: async () => ({
                    latitude: 37.7749,
                    longitude: -122.4194,
                    cityName: 'San Francisco',
                    regionName: 'California',
                    countryName: 'United States',
                    zipCode: '94102'
                })
            };
        }
        throw new Error('Not reached');
    };

    const loc = await fetchApproximateLocationByIp(mockFetchFreeIp);
    assert.ok(loc, 'Should resolve location from primary provider');
    assert.equal(loc.latitude, 37.7749);
    assert.equal(loc.longitude, -122.4194);
    assert.equal(loc.city, 'San Francisco');
    assert.equal(loc.country, 'United States');
    assert.equal(loc.isApproximate, true);
    assert.equal(loc.source, 'ip_lookup');
    console.log('  [PASS] 2.1 Primary IP provider (freeipapi) correctly mapped to approximate location object');
}

{
    // Test secondary provider (ipwho.is) when primary fails
    const mockFetchSecondary = async (url) => {
        if (url.includes('freeipapi')) {
            return { ok: false, status: 429 };
        }
        if (url.includes('ipwho.is')) {
            return {
                ok: true,
                json: async () => ({
                    success: true,
                    latitude: 35.6762,
                    longitude: 139.6503,
                    city: 'Tokyo',
                    region: 'Tokyo',
                    country: 'Japan',
                    postal: '100-0001'
                })
            };
        }
        throw new Error('Unknown URL');
    };

    const loc = await fetchApproximateLocationByIp(mockFetchSecondary);
    assert.ok(loc, 'Should fail over to secondary provider');
    assert.equal(loc.latitude, 35.6762);
    assert.equal(loc.longitude, 139.6503);
    assert.equal(loc.city, 'Tokyo');
    assert.equal(loc.country, 'Japan');
    assert.equal(loc.isApproximate, true);
    console.log('  [PASS] 2.2 Secondary IP provider (ipwho.is) successfully activated upon primary failure');
}

// ─── Section 3: Location Suite HTML Generation with isApproximate ────────────
console.log('\n--- Section 3: Dynamic HTML Card with Approximate Badge ---');
{
    const cardHtml = buildDynamicLocationSuiteHtml({
        latitude: 35.6762,
        longitude: 139.6503,
        exactAddress: 'Shinjuku, Tokyo, Japan',
        address: {
            city: 'Tokyo',
            state: 'Tokyo',
            country: 'Japan'
        },
        weather: {
            temperatureC: 22,
            humidity: 60,
            windSpeedKmH: 10,
            condition: 'Clear Sky',
            icon: '☀️'
        },
        amenities: { atms: [], hospitals: [], police: [], gasStations: [] },
        isApproximate: true
    });

    assert.ok(cardHtml.includes('location-suite-card'), 'Must contain location-suite-card');
    assert.ok(cardHtml.includes('Approximate Network Location'), 'Must include Approximate Network Location badge');
    assert.ok(cardHtml.includes('Estimated Pin:'), 'Must label pin as Estimated Pin for approximate locations');
    assert.ok(cardHtml.includes('Position Source'), 'Must list Position Source in table');
    assert.ok(cardHtml.includes('Approximate Network IP Geolocation'), 'Must state Approximate Network IP Geolocation');
    assert.ok(cardHtml.includes('openstreetmap.org/export/embed.html'), 'Must embed OSM map');
    console.log('  [PASS] 3.1 Dynamic location card properly adapts for approximate network location');
}

console.log('\n================================================================');
console.log('=== All Location Intent & Fallback Tests PASSED (100%) ===');
console.log('================================================================\n');
process.exit(0);
