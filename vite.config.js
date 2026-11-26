import { defineConfig } from 'vite';
import { minify } from 'terser';
import { readFile, readdir, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

export default defineConfig({
    publicDir: false,
    server: { hmr: false },
    worker: { format: 'es' },
    build: { target: 'es2022', manifest: true, cssCodeSplit: true },
    plugins: [{
        name: 'jarvis-production-shell',
        async generateBundle(_options, bundle) {
            for (const entry of Object.values(bundle)) {
                if (entry.type === 'asset' && /(?:legacy|settings|vision)-runtime.*\.js$/.test(entry.fileName)) {
                    entry.source = (await minify(String(entry.source), { compress: true, mangle: { toplevel: false }, format: { comments: false } })).code;
                }
            }
        },
        async closeBundle() {
            for (const name of ['katex.min.js', 'science-format.js', 'manifest.json', '404.html', 'robots.txt', 'sitemap.xml']) {
                await copyFile(name, join('dist', name));
            }
            for (const name of ['LICENSE', 'NOTICE']) {
                await copyFile(join('node_modules/@imagemagick/magick-wasm', name), join('dist', `image-decoder-${name}.txt`));
            }
            await copyFile('node_modules/@fontsource-variable/inter/LICENSE', 'dist/inter-LICENSE.txt');
            for (const name of ['code-sandbox.html', 'code-sandbox.js']) await copyFile(join('app', name), join('dist', name));
            // Vite finalizes HTML after generateBundle. Add the essential classic
            // runtime preload here, before computing the offline build hash.
            const coreRuntime = (await readdir('dist/assets')).find(name => /^legacy-runtime.*\.js$/.test(name));
            if (coreRuntime) {
                const shell = await readFile('dist/index.html', 'utf8');
                await writeFile('dist/index.html', shell.replace('</head>', `<link rel="preload" as="script" href="/assets/${coreRuntime}">\n</head>`));
            }
            const files = [];
            async function walk(directory) {
                for (const item of await readdir(directory, { withFileTypes: true })) {
                    if (item.name.startsWith('.')) continue;
                    const path = join(directory, item.name);
                    if (item.isDirectory()) await walk(path);
                    else if (item.name !== 'sw.js') files.push('/' + path.replaceAll('\\', '/').slice(5));
                }
            }
            await walk('dist');
            const buildId = createHash('sha256');
            for (const file of files.sort()) buildId.update(file).update(await readFile(join('dist', file.slice(1))));
            const version = buildId.digest('hex').slice(0, 16);
            const manifest = JSON.parse(await readFile('dist/.vite/manifest.json', 'utf8'));
            const core = new Set(['/index.html', '/katex.min.js', '/science-format.js', '/manifest.json', '/404.html', '/code-sandbox.html', '/code-sandbox.js']);
            const visited = new Set();
            const isLightweightAsset = (file) => !/(?:settings|vision)-runtime|image-decoder-worker|recall-worker|transformers|ort-wasm|pdf\.worker|magick|\.wasm$/i.test(file);
            const visit = key => {
                if (visited.has(key)) return;
                visited.add(key);
                const entry = manifest[key]; if (!entry) return;
                if (isLightweightAsset(entry.file)) core.add('/' + entry.file);
                for (const file of [...(entry.css || []), ...(entry.assets || [])]) if (isLightweightAsset(file)) core.add('/' + file);
                for (const dependency of entry.imports || []) visit(dependency);
                for (const dynDependency of entry.dynamicImports || []) {
                    if (/app\/attachments\.js$/i.test(dynDependency) || /browser|request-payload|file-format|image-decoder/i.test(dynDependency)) {
                        visit(dynDependency);
                    }
                }
            };
            visit('index.html');
            const template = await readFile('sw.js', 'utf8');
            const worker = template.replace(/const CACHE_NAME = .*?;/, `const CACHE_NAME = 'jarvis-cache-${version}';`)
                .replace(/const STATIC_ASSETS = \[[\s\S]*?\];/, `const STATIC_ASSETS = ${JSON.stringify([...core])};`);
            await writeFile('dist/sw.js', worker);
        }
    }]
});
