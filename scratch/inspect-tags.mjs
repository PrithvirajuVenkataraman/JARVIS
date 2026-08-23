const liteRes = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent('CM of Tamil Nadu'), {
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    }
});
const html = await liteRes.text();
console.log('HTML contains links?');
const links = html.match(/<a[^>]+href="[^"]+"[^>]*>[\s\S]*?<\/a>/gi) || [];
console.log('Total <a> tags:', links.length);
console.log('Sample <a> tags:', links.slice(0, 10));
