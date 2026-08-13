#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HARDCODED_CONTENT_ALLOWLIST } from './hardcoded-content-allowlist.mjs';

export const SCANNER_VERSION = 'hardcoded-content-scanner-v2';

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = path.join(tmpdir(), 'unify-hardcoded-content-scanner');

const SCAN_EXTENSIONS = new Set(['.html', '.js', '.mjs', '.ts', '.css', '.md', '.json']);
const SCAN_DIRS = new Set(['api', 'app', 'tests', 'tools']);
const ROOT_FILES = new Set(['index.html', 'README.md', 'package.json']);
const SKIP_PARTS = new Set(['node_modules', '.git', '.cache', 'dist', 'build']);
const SKIP_FILES = new Set([
    path.normalize('tests/hygiene-scanner.test.mjs'),
    path.normalize('tools/hardcoded-content-scanner.mjs'),
    path.normalize('tools/hardcoded-content-allowlist.mjs')
]);

const PROHIBITED_SYMBOL_PATTERNS = Object.freeze([
    { pattern: /\bSITCOM_MOVIE_REFERENCE_CATALOG\b/, category: 'runtime_content', reason: 'Removed sitcom/movie knowledge catalog returned.' },
    { pattern: /\bdetectSitcomMovieReference\b/, category: 'runtime_content', reason: 'Removed local sitcom/movie detector returned.' },
    { pattern: /\bbuildSitcomMovieReferenceResponse\b/, category: 'runtime_content', reason: 'Removed canned sitcom/movie response builder returned.' },
    { pattern: /\bhandleSitcomMovieReference\b/, category: 'runtime_content', reason: 'Removed sitcom/movie short-circuit returned.' },
    { pattern: /\bOFFICIAL_SOURCE_SHORTCUTS\b/, category: 'runtime_content', reason: 'Named official-source shortcut catalog returned.' },
    { pattern: /\bgetOfficialSourceShortcuts\b/, category: 'runtime_content', reason: 'Named official-source shortcut path returned.' },
    { pattern: /\bgetCuratedSongsForArtist\b/, category: 'runtime_content', reason: 'Curated artist song catalog helper returned.' },
    { pattern: /\bgetCuratedLanguageEraHits\b/, category: 'runtime_content', reason: 'Curated language-era song catalog helper returned.' },
    { pattern: /\bknownArtistCorrections\b|\btypoMap\b/, category: 'runtime_content', reason: 'Named local subject correction table returned.' }
]);

const PROHIBITED_NAMED_CONTENT = Object.freeze([
    'Jordan Vale',
    'Workplace Crew',
    'Riley Stone',
    'Example Corp',
    'Example Labs',
    'Sample Actor',
    'Nothing Phone',
    'Framework Laptop',
    'Schmosby',
    'Michael Scott',
    'Chandler Bing',
    'Ed Sheeran',
    'Sean Roldan',
    'Sundari',
    'Billie Jean',
    'Shape of You'
]);

