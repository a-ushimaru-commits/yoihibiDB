const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const { findHeaderRowIndex, parseBaseWorkbook } = require('../js/parsers.js');

function buildBaseWorkbook() {
  const aoa = [
    [null, 'よい日々1期　戦略考察レポート', null],
    [],
    ['月', '販売区分', 'よい日々', '定期/通常', '数量', '売上', '仕入額', '粗利', '粗利率'],
    ['2025-06', 'TV', 'MCTオイル', '通常', 2, 700, 300, 400, 0.57],
    ['2025-06', 'TV', 'MCTオイル', '通常', 1, 300, 100, 200, 0.67], // same brand+channel+type+month -> must still merge
    ['2025-06', 'TV', 'MSMクリーム', '通常', 1, 500, 200, 300, 0.6], // different brand -> must stay separate
    ['2025-06', '自社', 'MCTオイル', '定期', 5, 5000, 2000, 3000, 0.6],
    ['2025-07', 'TV', 'MCTオイル', '通常', 3, 1500, 600, 900, 0.6],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '詳細明細');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['dummy']]), '戦略考察');
  return wb;
}

test('findHeaderRowIndex finds row containing all required names', () => {
  const rows = [[null, 'title'], [], ['月', '販売区分', '売上'], ['2025-06', 'TV', 100]];
  assert.equal(findHeaderRowIndex(rows, ['月', '販売区分', '売上']), 2);
});

test('findHeaderRowIndex returns -1 when not found', () => {
  const rows = [['a', 'b'], ['c', 'd']];
  assert.equal(findHeaderRowIndex(rows, ['月', '売上']), -1);
});

test('parseBaseWorkbook aggregates across rows sharing the same brand within month/channel/type', () => {
  const records = parseBaseWorkbook(buildBaseWorkbook());
  const mct = records.find(r => r.yearMonth === '2025-06' && r.channel === 'TV' && r.type === '通常' && r.brand === 'MCTオイル');
  assert.ok(mct, 'expected an aggregated MCTオイル/2025-06/TV/通常 record');
  assert.equal(mct.sales, 1000); // 700 + 300
  assert.equal(mct.cost, 400); // 300 + 100
  assert.equal(mct.profit, 600); // 400 + 200
});

test('parseBaseWorkbook keeps different brands separate even within the same month/channel/type', () => {
  const records = parseBaseWorkbook(buildBaseWorkbook());
  const msm = records.find(r => r.yearMonth === '2025-06' && r.channel === 'TV' && r.type === '通常' && r.brand === 'MSMクリーム');
  assert.ok(msm, 'expected a separate MSMクリーム/2025-06/TV/通常 record');
  assert.equal(msm.sales, 500);

  // channel-level rollup (ignoring brand) must equal the pre-brand-split total
  const tvTotal = records
    .filter(r => r.yearMonth === '2025-06' && r.channel === 'TV' && r.type === '通常')
    .reduce((s, r) => s + r.sales, 0);
  assert.equal(tvTotal, 1500); // 1000 (MCTオイル) + 500 (MSMクリーム)
});

test('parseBaseWorkbook keeps distinct channel/type/month/brand combinations separate', () => {
  const records = parseBaseWorkbook(buildBaseWorkbook());
  const junJisha = records.find(r => r.yearMonth === '2025-06' && r.channel === '自社' && r.type === '定期');
  const julTV = records.find(r => r.yearMonth === '2025-07' && r.channel === 'TV' && r.type === '通常');
  assert.equal(junJisha.sales, 5000);
  assert.equal(junJisha.brand, 'MCTオイル');
  assert.equal(julTV.sales, 1500);
  assert.equal(julTV.brand, 'MCTオイル');
  assert.equal(records.length, 4); // MCTオイル/TV/通常/06, MSMクリーム/TV/通常/06, MCTオイル/自社/定期/06, MCTオイル/TV/通常/07
});

test('parseBaseWorkbook throws a clear error when 詳細明細 sheet is missing', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['x']]), 'Sheet1');
  assert.throws(() => parseBaseWorkbook(wb), /詳細明細/);
});

test('parseBaseWorkbook throws a clear error when required columns (including brand) are missing', () => {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([['月', '販売区分']]);
  XLSX.utils.book_append_sheet(wb, ws, '詳細明細');
  assert.throws(() => parseBaseWorkbook(wb), /よい日々/);
});
