let active = null;
const aborted = () => new DOMException('Location request cancelled', 'AbortError');

export function getDevicePosition(nav = navigator, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) { reject(aborted()); return; }
        if (!nav.geolocation) { reject(new Error('Device location is unavailable in this browser.')); return; }
        let settled = false;
        const finish = (callback, value) => { if (settled) return; settled = true; signal?.removeEventListener('abort', cancel); callback(value); };
        const cancel = () => finish(reject, aborted());
        signal?.addEventListener('abort', cancel, { once: true });
        nav.geolocation.getCurrentPosition(value => finish(resolve, value), error => finish(reject, error), { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 });
    });
}

export async function resolveDeviceLocation({ nav = navigator, fetchFn = fetch, reverseUrl, signal } = {}) {
    const position = await getDevicePosition(nav, signal);
    const latitude = Number(position.coords.latitude), longitude = Number(position.coords.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new Error('The device returned an invalid location.');
    let place = '';
    if (reverseUrl) {
        const controller = new AbortController(); const cancel = () => controller.abort();
        signal?.addEventListener('abort', cancel, { once: true });
        if (signal?.aborted) cancel();
        const timer = setTimeout(cancel, 4000);
        try {
            const url = new URL(reverseUrl); url.searchParams.set('lat', latitude); url.searchParams.set('lon', longitude); url.searchParams.set('format', 'json');
            const response = await fetchFn(url, { signal: controller.signal });
            if (response.ok) {
                const address = (await response.json()).address || {};
                place = [...new Set([address.neighbourhood || address.suburb || address.village, address.city || address.town || address.municipality, address.state, address.country].filter(Boolean))].join(', ');
            }
        } catch { /* Coordinates are still useful when naming is unavailable. */ }
        finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
    }
    if (signal?.aborted) throw aborted();
    return { latitude, longitude, place, accuracy: Number(position.coords.accuracy) || null };
}

export function formatLocation(value) {
    return `${value.place || 'Location name unavailable.'}\nLatitude ${value.latitude.toFixed(5)}, Longitude ${value.longitude.toFixed(5)}`;
}
export function cancel() { active?.abort(); active = null; }
export async function request(query = '') {
    cancel(); const controller = new AbortController(); active = controller;
    const sessionId = window.getActiveChatSession?.()?.id;
    window.showThinkingIndicator?.('Getting your location…');
    try {
        const value = await resolveDeviceLocation({ reverseUrl: window.APP_CONFIG?.externalUrls?.nominatimReverse, signal: controller.signal });
        if (active !== controller || (sessionId && window.getActiveChatSession?.()?.id !== sessionId)) return;
        const text = formatLocation(value);
        const host = document.createElement('div'); host.className = 'location-reply';
        for (const line of text.split('\n')) { const paragraph = document.createElement('p'); paragraph.textContent = line; host.append(paragraph); }
        window.addChatMessage?.(host.outerHTML, false, false);
        window.saveToHistory?.(query || 'Where am I?', text);
    } catch (error) {
        if (controller.signal.aborted || active !== controller) return;
        const text = error?.code === 1 ? 'Location access is blocked. Enable it in your browser settings and retry.' : 'Device location is unavailable. Please retry.';
        const host = document.createElement('div'); host.className = 'location-reply'; host.textContent = text;
        const retry = document.createElement('button'); retry.type = 'button'; retry.dataset.locationRetry = ''; retry.textContent = 'Retry location'; host.append(document.createElement('br'), retry);
        window.addChatMessage?.(host.outerHTML, false, false);
    } finally { if (active === controller) { active = null; window.hideThinkingIndicator?.(); } }
}
export function install() {
    window.addEventListener('pagehide', cancel);
    document.addEventListener('click', event => { if (event.target.closest?.('[data-location-retry]')) void request(); });
}
