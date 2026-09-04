export function validateEnv() {
  const groqKey = process.env.GROQ_API_KEY || '';
  const geminiKey = process.env.GEMINI_API_KEY || '';
  return { groqKey: groqKey || null, geminiKey: geminiKey || null };
}

export const APP_CONFIG = Object.freeze({
  version: "2.0.0",
  endpoints: Object.freeze({
    chatGroq: '/api/chat-groq',
    search: '/api/search',
    extractUrl: '/api/extract-url',
    markets: '/api/markets',
    currentFacts: '/api/current-facts',
    rankTexts: '/api/rank-texts',
    vision: '/api/vision',
    diagnostics: '/api/diagnostics',
    verify: '/api/verify',
    serviceWorker: '/sw.js'
  }),
  externalUrls: Object.freeze({
    googleNews: 'https://news.google.com',
    googleMapsSearch: 'https://www.google.com/maps/search/',
    googleWebSearch: 'https://www.google.com/search',
    duckDuckGoHtml: 'https://html.duckduckgo.com/html/',
    wikipediaRestSummary: 'https://en.wikipedia.org/api/rest_v1/page/summary/',
    wikipediaActionQuery: 'https://en.wikipedia.org/w/api.php',
    nominatimReverse: 'https://nominatim.openstreetmap.org/reverse',
    nominatimSearch: 'https://nominatim.openstreetmap.org/search',
    openMeteoForecast: 'https://api.open-meteo.com/v1/forecast',
    openMeteoGeocoding: 'https://geocoding-api.open-meteo.com/v1/search',
    coinGeckoSimplePrice: 'https://api.coingecko.com/api/v3/simple/price',
    yahooFinanceChart: 'https://query1.finance.yahoo.com/v8/finance/chart/'
  }),
  timeouts: Object.freeze({
    fetchDefaultMs: 35000,
    searchMs: 15000,
    diagnosticsMs: 12000,
    thinkingFloorMs: 500,
    thinkingCeilingMs: 10000,
    geolocationMs: 6000,
    geolocationCacheMs: 300000,
    visionContextTtlMs: 600000,
    multimodalContextTtlMs: 1200000,
    assistantRecoveryMs: 20000,
    summaryTimeoutMs: 4500,
    objectUrlRevokeMs: 1500,
    toastFadeMs: 300,
    toastDurationMs: 2400,
    copyResetMs: 1800
  }),
  limits: Object.freeze({
    maxPromptLength: 1200,
    textExtractLimit: 12000,
    maxMessagesPerSession: 160,
    maxSavedSessions: 80,
    historyLimit: 50,
    memoryLimit: 3,
    candidateLimit: 40
  }),
  storage: Object.freeze({
    dbName: 'jarvis_database_v1',
    dbVersion: 1,
    objectStores: Object.freeze({
      kv: 'kv_store',
      sessions: 'sessions'
    }),
    keys: Object.freeze({
      chatSessions: 'jarvis_chat_sessions_v1',
      activeDraft: 'jarvis_active_empty_chat_draft_v1',
      deletedSessionIds: 'jarvis_deleted_chat_session_ids_v1',
      deletedSessionTitles: 'jarvis_deleted_chat_session_titles_v1',
      learnedPreferences: 'jarvis_learned_preferences',
      bookmarkedMessages: 'jarvis_bookmarked_messages',
      userProfile: 'jarvis_user_profile',
      memoryItems: 'jarvis_memory_items',
      memoryTombstones: 'jarvis_memory_tombstones',
      interactionMetrics: 'jarvis_interaction_metrics'
    })
  }),
  defaults: Object.freeze({
    theme: 'dark',
    persistMemoryToDevice: true,
    medicalMode: false,
    visionShowEvidence: true,
    supportConversationMode: false,
    showRoutingDebugBadge: false
  })
});

