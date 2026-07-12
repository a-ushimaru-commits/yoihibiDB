const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCsv, parseDailyCsv } = require('../js/parsers.js');

test('parseCsv handles plain comma-separated rows', () => {
  const rows = parseCsv('a,b,c\n1,2,3\n');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['1', '2', '3']]);
});

test('parseCsv handles quoted fields with embedded commas and escaped quotes', () => {
  const rows = parseCsv('name,note\n"Sato, Taro","he said ""hi"""\n');
  assert.deepEqual(rows, [['name', 'note'], ['Sato, Taro', 'he said "hi"']]);
});

test('parseCsv tolerates trailing newline and CRLF line endings', () => {
  const rows = parseCsv('a,b\r\n1,2\r\n');
  assert.deepEqual(rows, [['a', 'b'], ['1', '2']]);
});

function buildDailyCsv() {
  // 商品コード drives brand identification now (replacing the old, incorrect ブランド区分='22' rule),
  // verified against real user data: 商品コード starting with "FH" matches 区分②='よい日々' row-for-row.
  // The lite daily CSV export has no 金額合計 column, so 金額 remains the sales figure here.
  const header = '出荷日,媒体名,販売区分,商品コード,金額,仕入金額,粗利額';
  const lines = [
    header,
    '26/06/09,よい日々,通常,FH0001010101000,1000,400,600', // mapped to MCTオイル
    '26/06/09,よい日々,通常,fh0002020202000,500,200,300', // lowercase "fh" prefix, mapped to MSMパウダー
    '26/06/10,楽天よい日々,定期,FH0003030303000,2000,800,1200', // not in mapping -> 未分類
    '26/06/11,謎の新規媒体,通常,FH0004040404000,300,100,200',
    '26/06/12,よい日々,通常,GH1234567890123,9999,0,0', // non-FH product code, must be excluded
  ];
  return lines.join('\n') + '\n';
}

const SAMPLE_BRAND_MAPPING = {
  'FH0001010101000': 'MCTオイル',
  'FH0002020202000': 'MSMパウダー',
};

test('parseDailyCsv filters by 商品コード starting with FH (case-insensitive), maps media, aggregates by date/channel/type', () => {
  const { records, unmappedMedia } = parseDailyCsv(buildDailyCsv());
  const day9 = records.find(r => r.date === '2026-06-09' && r.channel === '自社' && r.type === '通常');
  assert.ok(day9);
  assert.equal(day9.sales, 1500);
  assert.equal(day9.yearMonth, '2026-06');
  assert.equal(day9.brand, '未分類'); // no mapping passed -> default

  const day10 = records.find(r => r.date === '2026-06-10' && r.channel === '楽天');
  assert.equal(day10.sales, 2000);

  const total = records.reduce((s, r) => s + r.sales, 0);
  assert.equal(total, 1500 + 2000 + 300); // non-FH product code row excluded

  assert.ok(unmappedMedia['謎の新規媒体']);
});

test('parseDailyCsv attaches brand from productBrandMapping and reports unmapped product codes', () => {
  const { records, unmappedProducts } = parseDailyCsv(buildDailyCsv(), undefined, SAMPLE_BRAND_MAPPING);
  const day9mct = records.find(r => r.date === '2026-06-09' && r.brand === 'MCTオイル');
  assert.ok(day9mct);
  assert.equal(day9mct.sales, 1000);
  const day9msm = records.find(r => r.date === '2026-06-09' && r.brand === 'MSMパウダー');
  assert.ok(day9msm);
  assert.equal(day9msm.sales, 500);

  assert.ok(unmappedProducts['FH0003030303000']);
  assert.equal(unmappedProducts['FH0003030303000'].sales, 2000);
  assert.equal('FH0001010101000' in unmappedProducts, false);
});
