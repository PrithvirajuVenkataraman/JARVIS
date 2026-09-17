#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HARDCODED_CONTENT_ALLOWLIST } from './hardcoded-content-allowlist.mjs';

export const SCANNER_VERSION = 'hardcoded-content-scanner-v4';

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

export const PROHIBITED_SYMBOL_PATTERNS = Object.freeze([
    { pattern: /\bSITCOM_MOVIE_REFERENCE_CATALOG\b/, category: 'legacy_catalog_symbol', reason: 'Removed sitcom/movie knowledge catalog returned.' },
    { pattern: /\bdetectSitcomMovieReference\b/, category: 'legacy_catalog_symbol', reason: 'Removed local sitcom/movie detector returned.' },
    { pattern: /\bbuildSitcomMovieReferenceResponse\b/, category: 'legacy_catalog_symbol', reason: 'Removed canned sitcom/movie response builder returned.' },
    { pattern: /\bhandleSitcomMovieReference\b/, category: 'legacy_catalog_symbol', reason: 'Removed sitcom/movie short-circuit returned.' },
    { pattern: /\bOFFICIAL_SOURCE_SHORTCUTS\b/, category: 'legacy_catalog_symbol', reason: 'Named official-source shortcut catalog returned.' },
    { pattern: /\bgetOfficialSourceShortcuts\b/, category: 'legacy_catalog_symbol', reason: 'Named official-source shortcut path returned.' },
    { pattern: /\bgetCuratedSongsForArtist\b/, category: 'legacy_catalog_symbol', reason: 'Curated artist song catalog helper returned.' },
    { pattern: /\bgetCuratedLanguageEraHits\b/, category: 'legacy_catalog_symbol', reason: 'Curated language-era song catalog helper returned.' },
    { pattern: /\bknownArtistCorrections\b|\btypoMap\b/, category: 'legacy_catalog_symbol', reason: 'Named local subject correction table returned.' },
    { pattern: /\blandmarkKnowledge\b/, category: 'legacy_catalog_symbol', reason: 'Removed monument knowledge catalog returned.' },
    { pattern: /\btamil_joke\b|\bhandleTamilJoke\b|\bgetTamilJoke\b/, category: 'legacy_catalog_symbol', reason: 'Removed single-language joke routing override returned.' }
]);

export const PROHIBITED_NAMED_CONTENT = Object.freeze([
    'Jordan Vale',
    'Workplace Crew',
    'Riley Stone',
    'Schmosby',
    'Michael Scott',
    'Chandler Bing',
    'Ed Sheeran',
    'Sean Roldan',
    'Sundari',
    'Billie Jean',
    'Shape of You'
]);

