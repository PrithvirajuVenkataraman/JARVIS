import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import apiHandler from '../api/_lib/api-router.js';

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)));

export function parseEnvContent(rawContent = '') {
    const parsed = {};
    const lines = String(rawContent || '').split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        if (key) {
            parsed[key] = val;
        }
    }
    return parsed;
}

export function loadEnvFiles(baseDir = rootDir) {
    const envFiles = ['.env.local', '.env'];
    const loaded = {};
    for (const file of envFiles) {
        const filePath = join(baseDir, file);
        if (existsSync(filePath)) {
            try {
                const content = readFileSync(filePath, 'utf8');
                const parsed = parseEnvContent(content);
                for (const [key, value] of Object.entries(parsed)) {
                    if (process.env[key] === undefined) {
                        process.env[key] = value;
                        loaded[key] = file;
                    }
                }
            } catch (err) {
                console.warn(`[local-dev-server] Failed to load ${file}:`, err.message);
            }
        }
    }
    return loaded;
}

const MIME_TYPES = new Map([
    ['.html', 'text/html; charset=utf-8'],
    ['.css', 'text/css; charset=utf-8'],
    ['.js', 'text/javascript; charset=utf-8'],
    ['.mjs', 'text/javascript; charset=utf-8'],
    ['.json', 'application/json; charset=utf-8'],
    ['.svg', 'image/svg+xml'],
    ['.png', 'image/png'],
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.ico', 'image/x-icon']
]);

export const server = http.createServer(async (nodeReq, nodeRes) => {
    try {
        const port = Number(process.env.PORT || 3000);
        const host = process.env.HOST || '127.0.0.1';
        const requestUrl = new URL(nodeReq.url || '/', `http://${nodeReq.headers.host || `${host}:${port}`}`);
        if (requestUrl.pathname.startsWith('/api/')) {
            await handleApiRequest(nodeReq, nodeRes, requestUrl);
            return;
        }
        await handleStaticRequest(nodeRes, requestUrl.pathname);
    } catch (error) {
        console.error('[local-dev-server] request failed', error);
        sendJson(nodeRes, 500, {
            success: false,
            error: { code: 'local_server_error', message: 'Local dev server failed.' }
        });
    }
});

export function startLocalDevServer() {
    loadEnvFiles(rootDir);
    const port = Number(process.env.PORT || 3000);
    const host = process.env.HOST || '127.0.0.1';
    server.listen(port, host, () => {
        const hasGroq = Boolean(process.env.GROQ_API_KEY || process.env.GROQ_API_KEYS);
        const hasGemini = Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
        console.log(`JARVIS local dev server running at http://${host}:${port}`);
        console.log(`[local-dev-server] AI Providers: Groq=${hasGroq ? 'configured' : 'missing'}, Gemini=${hasGemini ? 'configured' : 'missing'}`);
        console.log('Press Ctrl+C to stop.');
    });
    return server;
}

const isDirectRun = process.argv[1] && (
    process.argv[1] === fileURLToPath(import.meta.url) ||
    process.argv[1].endsWith('local-dev-server.mjs')
);
if (isDirectRun) {
    startLocalDevServer();
}

async function handleApiRequest(nodeReq, nodeRes, requestUrl) {
    const body = await readJsonBody(nodeReq);
    const headers = Object.fromEntries(
        Object.entries(nodeReq.headers).map(([key, value]) => [key.toLowerCase(), Array.isArray(value) ? value.join(', ') : String(value || '')])
    );
    const req = {
        method: nodeReq.method || 'GET',
        url: `${requestUrl.pathname}${requestUrl.search}`,
        headers,
        body,
        socket: nodeReq.socket,
        connection: nodeReq.connection
    };
    const res = createApiResponseAdapter(nodeRes);
    await apiHandler(req, res);
    if (!nodeRes.writableEnded) nodeRes.end();
}

async function handleStaticRequest(nodeRes, pathname) {
    const safePath = pathname === '/' ? '/index.html' : pathname;
    const decodedPath = decodeURIComponent(safePath);
    const filePath = normalize(join(rootDir, decodedPath));
    if (!filePath.startsWith(rootDir)) {
        sendText(nodeRes, 403, 'Forbidden');
        return;
    }
    try {
        const content = await readFile(filePath);
        nodeRes.writeHead(200, {
            'Content-Type': MIME_TYPES.get(extname(filePath).toLowerCase()) || 'application/octet-stream',
            'Cache-Control': 'no-store'
        });
        nodeRes.end(content);
    } catch (_) {
        sendText(nodeRes, 404, 'Not found');
    }
}

async function readJsonBody(req) {
    if (!['POST', 'PUT', 'PATCH'].includes(String(req.method || '').toUpperCase())) return {};
    const chunks = [];
    for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks).toString('utf8').trim();
    if (!raw) return {};
    try {
        return JSON.parse(raw);
    } catch (_) {
        return {};
    }
}

function createApiResponseAdapter(nodeRes) {
    return {
        statusCode: 200,
        setHeader(name, value) {
            nodeRes.setHeader(name, value);
            return this;
        },
        status(code) {
            this.statusCode = Number(code) || 200;
            return this;
        },
        writeHead(code, headers = {}) {
            this.statusCode = Number(code) || this.statusCode || 200;
            nodeRes.writeHead(this.statusCode, headers);
            return this;
        },
        write(chunk) {
            nodeRes.write(chunk);
            return true;
        },
        json(payload) {
            sendJson(nodeRes, this.statusCode, payload);
            return this;
        },
        send(payload = '') {
            if (!nodeRes.headersSent) nodeRes.writeHead(this.statusCode);
            nodeRes.end(payload);
            return this;
        },
        end(payload = '') {
            if (!nodeRes.headersSent) nodeRes.writeHead(this.statusCode);
            nodeRes.end(payload);
            return this;
        }
    };
}

function sendJson(res, status, payload) {
    if (!res.headersSent) {
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    }
    res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(text);
}
