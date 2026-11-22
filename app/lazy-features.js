export function lazyModule(load, fallbacks = {}) {
    let loaded;
    let pending;
    const getModule = () => pending ||= load().then(module => { loaded = module; return module; }).catch(error => { pending = null; throw error; });
    return new Proxy({}, {
        get(_target, name) {
            if (loaded) return loaded[name];
            if (name in fallbacks) return fallbacks[name];
            return (...args) => getModule().then(module => module[name](...args));
        }
    });
}
