/**
 * Client-Side Local Image Engine
 * Provides in-browser image metadata extraction using HTML5 Canvas.
 */

export async function processImageLocallyInBrowser(fileOrDataUrl) {
    if (typeof window === 'undefined') return null;

    try {
        const imageElement = await loadImageElement(fileOrDataUrl);
        const { width, height } = imageElement;
        const aspectRatio = width / height;

        return {
            width,
            height,
            aspectRatio
        };
    } catch (_) {
        return null;
    }
}

export function extractLocalImageTagFromAttachment(attachment) {
    if (!attachment || !attachment.mimeType?.startsWith('image/')) return '';
    return '';
}

function loadImageElement(fileOrDataUrl) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = (err) => reject(err);

        if (typeof fileOrDataUrl === 'string') {
            img.src = fileOrDataUrl;
        } else if (fileOrDataUrl instanceof Blob || fileOrDataUrl instanceof File) {
            img.src = URL.createObjectURL(fileOrDataUrl);
        } else {
            reject(new Error('Invalid image input'));
        }
    });
}
