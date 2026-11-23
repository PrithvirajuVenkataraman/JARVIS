import * as magick from '@imagemagick/magick-wasm';
import wasmUrl from '@imagemagick/magick-wasm/magick.wasm?url';
import { convertImage, configureDecoderLimits } from './image-decoder-core.js';

self.onmessage = async ({ data }) => {
    try {
        await magick.initializeImageMagick(new URL(wasmUrl, import.meta.url));
        configureDecoderLimits(magick);
        const bytes = convertImage(magick, new Uint8Array(data.bytes), data.format, data.maxDimension);
        self.postMessage({ bytes: bytes.buffer }, [bytes.buffer]);
    } catch (error) {
        self.postMessage({ error: /limit|memory|cache resources/i.test(error.message)
            ? 'This image exceeds the safe decoding limits on this device.'
            : 'This image could not be decoded. It may be damaged or use an unsupported camera or codec.' });
    }
};
