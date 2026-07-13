(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.YoiHibi = Object.assign(root.YoiHibi || {}, factory());
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const STORAGE_KEY = 'yoihibi-dashboard-v1';

  function emptyState() {
    return { baseRecords: [], monthlyRecords: [], dailyRecords: [], targets: [], mediaMapping: {}, productBrandMapping: {}, janUnitCosts: {} };
  }

  function createStore(backend) {
    function load() {
      const raw = backend.getItem(STORAGE_KEY);
      if (!raw) return emptyState();
      try {
        const parsed = JSON.parse(raw);
        return Object.assign(emptyState(), parsed);
      } catch (e) {
        return emptyState();
      }
    }
    function save(state) { backend.setItem(STORAGE_KEY, JSON.stringify(state)); }

    return {
      getState: load,
      setBaseRecords(records) { const s = load(); s.baseRecords = records; save(s); return s; },
      upsertMonthlyRecords(yearMonth, records) {
        const s = load();
        s.monthlyRecords = s.monthlyRecords.filter(r => r.yearMonth !== yearMonth).concat(records);
        save(s); return s;
      },
      upsertDailyRecords(yearMonth, records) {
        const s = load();
        s.dailyRecords = s.dailyRecords.filter(r => r.yearMonth !== yearMonth).concat(records);
        save(s); return s;
      },
      setTargets(targets) { const s = load(); s.targets = targets; save(s); return s; },
      setMediaMapping(mapping) { const s = load(); s.mediaMapping = mapping; save(s); return s; },
      setProductBrandMapping(mapping) { const s = load(); s.productBrandMapping = mapping; save(s); return s; },
      upsertJanUnitCosts(costs) {
        const s = load();
        s.janUnitCosts = Object.assign({}, s.janUnitCosts, costs);
        save(s); return s;
      },
      clearAll() { save(emptyState()); return emptyState(); },
      exportJSON() { return JSON.stringify(load(), null, 2); },
      importJSON(json) { const s = Object.assign(emptyState(), JSON.parse(json)); save(s); return s; },
    };
  }

  return { createStore };
});
