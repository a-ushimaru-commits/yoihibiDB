const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../js/store.js');

function fakeBackend() {
  const data = {};
  return { getItem: k => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = v; } };
}

test('getState returns empty structure when nothing stored', () => {
  const store = createStore(fakeBackend());
  const state = store.getState();
  assert.deepEqual(state, { baseRecords: [], monthlyRecords: [], dailyRecords: [], targets: [], ownChannelTargets: [], mediaMapping: {}, productBrandMapping: {}, productTypeMapping: {}, janUnitCosts: {} });
});

test('setBaseRecords persists and getState reflects it', () => {
  const store = createStore(fakeBackend());
  store.setBaseRecords([{ yearMonth: '2025-06', channel: 'TV', type: '通常', sales: 100, cost: 40, profit: 60 }]);
  assert.equal(store.getState().baseRecords.length, 1);
});

test('upsertMonthlyRecords overwrites only the given yearMonth', () => {
  const store = createStore(fakeBackend());
  store.upsertMonthlyRecords('2026-06', [{ yearMonth: '2026-06', channel: 'TV', type: '通常', sales: 100, cost: 40, profit: 60 }]);
  store.upsertMonthlyRecords('2026-07', [{ yearMonth: '2026-07', channel: 'TV', type: '通常', sales: 200, cost: 80, profit: 120 }]);
  // re-import 2026-06 with different totals -> must replace, not add to, the old 2026-06 rows
  store.upsertMonthlyRecords('2026-06', [{ yearMonth: '2026-06', channel: 'TV', type: '通常', sales: 999, cost: 1, profit: 998 }]);

  const records = store.getState().monthlyRecords;
  assert.equal(records.filter(r => r.yearMonth === '2026-06').length, 1);
  assert.equal(records.find(r => r.yearMonth === '2026-06').sales, 999);
  assert.equal(records.find(r => r.yearMonth === '2026-07').sales, 200);
});

test('upsertDailyRecords overwrites only the given yearMonth', () => {
  const store = createStore(fakeBackend());
  store.upsertDailyRecords('2026-06', [{ yearMonth: '2026-06', date: '2026-06-01', channel: 'TV', type: '通常', sales: 10, cost: 4, profit: 6 }]);
  store.upsertDailyRecords('2026-06', [{ yearMonth: '2026-06', date: '2026-06-02', channel: 'TV', type: '通常', sales: 20, cost: 8, profit: 12 }]);
  const records = store.getState().dailyRecords;
  assert.equal(records.length, 1);
  assert.equal(records[0].date, '2026-06-02');
});

test('setTargets, setMediaMapping, and setProductBrandMapping replace their sections', () => {
  const store = createStore(fakeBackend());
  store.setTargets([{ yearMonth: '2026-06', salesTarget: 1000000, profitTarget: 400000 }]);
  store.setMediaMapping({ '新媒体': 'TV' });
  store.setProductBrandMapping({ 'FH0009999999999': 'MCTオイル' });
  const state = store.getState();
  assert.equal(state.targets[0].salesTarget, 1000000);
  assert.equal(state.mediaMapping['新媒体'], 'TV');
  assert.equal(state.productBrandMapping['FH0009999999999'], 'MCTオイル');
});

test('setProductTypeMapping replaces the 定期/通常 override section', () => {
  const store = createStore(fakeBackend());
  store.setProductTypeMapping({ 'FH0009999999999': '定期' });
  assert.equal(store.getState().productTypeMapping['FH0009999999999'], '定期');
});

test('setOwnChannelTargets replaces the 自社 channel target section independently of setTargets', () => {
  const store = createStore(fakeBackend());
  store.setTargets([{ yearMonth: '2026-06', salesTarget: 1000000, profitTarget: 400000 }]);
  store.setOwnChannelTargets([{ yearMonth: '2026-06', salesTarget: 550000, profitTarget: 220000 }]);
  const state = store.getState();
  assert.equal(state.targets[0].salesTarget, 1000000);
  assert.equal(state.ownChannelTargets[0].salesTarget, 550000);
});

test('upsertJanUnitCosts merges in new JAN unit costs, letting newer values overwrite matching JANs while keeping others', () => {
  const store = createStore(fakeBackend());
  store.upsertJanUnitCosts({ '0061998079829': 2210, '1111111111111': 500 });
  store.upsertJanUnitCosts({ '0061998079829': 2300 }); // updated cost for the same JAN from a newer monthly file
  const { janUnitCosts } = store.getState();
  assert.deepEqual(janUnitCosts, { '0061998079829': 2300, '1111111111111': 500 });
});

test('exportJSON/importJSON round-trip', () => {
  const store = createStore(fakeBackend());
  store.setBaseRecords([{ yearMonth: '2025-06', channel: 'TV', type: '通常', sales: 100, cost: 40, profit: 60 }]);
  const json = store.exportJSON();

  const store2 = createStore(fakeBackend());
  store2.importJSON(json);
  assert.deepEqual(store2.getState(), store.getState());
});

test('clearAll resets to empty structure', () => {
  const store = createStore(fakeBackend());
  store.setBaseRecords([{ yearMonth: '2025-06', channel: 'TV', type: '通常', sales: 1, cost: 1, profit: 0 }]);
  store.clearAll();
  assert.deepEqual(store.getState().baseRecords, []);
});
