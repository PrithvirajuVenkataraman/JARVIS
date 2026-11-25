export const FREE_LIVE_CATEGORIES = Object.freeze([
    'news',
    'technology',
    'vehicles',
    'conflicts_geopolitics',
    'government',
    'history',
    'weather',
    'disasters',
    'sports',
    'crypto',
    'tourism_food_places',
    'transportation_itineraries',
    'unsupported_free_live'
]);

export const FREE_LIVE_SOURCES = Object.freeze({
    gdelt: {
        id: 'gdelt',
        name: 'GDELT Doc API',
        category: 'news',
        attribution: 'GDELT Project',
        timeoutMs: 5000,
        cacheTtlMs: 10 * 60 * 1000,
        limitations: 'Broad public news index; coverage can miss very recent or local items.'
    },
    openMeteo: {
        id: 'open-meteo',
        name: 'Open-Meteo',
        category: 'weather',
        attribution: 'Open-Meteo',
        timeoutMs: 10000,
        cacheTtlMs: 10 * 60 * 1000,
        limitations: 'Forecast/model data by coordinates; location must be resolvable.'
    },
    coingecko: {
        id: 'coingecko',
        name: 'CoinGecko public API',
        category: 'crypto',
        attribution: 'CoinGecko',
        timeoutMs: 5000,
        cacheTtlMs: 60 * 1000,
        limitations: 'Public/demo endpoint availability and rate limits can vary.'
    },
    eonet: {
        id: 'nasa-eonet',
        name: 'NASA EONET',
        category: 'disasters',
        attribution: 'NASA Earth Observatory Natural Event Tracker',
        timeoutMs: 5000,
        cacheTtlMs: 15 * 60 * 1000,
        limitations: 'Natural event tracker; not an emergency alerting service.'
    },
    theSportsDb: {
        id: 'thesportsdb',
        name: 'TheSportsDB',
        category: 'sports',
        attribution: 'TheSportsDB',
        timeoutMs: 5000,
        cacheTtlMs: 5 * 60 * 1000,
        limitations: 'Free sports coverage is limited and not guaranteed for live scores.'
    },
    wikimedia: {
        id: 'wikimedia',
        name: 'Wikimedia APIs',
        category: 'tourism_food_places',
        attribution: 'Wikimedia',
        timeoutMs: 5000,
        cacheTtlMs: 24 * 60 * 60 * 1000,
        limitations: 'Reference and travel background, not reviews or live opening status.'
    },
    osm: {
        id: 'openstreetmap',
        name: 'OpenStreetMap public APIs',
        category: 'tourism_food_places',
        attribution: 'OpenStreetMap contributors',
        timeoutMs: 5000,
        cacheTtlMs: 24 * 60 * 60 * 1000,
        limitations: 'Use lightly, cache results, and do not treat as review/ranking data.'
    },
    hackerNews: {
        id: 'hacker-news',
        name: 'Hacker News Algolia API',
        category: 'technology',
        attribution: 'Hacker News / Algolia',
        timeoutMs: 3500,
        cacheTtlMs: 5 * 60 * 1000,
        limitations: 'Community tech stories and discussions.'
    },
    arxiv: {
        id: 'arxiv',
        name: 'arXiv Open Archive API',
        category: 'technology',
        attribution: 'arXiv.org',
        timeoutMs: 4000,
        cacheTtlMs: 60 * 60 * 1000,
        limitations: 'Preprint research papers across CS, AI, physics, and engineering.'
    },
    nhtsa: {
        id: 'nhtsa',
        name: 'NHTSA Vehicle API',
        category: 'vehicles',
        attribution: 'U.S. NHTSA',
        timeoutMs: 4000,
        cacheTtlMs: 60 * 60 * 1000,
        limitations: 'Official recalls and safety ratings for US-market vehicles.'
    },
    reliefWeb: {
        id: 'reliefweb',
        name: 'UN ReliefWeb API',
        category: 'conflicts_geopolitics',
        attribution: 'UN OCHA ReliefWeb',
        timeoutMs: 4000,
        cacheTtlMs: 15 * 60 * 1000,
        limitations: 'Humanitarian and geopolitical situation reports.'
    },
    loc: {
        id: 'library-of-congress',
        name: 'Library of Congress JSON API',
        category: 'history',
        attribution: 'Library of Congress',
        timeoutMs: 4000,
        cacheTtlMs: 24 * 60 * 60 * 1000,
        limitations: 'Archival and historical reference collections.'
    },
    wikivoyage: {
        id: 'wikivoyage',
        name: 'Wikivoyage + OSRM Public APIs',
        category: 'transportation_itineraries',
        attribution: 'Wikivoyage / OpenStreetMap / OSRM',
        timeoutMs: 4500,
        cacheTtlMs: 24 * 60 * 60 * 1000,
        limitations: 'Community travel guides, POIs, and estimated road/walking routing.'
    }
});

export function getFreeLiveSources() {
    return FREE_LIVE_SOURCES;
}
