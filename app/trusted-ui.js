// Application-owned listeners. Content cannot register code or select a handler
// by name: dynamic bindings use one-use random IDs, then live only in a WeakMap.
const pending = new Map();
const listeners = new WeakMap();
const handledEvents = new WeakMap();
const events = ['click', 'change', 'input', 'keydown', 'submit', 'error', 'load'];
let installed = false;

export function bindUiEvent(type, handler) {
    if (!events.includes(type) || typeof handler !== 'function') throw new TypeError('Invalid UI binding');
    const id = crypto.randomUUID();
    pending.set(id, { type, handler });
    if (pending.size > 20000) pending.delete(pending.keys().next().value);
    return `data-ui-bind-${type}="${id}"`;
}
export function isTrustedBinding(name, value) {
    const binding = pending.get(value);
    return Boolean(binding && name === `data-ui-bind-${binding.type}`);
}
export function assistantAction(action, id = '') {
    return bindUiEvent('click', function(event) {
        event.stopPropagation();
        globalThis.JarvisMarkupSecurity.performAssistantAction(this, action, id);
    });
}
function invoke(node, event) {
    const handler = listeners.get(node)?.get(event.type);
    if (!handler) return;
    const handled = handledEvents.get(event) || new Set();
    if (handled.has(node)) return;
    handled.add(node); handledEvents.set(event, handled);
    if (handler.call(node, event) === false) event.preventDefault();
}
function attach(node, type, handler) {
    const handlers = listeners.get(node) || new Map();
    if (!handlers.has(type)) node.addEventListener(type, event => invoke(node, event));
    handlers.set(type, handler); listeners.set(node, handlers);
}
function claim(node) {
    if (!(node instanceof Element)) return;
    for (const type of events) {
        const name = `data-ui-bind-${type}`, id = node.getAttribute(name);
        const binding = pending.get(id);
        if (binding?.type === type) {
            attach(node, type, binding.handler); pending.delete(id);
        }
        if (id !== null) node.removeAttribute(name);
    }
}
export function installTrustedUI(staticActions = {}) {
    if (installed) return;
    installed = true;
    for (const node of document.querySelectorAll('[data-ui-static]')) {
        const action = staticActions[node.dataset.uiStatic];
        if (action) for (const [type, handler] of action) attach(node, type, handler);
        node.removeAttribute('data-ui-static');
    }
    for (const type of events) document.addEventListener(type, event => {
        for (let node = event.target; node instanceof Element; node = node.parentElement) {
            claim(node);
            invoke(node, event);
            if (event.cancelBubble) break;
        }
    }, type === 'error' || type === 'load');
    const selector = events.map(type => `[data-ui-bind-${type}]`).join(',');
    const observer = new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) {
            if (!(node instanceof Element)) continue;
            claim(node); node.querySelectorAll(selector).forEach(claim);
        }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
}
