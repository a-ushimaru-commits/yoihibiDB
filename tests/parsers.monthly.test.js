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
  // 金額 is deliberately WRONG on every row (a decoy) to prove the parser sums 金額合計, not 金額.
  // 商品コード drives brand identification now (replacing the old, incorrect ブランド区分='22' rule),
  // verified against real user data: 商品コード starting with "FH" matches 区分②='よい日々' row-for-row.
  const header = ['出荷日', '媒体名', '事業部', '販売区分', '商品コード', '金額', '金額合計', '仕入金額', '粗利額'];
  const rows = [
    header,
    ['26/06/09', 'よい日々', 'FH', '通常', 'FH0001010101000', 999, 1000, 400, 600],
    ['26/06/09', 'よい日々', 'FH', '通常', 'fh0002020202000', 499, 500, 200, 300], // lowercase "fh" prefix, must still match
    ['26/06/10', '楽天よい日々', 'FH', '定期', 'FH0003030303000', 1999, 2000, 800, 1200],
    ['26/06/11', '謎の新規媒体', 'FH', '通常', 'FH0004040404000', 299, 300, 100, 200],
    ['26/06/12', 'よい日々', 'PD', '通常', 'GH1234567890123', 9999, 9999, 0, 0], // non-FH product code, must be excluded
    ['26/06/13', '倉庫移動', 'FH', '通常', 'FH0005050505000', 0, 0, 0, 0], // excluded media
  ];

  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '売上明細_提出');
  return wb;
}

test('parseMonthlyWorkbook filters by 商品コード starting with FH (case-insensitive), sums 金額合計 not 金額, maps media, aggregates by month/channel/type', () => {
  const { records, unmappedMedia } = parseMonthlyWorkbook(buildMonthlyWorkbook());
  const jisha = records.find(r => r.channel === '自社' && r.type === '通常');
  assert.ok(jisha);
  assert.equal(jisha.sales, 1500); // 1000 + 500 (金額合計), NOT 999 + 499 (金額)
  assert.equal(jisha.cost, 600);
  assert.equal(jisha.profit, 900);

  const rakuten = records.find(r => r.channel === '楽天' && r.type === '定期');
  assert.equal(rakuten.sales, 2000);

  const sonota = records.find(r => r.channel === 'その他' && r.type === '通常');
  assert.equal(sonota.sales, 300);

  // the non-FH product code row and 倉庫移動 row must not appear anywhere
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
