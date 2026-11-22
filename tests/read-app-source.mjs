import { readFileSync } from 'node:fs';

export function readAppSource() {
    const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
    let runtime = read('app/legacy-runtime.js');
    for (const feature of ['settings', 'vision']) {
        runtime = runtime.replace(new RegExp(`/\\*lazy-feature:${feature}\\*/[\\s\\S]*?/\\*end-lazy-feature\\*/`), () => read(`app/features/${feature}-runtime.js`));
    }
    return read('index.html').replace('</body>', () => `<script>\n${runtime}\n</script>\n</body>`);
}
