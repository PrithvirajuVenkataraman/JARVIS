/**
 * @file app/location-suite.js
 * @description Full Dynamic Location & Environmental Suite
 * - Reverse geocoding breakdown (Neighborhood, District, City, State, Country, Postcode)
 * - Live environmental weather snapshot (temperature, condition, humidity, wind)
 * - Interactive map pin & directions
 * - Dynamic nearby essential services (ATMs, Hospitals, Police Stations, Gas Stations)
 */

export function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth radius in meters
    const toRad = deg => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c);
}

export function formatDistance(meters) {
    if (!Number.isFinite(meters) || meters < 0) return '';
    if (meters < 1000) return `${meters} m`;
    return `${(meters / 1000).toFixed(1)} km`;
}

export function mapWeatherCode(code) {
    const numeric = Number(code);
    if (numeric === 0) return { label: 'Clear Sky', icon: '☀️' };
    if ([1, 2].includes(numeric)) return { label: 'Partly Cloudy', icon: '🌤️' };
    if (numeric === 3) return { label: 'Overcast', icon: '☁️' };
    if ([45, 48].includes(numeric)) return { label: 'Foggy', icon: '🌫️' };
    if ([51, 53, 55].includes(numeric)) return { label: 'Drizzle', icon: '🌦️' };
    if ([61, 63, 65].includes(numeric)) return { label: 'Rain', icon: '🌧️' };
    if ([71, 73, 75, 77].includes(numeric)) return { label: 'Snow', icon: '🌨️' };
    if ([80, 81, 82].includes(numeric)) return { label: 'Rain Showers', icon: '🌧️' };
    if ([85, 86].includes(numeric)) return { label: 'Snow Showers', icon: '🌨️' };
    if ([95, 96, 99].includes(numeric)) return { label: 'Thunderstorm', icon: '⛈️' };
    return { label: 'Fair', icon: '🌤️' };
}

