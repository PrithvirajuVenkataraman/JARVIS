const SEEN_KEY = 'jarvis_permission_intro_v1';
const names = ['microphone', 'camera', 'geolocation'];
const labels = { microphone: 'Microphone', camera: 'Camera', geolocation: 'Location' };
let generation = 0;
let installed = false;

export async function permissionStates(nav = navigator) {
    const entries = await Promise.all(names.map(async name => {
        if (name === 'geolocation' ? !nav.geolocation : !nav.mediaDevices?.getUserMedia) return [name, 'unavailable'];
        try { return [name, (await nav.permissions.query({ name })).state]; }
        catch { return [name, 'prompt']; }
    }));
    return Object.fromEntries(entries);
}

export async function requestPermissions({ nav = navigator, onState = () => {}, active = () => true } = {}) {
    const states = await permissionStates(nav);
    for (const name of names) {
        if (!active()) break;
        if (states[name] !== 'prompt') { onState(name, states[name]); continue; }
        onState(name, 'waiting');
        try {
            if (name === 'geolocation') {
                await new Promise((resolve, reject) => nav.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000, maximumAge: 0 }));
            } else {
                const stream = await nav.mediaDevices.getUserMedia(name === 'microphone' ? { audio: true } : { video: true });
                // Also release a stream that resolves after the setup was dismissed.
                for (const track of stream.getTracks()) track.stop();
            }
            states[name] = 'granted';
        } catch (error) {
            states[name] = error?.name === 'NotAllowedError' || error?.code === 1 ? 'denied' : 'unavailable';
            if (name === 'geolocation' && error?.code !== 1) {
                try { states[name] = (await nav.permissions.query({ name })).state === 'granted' ? 'granted' : 'unavailable'; } catch { /* No claim that a timed-out fix granted permission. */ }
            }
        }
        if (active()) onState(name, states[name]);
    }
    return states;
}

function remember() { try { localStorage.setItem(SEEN_KEY, 'true'); } catch { /* Setup remains optional. */ } }
export function close() { generation++; remember(); document.getElementById('startup-permissions-modal')?.remove(); }

export async function show() {
    if (document.getElementById('startup-permissions-modal')) return;
    const states = await permissionStates();
    const modal = document.createElement('div');
    modal.id = 'startup-permissions-modal'; modal.className = 'permissions-modal-backdrop';
    modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-labelledby', 'permission-title');
    modal.innerHTML = `<section class="permissions-modal-panel"><button type="button" class="permission-close" data-dialog-close aria-label="Close">×</button>
        <h2 id="permission-title">Enable device features</h2><p>Enable voice input, photos from your camera, and device location. Your browser will ask you to approve each permission.</p>
        <div class="permission-rows">${names.map(name => `<div class="permission-row"><div><strong>${labels[name]}</strong><span>${({ microphone: 'Dictate your messages', camera: 'Take a photo to ask about', geolocation: 'Answer location and local weather questions' })[name]}</span></div><span data-permission="${name}"></span></div>`).join('')}</div>
        <p class="permission-result" role="status" aria-live="polite"></p><button type="button" class="permission-enable">Enable permissions</button><button type="button" class="permission-later">Not now</button></section>`;
    const update = (name, state) => {
        const element = modal.querySelector(`[data-permission="${name}"]`);
        element.textContent = ({ granted: 'Allowed', denied: 'Blocked', waiting: 'Awaiting approval', unavailable: 'Unavailable', prompt: 'Not requested' })[state] || 'Not requested';
    };
    for (const name of names) update(name, states[name]);
    modal.querySelector('[data-dialog-close]').onclick = close;
    modal.querySelector('.permission-later').onclick = close;
    modal.addEventListener('click', event => { if (event.target === modal) close(); });
    modal.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); close(); } });
    modal.querySelector('.permission-enable').onclick = async event => {
        const id = ++generation; const button = event.currentTarget;
        button.disabled = true; button.textContent = 'Waiting for your browser…';
        const results = await requestPermissions({ onState: update, active: () => generation === id });
        if (generation !== id) return;
        remember();
        modal.querySelector('.permission-result').textContent = names.every(name => results[name] === 'granted') ? 'Permissions enabled.' : 'Setup complete. You can change blocked permissions in your browser settings.';
        button.textContent = 'Done'; button.disabled = false; button.onclick = close;
        modal.querySelector('.permission-later').hidden = true;
    };
    document.body.append(modal); modal.querySelector('.permission-enable').focus();
}

export function install() {
    if (installed) return;
    installed = true;
    window.addEventListener('pagehide', () => { generation++; document.getElementById('startup-permissions-modal')?.remove(); });
    let seen = false; try { seen = localStorage.getItem(SEEN_KEY) === 'true'; } catch { /* session only */ }
    if (!seen) setTimeout(async () => {
        const states = await permissionStates();
        if (names.every(name => states[name] === 'granted')) remember();
        else if (!document.querySelector('[role="dialog"]:not([aria-hidden="true"])')) void show();
    }, 700);
}
