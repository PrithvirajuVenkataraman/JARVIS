import './bootstrap.js';
import legacyUrl from './legacy-runtime.js?url&no-inline';
import settingsUrl from './features/settings-runtime.js?url&no-inline';
import visionUrl from './features/vision-runtime.js?url&no-inline';
import * as JarvisStreamRenderer from './stream-renderer.js';
import * as JarvisPersistence from './persistence-controller.js';
import * as JarvisPerformance from './performance-metrics.js';
import { installDialogController } from './dialog-controller.js';
import { installComposerAccessibility } from './composer-controller.js';
import * as JarvisCapabilities from './capabilities.js';
import * as JarvisCodeRunner from './code-runner.js';

Object.assign(window, { JarvisStreamRenderer, JarvisPersistence, JarvisPerformance, JarvisCodeRunner, JarvisCapabilities });
const scripts = new Map();
function loadClassic(url) {
    if (!scripts.has(url)) scripts.set(url, new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = url;
        script.onload = resolve;
        script.onerror = () => { scripts.delete(url); reject(new Error('The feature could not load. Please retry.')); };
        document.body.append(script);
    }));
    return scripts.get(url);
}
window.JarvisLazy = { loadClassic: name => loadClassic({ settings: settingsUrl, vision: visionUrl }[name]) };
// Classic compatibility code may register readiness callbacks after the DOM is ready.
const addDocumentListener = document.addEventListener;
document.addEventListener = function (type, listener, options) {
    if (type === 'DOMContentLoaded' && document.readyState !== 'loading') {
        queueMicrotask(() => typeof listener === 'function' ? listener.call(document, new Event(type)) : listener.handleEvent(new Event(type)));
    } else addDocumentListener.call(document, type, listener, options);
};
try { await loadClassic(legacyUrl); }
finally { document.addEventListener = addDocumentListener; }
JarvisPersistence.installPersistenceLifecycle();
JarvisPerformance.installPerformanceObservers();
installDialogController();
installComposerAccessibility();
JarvisCapabilities.installCapabilityVisibility();
if (!import.meta.env.DEV && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(registration => registration.update()).catch(() => {
        window.dispatchEvent(new CustomEvent('jarvis:offline-unavailable'));
    });
}
window.__jarvisModernReady = true;
