// Synchronous metadata formatting must remain available before document parsers load.
export function formatBytes(bytes) {
    const size = Math.max(0, Number(bytes) || 0);
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function detectImageMime(bytes) {
    const starts = (values, offset = 0) => values.every((value, index) => bytes[offset + index] === value);
    if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
    if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
    if (starts([0x47, 0x49, 0x46, 0x38]) && [0x37, 0x39].includes(bytes[4]) && bytes[5] === 0x61) return 'image/gif';
    if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
    if (starts([0x42, 0x4d])) return 'image/bmp';
    if (starts([0x49, 0x49, 0x2a, 0]) || starts([0x4d, 0x4d, 0, 0x2a])) return 'image/tiff';
    if (starts([0x66, 0x74, 0x79, 0x70], 4)) {
        const brands = String.fromCharCode(...bytes.slice(8, 32));
        if (/avif|avis/.test(brands)) return 'image/avif';
        if (/heic|heix|hevc|hevx|mif1|msf1/.test(brands)) return 'image/heic';
    }
    return '';
}

export function imageNameForMime(name, mimeType) {
    const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[mimeType];
    if (!extension) return name;
    if (mimeType === 'image/jpeg' && /\.jpe?g$/i.test(name)) return name;
    if (name.toLowerCase().endsWith('.' + extension)) return name;
    return name.replace(/\.[^./\\]+$/, '') + '.' + extension;
}
