import assert from 'node:assert/strict';
import {
    validateAndSanitizeTemporalClaims,
    classifyTemporalStatus,
    extractEntityTarget
} from '../api/_lib/entity-verifier.js';
import { extractVerifiedLeadershipClaim } from '../api/search.js';

console.log('--- Testing Temporal Accuracy & Entity Verification Regression Suite ---');

// =========================================================================
// 1. Independent Date Verification: Date omitted cleanly when unverified
// =========================================================================
console.log('1. Verifying independent date verification (unverified dates omitted, identity retained)...');
{
    const query = 'Who is the Chief Minister of Solaris?';
    const answerWithUnverifiedDate = 'Astra Vance is the current Chief Minister of Solaris, having been in office since January 2018.';
    // Sources confirm Astra Vance is the Chief Minister, but do NOT contain or support "January 2018"
    const sources = [
        {
            title: 'Solaris Government Portal - Leadership',
            description: 'Astra Vance serves as the current Chief Minister of Solaris following the recent administrative transition.',
            domain: 'solaris.gov'
        }
    ];

    const result = validateAndSanitizeTemporalClaims(answerWithUnverifiedDate, query, sources);
    assert.equal(result.dateOmitted, true, 'Unverified date must be flagged as omitted');
    assert.equal(result.dateVerified, false, 'Unverified date must not be marked verified');
    assert.ok(result.sanitizedAnswer.includes('Astra Vance'), 'Identity of Astra Vance must be preserved');
    assert.ok(result.sanitizedAnswer.includes('Chief Minister of Solaris'), 'Role must be preserved');
    assert.ok(!result.sanitizedAnswer.includes('January 2018'), 'Unverified date must be cleanly stripped');
    console.log('  [PASS] 1.1 Unverified start date omitted cleanly while retaining correct person and role.');
}

// =========================================================================
// 2. Contradicted Date Correction: Corrected when authoritative evidence exists
// =========================================================================
console.log('2. Verifying correction of contradicted dates using authoritative evidence...');
{
    const query = 'Who is the CEO of Novacorp?';
    const answerWithWrongDate = 'Elena Rostova is the current CEO of Novacorp, in office since 2019.';
    // Authoritative source states she assumed office in 2022
    const sources = [
        {
            title: 'Novacorp Investor Relations - Executive Leadership',
            description: 'Elena Rostova assumed office as CEO of Novacorp on October 14, 2022.',
            domain: 'novacorp.com'
        }
    ];

    const result = validateAndSanitizeTemporalClaims(answerWithWrongDate, query, sources);
    assert.equal(result.dateCorrected, true, 'Contradicted date must be corrected');
    assert.ok(result.sanitizedAnswer.includes('Elena Rostova'), 'Person must be retained');
    assert.ok(result.sanitizedAnswer.includes('October 14, 2022'), 'Authoritative date must replace the incorrect date');
    assert.ok(!result.sanitizedAnswer.includes('2019'), 'Incorrect date must not appear in sanitized answer');
    console.log('  [PASS] 2.1 Contradicted date replaced by authoritative office assumption date.');
}

// =========================================================================
// 3. Predecessor & Opponent Temporal Conflation Prevention
// =========================================================================
console.log('3. Verifying prevention of predecessor / opponent entity and date conflation...');
{
    const query = 'Who is the Chief Minister of Valen State?';
    // Opponent/Actor Marcus Thorne launched a political movement; incumbent Darius Grey has been in office since May 2021
    const sources = [
        {
            title: 'Valen State Political News: Marcus Thorne party launch',
            description: 'Actor Marcus Thorne launched his party and slammed the Valen State administration. Incumbent Chief Minister Darius Grey has been in office since May 2021.',
            domain: 'valennews.com'
        },
        {
            title: 'Official Portal of Valen State Government',
            description: 'Darius Grey is the current Chief Minister of Valen State, sworn in on May 7, 2021.',
            domain: 'valen.gov'
        }
    ];

    // Case 3.1: extractVerifiedLeadershipClaim must NOT extract the opponent/actor Marcus Thorne
    const extracted = extractVerifiedLeadershipClaim(query, sources);
    assert.ok(extracted, 'Leadership claim should be successfully extracted');
    assert.equal(extracted.person, 'Darius Grey', 'Must extract incumbent Darius Grey, not opponent Marcus Thorne');

    // Case 3.2: If an answer conflated Marcus Thorne with Darius Grey\'s tenure
    const conflatedAnswer = 'Marcus Thorne is the current Chief Minister of Valen State, in office since May 2021.';
    const sanitized = validateAndSanitizeTemporalClaims(conflatedAnswer, query, sources);
    assert.equal(sanitized.entityCorrected, true, 'Must correct conflated entity to true incumbent Darius Grey');
    assert.ok(sanitized.sanitizedAnswer.includes('Darius Grey'), 'Corrected answer must name Darius Grey');
    assert.ok(!sanitized.sanitizedAnswer.includes('Marcus Thorne'), 'Opponent name must be removed from leadership position');
    console.log('  [PASS] 3.1 Opponent and predecessor date conflation prevented and corrected.');
}

