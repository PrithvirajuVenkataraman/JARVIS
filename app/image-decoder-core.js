// Only raster coders are exposed. Never pass arbitrary ImageMagick pseudo-formats to read().
export const IMAGE_FORMATS = Object.freeze({
    jpg: 'JPEG', jpeg: 'JPEG', png: 'PNG', gif: 'GIF', webp: 'WEBP', bmp: 'BMP', dib: 'BMP',
    tif: 'TIFF', tiff: 'TIFF', heic: 'HEIC', heif: 'HEIC', heics: 'HEIC', heifs: 'HEIC',
    avif: 'AVIF', avifs: 'AVIF', nef: 'NEF', nrw: 'NRW', dng: 'DNG', cr2: 'CR2', cr3: 'CR3',
    arw: 'ARW', srf: 'SRF', sr2: 'SR2', raf: 'RAF', rw2: 'RW2', orf: 'ORF', pef: 'PEF',
    raw: 'DNG', rwl: 'RWL', srw: 'SRW', kdc: 'KDC', dcr: 'DCR', mrw: 'MRW', x3f: 'X3F',
    jp2: 'JP2', j2k: 'J2K', jpf: 'JP2', jpx: 'JP2', jpm: 'JPM', jxl: 'JXL',
    psd: 'PSD', psb: 'PSB', ico: 'ICO', cur: 'CUR', tga: 'TGA', qoi: 'QOI',
    exr: 'EXR', hdr: 'HDR', dds: 'DDS', pcx: 'PCX', ppm: 'PPM', pgm: 'PGM', pbm: 'PBM'
});
export const RAW_IMAGE_EXTENSIONS = /\.(dng|raw|cr[23]|nef|nrw|arw|srf|sr2|raf|rw2|orf|pef|rwl|srw|kdc|dcr|mrw|x3f)$/i;
export function imageFormatForName(name) { return IMAGE_FORMATS[String(name).split('.').pop().toLowerCase()] || ''; }

export function configureDecoderLimits({ ResourceLimits: limits }) {
    limits.memory = 512n * 1024n * 1024n;
    limits.maxMemoryRequest = 256n * 1024n * 1024n;
    limits.disk = 0n;
    // Internal conversion buffers need several slots; frameCount still restricts input to one frame.
    limits.width = 40000n; limits.height = 40000n; limits.listLength = 16n;
    limits.maxProfileSize = 16n * 1024n * 1024n;
    limits.time = 35n;
}

export function convertImage(magick, bytes, format, maxDimension = 1600) {
    const { ImageMagick, MagickReadSettings, MagickImageInfo, MagickGeometry, MagickFormat, MagickColors, AlphaAction } = magick;
    if (!Object.values(IMAGE_FORMATS).includes(format)) throw new Error('This image format is not supported.');
    const settings = new MagickReadSettings({ format, frameCount: 1, frameIndex: 0 });
    settings.setDefine('dng:half-size', true);
    const info = MagickImageInfo.create(bytes, settings);
    if (!info.width || !info.height || info.width > 40000 || info.height > 40000 || info.width * info.height > 64000000) {
        throw new Error('This image exceeds the 64 megapixel decoding limit.');
    }
    return ImageMagick.read(bytes, settings, image => {
        image.autoOrient();
        const geometry = new MagickGeometry(Math.min(1600, maxDimension), Math.min(1600, maxDimension));
        geometry.greater = true;
        image.resize(geometry);
        image.backgroundColor = MagickColors.White;
        image.alpha(AlphaAction.Remove);
        image.strip();
        image.quality = 88;
        return image.write(MagickFormat.Jpeg, result => new Uint8Array(result));
    });
}
