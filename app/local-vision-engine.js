/**
 * Client-Side Local Computer Vision & ROI Engine
 * Provides in-browser image feature analysis, device/screen identification,
 * and ROI document bounding box cropping using HTML5 Canvas.
 */

export async function processImageLocallyInBrowser(fileOrDataUrl) {
    if (typeof window === 'undefined') return null;

    try {
        const imageElement = await loadImageElement(fileOrDataUrl);
        const { width, height } = imageElement;
        const aspectRatio = width / height;

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const maxDimension = 300;
        const scale = Math.min(1, maxDimension / Math.max(width, height));
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);

        ctx.drawImage(imageElement, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const metrics = computeCanvasMetrics(imageData, aspectRatio);

        const isScreen = metrics.screenScore > 0.45;
        const isDocument = metrics.documentScore > 0.5 && !isScreen;

        let subjectType = 'object';
        let mainSubject = 'Physical object';
        if (isScreen) {
            subjectType = 'device';
            mainSubject = aspectRatio >= 1.2
                ? 'Tablet / iPad device screen displaying an application'
                : 'Smartphone device displaying an application';
        } else if (isDocument) {
            subjectType = 'document';
            mainSubject = 'Printed document page with text';
        }

        const roi = computeCanvasRoi(metrics);

        return {
            width,
            height,
            aspectRatio,
            subjectType,
            mainSubject,
            isScreen,
            isDocument,
            roi,
            tag: `[Local Vision: ${mainSubject}]`
        };
    } catch (_) {
        return null;
    }
}

export function extractLocalImageTagFromAttachment(attachment) {
    if (!attachment || !attachment.mimeType?.startsWith('image/')) return '';
    const name = String(attachment.name || '').toLowerCase();
    if (name.includes('ipad') || name.includes('tablet') || name.includes('screen') || name.includes('screenshot')) {
        return '[Local Vision: Electronic device screen displaying application UI]';
    }
    if (name.includes('doc') || name.includes('receipt') || name.includes('bill') || name.includes('scan')) {
        return '[Local Vision: Document page with text content]';
    }
    return '[Local Vision: Physical visual image]';
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

function computeCanvasMetrics(imageData, aspectRatio) {
    const { data, width, height } = imageData;
    let highEdgeCount = 0;
    let luminanceSum = 0;
    const totalPixels = width * height;

    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        luminanceSum += lum;

        if (i > 4) {
            const prevR = data[i - 4];
            if (Math.abs(r - prevR) > 40) highEdgeCount++;
        }
    }

    const avgLuminance = luminanceSum / totalPixels;
    const edgeRatio = highEdgeCount / totalPixels;

    const screenScore = Math.min(1.0, edgeRatio * 2.5 + (aspectRatio > 0.7 && aspectRatio < 1.7 ? 0.3 : 0.0));
    const documentScore = Math.min(1.0, edgeRatio * 3.0 + (avgLuminance > 160 ? 0.3 : 0.0));

    return {
        avgLuminance,
        edgeRatio,
        screenScore,
        documentScore
    };
}

function computeCanvasRoi(metrics) {
    if (metrics.screenScore > 0.45 || metrics.documentScore > 0.5) {
        return { x: 0.05, y: 0.05, width: 0.90, height: 0.90 };
    }
    return { x: 0.10, y: 0.10, width: 0.80, height: 0.80 };
}
