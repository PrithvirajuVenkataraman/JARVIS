/**
 * Local Image Metadata & Fallback Module
 * Provides clean image metadata when multimodal vision keys are unavailable.
 */

export function classifyImageLocally({ imageBase64 = '', mimeType = 'image/jpeg', prompt = '', task = 'general_vision' } = {}) {
    const rawData = String(imageBase64 || '').trim();
    const byteLength = rawData ? Math.floor((rawData.length * 3) / 4) : 0;
    const kb = Math.round(byteLength / 1024);
    const summary = rawData
        ? `Image attached (${mimeType || 'image/jpeg'}, ${kb} KB).`
        : 'Image data is empty.';

    return {
        success: true,
        task,
        localClassifier: true,
        response: summary,
        summary,
        details: {
            summary,
            mimeType,
            sizeKb: kb,
            confidence: 1.0,
            distinctiveFeatures: [],
            roiCrop: { x: 0, y: 0, width: 1, height: 1 }
        }
    };
}
