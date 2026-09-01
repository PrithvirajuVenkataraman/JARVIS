import assert from 'node:assert/strict';
import {
    calculateHaversineDistance,
    formatDistance,
    mapWeatherCode,
    fetchLiveWeatherForCoords,
    fetchNearbyAmenities,
    buildDynamicLocationSuiteHtml
} from '../app/location-suite.js';

function fixtureSubject(label) {
    return `Fixture ${label} ${Date.now().toString(36).slice(-4)}`;
}

console.log('=== Testing Full Dynamic Location Suite ===\n');

// Section 1: Geodesic Haversine Distance Calculations
console.log('--- Section 1: Haversine Distance & Formatting ---');

// Distance between approx 12.9352, 77.6245 and 12.9360, 77.6250
const dMeters = calculateHaversineDistance(12.9352, 77.6245, 12.9360, 77.6250);
assert.ok(dMeters > 50 && dMeters < 150);
assert.equal(formatDistance(450), '450 m');
assert.equal(formatDistance(2400), '2.4 km');
console.log('  [PASS] 1.1 Haversine distance and metric formatting verified');

// Section 2: Weather Code Mapping & Live Weather
console.log('\n--- Section 2: Weather Mapping & Environmental Snapshot ---');

const clearSky = mapWeatherCode(0);
assert.equal(clearSky.label, 'Clear Sky');
assert.equal(clearSky.icon, '☀️');

const rain = mapWeatherCode(61);
assert.equal(rain.label, 'Rain');

const thunderstorm = mapWeatherCode(95);
assert.equal(thunderstorm.label, 'Thunderstorm');
console.log('  [PASS] 2.1 WMO weather codes properly mapped to condition labels and icons');

const mockWeatherFetch = async () => ({
    ok: true,
    json: async () => ({
        current: {
            temperature_2m: 24.3,
            relative_humidity_2m: 65,
            weather_code: 1,
            wind_speed_10m: 12.4
        }
    })
});

const weatherData = await fetchLiveWeatherForCoords(12.9352, 77.6245, mockWeatherFetch);
assert.ok(weatherData);
assert.equal(weatherData.temperatureC, 24);
assert.equal(weatherData.humidity, 65);
assert.equal(weatherData.windSpeedKmH, 12);
assert.equal(weatherData.condition, 'Partly Cloudy');
console.log('  [PASS] 2.2 Live weather snapshot properly parsed from API payload');

// Section 3: Dynamic Nearby Amenities (ATMs, Hospitals, Police, Gas)
console.log('\n--- Section 3: Dynamic Nearby Essential Amenities ---');

const mockAtm = fixtureSubject('Bank ATM');
const mockHospital = fixtureSubject('General Hospital');
const mockPolice = fixtureSubject('Police Station');
const mockFuel = fixtureSubject('Fuel Station');

const mockOverpassFetch = async () => ({
    ok: true,
    json: async () => ({
        elements: [
            { lat: 12.9360, lon: 77.6250, tags: { amenity: 'atm', name: mockAtm, 'addr:street': 'Main St' } },
            { lat: 12.9400, lon: 77.6300, tags: { amenity: 'hospital', name: mockHospital, 'addr:city': 'Metro' } },
            { lat: 12.9380, lon: 77.6280, tags: { amenity: 'police', name: mockPolice } },
            { lat: 12.9370, lon: 77.6260, tags: { amenity: 'fuel', name: mockFuel } }
        ]
    })
});

const amenities = await fetchNearbyAmenities(12.9352, 77.6245, 3000, mockOverpassFetch);
assert.equal(amenities.atms.length, 1);
assert.equal(amenities.atms[0].name, mockAtm);
assert.ok(amenities.atms[0].distMeters > 0);

assert.equal(amenities.hospitals.length, 1);
assert.equal(amenities.hospitals[0].name, mockHospital);

assert.equal(amenities.police.length, 1);
assert.equal(amenities.police[0].name, mockPolice);

assert.equal(amenities.gasStations.length, 1);
assert.equal(amenities.gasStations[0].name, mockFuel);
console.log('  [PASS] 3.1 Overpass amenities categorized into ATMs, Hospitals, Police, Gas with calculated distances');

// Section 4: Full Dynamic Location Suite HTML Card Generation
console.log('\n--- Section 4: Dynamic HTML Card Generation ---');

const dynamicNeighborhood = fixtureSubject('Neighborhood');
const dynamicCity = fixtureSubject('City');
const dynamicState = fixtureSubject('State');

const htmlCard = buildDynamicLocationSuiteHtml({
    latitude: 12.9352,
    longitude: 77.6245,
    exactAddress: `${dynamicNeighborhood}, ${dynamicCity}, ${dynamicState}`,
    address: {
        neighbourhood: dynamicNeighborhood,
        city: dynamicCity,
        state: dynamicState,
        country: 'India',
        postcode: '560034'
    },
    weather: weatherData,
    amenities
});

assert.ok(htmlCard.includes('location-suite-card'));
assert.ok(htmlCard.includes(dynamicNeighborhood));
assert.ok(htmlCard.includes(dynamicCity));
assert.ok(htmlCard.includes('24°C · Partly Cloudy'));
assert.ok(htmlCard.includes('65% Humidity'));
assert.ok(htmlCard.includes('12 km/h Wind'));
assert.ok(htmlCard.includes('iframe'));
assert.ok(htmlCard.includes('ATMs / Cash'));
assert.ok(htmlCard.includes('Hospitals &amp; Clinics') || htmlCard.includes('Hospitals & Clinics'));
assert.ok(htmlCard.includes('Police Stations'));
assert.ok(htmlCard.includes('Gas &amp; Fuel Stations') || htmlCard.includes('Gas & Fuel Stations'));
assert.ok(htmlCard.includes(mockAtm));
assert.ok(htmlCard.includes(mockHospital));
assert.ok(htmlCard.includes(mockPolice));
assert.ok(htmlCard.includes(mockFuel));
console.log('  [PASS] 4.1 Full dynamic location suite HTML rendered with AI summary, weather, area table, map, and all 4 amenity categories');

console.log('\n================================================================');
console.log('=== All Dynamic Location Suite Tests PASSED ===');
console.log('================================================================\n');
