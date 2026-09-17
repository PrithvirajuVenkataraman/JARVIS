import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/gi)];
if (!scripts.length) {
    throw new Error('inline script not found');
}

for (let i = 0; i < scripts.length; i++) {
    const code = scripts[i][1].trim();
    if (!code) continue;
    new vm.Script(code, {
        filename: `index.inline.${i}.js`
    });
}

console.log('inline-js-ok');