export async function fetchLiveWeatherForCoords(lat, lon, fetchFn = globalThis.fetch) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m`;
        const res = await fetchFn(url, { signal: AbortSignal.timeout(3500) });
        if (!res.ok) return null;
        const data = await res.json();
        const current = data?.current || {};
        const weatherInfo = mapWeatherCode(current.weather_code);
        return {
            temperatureC: Math.round(current.temperature_2m ?? 0),
            humidity: Math.round(current.relative_humidity_2m ?? 0),
            windSpeedKmH: Math.round(current.wind_speed_10m ?? 0),
            condition: weatherInfo.label,
            icon: weatherInfo.icon
        };
    } catch (_) {
        return null;
    }
}

export async function fetchNearbyAmenities(lat, lon, radiusMeters = 3000, fetchFn = globalThis.fetch) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return { atms: [], hospitals: [], police: [], gasStations: [] };
    }

    const categories = {
        atms: [],
        hospitals: [],
        police: [],
        gasStations: []
    };

    try {
        // Query Overpass API for essential amenities around coordinates
        const query = `[out:json][timeout:4];(node["amenity"~"atm|bank|hospital|clinic|police|fuel"](around:${radiusMeters},${lat},${lon}););out 30;`;
        const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
        const res = await fetchFn(url, { signal: AbortSignal.timeout(4000) });
        
        if (res.ok) {
            const data = await res.json();
            const elements = Array.isArray(data?.elements) ? data.elements : [];

            for (const el of elements) {
                const tags = el.tags || {};
                const name = tags.name || tags['brand'] || tags['operator'] || '';
                if (!name) continue;

                const amenity = String(tags.amenity || '').toLowerCase();
                const distMeters = calculateHaversineDistance(lat, lon, el.lat, el.lon);
                const item = {
                    name,
                    distMeters,
                    distLabel: formatDistance(distMeters),
                    lat: el.lat,
                    lon: el.lon,
                    address: [tags['addr:street'], tags['addr:suburb'], tags['addr:city']].filter(Boolean).join(', ')
                };

                if (amenity === 'atm' || (amenity === 'bank' && tags.atm === 'yes')) {
                    categories.atms.push(item);
                } else if (amenity === 'hospital' || amenity === 'clinic') {
                    categories.hospitals.push(item);
                } else if (amenity === 'police') {
                    categories.police.push(item);
                } else if (amenity === 'fuel') {
                    categories.gasStations.push(item);
                }
            }

            // Sort each category by closest distance and limit to top 3
            for (const key of Object.keys(categories)) {
                categories[key].sort((a, b) => a.distMeters - b.distMeters);
                categories[key] = categories[key].slice(0, 3);
            }
        }
    } catch (_) {
        // Overpass timeout or failure gracefully falls back to empty lists with Google Maps links
    }

    return categories;
}

export function escapeHtmlText(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export function buildDynamicLocationSuiteHtml(data = {}) {
    const lat = Number(data.latitude ?? 0);
    const lon = Number(data.longitude ?? 0);
    const addr = data.address || {};
    const weather = data.weather || null;
    const amenities = data.amenities || { atms: [], hospitals: [], police: [], gasStations: [] };

    const neighborhood = addr.neighbourhood || addr.suburb || addr.hamlet || addr.village || addr.residential || '';
    const city = addr.city || addr.town || addr.municipality || addr.state_district || addr.county || 'Your Area';
    const state = addr.state || '';
    const country = addr.country || '';
    const postcode = addr.postcode || '';
    const exactAddress = data.exactAddress || [neighborhood, city, state, country].filter(Boolean).join(', ');

    const mapsUrl = `https://maps.google.com/?q=${lat},${lon}`;
    const directionsBaseUrl = 'https://www.google.com/maps/dir/?api=1&destination=';

    // 1. Natural AI Summary
    const locationTitleParts = [neighborhood, city, state, country].filter(Boolean);
    const locationTitle = locationTitleParts.join(', ') || 'Current GPS Location';
    
    let aiSummary = `You are currently in **${escapeHtmlText(neighborhood ? `${neighborhood}, ${city}` : city)}**`;
    if (state || country) {
        aiSummary += `, ${escapeHtmlText([state, country].filter(Boolean).join(', '))}`;
    }
    aiSummary += `.`;

    if (weather) {
        aiSummary += ` The current local weather is **${weather.temperatureC}°C** (${escapeHtmlText(weather.condition)}) with **${weather.humidity}%** humidity and winds at **${weather.windSpeedKmH} km/h**.`;
    }

    // 2. Weather Badges
    const weatherBadgeHtml = weather ? `
        <div class="loc-weather-bar" style="display:flex; flex-wrap:wrap; gap:8px; margin:12px 0 16px;">
            <div style="background:rgba(56,189,248,0.12); border:1px solid rgba(56,189,248,0.3); border-radius:999px; padding:4px 12px; font-size:13px; font-weight:600; color:#38bdf8; display:flex; align-items:center; gap:6px;">
                <span>${weather.icon}</span>
                <span>${weather.temperatureC}°C · ${escapeHtmlText(weather.condition)}</span>
            </div>
            <div style="background:rgba(148,163,184,0.12); border:1px solid rgba(148,163,184,0.25); border-radius:999px; padding:4px 12px; font-size:13px; color:#94a3b8; display:flex; align-items:center; gap:5px;">
                <span>💧</span>
                <span>${weather.humidity}% Humidity</span>
            </div>
            <div style="background:rgba(148,163,184,0.12); border:1px solid rgba(148,163,184,0.25); border-radius:999px; padding:4px 12px; font-size:13px; color:#94a3b8; display:flex; align-items:center; gap:5px;">
                <span>💨</span>
                <span>${weather.windSpeedKmH} km/h Wind</span>
            </div>
        </div>
    ` : '';

    // 3. Area Hierarchy Table
    const areaRows = [
        neighborhood ? `<tr><td style="padding:4px 8px; color:#94a3b8; font-size:12px;">Neighborhood / Suburb</td><td style="padding:4px 8px; font-weight:600; font-size:12px;">${escapeHtmlText(neighborhood)}</td></tr>` : '',
        city ? `<tr><td style="padding:4px 8px; color:#94a3b8; font-size:12px;">City / Town</td><td style="padding:4px 8px; font-weight:600; font-size:12px;">${escapeHtmlText(city)}</td></tr>` : '',
        state ? `<tr><td style="padding:4px 8px; color:#94a3b8; font-size:12px;">State / Region</td><td style="padding:4px 8px; font-weight:600; font-size:12px;">${escapeHtmlText(state)}</td></tr>` : '',
        country ? `<tr><td style="padding:4px 8px; color:#94a3b8; font-size:12px;">Country</td><td style="padding:4px 8px; font-weight:600; font-size:12px;">${escapeHtmlText(country)}</td></tr>` : '',
        postcode ? `<tr><td style="padding:4px 8px; color:#94a3b8; font-size:12px;">Postal / ZIP Code</td><td style="padding:4px 8px; font-weight:600; font-size:12px;">${escapeHtmlText(postcode)}</td></tr>` : '',
        `<tr><td style="padding:4px 8px; color:#94a3b8; font-size:12px;">GPS Coordinates</td><td style="padding:4px 8px; font-weight:600; font-size:12px;"><code>${lat.toFixed(6)}, ${lon.toFixed(6)}</code></td></tr>`
    ].filter(Boolean).join('');

    // 4. Amenity Card Builder
    function renderAmenitySection(title, icon, searchType, items = []) {
        const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(searchType)}/@${lat},${lon},15z`;
        let itemsHtml = '';

        if (items.length > 0) {
            itemsHtml = items.map(item => `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 8px; background:rgba(255,255,255,0.03); border-radius:6px; margin-bottom:4px;">
                    <div style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-right:8px;">
                        <div style="font-size:12px; font-weight:600; color:#f1f5f9;">${escapeHtmlText(item.name)}</div>
                        ${item.address ? `<div style="font-size:11px; color:#64748b; overflow:hidden; text-overflow:ellipsis;">${escapeHtmlText(item.address)}</div>` : ''}
                    </div>
                    <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
                        <span style="font-size:11px; font-weight:600; color:#38bdf8; background:rgba(56,189,248,0.1); padding:2px 6px; border-radius:4px;">${escapeHtmlText(item.distLabel)}</span>
                        <a href="${directionsBaseUrl}${item.lat},${item.lon}" target="_blank" rel="noopener noreferrer" style="color:#94a3b8; hover:color:#38bdf8; font-size:11px; text-decoration:none;" title="Get directions">🧭</a>
                    </div>
                </div>
            `).join('');
        } else {
            itemsHtml = `
                <div style="font-size:11px; color:#64748b; padding:4px 8px;">
                    Find nearby ${escapeHtmlText(searchType)} on map.
                </div>
            `;
        }

        return `
            <div style="background:rgba(15,23,42,0.6); border:1px solid rgba(148,163,184,0.18); border-radius:10px; padding:10px 12px; display:flex; flex-direction:column; justify-content:space-between;">
                <div>
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                        <div style="font-size:13px; font-weight:700; color:#e2e8f0; display:flex; align-items:center; gap:6px;">
                            <span>${icon}</span>
                            <span>${escapeHtmlText(title)}</span>
                        </div>
                        <a href="${searchUrl}" target="_blank" rel="noopener noreferrer" style="font-size:11px; color:#38bdf8; text-decoration:none; font-weight:600;">View all →</a>
                    </div>
                    ${itemsHtml}
                </div>
            </div>
        `;
    }

    const amenitiesGridHtml = `
        <div style="margin-top:18px;">
            <div style="font-size:14px; font-weight:700; color:#f8fafc; margin-bottom:10px; display:flex; align-items:center; gap:6px;">
                <span>📍</span>
                <span>Nearby Essential Services (Live Dynamic Proximity)</span>
            </div>
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:10px;">
                ${renderAmenitySection('ATMs / Cash', '🏧', 'ATM', amenities.atms)}
                ${renderAmenitySection('Hospitals & Clinics', '🏥', 'Hospital', amenities.hospitals)}
                ${renderAmenitySection('Police Stations', '🚓', 'Police Station', amenities.police)}
                ${renderAmenitySection('Gas & Fuel Stations', '⛽', 'Gas Station', amenities.gasStations)}
            </div>
        </div>
    `;

    // 5. Interactive Embedded Map
    const minLon = (lon - 0.008).toFixed(6);
    const minLat = (lat - 0.005).toFixed(6);
    const maxLon = (lon + 0.008).toFixed(6);
    const maxLat = (lat + 0.005).toFixed(6);
    const osmEmbedUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${minLon}%2C${minLat}%2C${maxLon}%2C${maxLat}&layer=mapnik&marker=${lat.toFixed(6)}%2C${lon.toFixed(6)}`;

    const mapHtml = `
        <div class="map-container" style="margin-top:16px; border-radius:12px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,0.3); border:1px solid rgba(148,163,184,0.2); position:relative;">
            <iframe
                src="${osmEmbedUrl}"
                width="100%"
                height="320"
                style="border:0; display:block; filter:contrast(1.05) brightness(0.95);"
                loading="lazy"
                title="Interactive Location Map"
                sandbox="allow-scripts allow-same-origin allow-popups"
                allowfullscreen>
            </iframe>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px; font-size:12px; color:#94a3b8; flex-wrap:wrap; gap:8px;">
            <span>Exact Pin: <strong>${escapeHtmlText(exactAddress || locationTitle)}</strong></span>
            <div style="display:flex; gap:12px;">
                <a href="${mapsUrl}" target="_blank" rel="noopener noreferrer" style="color:#38bdf8; text-decoration:none; font-weight:600; display:flex; align-items:center; gap:4px;">🗺️ Open in Google Maps</a>
                <a href="${directionsBaseUrl}${lat},${lon}" target="_blank" rel="noopener noreferrer" style="color:#38bdf8; text-decoration:none; font-weight:600; display:flex; align-items:center; gap:4px;">🧭 Get Directions</a>
            </div>
        </div>
    `;

    return `
        <div class="location-suite-card" style="margin-top:8px; padding:16px; background:rgba(30,41,59,0.7); backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px); border:1px solid rgba(148,163,184,0.2); border-radius:16px; color:#f8fafc; font-family:inherit;">
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px;">
                <span style="font-size:20px;">🧭</span>
                <h3 style="margin:0; font-size:16px; font-weight:700; color:#f8fafc;">Current Location & Area Intelligence</h3>
            </div>
            
            <p style="margin:0 0 10px; font-size:14px; line-height:1.5; color:#cbd5e1;">${aiSummary}</p>
            
            ${weatherBadgeHtml}

            <div style="background:rgba(15,23,42,0.4); border-radius:10px; border:1px solid rgba(148,163,184,0.15); overflow:hidden; margin-top:12px;">
                <table style="width:100%; border-collapse:collapse;">
                    <tbody>
                        ${areaRows}
                    </tbody>
                </table>
            </div>

            ${mapHtml}
        </div>
    `;
}
