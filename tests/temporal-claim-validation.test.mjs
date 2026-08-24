import assert from 'node:assert/strict';
import { __test, parseGovernmentRoleQuery, rankSources } from '../api/search.js';

const {
    validateClaimTemporalStatus,
    isCurrentStateQuery,
    hasObviousRagConflict,
    buildSourceDerivedAnswer,
    roleClaimOverlapsWindow
} = __test;

function fixtureSubject(value) {
    return String(value || '');
}

console.log('--- Section 1: Temporal Status Classification ---');
{
    const currentClaim = {
        holderName: 'M. K. Stalin',
        role: 'chief minister',
        jurisdiction: 'Tamil Nadu',
        startDate: '2021-05-07',
        endDate: ''
    };
    assert.equal(validateClaimTemporalStatus(currentClaim), 'current');

    const historicalClaim = {
        holderName: 'Edappadi K. Palaniswami',
        role: 'chief minister',
        jurisdiction: 'Tamil Nadu',
        startDate: '2017-02-16',
        endDate: '2021-05-06'
    };
    assert.equal(validateClaimTemporalStatus(historicalClaim), 'historical');

    const futureClaim = {
        holderName: 'Future Leader',
        role: 'president',
        jurisdiction: 'Mars',
        startDate: '2099-01-01',
        endDate: ''
    };
    assert.equal(validateClaimTemporalStatus(futureClaim), 'future');

    const unknownClaim = {
        title: 'Tamil Nadu Council of Ministers',
        description: 'General description of office'
    };
    assert.equal(validateClaimTemporalStatus(unknownClaim), 'unknown');

    const officialClaim = {
        holderName: 'M. K. Stalin',
        evidenceLevel: 'official_current_holder'
    };
    assert.equal(validateClaimTemporalStatus(officialClaim), 'current');
    console.log('  [PASS] 1.1 Temporal status classifies current, historical, future, and unknown claims');
}

console.log('--- Section 2: Current vs Historical Query Intent Detection ---');
{
    assert.equal(isCurrentStateQuery('Who is the current CM of Tamil Nadu?'), true);
    assert.equal(isCurrentStateQuery('Current Prime Minister of UK'), true);
    assert.equal(isCurrentStateQuery('Who is the CEO of Apple?'), true);
    assert.equal(isCurrentStateQuery('CM of Tamil Nadu in 2015'), false);
    assert.equal(isCurrentStateQuery('Prime Minister of UK in 2020'), false);
    assert.equal(isCurrentStateQuery('CEO of Apple in 2010'), false);
    assert.equal(isCurrentStateQuery('Former CM of Tamil Nadu'), false);
    assert.equal(isCurrentStateQuery('Past Prime Minister of UK'), false);
    console.log('  [PASS] 2.1 Current vs historical intent detected accurately across CM/PM/CEO queries');
}

console.log('--- Section 3: Temporal Succession vs Real Conflict Resolution ---');
{
    const stalinClaim = {
        holderName: 'M. K. Stalin',
        role: 'chief minister',
        jurisdiction: 'Tamil Nadu',
        startDate: '2021-05-07',
        endDate: ''
    };
    const epsClaim = {
        holderName: 'Edappadi K. Palaniswami',
        role: 'chief minister',
        jurisdiction: 'Tamil Nadu',
        startDate: '2017-02-16',
        endDate: '2021-05-06'
    };

    // Succession: One is current, one is historical -> NOT a conflict
    assert.equal(hasObviousRagConflict([stalinClaim, epsClaim], 'Who is the current CM of Tamil Nadu?'), false);

    // Conflict: Two distinct holders both claiming to be currently active
    const competingClaim = {
        holderName: 'Another Candidate',
        role: 'chief minister',
        jurisdiction: 'Tamil Nadu',
        startDate: '2022-01-01',
        endDate: ''
    };
    assert.equal(hasObviousRagConflict([stalinClaim, competingClaim], 'Who is the current CM of Tamil Nadu?'), true);
    console.log('  [PASS] 3.1 Temporal succession correctly resolved without false conflict alerts');
}

console.log('--- Section 4: CM Queries (Tamil Nadu Current vs Historical) ---');
{
    const stalin = {
        title: 'M. K. Stalin - Chief Minister of Tamil Nadu',
        holderName: 'M. K. Stalin',
        role: 'chief minister',
        jurisdiction: 'Tamil Nadu',
        startDate: '2021-05-07',
        endDate: '',
        evidenceLevel: 'structured_claim',
        url: 'https://www.wikidata.org/wiki/Q6712771'
    };
    const eps = {
        title: 'Edappadi K. Palaniswami - former Chief Minister of Tamil Nadu',
        holderName: 'Edappadi K. Palaniswami',
        role: 'chief minister',
        jurisdiction: 'Tamil Nadu',
        startDate: '2017-02-16',
        endDate: '2021-05-06',
        evidenceLevel: 'structured_claim',
        url: 'https://www.wikidata.org/wiki/Q5335750'
    };
    const jayalalithaa = {
        title: 'J. Jayalalithaa - former Chief Minister of Tamil Nadu',
        holderName: 'J. Jayalalithaa',
        role: 'chief minister',
        jurisdiction: 'Tamil Nadu',
        startDate: '2015-05-23',
        endDate: '2016-12-05',
        evidenceLevel: 'structured_claim',
        url: 'https://www.wikidata.org/wiki/Q465039'
    };

    // 4.1 Current CM query: Stalin must rank #1
    const currentResults = rankSources('Who is the current CM of Tamil Nadu?', [eps, stalin, jayalalithaa]);
    assert.equal(currentResults[0].holderName, 'M. K. Stalin');

    const currentAnswer = buildSourceDerivedAnswer(currentResults, { query: 'Who is the current CM of Tamil Nadu?' });
    assert.equal(currentAnswer.provider, 'wikidata_structured_claim');
    assert.match(currentAnswer.answer, /M\. K\. Stalin/);

    // 4.2 Historical CM query (2015): Jayalalithaa must rank #1
    const historicalResults = rankSources('Who was the CM of Tamil Nadu in 2015?', [eps, stalin, jayalalithaa]);
    assert.equal(historicalResults[0].holderName, 'J. Jayalalithaa');

    const historicalAnswer = buildSourceDerivedAnswer(historicalResults, { query: 'Who was the CM of Tamil Nadu in 2015?' });
    assert.equal(historicalAnswer.provider, 'wikidata_dated_structured_claim');
    assert.match(historicalAnswer.answer, /Jayalalithaa/);
    console.log('  [PASS] 4.1 Current & historical CM queries correctly prioritize active vs dated holders');
}

