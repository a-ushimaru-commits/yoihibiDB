const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const { parseShippingDate, parseMonthlyWorkbook } = require('../js/parsers.js');

test('parseShippingDate handles YY/MM/DD strings (2000+YY)', () => {
  const r = parseShippingDate('26/06/09');
  assert.deepEqual(r, { yearMonth: '2026-06', date: '2026-06-09' });
});

test('parseShippingDate handles JS Date instances', () => {
  const r = parseShippingDate(new Date(2026, 5, 9)); // month is 0-indexed => June
  assert.deepEqual(r, { yearMonth: '2026-06', date: '2026-06-09' });
});

test('parseShippingDate handles Excel serial numbers', () => {
  // Excel serial 46182 = 2026-06-09 (days since 1899-12-30)
  const r = parseShippingDate(46182);
  assert.deepEqual(r, { yearMonth: '2026-06', date: '2026-06-09' });
});

test('parseShippingDate returns null for unparseable values', () => {
  assert.equal(parseShippingDate(null), null);
  assert.equal(parseShippingDate('not a date'), null);
});

function buildMonthlyWorkbook() {
  const header = ['出荷日', '媒体名', '事業部', '販売区分', 'ブランド区分'];
  const rows = [
    header,
    ['26/06/09', 'よい日々', 'FH', '通常', '22'],
    ['26/06/09', 'よい日々', 'FH', '通常', '22'],
    ['26/06/10', '楽天よい日々', 'FH', '定期', '22'],
    ['26/06/11', '謎の新規媒体', 'FH', '通常', '22'],
    ['26/06/12', 'よい日々', 'FH', '通常', '9'], // different brand, must be excluded
    ['26/06/13', '倉庫移動', 'FH', '通常', '22'], // excluded media
  ];
  // 金額/仕入金額/粗利額 columns appended after ブランド区分 to mimic the real 99-col sheet
  header.push('金額', '仕入金額', '粗利額');
  rows[1].push(1000, 400, 600);
  rows[2].push(500, 200, 300);
  rows[3].push(2000, 800, 1200);
  rows[4].push(300, 100, 200);
  rows[5].push(9999, 0, 0);
  rows[6].push(0, 0, 0);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '売上明細_提出');
  return wb;
}

test('parseMonthlyWorkbook filters to brand 22, maps media, aggregates by month/channel/type', () => {
  const { records, unmappedMedia } = parseMonthlyWorkbook(buildMonthlyWorkbook());
  const jisha = records.find(r => r.channel === '自社' && r.type === '通常');
  assert.ok(jisha);
  assert.equal(jisha.sales, 1500); // 1000 + 500
  assert.equal(jisha.cost, 600);
  assert.equal(jisha.profit, 900);

  const rakuten = records.find(r => r.channel === '楽天' && r.type === '定期');
  assert.equal(rakuten.sales, 2000);

  const sonota = records.find(r => r.channel === 'その他' && r.type === '通常');
  assert.equal(sonota.sales, 300);

  // brand 9 row and 倉庫移動 row must not appear anywhere
  const total = records.reduce((s, r) => s + r.sales, 0);
  assert.equal(total, 1500 + 2000 + 300);
});

test('parseMonthlyWorkbook reports unmapped media names with count and sales', () => {
  const { unmappedMedia } = parseMonthlyWorkbook(buildMonthlyWorkbook());
  assert.ok(unmappedMedia['謎の新規媒体']);
  assert.equal(unmappedMedia['謎の新規媒体'].count, 1);
  assert.equal(unmappedMedia['謎の新規媒体'].sales, 300);
});

test('parseMonthlyWorkbook throws a clear error when 売上明細_提出 sheet is missing', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['x']]), 'Sheet1');
  assert.throws(() => parseMonthlyWorkbook(wb), /売上明細_提出/);
});
