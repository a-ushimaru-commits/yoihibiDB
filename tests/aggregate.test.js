const test = require('node:test');
const assert = require('node:assert/strict');
const {
  shiftYearMonth, sumRecords, filterRecords, profitRate, pctChange, daysInMonth,
  getMonthlyComparison, getChannelTable, getDailyCumulativeSeries, getMonthlyTrend, getBrandTable,
  getBrandMonthlyPivot, getChannelMonthlyPivot, previousMonth, getElapsedDays,
  getOwnChannelMonthlySummary,
} = require('../js/aggregate.js');

test('shiftYearMonth moves the year and keeps the month', () => {
  assert.equal(shiftYearMonth('2026-06', -1), '2025-06');
  assert.equal(shiftYearMonth('2025-12', 1), '2026-12');
});

test('sumRecords totals qty/sales/cost/profit, defaulting missing qty to 0', () => {
  const totals = sumRecords([{ qty: 2, sales: 100, cost: 40, profit: 60 }, { qty: 3, sales: 50, cost: 20, profit: 30 }]);
  assert.deepEqual(totals, { qty: 5, sales: 150, cost: 60, profit: 90 });

  const totalsWithoutQty = sumRecords([{ sales: 100, cost: 40, profit: 60 }]);
  assert.equal(totalsWithoutQty.qty, 0);
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

test('previousMonth moves back one month, rolling over the year at January', () => {
  assert.equal(previousMonth('2026-07'), '2026-06');
  assert.equal(previousMonth('2026-01'), '2025-12');
});

test('getElapsedDays returns the full month length when confirmed monthlyRecords exist for that month', () => {
  const state = { monthlyRecords: [{ yearMonth: '2026-06', channel: 'TV', type: '通常', sales: 1, cost: 0, profit: 1 }], dailyRecords: [] };
  assert.equal(getElapsedDays(state, '2026-06'), 30);
});

test('getElapsedDays returns the latest day present in dailyRecords when the month has no confirmed monthly data', () => {
  const state = {
    monthlyRecords: [],
    dailyRecords: [
      { yearMonth: '2026-07', date: '2026-07-05', channel: 'TV', type: '通常', sales: 1, cost: 0, profit: 1 },
      { yearMonth: '2026-07', date: '2026-07-13', channel: 'TV', type: '通常', sales: 1, cost: 0, profit: 1 },
      { yearMonth: '2026-07', date: '2026-07-09', channel: 'TV', type: '通常', sales: 1, cost: 0, profit: 1 },
    ],
  };
  assert.equal(getElapsedDays(state, '2026-07'), 13);
});

test('getElapsedDays degrades to the full month length when there is no data at all for that month', () => {
  const state = { monthlyRecords: [], dailyRecords: [] };
  assert.equal(getElapsedDays(state, '2026-07'), 31);
});

function sampleState() {
  return {
    baseRecords: [
      { yearMonth: '2025-06', channel: 'TV', type: '通常', brand: 'MCTオイル', qty: 20, sales: 1000, cost: 400, profit: 600 },
      { yearMonth: '2025-06', channel: '自社', type: '定期', brand: 'MSMパウダー', qty: 30, sales: 2000, cost: 800, profit: 1200 },
    ],
    monthlyRecords: [
      { yearMonth: '2026-06', channel: 'TV', type: '通常', brand: 'MCTオイル', qty: 10, sales: 1200, cost: 480, profit: 720 },
      { yearMonth: '2026-06', channel: '自社', type: '定期', brand: 'MSMパウダー', qty: 15, sales: 1800, cost: 720, profit: 1080 },
    ],
    dailyRecords: [
      { yearMonth: '2026-06', date: '2026-06-01', channel: 'TV', type: '通常', brand: 'MCTオイル', qty: 2, sales: 100, cost: 40, profit: 60 },
      { yearMonth: '2026-06', date: '2026-06-02', channel: 'TV', type: '通常', brand: 'MCTオイル', qty: 4, sales: 200, cost: 80, profit: 120 },
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

test('getMonthlyComparison also computes 前月比 (MoM) against the immediately preceding month', () => {
  const state = sampleState();
  state.monthlyRecords.push(
    { yearMonth: '2026-05', channel: 'TV', type: '通常', brand: 'MCTオイル', sales: 1000, cost: 400, profit: 600 },
  );
  const cmp = getMonthlyComparison(state, '2026-06');
  assert.equal(cmp.salesMoM, 2); // (3000-1000)/1000
});

test('getMonthlyComparison prorates the target by elapsed days when the month has no confirmed monthly data yet', () => {
  const state = {
    baseRecords: [],
    monthlyRecords: [],
    dailyRecords: [
      { yearMonth: '2026-07', date: '2026-07-01', channel: 'TV', type: '通常', brand: 'MCTオイル', sales: 500, cost: 200, profit: 300 },
      { yearMonth: '2026-07', date: '2026-07-10', channel: 'TV', type: '通常', brand: 'MCTオイル', sales: 500, cost: 200, profit: 300 },
    ],
    targets: [{ yearMonth: '2026-07', salesTarget: 3100, profitTarget: 1240 }], // full-month target: 100/day sales, 40/day profit
    mediaMapping: {}, productBrandMapping: {},
  };
  const cmp = getMonthlyComparison(state, '2026-07');
  // elapsed days = 10 (latest day in dailyRecords); prorated sales target = 3100 * 10/31 ≈ 1000
  assert.equal(cmp.sales, 1000);
  assert.equal(cmp.salesTargetRateProrated, 1); // 1000 / (3100*10/31)
  assert.ok(cmp.salesTargetRate < 1); // full-month target rate is much lower than the prorated one
});

test('getMonthlyComparison restricts to a channel and uses an override targets array when given options', () => {
  const state = sampleState();
  const cmp = getMonthlyComparison(state, '2026-06', { channel: '自社', targets: [{ yearMonth: '2026-06', salesTarget: 1800, profitTarget: 1080 }] });
  assert.equal(cmp.sales, 1800); // only the 自社/MSMパウダー row, not TV's
  assert.equal(cmp.profit, 1080);
  assert.equal(cmp.salesTargetRate, 1); // uses the override targets array, not state.targets (which would give 1800/3000)
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

test('getDailyCumulativeSeries also prorates 1期の定期数量/通常数量 (paceTeikiQty/paceTsujoQty) from baseRecords', () => {
  const series = getDailyCumulativeSeries(sampleState(), '2026-06');
  // base month (2025-06): teikiQty=30 (自社/定期/MSMパウダー), tsujoQty=20 (TV/通常/MCTオイル); day 2 of 30
  assert.ok(Math.abs(series[1].paceTeikiQty - 30 * 2 / 30) < 1e-9);
  assert.ok(Math.abs(series[1].paceTsujoQty - 20 * 2 / 30) < 1e-9);
});

test('getDailyCumulativeSeries also cumulates 定期数量/通常数量 (qty) per day, by type', () => {
  const series = getDailyCumulativeSeries(sampleState(), '2026-06');
  // only 通常/TV daily records exist in the fixture: day1 qty=2, day2 qty=4
  assert.equal(series[0].actualTeikiQty, 0);
  assert.equal(series[0].actualTsujoQty, 2);
  assert.equal(series[1].actualTeikiQty, 0);
  assert.equal(series[1].actualTsujoQty, 6);
});

test('getMonthlyTrend returns a trailing chronological window including 1期-only (baseRecords) months, with base and target for the matching 2期 month', () => {
  const trend = getMonthlyTrend(sampleState());
  assert.deepEqual(trend.map(t => t.yearMonth), ['2025-06', '2026-06']);
  const june2026 = trend.find(t => t.yearMonth === '2026-06');
  assert.equal(june2026.currentSales, 3000);
  assert.equal(june2026.baseSales, 3000);
  assert.equal(june2026.targetSales, 3000);
});

test('getMonthlyTrend sources currentSales directly from baseRecords for months that predate any 2期 data', () => {
  const trend = getMonthlyTrend(sampleState());
  const june2025 = trend.find(t => t.yearMonth === '2025-06');
  assert.equal(june2025.currentSales, 3000); // 1000 (TV/通常) + 2000 (自社/定期) from baseRecords itself
  assert.equal(june2025.baseSales, null); // no 2024-06 baseRecords at all -> null (no comparison available), not a misleading 0
});

test('getMonthlyTrend distinguishes "no 1期 comparison data at all" (null) from "1期 sales genuinely totaling zero" (0)', () => {
  const state = sampleState();
  // 2025-07 baseRecords row genuinely nets to zero sales (e.g. a return), unlike 2024-06 which has no row at all
  state.baseRecords.push({ yearMonth: '2025-07', channel: 'TV', type: '通常', brand: 'MCTオイル', sales: 0, cost: 0, profit: 0 });
  state.monthlyRecords.push({ yearMonth: '2026-07', channel: 'TV', type: '通常', brand: 'MCTオイル', sales: 500, cost: 200, profit: 300 });
  const trend = getMonthlyTrend(state);
  const july2026 = trend.find(t => t.yearMonth === '2026-07');
  assert.equal(july2026.baseSales, 0); // 2025-07 baseRecords row DOES exist, genuinely sums to 0 -- not null
});

test('getMonthlyTrend caps the window at the most recent 12 months even when more history exists', () => {
  const baseRecords = [];
  const months = [];
  let y = 2025, m = 1;
  for (let i = 0; i < 14; i++) {
    const ym = `${y}-${String(m).padStart(2, '0')}`;
    months.push(ym);
    baseRecords.push({ yearMonth: ym, channel: 'TV', type: '通常', sales: 100, cost: 40, profit: 60, qty: 1 });
    m++; if (m > 12) { m = 1; y++; }
  }
  const state = { baseRecords, monthlyRecords: [], dailyRecords: [], targets: [], mediaMapping: {}, productBrandMapping: {} };
  const trend = getMonthlyTrend(state);
  assert.equal(trend.length, 12);
  assert.deepEqual(trend.map(t => t.yearMonth), months.slice(-12));
});

test('getMonthlyTrend also includes 定期数量/通常数量 (qty) split by type for the month', () => {
  const trend = getMonthlyTrend(sampleState());
  const june2026 = trend.find(t => t.yearMonth === '2026-06');
  assert.equal(june2026.teikiQty, 15); // 自社/定期/MSMパウダー
  assert.equal(june2026.tsujoQty, 10); // TV/通常/MCTオイル
});

test('getMonthlyTrend also includes baseTeikiQty/baseTsujoQty (1期の定期数量/通常数量) for the matching 2期 month', () => {
  const trend = getMonthlyTrend(sampleState());
  const june2026 = trend.find(t => t.yearMonth === '2026-06');
  assert.equal(june2026.baseTeikiQty, 30); // 自社/定期/MSMパウダー in baseRecords 2025-06
  assert.equal(june2026.baseTsujoQty, 20); // TV/通常/MCTオイル in baseRecords 2025-06
});

test('getMonthlyTrend reports baseTeikiQty/baseTsujoQty as null (not 0) when there is no 1期 comparison data at all', () => {
  const trend = getMonthlyTrend(sampleState());
  const june2025 = trend.find(t => t.yearMonth === '2025-06');
  assert.equal(june2025.baseTeikiQty, null);
  assert.equal(june2025.baseTsujoQty, null);
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

function dailyOnlyMonthState() {
  return {
    baseRecords: [
      { yearMonth: '2025-07', channel: 'TV', type: '通常', brand: 'MCTオイル', sales: 500, cost: 200, profit: 300 },
    ],
    monthlyRecords: [
      // 2026-06 already has confirmed monthly data -- its daily records (if any) must be ignored
      { yearMonth: '2026-06', channel: 'TV', type: '通常', brand: 'MCTオイル', sales: 1200, cost: 480, profit: 720 },
    ],
    dailyRecords: [
      { yearMonth: '2026-06', date: '2026-06-01', channel: 'TV', type: '通常', brand: 'MCTオイル', sales: 999, cost: 999, profit: 999 }, // must be ignored (monthly already exists)
      // 2026-07 has ONLY daily records (no monthly xlsx yet) -- must be used as an interim aggregate
      { yearMonth: '2026-07', date: '2026-07-01', channel: '自社', type: '通常', brand: 'MSMパウダー', sales: 400, cost: 150, profit: 250 },
      { yearMonth: '2026-07', date: '2026-07-02', channel: 'TV', type: '定期', brand: 'MCTオイル', sales: 100, cost: 40, profit: 60 },
    ],
    targets: [],
    mediaMapping: {},
    productBrandMapping: {},
  };
}

test('getMonthlyComparison falls back to daily records for a month with no confirmed monthly data', () => {
  const cmp = getMonthlyComparison(dailyOnlyMonthState(), '2026-07');
  assert.equal(cmp.sales, 500); // 400 + 100
  assert.equal(cmp.profit, 310); // 250 + 60
});

test('getMonthlyComparison ignores daily records for a month that already has confirmed monthly data', () => {
  const cmp = getMonthlyComparison(dailyOnlyMonthState(), '2026-06');
  assert.equal(cmp.sales, 1200); // NOT 1200+999
});

test('getChannelTable falls back to daily records for a month with no confirmed monthly data', () => {
  const table = getChannelTable(dailyOnlyMonthState(), '2026-07');
  const jisha = table.find(r => r.channel === '自社');
  const tv = table.find(r => r.channel === 'TV');
  assert.equal(jisha.sales, 400);
  assert.equal(tv.sales, 100);
});

test('getBrandTable falls back to daily records for a month with no confirmed monthly data', () => {
  const table = getBrandTable(dailyOnlyMonthState(), '2026-07');
  const msm = table.find(r => r.brand === 'MSMパウダー');
  const mct = table.find(r => r.brand === 'MCTオイル');
  assert.equal(msm.sales, 400);
  assert.equal(mct.sales, 100);
});

test('getMonthlyTrend includes a daily-only month, falling back to its daily aggregate', () => {
  const trend = getMonthlyTrend(dailyOnlyMonthState());
  assert.deepEqual(trend.map(t => t.yearMonth), ['2025-07', '2026-06', '2026-07']);
  const july = trend.find(t => t.yearMonth === '2026-07');
  assert.equal(july.currentSales, 500);
  assert.equal(july.currentProfit, 310);
});

function pivotSampleState() {
  return {
    baseRecords: [
      { yearMonth: '2025-06', channel: 'TV', type: '定期', brand: 'MCTオイル', sales: 100, cost: 40, profit: 60 },
      { yearMonth: '2025-06', channel: '自社', type: '通常', brand: 'MSMパウダー', sales: 200, cost: 80, profit: 120 },
      { yearMonth: '2025-06', channel: 'TV', type: '通常', brand: null, sales: 50, cost: 20, profit: 30 }, // blank-brand row: counts in totals, not in byBrand
    ],
    monthlyRecords: [
      { yearMonth: '2026-06', channel: 'TV', type: '定期', brand: 'MCTオイル', sales: 300, cost: 120, profit: 180 },
      { yearMonth: '2026-06', channel: '自社', type: '通常', brand: '未分類', sales: 10, cost: 5, profit: 5 }, // "未分類" is a real string brand, unlike null
    ],
    dailyRecords: [],
    targets: [],
    mediaMapping: {},
    productBrandMapping: {},
  };
}

test('getBrandMonthlyPivot spans both 1期 (baseRecords) and 2期 (monthlyRecords) as one continuous month list', () => {
  const pivot = getBrandMonthlyPivot(pivotSampleState());
  assert.deepEqual(pivot.months, ['2025-06', '2026-06']);
});

test('getBrandMonthlyPivot sorts brands by total sales across all months, descending, excluding null-brand rows', () => {
  const pivot = getBrandMonthlyPivot(pivotSampleState());
  // MCTオイル: 100 + 300 = 400 total; MSMパウダー: 200; 未分類: 10 -- and no separate "null" entry
  assert.deepEqual(pivot.brands, ['MCTオイル', 'MSMパウダー', '未分類']);
});

test('getBrandMonthlyPivot totals include blank-brand rows even though they are excluded from byBrand', () => {
  const pivot = getBrandMonthlyPivot(pivotSampleState());
  const june2025 = pivot.rows.find(r => r.yearMonth === '2025-06');
  assert.equal(june2025.totalTeikiSales, 100);
  assert.equal(june2025.totalTeikiProfit, 60);
  assert.equal(june2025.totalTsujoSales, 250); // 200 (MSMパウダー) + 50 (blank brand)
  assert.equal(june2025.totalTsujoProfit, 150); // 120 + 30
});

test('getBrandMonthlyPivot zero-fills a brand with no data in a given month, per-brand split by 定期/通常', () => {
  const pivot = getBrandMonthlyPivot(pivotSampleState());
  const june2025 = pivot.rows.find(r => r.yearMonth === '2025-06');
  assert.deepEqual(june2025.byBrand['MCTオイル'], { teikiSales: 100, teikiProfit: 60, tsujoSales: 0, tsujoProfit: 0 });
  assert.deepEqual(june2025.byBrand['MSMパウダー'], { teikiSales: 0, teikiProfit: 0, tsujoSales: 200, tsujoProfit: 120 });
  assert.deepEqual(june2025.byBrand['未分類'], { teikiSales: 0, teikiProfit: 0, tsujoSales: 0, tsujoProfit: 0 }); // no 2025-06 row for 未分類 at all

  const june2026 = pivot.rows.find(r => r.yearMonth === '2026-06');
  assert.deepEqual(june2026.byBrand['MCTオイル'], { teikiSales: 300, teikiProfit: 180, tsujoSales: 0, tsujoProfit: 0 });
  assert.deepEqual(june2026.byBrand['MSMパウダー'], { teikiSales: 0, teikiProfit: 0, tsujoSales: 0, tsujoProfit: 0 });
  assert.deepEqual(june2026.byBrand['未分類'], { teikiSales: 0, teikiProfit: 0, tsujoSales: 10, tsujoProfit: 5 });
});

test('getBrandMonthlyPivot recodes 1期 (baseRecords) brands not in productBrandMapping to その他, once a mapping is loaded', () => {
  const state = pivotSampleState();
  // 分解詳細リストの商品細分に存在するのはMCTオイルだけ、というシナリオ
  state.productBrandMapping = { 'FH0001': 'MCTオイル' };
  const pivot = getBrandMonthlyPivot(state);
  assert.ok(pivot.brands.includes('MCTオイル'));
  assert.ok(!pivot.brands.includes('MSMパウダー')); // 分解詳細リストに無いので その他 に吸収される
  assert.ok(pivot.brands.includes('その他'));
  assert.ok(pivot.brands.includes('未分類')); // 2期(monthlyRecords)側は対象外、従来通り

  const june2025 = pivot.rows.find(r => r.yearMonth === '2025-06');
  // その他 = MSMパウダー(200/120,通常) + 元々null(50/30,通常) が合算される
  assert.deepEqual(june2025.byBrand['その他'], { teikiSales: 0, teikiProfit: 0, tsujoSales: 250, tsujoProfit: 150 });
});

test('getBrandMonthlyPivot leaves 1期 (baseRecords) brands untouched when productBrandMapping is empty (not yet loaded)', () => {
  const pivot = getBrandMonthlyPivot(pivotSampleState()); // productBrandMapping: {}
  assert.deepEqual(pivot.brands, ['MCTオイル', 'MSMパウダー', '未分類']); // unchanged from the existing behavior
});

test('getBrandMonthlyPivot returns empty months/brands/rows when both record sets are empty', () => {
  const pivot = getBrandMonthlyPivot({ baseRecords: [], monthlyRecords: [] });
  assert.deepEqual(pivot, { months: [], brands: [], rows: [] });
});

test('getBrandMonthlyPivot with a channel filter restricts months/brands/totals/byBrand to only that channel\'s records', () => {
  const pivot = getBrandMonthlyPivot(pivotSampleState(), { channel: '自社' });
  // MCTオイル only ever appears on TV, so it's excluded entirely once filtered to 自社
  assert.deepEqual(pivot.brands, ['MSMパウダー', '未分類']);
  assert.deepEqual(pivot.months, ['2025-06', '2026-06']);

  const june2025 = pivot.rows.find(r => r.yearMonth === '2025-06');
  assert.equal(june2025.totalTeikiSales, 0);
  assert.equal(june2025.totalTsujoSales, 200);
  assert.deepEqual(june2025.byBrand['MSMパウダー'], { teikiSales: 0, teikiProfit: 0, tsujoSales: 200, tsujoProfit: 120 });
  assert.deepEqual(june2025.byBrand['未分類'], { teikiSales: 0, teikiProfit: 0, tsujoSales: 0, tsujoProfit: 0 });

  const june2026 = pivot.rows.find(r => r.yearMonth === '2026-06');
  assert.deepEqual(june2026.byBrand['未分類'], { teikiSales: 0, teikiProfit: 0, tsujoSales: 10, tsujoProfit: 5 });
});

test('getBrandMonthlyPivot with no filter argument behaves exactly as before (backward compatible)', () => {
  const withoutFilter = getBrandMonthlyPivot(pivotSampleState());
  const withEmptyFilter = getBrandMonthlyPivot(pivotSampleState(), {});
  assert.deepEqual(withoutFilter, withEmptyFilter);
});

test('getChannelMonthlyPivot spans both 1期 and 2期 as one continuous month list, with all 7 channels in the fixed CHANNELS order', () => {
  const pivot = getChannelMonthlyPivot(pivotSampleState());
  assert.deepEqual(pivot.months, ['2025-06', '2026-06']);
  assert.deepEqual(pivot.channels, ['自社', 'アマゾン', '楽天', 'yahoo', '卸', 'TV', 'その他']);
});

test('getChannelMonthlyPivot totals match the whole-company totals for the month', () => {
  const pivot = getChannelMonthlyPivot(pivotSampleState());
  const june2025 = pivot.rows.find(r => r.yearMonth === '2025-06');
  assert.equal(june2025.totalTeikiSales, 100);
  assert.equal(june2025.totalTeikiProfit, 60);
  assert.equal(june2025.totalTsujoSales, 250); // 200 (自社/MSMパウダー) + 50 (TV/blank brand)
  assert.equal(june2025.totalTsujoProfit, 150);
});

test('getChannelMonthlyPivot zero-fills a channel with no data in a given month, per-channel split by 定期/通常', () => {
  const pivot = getChannelMonthlyPivot(pivotSampleState());
  const june2025 = pivot.rows.find(r => r.yearMonth === '2025-06');
  assert.deepEqual(june2025.byChannel['TV'], { teikiSales: 100, teikiProfit: 60, tsujoSales: 50, tsujoProfit: 30 });
  assert.deepEqual(june2025.byChannel['自社'], { teikiSales: 0, teikiProfit: 0, tsujoSales: 200, tsujoProfit: 120 });
  assert.deepEqual(june2025.byChannel['アマゾン'], { teikiSales: 0, teikiProfit: 0, tsujoSales: 0, tsujoProfit: 0 });

  const june2026 = pivot.rows.find(r => r.yearMonth === '2026-06');
  assert.deepEqual(june2026.byChannel['TV'], { teikiSales: 300, teikiProfit: 180, tsujoSales: 0, tsujoProfit: 0 });
  assert.deepEqual(june2026.byChannel['自社'], { teikiSales: 0, teikiProfit: 0, tsujoSales: 10, tsujoProfit: 5 });
});

test('getChannelMonthlyPivot returns empty months/rows but all 7 channels when both record sets are empty', () => {
  const pivot = getChannelMonthlyPivot({ baseRecords: [], monthlyRecords: [] });
  assert.deepEqual(pivot.months, []);
  assert.deepEqual(pivot.rows, []);
  assert.deepEqual(pivot.channels, ['自社', 'アマゾン', '楽天', 'yahoo', '卸', 'TV', 'その他']);
});

function dailyFallbackState() {
  return {
    baseRecords: [],
    monthlyRecords: [
      // 2026-06 already has confirmed monthly data
      { yearMonth: '2026-06', channel: '自社', type: '通常', brand: 'MCTオイル', sales: 1000, cost: 400, profit: 600 },
    ],
    dailyRecords: [
      // 2026-06 also has daily records (same month as monthlyRecords) -- must NOT be double-counted
      { yearMonth: '2026-06', date: '2026-06-01', channel: '自社', type: '通常', brand: 'MCTオイル', sales: 50, cost: 20, profit: 30 },
      // 2026-07 has ONLY daily records (no monthly xlsx yet) -- must be used as an interim aggregate
      { yearMonth: '2026-07', date: '2026-07-01', channel: 'アマゾン', type: '定期', brand: 'MSMパウダー', sales: 200, cost: 80, profit: 120 },
      { yearMonth: '2026-07', date: '2026-07-02', channel: '自社', type: '通常', brand: 'MCTオイル', sales: 300, cost: 100, profit: 200 },
    ],
    targets: [],
    mediaMapping: {},
    productBrandMapping: {},
  };
}

test('getBrandMonthlyPivot includes a daily-only month as an interim aggregate, but ignores daily records for a month that already has confirmed monthly data', () => {
  const pivot = getBrandMonthlyPivot(dailyFallbackState());
  assert.deepEqual(pivot.months, ['2026-06', '2026-07']);

  const june = pivot.rows.find(r => r.yearMonth === '2026-06');
  assert.equal(june.totalTsujoSales, 1000); // NOT 1050 -- the daily row for this month is ignored, monthly wins

  const july = pivot.rows.find(r => r.yearMonth === '2026-07');
  assert.equal(july.totalTeikiSales, 200);
  assert.equal(july.totalTsujoSales, 300);
  assert.deepEqual(july.byBrand['MSMパウダー'], { teikiSales: 200, teikiProfit: 120, tsujoSales: 0, tsujoProfit: 0 });
  assert.deepEqual(july.byBrand['MCTオイル'], { teikiSales: 0, teikiProfit: 0, tsujoSales: 300, tsujoProfit: 200 });
});

test('getChannelMonthlyPivot includes a daily-only month as an interim aggregate, but ignores daily records for a month that already has confirmed monthly data', () => {
  const pivot = getChannelMonthlyPivot(dailyFallbackState());
  assert.deepEqual(pivot.months, ['2026-06', '2026-07']);

  const june = pivot.rows.find(r => r.yearMonth === '2026-06');
  assert.equal(june.totalTsujoSales, 1000); // NOT 1050

  const july = pivot.rows.find(r => r.yearMonth === '2026-07');
  assert.equal(july.totalTeikiSales, 200);
  assert.equal(july.totalTsujoSales, 300);
  assert.deepEqual(july.byChannel['アマゾン'], { teikiSales: 200, teikiProfit: 120, tsujoSales: 0, tsujoProfit: 0 });
  assert.deepEqual(july.byChannel['自社'], { teikiSales: 0, teikiProfit: 0, tsujoSales: 300, tsujoProfit: 200 });
});

function ownChannelSummaryState() {
  return {
    baseRecords: [
      { yearMonth: '2025-06', channel: '自社', type: '定期', brand: 'BrandA', qty: 10, sales: 1000, cost: 400, profit: 600 },
      { yearMonth: '2025-06', channel: '自社', type: '通常', brand: 'BrandA', qty: 5, sales: 500, cost: 200, profit: 300 },
    ],
    monthlyRecords: [
      { yearMonth: '2026-01', channel: '自社', type: '定期', brand: 'BrandA', qty: 2, sales: 200, cost: 80, profit: 120 },
      { yearMonth: '2026-06', channel: '自社', type: '定期', brand: 'BrandA', qty: 12, sales: 1200, cost: 480, profit: 720 },
      { yearMonth: '2026-06', channel: '自社', type: '通常', brand: 'BrandA', qty: 6, sales: 600, cost: 240, profit: 360 },
      { yearMonth: '2026-06', channel: '自社', type: '通常', brand: 'BrandB', qty: 1, sales: 100, cost: 40, profit: 60 },
      { yearMonth: '2026-06', channel: 'TV', type: '定期', brand: 'BrandA', qty: 999, sales: 99999, cost: 1, profit: 99998 }, // different channel, must be excluded
    ],
    dailyRecords: [],
    targets: [],
    ownChannelTargets: [],
    mediaMapping: {},
    productBrandMapping: {},
  };
}

test('getOwnChannelMonthlySummary restricts to 自社 channel and combines all brands into teiki/tsujo/total for the month', () => {
  const summary = getOwnChannelMonthlySummary(ownChannelSummaryState());
  assert.ok(summary.months.includes('2026-06'));
  assert.deepEqual(summary.brands, ['BrandA', 'BrandB']); // BrandA total sales (3500) > BrandB (100)

  const row = summary.rows.find(r => r.yearMonth === '2026-06');
  assert.deepEqual(row.teiki, { qty: 12, sales: 1200, profit: 720, profitRate: 0.6 });
  assert.deepEqual(row.tsujo, { qty: 7, sales: 700, profit: 420, profitRate: 0.6 }); // BrandA(600)+BrandB(100)
  assert.deepEqual(row.total, { qty: 19, sales: 1900, profit: 1140, profitRate: 0.6 });
});

test('getOwnChannelMonthlySummary computes 昨対比 (yoy) against the same month one year earlier, with profitRate as a point difference', () => {
  const summary = getOwnChannelMonthlySummary(ownChannelSummaryState());
  const row = summary.rows.find(r => r.yearMonth === '2026-06');
  assert.equal(row.yoy.teiki.qtyPct, 0.2); // (12-10)/10
  assert.equal(row.yoy.teiki.salesPct, 0.2);
  assert.equal(row.yoy.teiki.profitPct, 0.2);
  assert.equal(row.yoy.teiki.profitRatePtDiff, 0); // 0.6 - 0.6
  assert.ok(Math.abs(row.yoy.tsujo.qtyPct - 0.4) < 1e-9); // (7-5)/5
  assert.ok(Math.abs(row.yoy.total.salesPct - (400 / 1500)) < 1e-9); // (1900-1500)/1500
});

test('getOwnChannelMonthlySummary computes 年計対比 (trailing-12-month total vs the prior 12-month window)', () => {
  const summary = getOwnChannelMonthlySummary(ownChannelSummaryState());
  const row = summary.rows.find(r => r.yearMonth === '2026-06');
  // ttm ending 2026-06 includes both 2026-06 (qty12) and 2026-01 (qty2) -> 14; ttm ending 2025-06 only has 2025-06 (qty10)
  assert.equal(row.ttmYoy.teiki.qtyPct, 0.4); // (14-10)/10 -- differs from the plain yoy (0.2), proving the 12-month window is used
  assert.equal(row.ttmYoy.teiki.salesPct, 0.4);
  assert.equal(row.ttmYoy.teiki.profitPct, 0.4);
});

test('getOwnChannelMonthlySummary splits byBrand with the same teiki/tsujo/total/yoy/ttmYoy shape as the 自社-wide totals', () => {
  const summary = getOwnChannelMonthlySummary(ownChannelSummaryState());
  const row = summary.rows.find(r => r.yearMonth === '2026-06');
  assert.deepEqual(row.byBrand['BrandA'].total, { qty: 18, sales: 1800, profit: 1080, profitRate: 0.6 });
  assert.deepEqual(row.byBrand['BrandB'].teiki, { qty: 0, sales: 0, profit: 0, profitRate: 0 });
  assert.deepEqual(row.byBrand['BrandB'].tsujo, { qty: 1, sales: 100, profit: 60, profitRate: 0.6 });
});

test('getOwnChannelMonthlySummary returns empty months/brands/rows when there is no 自社 data at all', () => {
  const summary = getOwnChannelMonthlySummary({ baseRecords: [], monthlyRecords: [] });
  assert.deepEqual(summary, { months: [], brands: [], rows: [] });
});

test('getOwnChannelMonthlySummary restricts to a single requested month, without dropping the full brand universe from other months', () => {
  const summary = getOwnChannelMonthlySummary(ownChannelSummaryState(), '2026-06');
  assert.deepEqual(summary.months, ['2026-06']);
  assert.equal(summary.rows.length, 1);
  assert.equal(summary.rows[0].yearMonth, '2026-06');
  // brands are still drawn from the whole dataset (BrandA/BrandB), not just the requested month
  assert.deepEqual(summary.brands, ['BrandA', 'BrandB']);
  // yoy/ttmYoy for the requested month are computed exactly as in the full-timeline case
  assert.equal(summary.rows[0].yoy.teiki.qtyPct, 0.2);
  assert.equal(summary.rows[0].ttmYoy.teiki.qtyPct, 0.4);
});

test('getOwnChannelMonthlySummary zero-fills a requested month that has no 自社 data at all, rather than omitting it', () => {
  const summary = getOwnChannelMonthlySummary(ownChannelSummaryState(), '2026-12');
  assert.deepEqual(summary.months, ['2026-12']);
  assert.equal(summary.rows.length, 1);
  assert.deepEqual(summary.rows[0].total, { qty: 0, sales: 0, profit: 0, profitRate: 0 });
});
