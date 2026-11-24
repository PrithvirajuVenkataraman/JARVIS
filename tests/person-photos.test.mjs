import test from 'node:test';
import assert from 'node:assert/strict';
import { personPhotoQuery, personPhotoSubject } from '../app/person-photo-query.js';
import { isImageGenerationIntent } from '../app/frontend-routing.js';
import { imageDate, commonsImage, resolvePersonPhoto } from '../api/_lib/person-photos.js';

function file(title, date, extra = {}) {
    return { title: `File:${title}.jpg`, imageinfo: [{ mime: 'image/jpeg', url: `https://upload.wikimedia.org/wikipedia/commons/a/ab/${title}.jpg`, descriptionurl: `https://commons.wikimedia.org/wiki/File:${title}.jpg`, width: 600, height: 800, timestamp: '2026-10-01T12:00:00Z', extmetadata: { DateTimeOriginal: { value: date }, Artist: { value: '<b>Example photographer</b>' }, ImageDescription: { value: 'Photograph of the subject' }, LicenseShortName: { value: 'CC BY 4.0' }, ...extra } }] };
}

test('person queries accept explicit names and photo requests without treating vague follow-ups as new people', () => {
    assert.equal(personPhotoQuery('Who is José Andrés?'), 'José Andrés');
    assert.equal(personPhotoQuery('Show me the latest photo of Example Person.'), 'Example Person');
    assert.equal(personPhotoQuery('Example Person latest pictures'), 'Example Person');
    for (const query of ['What was it?', 'his latest photo', 'Describe this picture', 'Explain the above']) assert.equal(personPhotoQuery(query), '');
    assert.equal(personPhotoQuery('Example Person', { status: 'ambiguous' }), '');
    assert.equal(personPhotoQuery('Example Person', { evidenceIds: ['earlier-turn'] }), '');
    assert.equal(isImageGenerationIntent('Show me the latest photo of Example Person'), false);
    assert.equal(isImageGenerationIntent('Create a portrait of Example Person'), true);
    assert.equal(personPhotoQuery('Actor Example Person', { status: 'missing' }), 'Actor Example Person');
    assert.deepEqual(personPhotoSubject('Who is actress Example Person?'), { query: 'actress Example Person', name: 'Example Person', role: 'actor' });
    assert.equal(personPhotoSubject('Example Person (actor)').role, 'actor');
});

test('photo dates use source image metadata, reject impossible/future dates, and never use upload dates', () => {
    const now = new Date('2026-11-24T00:00:00Z');
    assert.equal(imageDate('2024-02-29 12:30:00', now), '2024-02-29');
    for (const value of ['2025-02-29', '2026-13-01', '2027-01-01', 'next week']) assert.equal(imageDate(value, now), null);
    assert.equal(commonsImage(file('Undated', ''), now).imageDate, null);
    assert.equal(commonsImage(file('Photograph', '2024-01-02'), now).author, 'Example photographer');
    assert.equal(commonsImage(file('Watercolor', '2025-01-02', { ImageDescription: { value: 'Watercolor portrait' } }), now), null);
    assert.equal(commonsImage(file('Digital_Painting', '2025-01-02'), now), null);
});

