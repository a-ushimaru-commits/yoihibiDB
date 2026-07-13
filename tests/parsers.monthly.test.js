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
  // 販売区分 is deliberately the OPPOSITE of what 商品名 says on every row, to prove 定期/通常 is now
  // decided purely by whether 商品名 contains "定期" -- the 販売区分 column is no longer read at all.
  const header = ['出荷日', '媒体名', '事業部', '販売区分', '商品コード', '商品名', '金額', '金額合計', '仕入金額', '粗利額'];
  const rows = [
    header,
    ['26/06/09', 'よい日々', 'FH', '定期', 'FH0001010101000', 'ﾌﾛｰ･ｴｯｾﾝｽ+ ﾘｷｯﾄﾞ/500ml', 999, 1000, 400, 600], // mapped to MCTオイル
    ['26/06/09', 'よい日々', 'FH', '定期', 'fh0002020202000', 'MSMﾊﾟｳﾀﾞｰ /60包', 499, 500, 200, 300], // lowercase "fh" prefix, mapped to MSMパウダー
    ['26/06/10', '楽天よい日々', 'FH', '通常', 'FH0003030303000', '【定期】謎の新商品/500ml', 1999, 2000, 800, 1200], // not in mapping -> 未分類
    ['26/06/11', '謎の新規媒体', 'FH', '定期', 'FH0004040404000', '謎の新商品/500ml', 299, 300, 100, 200],
    ['26/06/12', 'よい日々', 'PD', '通常', 'GH1234567890123', '源喜の一粒', 9999, 9999, 0, 0], // non-FH product code, must be excluded
    ['26/06/13', '倉庫移動', 'FH', '定期', 'FH0005050505000', 'ﾍﾞﾙﾒ/700g', 699, 700, 250, 450], // real-data verified: must be INCLUDED (mapped to その他), not excluded
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

test('parseMonthlyWorkbook reports unmapped product codes with count, sales, and a representative product name', () => {
  const { unmappedProducts } = parseMonthlyWorkbook(buildMonthlyWorkbook(), undefined, SAMPLE_BRAND_MAPPING);
  assert.ok(unmappedProducts['FH0003030303000']);
  assert.equal(unmappedProducts['FH0003030303000'].count, 1);
  assert.equal(unmappedProducts['FH0003030303000'].sales, 2000);
  assert.equal(unmappedProducts['FH0003030303000'].productName, '【定期】謎の新商品/500ml');
  // rows already mapped to a real brand must NOT appear as unmapped
  assert.equal('FH0001010101000' in unmappedProducts, false);
});

test('parseMonthlyWorkbook reports unmapped media names with count and sales', () => {
  const { unmappedMedia } = parseMonthlyWorkbook(buildMonthlyWorkbook());
  assert.ok(unmappedMedia['謎の新規媒体']);
  assert.equal(unmappedMedia['謎の新規媒体'].count, 1);
  assert.equal(unmappedMedia['謎の新規媒体'].sales, 300);
});

test('parseMonthlyWorkbook decides 定期/通常 from 商品名 (containing "定期"), ignoring 販売区分 entirely', () => {
  const wb = XLSX.utils.book_new();
  const header = ['出荷日', '媒体名', '販売区分', '商品コード', '商品名', '金額合計', '仕入金額', '粗利額'];
  const rows = [
    header,
    ['26/06/09', 'よい日々', '通常', 'FH0006060606000', '【定期】特選セット/1kg', 1000, 400, 600], // 販売区分 says 通常, but name has 定期
    ['26/06/09', 'よい日々', '定期', 'FH0007070707000', '単品セット/1kg', 500, 200, 300], // 販売区分 says 定期, but name has no 定期
    ['26/06/09', 'よい日々', '通常', 'FH0008080808000', '', 200, 80, 120], // blank 商品名 -> defaults to 通常
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), '売上明細_提出');

  const { records } = parseMonthlyWorkbook(wb);
  const teiki = records.find(r => r.type === '定期');
  const tsujo = records.find(r => r.type === '通常');
  assert.equal(teiki.sales, 1000); // only the 【定期】-named row
  assert.equal(tsujo.sales, 500 + 200); // the other two, despite one saying 販売区分='定期'
});

function buildMonthlyWorkbookWithJan() {
  const header = ['出荷日', '媒体名', '販売区分', '商品コード', '商品名', '金額合計', '仕入金額', '粗利額', 'JANコード', '構成数', '数量'];
  const rows = [
    header,
    // JAN 0061998079829: 構成数=1, cost consistently 2210/unit across two rows with different 数量
    ['26/06/09', 'よい日々', '通常', 'FH0001010101000', 'ｵｰｶﾞﾆｯｸ ｳﾄﾞｽﾞｵｲﾙ/500ml', 17328, 8840, 8488, '0061998079829', 1, 4],
    ['26/06/10', 'よい日々', '通常', 'FH0001010101000', 'ｵｰｶﾞﾆｯｸ ｳﾄﾞｽﾞｵｲﾙ/500ml', 5880, 2210, 3670, '0061998079829', 1, 1],
    // JAN 1111111111111: 構成数=2 (2-pack), 数量=3 -> 6 base units, cost 600 total -> 100/unit
    ['26/06/11', 'よい日々', '通常', 'FH0002020202000', 'ﾍﾞﾙﾒ2本ｾｯﾄ', 3000, 600, 2400, '1111111111111', 2, 3],
    // 構成数×数量 = 0 -> excluded from janUnitCosts entirely
    ['26/06/12', 'よい日々', '通常', 'FH0003030303000', '謎の商品', 0, 0, 0, '9999999999999', 0, 0],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '売上明細_提出');
  return wb;
}

test('parseMonthlyWorkbook computes janUnitCosts as total 仕入金額 / total (構成数×数量) across all rows sharing a JAN code', () => {
  const { janUnitCosts } = parseMonthlyWorkbook(buildMonthlyWorkbookWithJan());
  assert.equal(janUnitCosts['0061998079829'], 2210); // (8840+2210) / (1*4 + 1*1) = 11050/5
  assert.equal(janUnitCosts['1111111111111'], 100); // 600 / (2*3)
  assert.equal('9999999999999' in janUnitCosts, false);
});

test('parseMonthlyWorkbook returns an empty janUnitCosts when the file has no JANコード/構成数/数量 columns', () => {
  const { janUnitCosts } = parseMonthlyWorkbook(buildMonthlyWorkbook());
  assert.deepEqual(janUnitCosts, {});
});

test('parseMonthlyWorkbook sums 数量 into each aggregated record\'s qty field', () => {
  const { records } = parseMonthlyWorkbook(buildMonthlyWorkbookWithJan());
  // all four rows share the same yearMonth/channel(自社)/type(通常)/brand(未分類), so they merge into one record
  const rec = records.find(r => r.channel === '自社' && r.type === '通常');
  assert.equal(rec.qty, 4 + 1 + 3 + 0);
});

test('parseMonthlyWorkbook throws a clear error when 売上明細_提出 sheet is missing', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['x']]), 'Sheet1');
  assert.throws(() => parseMonthlyWorkbook(wb), /売上明細_提出/);
});