const CATALOG_LITERAL_PATTERNS = Object.freeze([
    { pattern: /\{\s*song\s*:\s*['"`]/, reason: 'Runtime local song row literal detected.' },
    { pattern: /\{\s*(?:character|show|movie|film)\s*:\s*['"`]/, reason: 'Runtime local entertainment reference row literal detected.' },
    { pattern: /\b(?:catalog|curated)\w*\s*=\s*(?:Object\.freeze\()?[\[{]/i, reason: 'Runtime local curated/catalog data structure detected.' }
]);

const allowlist = HARDCODED_CONTENT_ALLOWLIST.map((entry, index) => {
    assert.equal(typeof entry.reason, 'string', `allowlist entry ${index} must include a reason`);
    assert.ok(entry.reason.trim().length >= 12, `allowlist entry ${index} reason is too short`);
    return {
        ...entry,
        regex: new RegExp(entry.pattern, 'i')
    };
});

export function stableHash(value) {
    return createHash('sha256').update(String(value)).digest('hex');
}

export function tokenizeContent(content) {
    return Array.from(new Set(String(content || '')
        .match(/[A-Za-z][A-Za-z0-9_.'-]*/g) || []));
}

export function extractStringLiterals(content) {
    const literals = [];
    const source = String(content || '');
    for (let i = 0; i < source.length; i++) {
        const quote = source[i];
        if (quote !== '\'' && quote !== '"' && quote !== '`') continue;
        const start = i;
        let value = '';
        i += 1;
        while (i < source.length) {
            const char = source[i];
            if (char === '\\') {
                value += char;
                if (i + 1 < source.length) {
                    value += source[i + 1];
                    i += 2;
                    continue;
                }
                i += 1;
                continue;
            }
            if (char === quote) break;
            value += char;
            i += 1;
        }
        literals.push({
            quote,
            value,
            index: start
        });
    }
    return literals;
}

export function extractIdentifierLikeNames(content) {
    const names = String(content || '').match(/\b[A-Z][A-Za-z0-9]*(?:\s+[A-Z][A-Za-z0-9]*){1,5}\b/g) || [];
    return Array.from(new Set(names));
}

export function scanContent(content, options = {}) {
    const filePath = normalizeSlashes(options.filePath || '<memory>');
    const rel = normalizeSlashes(options.relativePath || filePath);
    const isTest = /(^|\/)tests\//.test(rel);
    const findings = [];
    const source = String(content || '');
    const stringLiterals = extractStringLiterals(source);
    const literalText = stringLiterals.map(item => item.value).join('\n');

    function isAllowed(value) {
        return allowlist.some(entry => entry.regex.test(value));
    }

    function addFinding(category, reason, pattern, index = 0) {
        const target = typeof pattern === 'string' ? pattern : String(pattern);
        if (isAllowed(target) || isAllowed(reason)) return;
        if (isNegativeHygieneAssertion(source, index)) return;
        findings.push({
            category,
            reason,
            pattern: target,
            filePath: rel,
            line: lineForIndex(source, index)
        });
    }

    for (const item of PROHIBITED_SYMBOL_PATTERNS) {
        const match = source.match(item.pattern);
        if (match) addFinding(item.category, item.reason, item.pattern, match.index || 0);
    }

    for (const name of PROHIBITED_NAMED_CONTENT) {
        const regex = new RegExp(`\\b${escapeRegex(name)}\\b`, 'i');
        const hay = isTest ? literalText : source;
        const match = hay.match(regex);
        if (match && !isAllowed(name)) {
            addFinding(isTest ? 'test_fixture_inline' : 'runtime_content', `Prohibited named content fixture: ${name}`, name, match.index || 0);
        }
    }

    if (!isTest) {
        for (const item of CATALOG_LITERAL_PATTERNS) {
            const match = source.match(item.pattern);
            if (match) addFinding('runtime_content', item.reason, item.pattern, match.index || 0);
        }
    }

    for (const literal of stringLiterals) {
        const value = literal.value.trim();
        if (!value || isAllowed(value)) continue;
        if (isTest && looksLikeInlineNamedFixture(value) && !isNeutralFixtureExpression(source, literal.index)) {
            addFinding('test_fixture_inline', 'Named inline test fixture should use fixtureSubject() or a neutral builder.', value, literal.index);
        }
        if (!isTest && looksLikeCannedAnswerContent(value)) {
            addFinding('runtime_content', 'Runtime string looks like canned answer content rather than routing/config.', value.slice(0, 120), literal.index);
        }
    }

    return {
        filePath: rel,
        tokens: tokenizeContent(source),
        stringLiterals: stringLiterals.map(item => item.value),
        identifierLikeNames: extractIdentifierLikeNames(source),
        findings
    };
}

export async function scanFile(filePath, options = {}) {
    const root = options.root || DEFAULT_ROOT;
    const relativePath = normalizeSlashes(path.relative(root, filePath));
    const content = await readFile(filePath, 'utf8');
    const hash = stableHash(content);
    const cacheKey = stableHash(`${SCANNER_VERSION}:${relativePath}:${hash}`);
    const cached = await readCache(cacheKey);
    if (cached) return { ...cached, cacheHit: true };

    const result = {
        ...scanContent(content, { filePath, relativePath }),
        hash,
        scannerVersion: SCANNER_VERSION,
        cacheHit: false
    };
    await writeCache(cacheKey, result);
    return result;
}

export async function scanRepo(options = {}) {
    const root = options.root || DEFAULT_ROOT;
    const files = options.files || await listScanFiles(root);
    const results = [];
    for (const file of files) {
        results.push(await scanFile(file, { root }));
    }
    return {
        root,
        files: results.length,
        cacheHits: results.filter(item => item.cacheHit).length,
        findings: results.flatMap(item => item.findings)
    };
}

async function listScanFiles(root) {
    const files = [];
    async function visit(dir) {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            const rel = path.normalize(path.relative(root, full));
            const parts = rel.split(path.sep);
            if (parts.some(part => SKIP_PARTS.has(part))) continue;
            if (entry.isDirectory()) {
                if (dir === root && !SCAN_DIRS.has(entry.name)) continue;
                await visit(full);
                continue;
            }
            if (!entry.isFile()) continue;
            if (SKIP_FILES.has(rel)) continue;
            if (dir === root && !ROOT_FILES.has(entry.name)) continue;
            if (!SCAN_EXTENSIONS.has(path.extname(entry.name))) continue;
            files.push(full);
        }
    }
    await visit(root);
    return files.sort();
}

async function readCache(key) {
    const file = cacheFile(key);
    if (!existsSync(file)) return null;
    try {
        const parsed = JSON.parse(await readFile(file, 'utf8'));
        if (parsed?.scannerVersion === SCANNER_VERSION) return parsed;
    } catch (_) {}
    return null;
}

async function writeCache(key, value) {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(cacheFile(key), JSON.stringify(value), 'utf8');
}

function cacheFile(key) {
    return path.join(CACHE_DIR, `${key}.json`);
}

function looksLikeInlineNamedFixture(value) {
    const text = String(value || '').trim();
    if (!text || text.length > 220) return false;
    if (/fixtureSubject|Subject\s+\$\{/.test(text)) return false;
    if (/^(?:Tech Review|Review Source|Reference|Shopping Source|Fixture [A-Za-z ]+)$/.test(text)) return false;
    if (/\b(?:Example|Sample)\s+(?:Labs|Framework|City|Actor|Corp|Phone|Laptop|Speaker|Team|League)\b/i.test(text)) return true;
    if (/\b[A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/.test(text) &&
        /\b(?:character|movie|song|album|review|CEO|captain|coach|official|latest|news)\b/i.test(text)) {
        return true;
    }
    return false;
}

function isNegativeHygieneAssertion(source, index) {
    const lineStart = source.lastIndexOf('\n', Math.max(0, index));
    const lineEnd = source.indexOf('\n', Math.max(0, index));
    const line = source.slice(lineStart + 1, lineEnd === -1 ? source.length : lineEnd);
    return /\bassert\.doesNotMatch\s*\(/.test(line);
}

function looksLikeCannedAnswerContent(value) {
    const text = String(value || '').trim();
    if (!text || text.length > 240) return false;
    if (/^[a-z0-9_:-]+$/i.test(text)) return false;
    if (/\b(?:is|was|are)\s+(?:the\s+)?(?:current\s+)?(?:CEO|chief minister|president|captain|coach|character|song|movie)\b/i.test(text)) return true;
    if (/\b(?:song|artist|album|film|episode|scene|quote)\s*[-:]\s*[A-Z]/i.test(text)) return true;
    return false;
}

function isNeutralFixtureExpression(source, index) {
    const before = source.slice(Math.max(0, index - 80), index);
    return /fixtureSubject\s*\([^)]*$/.test(before);
}

function lineForIndex(source, index) {
    return source.slice(0, Math.max(0, index)).split(/\r?\n/).length;
}

function escapeRegex(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeSlashes(value) {
    return String(value || '').replace(/\\/g, '/');
}

function formatFindings(findings) {
    return findings.map(item =>
        `${item.filePath}:${item.line} [${item.category}] ${item.reason} (${item.pattern})`
    ).join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const result = await scanRepo();
    if (result.findings.length) {
        console.error(formatFindings(result.findings));
        process.exit(1);
    }
    console.log(`hardcoded-content-scan-ok files=${result.files} cacheHits=${result.cacheHits}`);
}
