import fs from 'fs';

const liteRes = await fetch('https://lite.duckduckgo.com/lite/', {
    method: 'POST',
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: `q=${encodeURIComponent('CM of Tamil Nadu')}`
});

const html = await liteRes.text();

// Parse table rows in DDG lite
const results = [];
const linkRegex = /<a[^>]+class="result-link"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
const snippetRegex = /<td[^>]+class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;

let match;
while ((match = linkRegex.exec(html)) !== null) {
    let url = match[1];
    if (url.includes('uddg=')) {
        try {
            const u = /uddg=([^&]+)/.exec(url);
            if (u) url = decodeURIComponent(u[1]);
        } catch (_) {}
    }
    const title = match[2].replace(/<[^>]+>/g, '').trim();
    results.push({ title, url });
}

let sMatch, i = 0;
while ((sMatch = snippetRegex.exec(html)) !== null && i < results.length) {
    results[i].snippet = sMatch[1].replace(/<[^>]+>/g, '').trim();
    i++;
}

console.log('Parsed DDG Lite Results count:', results.length);
console.log('Results:', JSON.stringify(results.slice(0, 5), null, 2));