// =========================================================================
// 4. Temporal Context Preservation: Distinguish Oath, Appointment, Election
// =========================================================================
console.log('4. Verifying temporal context preservation across oath, appointment, and election...');
{
    const sources = [
        {
            title: 'Official Gazette - Swearing-in Ceremony',
            description: 'Governor Sarah Lin was sworn in on January 20, 2023, following her appointment in December 2022.',
            domain: 'state.gov'
        }
    ];

    const answer = 'Sarah Lin is the Governor of Arcadia, sworn in on January 20, 2023.';
    const verified = validateAndSanitizeTemporalClaims(answer, 'Who is the Governor of Arcadia?', sources);
    assert.equal(verified.dateVerified, true, 'Explicit sworn-in date matching source must be verified');
    assert.ok(verified.sanitizedAnswer.includes('January 20, 2023'), 'Verified oath date preserved');
    console.log('  [PASS] 4.1 Explicit oath date corroborated and preserved in temporal context.');
}

// =========================================================================
// 5. Unnecessary Numbers & Tenure Duration Stripping
// =========================================================================
console.log('5. Verifying removal of unsolicited numbers and tenure durations...');
{
    const query = 'Who is the President of Zephyr Federation?';
    const answerWithUnwantedNumbers = '1. Rowan Hayes is the President of Zephyr Federation, serving for 4 years and 2 months.';
    const sources = [
        {
            title: 'Zephyr Federation Official Portal',
            description: 'Rowan Hayes is the current President of Zephyr Federation.',
            domain: 'zephyr.org'
        }
    ];

    const result = validateAndSanitizeTemporalClaims(answerWithUnwantedNumbers, query, sources);
    assert.equal(result.numbersRemoved, true, 'Unsolicited numbers and durations must be removed');
    assert.ok(!result.sanitizedAnswer.startsWith('1.'), 'Arbitrary leading numbering must be stripped');
    assert.ok(!result.sanitizedAnswer.includes('serving for 4 years'), 'Unsolicited tenure duration must be stripped');
    assert.ok(result.sanitizedAnswer.includes('Rowan Hayes is the President of Zephyr Federation'), 'Core answer preserved');

    // But if the user explicitly asks for tenure duration, duration is kept
    const durationQuery = 'How long has Rowan Hayes served as President?';
    const durationAnswer = 'Rowan Hayes has been serving for 4 years and 2 months as President.';
    const keptResult = validateAndSanitizeTemporalClaims(durationAnswer, durationQuery, sources);
    assert.equal(keptResult.numbersRemoved, false, 'Tenure duration must be retained when user explicitly asks for it');
    assert.ok(keptResult.sanitizedAnswer.includes('serving for 4 years and 2 months'));
    console.log('  [PASS] 5.1 Unsolicited arbitrary numbering and tenure calculations stripped, explicit duration queries preserved.');
}

// =========================================================================
// 6. Generic Zero-Hardcoding Invariant
// =========================================================================
console.log('6. Verifying generic dynamic capability across novel jurisdictions and roles...');
{
    const novelQuery = 'Who is the Chancellor of Neo Tokyo University?';
    const parsed = extractEntityTarget(novelQuery);
    assert.ok(parsed, 'Dynamic parser must extract entity target for arbitrary roles');
    assert.equal(parsed.role, 'Chancellor');
    assert.equal(parsed.jurisdiction, 'Neo Tokyo University');

    const sources = [
        {
            title: 'Neo Tokyo University Administration',
            description: 'Dr. Kenji Sato serves as the current Chancellor of Neo Tokyo University.',
            domain: 'neotokyo.ac.jp'
        }
    ];

    const answer = 'Dr. Kenji Sato is the current Chancellor of Neo Tokyo University.';
    const result = validateAndSanitizeTemporalClaims(answer, novelQuery, sources);
    assert.ok(result.sanitizedAnswer.includes('Dr. Kenji Sato'));
    assert.ok(result.sanitizedAnswer.includes('Chancellor of Neo Tokyo University'));
    console.log('  [PASS] 6.1 Generic dynamic execution across novel entities without hardcoded lists.');
}

console.log('--- ALL TEMPORAL ENTITY REGRESSION TESTS PASSED ---');
