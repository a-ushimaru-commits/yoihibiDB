const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const { parseTargetsWorkbook } = require('../js/parsers.js');

function buildTargetsWorkbook() {
  // Mirrors the real 目標 workbook's shape: a meta row, a month-name row (merged
  // conceptually across 3 sub-columns), a 媒体/項目/予算・見込・実績 sub-header row,
  // then per-media blocks (売上・原価・...), ending with a 合計 block.
  const rows = [
    ['よい日々'],
    [],
    [null, null, null, '6月', '6月', '6月', '7月', '7月', '7月'],
    [null, '媒体', '項目', '予算', '見込', '実績', '予算', '見込', '実績'],
    [null, '自社サイト', '売上', 5500, 4600, 5332, 5500, 6000, null],
    [null, null, '原価', 1925, 1610, 1852, 1925, 2100, null],
    [null, '合計', '売上', 12200, 10000, 11000, 13000, 12000, null],
    [null, null, '原価', 4225, 3500, 3800, 4500, 4000, null],
    [null, null, '営業利益', -244, 0, 0, 100, 0, null],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'よい日々');
  return wb;
}

test('parseTargetsWorkbook extracts sales/gross-profit targets from the 合計 row\'s 予算 columns, per month, converted from 千円 to yen', () => {
  const { targets } = parseTargetsWorkbook(buildTargetsWorkbook(), 2026);
  assert.deepEqual(targets, [
    { yearMonth: '2026-06', salesTarget: 12200000, profitTarget: (12200 - 4225) * 1000 },
    { yearMonth: '2026-07', salesTarget: 13000000, profitTarget: (13000 - 4500) * 1000 },
  ]);
});

test('parseTargetsWorkbook also extracts ownChannelTargets from the 自社サイト row, independently of 合計', () => {
  const { ownChannelTargets } = parseTargetsWorkbook(buildTargetsWorkbook(), 2026);
  assert.deepEqual(ownChannelTargets, [
    { yearMonth: '2026-06', salesTarget: 5500000, profitTarget: (5500 - 1925) * 1000 },
    { yearMonth: '2026-07', salesTarget: 5500000, profitTarget: (5500 - 1925) * 1000 },
  ]);
});

test('parseTargetsWorkbook returns an empty ownChannelTargets (without throwing) when there is no 自社サイト row', () => {
  const rows = [
    [null, null, null, '6月', '6月', '6月'],
    [null, '媒体', '項目', '予算', '見込', '実績'],
    [null, '合計', '売上', 12200, null, null],
    [null, null, '原価', 4225, null, null],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'よい日々');

  const { targets, ownChannelTargets } = parseTargetsWorkbook(wb, 2026);
  assert.deepEqual(ownChannelTargets, []);
  assert.equal(targets.length, 1); // 合計 is still required and present
});

test('parseTargetsWorkbook maps months 12 and after to the following calendar year, per the given fiscal-year start', () => {
  const rows = [
    [null, null, null, '12月', '12月', '12月', '1月', '1月', '1月'],
    [null, '媒体', '項目', '予算', '見込', '実績', '予算', '見込', '実績'],
    [null, '合計', '売上', 5000, null, null, 6000, null, null],
    [null, null, '原価', 2000, null, null, 2500, null, null],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'よい日々');

  const { targets } = parseTargetsWorkbook(wb, 2026);
  assert.deepEqual(targets, [
    { yearMonth: '2026-12', salesTarget: 5000000, profitTarget: 3000000 },
    { yearMonth: '2027-01', salesTarget: 6000000, profitTarget: 3500000 },
  ]);
});

test('parseTargetsWorkbook ignores aggregate columns (上期計/下期計/年間計) since they are not real months', () => {
  const rows = [
    [null, null, null, '6月', '6月', '6月', '上期計', '上期計', '上期計'],
    [null, '媒体', '項目', '予算', '見込', '実績', '予算', '見込', '実績'],
    [null, '合計', '売上', 12200, null, null, 70000, null, null],
    [null, null, '原価', 4225, null, null, 24000, null, null],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'よい日々');

  const { targets } = parseTargetsWorkbook(wb, 2026);
  assert.deepEqual(targets, [{ yearMonth: '2026-06', salesTarget: 12200000, profitTarget: (12200 - 4225) * 1000 }]);
});

test('parseTargetsWorkbook throws a clear error when the 媒体/項目 header row is missing', () => {
  const ws = XLSX.utils.aoa_to_sheet([['x']]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'よい日々');
  assert.throws(() => parseTargetsWorkbook(wb, 2026), /媒体・項目/);
});

test('parseTargetsWorkbook throws a clear error when the 合計 row is missing', () => {
  const rows = [
    [null, null, null, '6月', '6月', '6月'],
    [null, '媒体', '項目', '予算', '見込', '実績'],
    [null, '自社サイト', '売上', 5500, null, null],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'よい日々');
  assert.throws(() => parseTargetsWorkbook(wb, 2026), /合計/);
});
