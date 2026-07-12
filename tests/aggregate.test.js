const test = require('node:test');
const assert = require('node:assert/strict');
const {
  shiftYearMonth, sumRecords, filterRecords, profitRate, pctChange, daysInMonth,
  getMonthlyComparison, getChannelTable, getDailyCumulativeSeries, getMonthlyTrend, getBrandTable,
} = require('../js/aggregate.js');

test('shiftYearMonth moves the year and keeps the month', () => {
  assert.equal(shiftYearMonth('2026-06', -1), '2025-06');
  assert.equal(shiftYearMonth('2025-12', 1), '2026-12');
});

test('sumRecords totals sales/cost/profit', () => {
  const totals = sumRecords([{ sales: 100, cost: 40, profit: 60 }, { sales: 50, cost: 20, profit: 30 }]);
  assert.deepEqual(totals, { sales: 150, cost: 60, profit: 90 });
});

test('filterRecords matches only provided keys', () => {
  const recs = [{ yearMonth: '2026-06', channel: 'TV' }, { yearMonth: '2026-06', channel: '自社' }];
  assert.equal(filterRecords(recs, { channel: 'TV' }).length, 1);
  assert.equal(filterRecords(recs, {}).length, 2);
});

test('profitRate and pctChange handle zero-base gracefully', () => {
  assert.equal(profitRate({ sales: 200, profit: 50 }), 0.25);
  assert.equal(profitRate({ sales: 0, profit: 0 }), 0);
  assert.equal(pctChange(150, 100), 0.5);
  assert.equal(pctChange(0, 0), 0);
  assert.equal(pctChange(50, 0), null);
});

test('daysInMonth returns correct day counts including leap Feb', () => {
  assert.equal(daysInMonth('2026-06'), 30);
  assert.equal(daysInMonth('2024-02'), 29);
  assert.equal(daysInMonth('2026-02'), 28);
});

function sampleState() {
  return {
    baseRecords: [
      { yearMonth: '2025-06', channel: 'TV', type: '通常', brand: 'MCTオイル', sales: 1000, cost: 400, profit: 600 },
      { yearMonth: '2025-06', channel: '自社', type: '定期', brand: 'MSMパウダー', sales: 2000, cost: 800, profit: 1200 },
    ],
    monthlyRecords: [
      { yearMonth: '2026-06', channel: 'TV', type: '通常', brand: 'MCTオイル', sales: 1200, cost: 480, profit: 720 },
      { yearMonth: '2026-06', channel: '自社', type: '定期', brand: 'MSMパウダー', sales: 1800, cost: 720, profit: 1080 },
    ],
    dailyRecords: [
      { yearMonth: '2026-06', date: '2026-06-01', channel: 'TV', type: '通常', brand: 'MCTオイル', sales: 100, cost: 40, profit: 60 },
      { yearMonth: '2026-06', date: '2026-06-02', channel: 'TV', type: '通常', brand: 'MCTオイル', sales: 200, cost: 80, profit: 120 },
    ],
    targets: [{ yearMonth: '2026-06', salesTarget: 3000, profitTarget: 1800 }],
    mediaMapping: {},
    productBrandMapping: {},
  };
}

test('getMonthlyComparison compares 2期 month against 1期 same month one year earlier', () => {
  const cmp = getMonthlyComparison(sampleState(), '2026-06');
  assert.equal(cmp.sales, 3000); // 1200 + 1800
  assert.equal(cmp.profit, 1800); // 720 + 1080
  assert.equal(cmp.profitRate, 0.6);
  assert.equal(cmp.salesYoY, 0); // (3000-3000)/3000
  assert.equal(cmp.salesTargetRate, 1); // 3000/3000
  assert.equal(cmp.profitTargetRate, 1);
});

test('getChannelTable returns all 7 channels with sales/profit/profitRate/salesYoY, no target column', () => {
  const table = getChannelTable(sampleState(), '2026-06');
  assert.equal(table.length, 7);
  const tv = table.find(r => r.channel === 'TV');
  assert.equal(tv.sales, 1200);
  assert.equal(tv.salesYoY, 0.2); // (1200-1000)/1000
  assert.equal('salesTargetRate' in tv, false);
  const kaso = table.find(r => r.channel === 'yahoo');
  assert.equal(kaso.sales, 0);
});

test('getDailyCumulativeSeries produces one entry per day with actual cumulative and prorated 1期 pace', () => {
  const series = getDailyCumulativeSeries(sampleState(), '2026-06');
  assert.equal(series.length, 30);
  assert.equal(series[0].actualSales, 100);
  assert.equal(series[1].actualSales, 300);
  // base month total sales = 3000, day 2 of 30 => pace = 3000 * 2/30 = 200
  assert.equal(series[1].paceSales, 200);
});

test('getMonthlyTrend returns one row per month present in monthlyRecords with base and target', () => {
  const trend = getMonthlyTrend(sampleState());
  assert.equal(trend.length, 1);
  assert.equal(trend[0].yearMonth, '2026-06');
  assert.equal(trend[0].currentSales, 3000);
  assert.equal(trend[0].baseSales, 3000);
  assert.equal(trend[0].targetSales, 3000);
});

test('getBrandTable returns one row per brand present in the month, sorted by descending sales, with 1期比', () => {
  const table = getBrandTable(sampleState(), '2026-06');
  assert.equal(table.length, 2);
  assert.equal(table[0].brand, 'MSMパウダー'); // 1800 > 1200, so it sorts first
  assert.equal(table[0].sales, 1800);
  assert.equal(table[0].profit, 1080);
  assert.equal(table[0].profitRate, 0.6);
  assert.equal(table[0].salesYoY, -0.1); // (1800-2000)/2000
  assert.equal(table[1].brand, 'MCTオイル');
  assert.equal(table[1].sales, 1200);
  assert.equal(table[1].salesYoY, 0.2); // (1200-1000)/1000
});

test('getBrandTable returns an empty array when the month has no brand-bearing records', () => {
  const state = sampleState();
  state.monthlyRecords = state.monthlyRecords.map(r => { const { brand, ...rest } = r; return rest; }); // simulate pre-feature records
  const table = getBrandTable(state, '2026-06');
  assert.deepEqual(table, []);
});
