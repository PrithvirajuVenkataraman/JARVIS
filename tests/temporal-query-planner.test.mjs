import assert from 'node:assert/strict';
import {
    resolveTemporalFrame,
    classifyTemporalScope,
    distillTemporalTopic,
    planTemporalSearchQueries
} from '../api/_lib/temporal-query-planner.js';

console.log('=== Testing DeepMind-Grade Temporal Query Planner Suite ===\n');

// -------------------------------------------------------------------------
// Section 1: Temporal Reference Frame Calculus
// -------------------------------------------------------------------------
console.log('--- Section 1: Mathematical Reference Frame Calculus ---');

// Test with fixed epoch for deterministic verification: Oct 9, 2026 UTC
const testEpoch = new Date(Date.UTC(2026, 9, 9, 14, 30, 0)); // Month index 9 = October
const frame = resolveTemporalFrame(testEpoch);

assert.equal(frame.year, 2026, 'Year must be 2026');
assert.equal(frame.month, 10, 'Month must be 10');
assert.equal(frame.day, 9, 'Day must be 9');
assert.equal(frame.monthName, 'October', 'Month name must be October');
assert.equal(frame.monthShort, 'Oct', 'Short month name must be Oct');
assert.equal(frame.isoYearMonth, '2026-10', 'ISO year-month must be 2026-10');
assert.equal(frame.isoDate, '2026-10-09', 'ISO date must be 2026-10-09');
assert.equal(frame.quarter, 'Q4', 'October must be Q4');
assert.equal(frame.weekdayName, 'Friday', 'Oct 9, 2026 must be Friday');
assert.ok(frame.isoWeek >= 40 && frame.isoWeek <= 42, 'ISO week must be ~41');

console.log('  [PASS] 1.1 Temporal reference frame properties computed accurately via Intl calendar math.');

// -------------------------------------------------------------------------
// Section 2: Temporal Scope & Interval Classification
// -------------------------------------------------------------------------
console.log('\n--- Section 2: Temporal Scope Classification ---');

// 2.1 Immediate / Today
const todayScope = classifyTemporalScope('wildfire evacuation orders today right now', frame);
assert.equal(todayScope.scope, 'IMMEDIATE_DAY');
assert.equal(todayScope.isTimeSensitive, true);
assert.equal(todayScope.filter.ddg, 'd');
assert.equal(todayScope.filter.searx, 'day');
console.log('  [PASS] 2.1 Immediate queries map to IMMEDIATE_DAY with 24h filter.');

// 2.2 Weekly / Recent Days
const weekScope = classifyTemporalScope('OpenAI copyright lawsuit developments this week', frame);
assert.equal(weekScope.scope, 'RECENT_WEEK');
assert.equal(weekScope.isTimeSensitive, true);
assert.equal(weekScope.filter.ddg, 'w');
assert.equal(weekScope.filter.searx, 'week');
console.log('  [PASS] 2.2 Relative week queries map to RECENT_WEEK with 7d filter.');

// 2.3 Monthly
const monthScope = classifyTemporalScope('Federal Reserve interest rate decisions this month', frame);
assert.equal(monthScope.scope, 'CURRENT_MONTH');
assert.equal(monthScope.isTimeSensitive, true);
assert.equal(monthScope.filter.ddg, 'm');
assert.equal(monthScope.filter.searx, 'month');
console.log('  [PASS] 2.3 Relative month queries map to CURRENT_MONTH with 30d filter.');

// 2.4 Annual
const yearScope = classifyTemporalScope('Global renewable energy capacity additions this year', frame);
assert.equal(yearScope.scope, 'CURRENT_YEAR');
assert.equal(yearScope.isTimeSensitive, true);
assert.equal(yearScope.filter.ddg, 'y');
assert.equal(yearScope.filter.searx, 'year');
console.log('  [PASS] 2.4 Relative year queries map to CURRENT_YEAR with 365d filter.');

// 2.5 Historical Anchored
const histScope = classifyTemporalScope('Apollo 11 moon landing mission in 1969', frame);
assert.equal(histScope.scope, 'HISTORICAL_ANCHORED');
assert.equal(histScope.isTimeSensitive, false);
assert.equal(histScope.targetYear, 1969);
assert.equal(histScope.filter, null);
console.log('  [PASS] 2.5 Historical queries accurately preserve historical anchor year without freshness bias.');

// 2.6 Timeless / Unconstrained
const timelessScope = classifyTemporalScope('How does the human circulatory system work?', frame);
assert.equal(timelessScope.scope, 'UNCONSTRAINED');
assert.equal(timelessScope.isTimeSensitive, false);
assert.equal(timelessScope.filter, null);
console.log('  [PASS] 2.6 Timeless scientific queries cleanly classified as UNCONSTRAINED.');

// -------------------------------------------------------------------------
// Section 3: Multi-Resolution Temporal Query Plan Generation
// -------------------------------------------------------------------------
console.log('\n--- Section 3: Multi-Resolution Temporal Query Planning ---');

const planWeek = planTemporalSearchQueries('OpenAI copyright lawsuit developments this week', {
    referenceEpoch: testEpoch
});

assert.equal(planWeek.scope, 'RECENT_WEEK');
assert.equal(planWeek.isTimeSensitive, true);
assert.equal(planWeek.filter.ddg, 'w');
assert.ok(planWeek.queries.length >= 2, 'Must generate multiple resolution queries');
assert.ok(planWeek.queries.some(q => q.includes('October 2026')), 'Must plan month name + year anchor: "October 2026"');
assert.ok(planWeek.queries.some(q => q.includes('2026-10')), 'Must plan ISO anchor: "2026-10"');
assert.ok(planWeek.queries.some(q => q.includes('2026')), 'Must plan year anchor: "2026"');
console.log(`  Planned queries for "this week":\n    ${planWeek.queries.join('\n    ')}`);
console.log('  [PASS] 3.1 Weekly query plan generates active calendar month and ISO anchors.');

const planHistorical = planTemporalSearchQueries('James Webb Space Telescope first images released in 2022', {
    referenceEpoch: testEpoch
});

assert.equal(planHistorical.scope, 'HISTORICAL_ANCHORED');
assert.ok(planHistorical.queries.every(q => !q.includes('2026')), 'Must never pollute historical query with current year (2026)');
assert.ok(planHistorical.queries.some(q => q.includes('2022')), 'Must retain historical target year (2022)');
console.log('  [PASS] 3.2 Historical query plan strictly shields past records from current date pollution.');

const planTimeless = planTemporalSearchQueries('Explain the mechanism of CRISPR Cas9 gene editing', {
    referenceEpoch: testEpoch
});
assert.equal(planTimeless.scope, 'UNCONSTRAINED');
assert.ok(planTimeless.queries.every(q => !q.includes('2026')), 'Timeless queries must not append dates');
console.log('  [PASS] 3.3 Timeless queries remain unpolluted by dates.');

console.log('\n=== ALL TEMPORAL QUERY PLANNER TESTS PASSED (100%) ===\n');
