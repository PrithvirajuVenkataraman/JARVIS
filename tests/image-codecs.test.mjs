import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as magick from '@imagemagick/magick-wasm';
import { convertImage, imageFormatForName, configureDecoderLimits } from '../app/image-decoder-core.js';

await magick.initializeImageMagick(new Uint8Array(fs.readFileSync(new URL('../node_modules/@imagemagick/magick-wasm/dist/x86/magick.wasm', import.meta.url))));
configureDecoderLimits(magick);
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
for (const format of ['TIFF', 'PSD', 'AVIF', 'JP2', 'JXL', 'QOI', 'TGA', 'BMP', 'EXR']) {
    test(`actual ${format} decoding produces a bounded JPEG`, () => {
        const fixture = magick.ImageMagick.read(png, image => { image.resize(32, 24); image.extent(32, 24, magick.MagickColors.White); return image.write(format, data => new Uint8Array(data)); });
        const jpeg = convertImage(magick, fixture, format, 16);
        assert.deepEqual([...jpeg.slice(0, 3)], [255, 216, 255]);
        const info = magick.MagickImageInfo.create(jpeg);
        assert.equal(info.width, 16); assert.equal(info.height, 12);
    });
}
test('unsafe pseudo-formats and malformed files cannot be decoded', () => {
    for (const format of ['MVG', 'MSL', 'HTTPS', 'PDF']) assert.throws(() => convertImage(magick, png, format), /not supported/);
    assert.equal(imageFormatForName('file.mvg'), '');
    assert.throws(() => convertImage(magick, new Uint8Array([1, 2, 3]), 'NEF'));
});
const raw = process.env.JARVIS_RAW_TEST_FILE || 'scratch/image-fixtures/nikon-d1.nef';
const heic = process.env.JARVIS_HEIC_TEST_FILE || 'scratch/image-fixtures/example.heic';
test('real HEIC source decodes independently of encoder availability', { skip: !fs.existsSync(heic) }, () => {
    const jpeg = convertImage(magick, new Uint8Array(fs.readFileSync(heic)), 'HEIC');
    assert.equal(magick.MagickImageInfo.create(jpeg).format, 'JPEG');
});
test('real Nikon NEF source decodes with LibRaw', { skip: !fs.existsSync(raw) }, () => {
    const source = new Uint8Array(fs.readFileSync(raw));
    const jpeg = convertImage(magick, source, 'NEF');
    assert.equal(magick.MagickImageInfo.create(jpeg).format, 'JPEG');
    assert.ok(magick.MagickImageInfo.create(jpeg).width <= 1600);
    assert.equal(source.length, fs.statSync(raw).size);
});
