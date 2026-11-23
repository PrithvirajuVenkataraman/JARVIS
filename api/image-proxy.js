// Compatibility endpoint for old clients. Never send a platform key to a billed image API.
export function imageProxyHandler(_req, res) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(410).json({ error: { code: 'image_client_upgrade_required',
        message: 'Refresh JARVIS to use free community image generation. No paid image provider is enabled.' } });
}
export default imageProxyHandler;
