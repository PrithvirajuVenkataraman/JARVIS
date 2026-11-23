import { imageFormatForName } from './image-decoder-core.js';

const active = new Set();
let queue = Promise.resolve();
let epoch = 0;
const canceled = () => new DOMException('Image preparation canceled.', 'AbortError');

// One decoder at a time bounds peak memory on phones. Each worker is released after conversion.
export function decodeImageFile(file, { maxDimension = 1600, signal } = {}) {
    const generation = epoch;
    const operation = queue.then(async () => {
        if (signal?.aborted || generation !== epoch) throw canceled();
        const format = imageFormatForName(file.name);
        if (!format || file.size > 50 * 1024 * 1024) throw new Error('This image format or size is not supported.');
        const bytes = await file.arrayBuffer();
        if (signal?.aborted || generation !== epoch) throw canceled();
        return new Promise((resolve, reject) => {
            const worker = new Worker(new URL('./image-decoder-worker.js', import.meta.url), { type: 'module' });
            const finish = (error, value) => {
                clearTimeout(timer); worker.terminate(); active.delete(abort);
                signal?.removeEventListener('abort', abort);
                if (error) reject(error); else resolve(value);
            };
            const abort = () => finish(canceled());
            const timer = setTimeout(() => finish(new Error('Image preparation timed out. Try a smaller image.')), 45000);
            active.add(abort); signal?.addEventListener('abort', abort, { once: true });
            worker.onmessage = ({ data }) => data.error ? finish(new Error(data.error)) : finish(null, new Blob([data.bytes], { type: 'image/jpeg' }));
            worker.onerror = () => finish(new Error('The image decoder could not run on this device.'));
            worker.postMessage({ bytes, format, maxDimension }, [bytes]);
        });
    });
    queue = operation.catch(() => {});
    return operation;
}

export function cancelImageDecoding() { epoch++; for (const abort of [...active]) abort(); }