export const STRUCTURAL_SYSTEM_TERMS = new Set([
    // Interrogatives & Command Verbs
    'what', 'where', 'when', 'who', 'how', 'why', 'which', 'whom', 'whose',
    'explain', 'define', 'tell', 'describe', 'summarize', 'list', 'search', 'find', 'show', 'check',
    'look up', 'lookup', 'browse', 'calculate', 'compute', 'evaluate', 'translate', 'create', 'generate',
    // Temporal & Freshness
    'current', 'latest', 'recent', 'upcoming', 'new', 'today', 'now', 'present',
    'yesterday', 'tomorrow', 'live', 'breaking', 'future', 'past', 'historic', 'history',
    // Media/Work relation terms (verbs, roles, not specific titles)
    'sing', 'sang', 'sung', 'direct', 'directed', 'director', 'release', 'released',
    'write', 'written', 'writer', 'star', 'starred', 'play', 'played', 'actor', 'actress',
    'author', 'composer', 'producer', 'artist', 'song', 'songs', 'album', 'albums',
    'movie', 'movies', 'film', 'films', 'show', 'shows', 'series', 'track', 'tracks',
    // Metric, finance, domain concepts
    'price', 'prices', 'stock', 'stocks', 'share', 'shares', 'market', 'cap', 'valuation',
    'rate', 'rates', 'inflation', 'gdp', 'revenue', 'earnings', 'profit', 'dividend',
    'weather', 'temperature', 'forecast', 'rain', 'snow', 'wind', 'humidity', 'climate',
    'recipe', 'ingredients', 'cook', 'bake', 'dish', 'food', 'cuisine',
    // Geographic & Structural Landmark nouns (types of places, not specific names)
    'temple', 'monument', 'tower', 'palace', 'cathedral', 'mosque', 'church', 'pyramid',
    'fort', 'castle', 'bridge', 'statue', 'memorial', 'museum', 'capital', 'country', 'city',
    'state', 'province', 'island', 'mountain', 'river', 'lake', 'ocean', 'sea',
    // System, HTTP, API & Code keywords
    'get', 'post', 'put', 'delete', 'patch', 'head', 'options',
    'function', 'class', 'const', 'let', 'var', 'operator', 'import', 'export', 'return',
    'true', 'false', 'null', 'undefined', 'boolean', 'string', 'number', 'object',
    'chat', 'model', 'stream', 'event', 'status', 'done', 'error', 'failed', 'pass',
    // Common grammar / prepositions
    'in', 'on', 'at', 'of', 'to', 'for', 'from', 'with', 'by', 'a', 'an', 'the', 'is', 'are', 'was', 'were'
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

export function stripComments(source) {
    return String(source || '')
        .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
        .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

export const KNOWN_ENTITY_NAMES = new Set([
    // Big Tech & Companies
    'apple', 'tesla', 'nvidia', 'microsoft', 'google', 'amazon', 'meta', 'alphabet', 'netflix',
    'openai', 'anthropic', 'deepmind', 'groq', 'claude', 'chatgpt', 'llama', 'deepseek', 'mistral',
    // Media / Pop-Culture titles
    'inception', 'interstellar', 'dune', 'oppenheimer', 'avatar', 'titanic', 'gladiator',
    'friends', 'seinfeld', 'succession', 'ted lasso', 'euphoria', 'severance', 'shogun',
    // Famous people / artists
    'taylor swift', 'dua lipa', 'ed sheeran', 'billie eilish', 'ariana grande', 'drake',
    'michael jackson', 'elvis presley', 'the beatles',
    // Monuments / Landmarks
    'taj mahal', 'eiffel tower', 'colosseum', 'statue of liberty', 'big ben', 'pyramids of giza',
    'brihadeeswarar temple', 'great wall of china', 'machu picchu',
    // Science terms used as canned knowledge
    'photosynthesis', 'mitochondria', 'pythagorean', 'chlorophyll', 'endoplasmic reticulum',
    // Geography proper nouns used to filter 'new'
    'new york', 'new jersey', 'new zealand', 'new delhi', 'new hampshire', 'new mexico', 'new orleans'
]);

export function isNamedEntityTerm(term) {
    const t = String(term || '').trim().toLowerCase();
    if (!t || t.length < 2) return false;
    if (KNOWN_ENTITY_NAMES.has(t)) return true;
    if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+$/.test(term.trim())) {
        const lower = term.trim().toLowerCase();
        if (!/^(user|system|assistant|error|status|event|response|request|test|mock|query|route|feature|action|handler|command)\b/.test(lower)) {
            return true;
        }
    }
    return false;
}

export function isProperEntityName(item) {
    return isNamedEntityTerm(item);
}

export function isSpecificUserQuestion(queryText) {
    const t = String(queryText || '').trim();
    if (t.length < 12) return false;
    const isInterrogativeStart = /^(?:what\s+(?:is|are|was|were)|who\s+(?:is|was|are)|where\s+(?:is|was|are)|when\s+(?:did|was|is)|how\s+(?:to|does|do|did)|why\s+(?:is|do|does)|tell\s+me\s+about|give\s+me\s+a)\b/i.test(t);
    const hasQuestionMark = t.endsWith('?');
    return isInterrogativeStart || hasQuestionMark;
}

export function scanContent(content, options = {}) {
    const filePath = normalizeSlashes(options.filePath || '<memory>');
    const rel = normalizeSlashes(options.relativePath || filePath);
    const isTest = /(^|\/)tests\//.test(rel);
    const findings = [];
    const source = String(content || '');
    const cleanSource = stripComments(source);
    const stringLiterals = extractStringLiterals(source);

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

    // 1. Prohibited Legacy Symbols (checked across all files)
    for (const item of PROHIBITED_SYMBOL_PATTERNS) {
        const match = cleanSource.match(item.pattern);
        if (match) addFinding(item.category, item.reason, item.pattern, match.index || 0);
    }

    // 2. Prohibited Named Content (in runtime non-test files)
    if (!isTest) {
        for (const name of PROHIBITED_NAMED_CONTENT) {
            const regex = new RegExp(`\\b${escapeRegex(name)}\\b`, 'i');
            const match = cleanSource.match(regex);
            if (match && !isAllowed(name)) {
                addFinding('prohibited_named_content', `Prohibited named content in runtime code: ${name}`, name, match.index || 0);
            }
        }
    }

    // 3. Canned Knowledge Catalogs & Rows (in runtime non-test files)
    if (!isTest) {
        // Song row literals with hardcoded values: { song: '...', artist: '...' }
        const songRowRegex = /\{\s*song\s*:\s*['"`][^'"`]{2,}['"`]\s*,\s*artist\s*:\s*['"`][^'"`]{2,}['"`]/gi;
        let sMatch;
        while ((sMatch = songRowRegex.exec(cleanSource)) !== null) {
            addFinding('canned_knowledge_catalog', 'Runtime local song row literal detected.', sMatch[0], sMatch.index);
        }

        // Entertainment reference row literals with hardcoded values: { character: '...', show: '...' }
        const entRowRegex = /\{\s*(?:character|show|movie|film)\s*:\s*['"`][^'"`]{2,}['"`]\s*,\s*(?:quote|reference|actor|role)\s*:\s*['"`][^'"`]{2,}['"`]/gi;
        let eMatch;
        while ((eMatch = entRowRegex.exec(cleanSource)) !== null) {
            addFinding('canned_knowledge_catalog', 'Runtime local entertainment reference row literal detected.', eMatch[0], eMatch.index);
        }

        // Explicit knowledge catalog declaration: const catalog = [ ... ]
        const catalogDeclRegex = /\b(?:catalog|knowledge_base|fact_table)\s*=\s*(?:Object\.freeze\()?[\[{]/gi;
        let cMatch;
        while ((cMatch = catalogDeclRegex.exec(cleanSource)) !== null) {
            addFinding('canned_knowledge_catalog', 'Runtime local curated/catalog data structure detected.', cMatch[0], cMatch.index);
        }
    }

    // 4. Entity Regex Dictionaries in Runtime Code (in runtime non-test files)
    if (!isTest) {
        const regexLiteralPattern = /\/(?![*+?])(?:[^\r\n\[/\\]|\\.|\[(?:[^\r\n\]\\]|\\.)*\])+\/[a-z]*/g;
        let rMatch;
        while ((rMatch = regexLiteralPattern.exec(cleanSource)) !== null) {
            const regexStr = rMatch[0];
            const altMatch = regexStr.match(/\(\?:?([a-zA-Z0-9_.\s|'-]{16,})\)/);
            if (!altMatch) continue;
            const rawGroup = altMatch[1];
            if (!rawGroup.includes('|')) continue;
            const alts = rawGroup.split('|').map(s => s.trim()).filter(Boolean);
            if (alts.length < 4) continue;

            const entityMatches = alts.filter(term => isNamedEntityTerm(term));
            if (entityMatches.length >= 3) {
                addFinding('entity_regex_dictionary', `Entity regex dictionary detected with ${entityMatches.length} named entities in routing/classification.`, regexStr.slice(0, 100), rMatch.index);
            }
        }
    }

    // 5. Hardcoded Entity Keyword Lists / Arrays (in runtime non-test files)
    if (!isTest) {
        const arrayDeclRegex = /(?:const|let|var)\s+([A-Za-z0-9_]+)\s*=\s*(?:Object\.freeze\()?\s*\[([^\]]{25,})\]/g;
        let aMatch;
        while ((aMatch = arrayDeclRegex.exec(cleanSource)) !== null) {
            const varName = aMatch[1];
            const arrayBody = aMatch[2];
            const items = (arrayBody.match(/['"`]([^'"`]+)['"`]/g) || [])
                .map(s => s.slice(1, -1).trim())
                .filter(Boolean);

            if (items.length >= 3) {
                const entityItems = items.filter(item => isNamedEntityTerm(item));
                const isEntityVarName = /\b(?:ENTITIES|ARTISTS|MOVIES|SONGS|MONUMENTS|CELEBRITIES|STOCKS|COMPANIES)\b/i.test(varName);

                if (entityItems.length >= 3 || (isEntityVarName && items.length >= 3)) {
                    addFinding('entity_keyword_list', `Hardcoded entity list detected in array "${varName}" (${entityItems.length || items.length} entities).`, aMatch[0].slice(0, 120), aMatch.index);
                }
            }
        }
    }

    // 6. Query-Specific Routing Exceptions (in runtime non-test files)
    if (!isTest) {
        const queryCheckRegex = /if\s*\(\s*(?:raw|text|query|cleanText|cleaned|lower|userMessage|prompt)\s*(?:===|==)\s*['"`]([A-Za-z0-9\s?,.'"-]{12,})['"`]\s*\)/g;
        let qMatch;
        while ((qMatch = queryCheckRegex.exec(cleanSource)) !== null) {
            const queryText = qMatch[1].trim();
            if (isSpecificUserQuestion(queryText)) {
                addFinding('query_specific_exception', `Query-specific routing exception detected for full question: "${queryText}".`, qMatch[0], qMatch.index);
            }
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

function isNegativeHygieneAssertion(source, index) {
    const lineStart = source.lastIndexOf('\n', Math.max(0, index));
    const lineEnd = source.indexOf('\n', Math.max(0, index));
    const line = source.slice(lineStart + 1, lineEnd === -1 ? source.length : lineEnd);
    return /\bassert\.doesNotMatch\s*\(/.test(line);
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

