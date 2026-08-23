import { searchPublicSources } from '../api/search.js';

console.log('Testing searchPublicSources for CM of Tamil Nadu...');
const results = await searchPublicSources('CM of Tamil Nadu', { limit: 8 });
console.log('Found results count:', results.length);
console.log('Results summary:');
for (const r of results.slice(0, 6)) {
    console.log(`- [${r.domain || r.source}] ${r.title} => ${r.description?.slice(0, 100)}`);
}