test('person lookup verifies human identity and ranks photograph dates instead of upload recency', async () => {
    const original = globalThis.fetch; const calls = [];
    globalThis.fetch = async input => {
        const url = new URL(input); calls.push(url);
        if (url.hostname === 'en.wikipedia.org') return Response.json({ title: 'Example Person Alpha', extract: 'Example Person Alpha is a scientist.', description: 'Scientist', wikibase_item: 'Q123456', thumbnail: { source: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Reference.jpg' } });
        if (url.hostname === 'www.wikidata.org') return Response.json({ claims: { P31: [{ mainsnak: { datavalue: { value: { id: 'Q5' } } } }] } });
        assert.equal(url.hostname, 'commons.wikimedia.org');
        const pages = url.searchParams.has('titles') ? [file('Reference', '2020-01-01')] : [file('New_Photo', '2024-06-04'), file('Old_Photo', '2019-01-01'), file('Painting', '2025-01-01')];
        return Response.json({ query: { pages } });
    };
    try {
        const result = await resolvePersonPhoto('Who is Example Person Alpha?');
        assert.equal(result.entity.isPerson, true); assert.equal(result.entity.image.imageDate, '2024-06-04');
        assert.match(result.entity.image.url, /New_Photo/); assert.equal(result.entity.image.license, 'CC BY 4.0');
        assert.ok(calls.filter(url => url.hostname === 'commons.wikimedia.org').every(url => url.searchParams.has('titles') || url.searchParams.get('gsrsearch').includes('P180=Q123456')));
        const before = calls.length; await resolvePersonPhoto('Example Person Alpha'); assert.equal(calls.length, before, 'Only public lookup metadata is cached');
    } finally { globalThis.fetch = original; }
});

test('companies, canceled lookups and ambiguous references do not acquire person photographs', async () => {
    const original = globalThis.fetch; let calls = 0;
    globalThis.fetch = async input => {
        calls++;
        if (String(input).includes('en.wikipedia.org')) return Response.json({ title: 'Example Company Beta', extract: 'Example Company Beta is a company.', description: 'Software company', wikibase_item: 'Q654321', thumbnail: { source: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Logo.jpg' } });
        assert.match(String(input), /wikidata\.org/); return Response.json({ claims: { P31: [{ mainsnak: { datavalue: { value: { id: 'Q43229' } } } }] } });
    };
    try {
        assert.equal(await resolvePersonPhoto('Example Company Beta'), null); assert.equal(calls, 2);
        const controller = new AbortController(); controller.abort();
        assert.equal(await resolvePersonPhoto('Other Person', { signal: controller.signal }), null);
        assert.equal(await resolvePersonPhoto('Another Person', { reference: { status: 'ambiguous' } }), null);
        assert.equal(calls, 2);
    } finally { globalThis.fetch = original; }
});

test('shared-name disambiguation pages never choose a person arbitrarily', async () => {
    const original = globalThis.fetch; let calls = 0;
    globalThis.fetch = async input => {
        calls++; assert.match(String(input), /en\.wikipedia\.org/);
        return Response.json({ title: 'Example Shared Name', type: 'disambiguation', extract: 'This name refers to several people.' });
    };
    try { assert.equal(await resolvePersonPhoto('Example Shared Name'), null); assert.equal(calls, 1); }
    finally { globalThis.fetch = original; }
});

test('role-qualified person photos follow verified aliases after a canonical article rename', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async input => {
        const url = new URL(input);
        if (url.hostname === 'en.wikipedia.org') {
            assert.equal(url.searchParams.get('gsrsearch'), 'Example Alias actor');
            return Response.json({ query: { pages: [
                { title: 'Current Public Name', pageid: 1, pageprops: { wikibase_item: 'Q987654' }, redirects: [{ title: 'Example Alias (Actor)' }], thumbnail: { source: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Reference.jpg' } },
                { title: 'Different Example Alias', pageprops: { wikibase_item: 'Q9999' }, extract: 'Another actor.' }
            ] } });
        }
        if (url.hostname === 'www.wikidata.org') { assert.equal(url.searchParams.get('entity'), 'Q987654'); return Response.json({ claims: { P31: [{ mainsnak: { datavalue: { value: { id: 'Q5' } } } }] } }); }
        return Response.json({ query: { pages: [file('Alias_Photograph', '2025-02-03')] } });
    };
    try {
        const result = await resolvePersonPhoto('Actor Example Alias');
        assert.equal(result.entity.name, 'Current Public Name'); assert.equal(result.entity.wikidataId, 'Q987654'); assert.equal(result.entity.image.imageDate, '2025-02-03');
    } finally { globalThis.fetch = original; }
});

test('role-qualified aliases shared by multiple people stay unresolved', async () => {
    const original = globalThis.fetch; let calls = 0;
    globalThis.fetch = async () => { calls++; return Response.json({ query: { pages: ['Q1111', 'Q2222'].map(id => ({ title: id, pageprops: { wikibase_item: id }, redirects: [{ title: 'Ambiguous Alias (actor)' }] })) } }); };
    try { assert.equal(await resolvePersonPhoto('Actor Ambiguous Alias'), null); assert.equal(calls, 1); }
    finally { globalThis.fetch = original; }
});
