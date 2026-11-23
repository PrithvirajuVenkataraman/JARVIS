// Optional integration fixtures, saved only in ignored scratch/. Never redistributed in releases.
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

await mkdir('scratch/image-fixtures', { recursive: true });
for (const [name, url, maxBytes] of [
    ['nikon-d1.nef', 'https://www.rawsamples.ch/raws/nikon/d1/RAW_NIKON_D1.NEF', 10000000],
    ['example.heic', 'https://raw.githubusercontent.com/strukturag/libheif/master/examples/example.heic', 4000000]
]) {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Sample download failed: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > maxBytes) throw new Error('Unexpected sample size.');
    await writeFile(`scratch/image-fixtures/${name}`, bytes);
    console.log(`${name}: ${bytes.length} bytes, SHA256 ${createHash('sha256').update(bytes).digest('hex')}`);
}
