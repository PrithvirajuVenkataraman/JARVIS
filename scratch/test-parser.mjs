const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent('CM of Tamil Nadu')}`;
const response = await fetch(url, {
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    }
});

const html = await response.text();

function parseDuckDuckGoHtml(html) {
    const results = [];
    const linkRegex = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    const snippetRegex = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

    const links = [];
    let match;
    while ((match = linkRegex.exec(html)) !== null) {
        let rawUrl = match[1];
        if (rawUrl.includes('uddg=')) {
            try {
                const u = /uddg=([^&]+)/.exec(rawUrl);
                if (u) rawUrl = decodeURIComponent(u[1]);
            } catch (_) {}
        }
        const title = match[2].replace(/<[^>]+>/g, '').trim();
        links.push({ title, url: rawUrl });
    }

    const snippets = [];
    let sMatch;
    while ((sMatch = snippetRegex.exec(html)) !== null) {
        snippets.push(sMatch[1].replace(/<[^>]+>/g, '').trim());
    }

    for (let i = 0; i < links.length; i++) {
        results.push({
            title: links[i].title,
            url: links[i].url,
            description: snippets[i] || '',
            domain: new URL(links[i].url).hostname
        });
    }
    return results;
}

const parsed = parseDuckDuckGoHtml(html);
console.log('Successfully Parsed DDG count:', parsed.length);
console.log('Sample parsed:', JSON.stringify(parsed.slice(0, 5), null, 2));
