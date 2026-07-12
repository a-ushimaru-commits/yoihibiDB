const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const { parseShippingDate, parseMonthlyWorkbook, isYoiHibiProductCode } = require('../js/parsers.js');

test('isYoiHibiProductCode matches FH-prefixed codes case-insensitively, rejects others safely', () => {
  assert.equal(isYoiHibiProductCode('FH0001010101000'), true);
  assert.equal(isYoiHibiProductCode('fh0002020202000'), true);
  assert.equal(isYoiHibiProductCode('  FH0003030303000  '), true);
  assert.equal(isYoiHibiProductCode('GH1234567890123'), false);
  assert.equal(isYoiHibiProductCode(''), false);
  assert.equal(isYoiHibiProductCode(null), false);
  assert.equal(isYoiHibiProductCode(undefined), false);
});

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
    ['26/06/09', 'よい日々', 'FH', '通常', 'FH0001010101000', 999, 1000, 400, 600], // mapped to MCTオイル
    ['26/06/09', 'よい日々', 'FH', '通常', 'fh0002020202000', 499, 500, 200, 300], // lowercase "fh" prefix, mapped to MSMパウダー
    ['26/06/10', '楽天よい日々', 'FH', '定期', 'FH0003030303000', 1999, 2000, 800, 1200], // not in mapping -> 未分類
    ['26/06/11', '謎の新規媒体', 'FH', '通常', 'FH0004040404000', 299, 300, 100, 200],
    ['26/06/12', 'よい日々', 'PD', '通常', 'GH1234567890123', 9999, 9999, 0, 0], // non-FH product code, must be excluded
    ['26/06/13', '倉庫移動', 'FH', '通常', 'FH0005050505000', 699, 700, 250, 450], // real-data verified: must be INCLUDED (mapped to その他), not excluded
  ];

  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '売上明細_提出');
  return wb;
}

const SAMPLE_BRAND_MAPPING = {
  'FH0001010101000': 'MCTオイル',
  'FH0002020202000': 'MSMパウダー', // lowercase in the sheet, but the mapping key is always the canonical uppercase form of a real product code
};

test('parseMonthlyWorkbook filters by 商品コード starting with FH (case-insensitive), sums 金額合計 not 金額, maps media, aggregates by month/channel/type', () => {
  const { records, unmappedMedia } = parseMonthlyWorkbook(buildMonthlyWorkbook());
  const jisha = records.find(r => r.channel === '自社' && r.type === '通常' && r.brand === '未分類');
  assert.ok(jisha);
  assert.equal(jisha.sales, 1500); // 1000 + 500 (金額合計), NOT 999 + 499 (金額)
  assert.equal(jisha.cost, 600);
  assert.equal(jisha.profit, 900);

  const rakuten = records.find(r => r.channel === '楽天' && r.type === '定期');
  assert.equal(rakuten.sales, 2000);

  // その他 channel combines the unmapped-media row (300) and the 倉庫移動 row (700, mapped to
  // その他 per real-data verification — it must NOT be excluded, unlike the old ブランド区分 logic)
  const sonota = records.find(r => r.channel === 'その他' && r.type === '通常');
  assert.equal(sonota.sales, 1000);
  assert.equal(sonota.cost, 350);
  assert.equal(sonota.profit, 650);

  // only the non-FH product code row must be absent
  const total = records.reduce((s, r) => s + r.sales, 0);
  assert.equal(total, 1500 + 2000 + 1000);
});

test('parseMonthlyWorkbook attaches brand from productBrandMapping and defaults to 未分類 otherwise, without changing channel-level totals', () => {
  const { records } = parseMonthlyWorkbook(buildMonthlyWorkbook(), undefined, SAMPLE_BRAND_MAPPING);
  const mct = records.find(r => r.brand === 'MCTオイル');
  assert.ok(mct);
  assert.equal(mct.sales, 1000); // FH0001010101000 row only, split out from the merged 自社/通常 total
  const msm = records.find(r => r.brand === 'MSMパウダー');
  assert.ok(msm);
  assert.equal(msm.sales, 500); // the row's code is lowercase ("fh0002020202000") but SAMPLE_BRAND_MAPPING's key is
  // upper-case ("FH0002020202000") -- this only matches because the parser normalizes both sides
  // (trim + upper-case) before lookup; a case-sensitive lookup would wrongly leave this row 未分類

  // channel-level rollup (ignoring brand) must still equal the pre-brand-split total
  const jishaTotal = records
    .filter(r => r.channel === '自社' && r.type === '通常')
    .reduce((s, r) => s + r.sales, 0);
  assert.equal(jishaTotal, 1500);
});

test('parseMonthlyWorkbook reports unmapped product codes with count and sales', () => {
  const { unmappedProducts } = parseMonthlyWorkbook(buildMonthlyWorkbook(), undefined, SAMPLE_BRAND_MAPPING);
  assert.ok(unmappedProducts['FH0003030303000']);
  assert.equal(unmappedProducts['FH0003030303000'].count, 1);
  assert.equal(unmappedProducts['FH0003030303000'].sales, 2000);
  // rows already mapped to a real brand must NOT appear as unmapped
  assert.equal('FH0001010101000' in unmappedProducts, false);
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
