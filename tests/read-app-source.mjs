import { readFileSync } from 'node:fs';

export function readAppSource() {
    // Source contracts use Git's LF representation on Windows and Linux alike.
    const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    let runtime = read('app/legacy-runtime.js');
    for (const feature of ['settings', 'vision']) {
        runtime = runtime.replace(new RegExp(`/\\*lazy-feature:${feature}\\*/[\\s\\S]*?/\\*end-lazy-feature\\*/`), () => read(`app/features/${feature}-runtime.js`));
    }
    return read('index.html').replace('</body>', () => `<script>\n${runtime}\n</script>\n</body>`);
}
