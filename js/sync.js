(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.YoiHibi = Object.assign(root.YoiHibi || {}, factory());
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const PASSTHROUGH_METHODS = new Set(['getState', 'exportJSON']);

  function wrapStoreWithSync(store, onChange) {
    const wrapped = {};
    Object.keys(store).forEach(key => {
      const original = store[key];
      if (typeof original !== 'function') { wrapped[key] = original; return; }
      if (PASSTHROUGH_METHODS.has(key)) { wrapped[key] = original.bind(store); return; }
      wrapped[key] = function (...args) {
        const result = original.apply(store, args);
        onChange(store.exportJSON());
        return result;
      };
    });
    return wrapped;
  }

  function debounce(fn, waitMs) {
    let timer = null;
    return function (...args) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; fn(...args); }, waitMs);
    };
  }

  return { wrapStoreWithSync, debounce };
});