console.log('--- Section 5: PM Queries (UK Prime Minister Current vs Historical) ---');
{
    const starmer = {
        title: 'Keir Starmer - Prime Minister of the United Kingdom',
        holderName: 'Keir Starmer',
        role: 'prime minister',
        jurisdiction: 'United Kingdom',
        startDate: '2024-07-05',
        endDate: '',
        evidenceLevel: 'structured_claim',
        url: 'https://www.wikidata.org/wiki/Q6383634'
    };
    const sunak = {
        title: 'Rishi Sunak - former Prime Minister of the United Kingdom',
        holderName: 'Rishi Sunak',
        role: 'prime minister',
        jurisdiction: 'United Kingdom',
        startDate: '2022-10-25',
        endDate: '2024-07-05',
        evidenceLevel: 'structured_claim',
        url: 'https://www.wikidata.org/wiki/Q20055561'
    };
    const johnson = {
        title: 'Boris Johnson - former Prime Minister of the United Kingdom',
        holderName: 'Boris Johnson',
        role: 'prime minister',
        jurisdiction: 'United Kingdom',
        startDate: '2019-07-24',
        endDate: '2022-09-06',
        evidenceLevel: 'structured_claim',
        url: 'https://www.wikidata.org/wiki/Q180589'
    };

    // 5.1 Current PM query: Starmer must rank #1
    const currentPMResults = rankSources('Current Prime Minister of UK', [sunak, starmer, johnson]);
    assert.equal(currentPMResults[0].holderName, 'Keir Starmer');

    const currentPMAnswer = buildSourceDerivedAnswer(currentPMResults, { query: 'Current Prime Minister of UK' });
    assert.equal(currentPMAnswer.provider, 'wikidata_structured_claim');
    assert.match(currentPMAnswer.answer, /Keir Starmer/);

    // 5.2 Historical PM query (2020): Boris Johnson must rank #1
    const historicalPMResults = rankSources('Prime Minister of UK in 2020', [starmer, sunak, johnson]);
    assert.equal(historicalPMResults[0].holderName, 'Boris Johnson');

    const historicalPMAnswer = buildSourceDerivedAnswer(historicalPMResults, { query: 'Prime Minister of UK in 2020' });
    assert.equal(historicalPMAnswer.provider, 'wikidata_dated_structured_claim');
    assert.match(historicalPMAnswer.answer, /Boris Johnson/);
    console.log('  [PASS] 5.1 Current & historical PM queries correctly prioritize active vs dated holders');
}

console.log('--- Section 6: CEO Queries (Apple CEO Current vs Historical) ---');
{
    const timCook = {
        title: fixtureSubject('Tim Cook - CEO of Apple'),
        holderName: 'Tim Cook',
        role: 'ceo',
        jurisdiction: 'Apple',
        startDate: '2011-08-24',
        endDate: '',
        evidenceLevel: 'structured_claim',
        url: 'https://www.wikidata.org/wiki/Q265'
    };
    const steveJobs = {
        title: fixtureSubject('Steve Jobs - former CEO of Apple'),
        holderName: 'Steve Jobs',
        role: 'ceo',
        jurisdiction: 'Apple',
        startDate: '1997-09-16',
        endDate: '2011-08-24',
        evidenceLevel: 'structured_claim',
        url: 'https://www.wikidata.org/wiki/Q19837'
    };

    // 6.1 Current CEO query: Tim Cook must rank #1
    const currentCEOResults = rankSources('Who is the current CEO of Apple?', [steveJobs, timCook]);
    assert.equal(currentCEOResults[0].holderName, 'Tim Cook');

    const currentCEOAnswer = buildSourceDerivedAnswer(currentCEOResults, { query: 'Who is the current CEO of Apple?' });
    assert.equal(currentCEOAnswer.provider, 'wikidata_structured_claim');
    assert.match(currentCEOAnswer.answer, /Tim Cook/);

    // 6.2 Historical CEO query (2010): Steve Jobs must rank #1
    const historicalCEOResults = rankSources('Who was the CEO of Apple in 2010?', [timCook, steveJobs]);
    assert.equal(historicalCEOResults[0].holderName, 'Steve Jobs');

    const historicalCEOAnswer = buildSourceDerivedAnswer(historicalCEOResults, { query: 'Who was the CEO of Apple in 2010?' });
    assert.equal(historicalCEOAnswer.provider, 'wikidata_dated_structured_claim');
    assert.match(historicalCEOAnswer.answer, /Steve Jobs/);
    console.log('  [PASS] 6.1 Current & historical CEO queries correctly prioritize active vs dated holders');
}

console.log('================================================================');
console.log('=== All Temporal Claim Validation & Grounding Tests PASSED ===');
console.log('================================================================');

