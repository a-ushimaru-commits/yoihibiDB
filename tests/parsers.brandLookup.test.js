const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const { parseBrandLookup, detectFileType, guessBrandForProductCode } = require('../js/parsers.js');

function buildBrandLookupWorkbook() {
  const aoa = [
    ['商品コード', '商品名', '商品細分', '定期/単品', '修正'],
    ['FH0001010101000', 'ﾌﾛｰ･ｴｯｾﾝｽ+ ﾘｷｯﾄﾞ/500ml', 'フローエッセンスリキッド', '単品', null],
    ['FH0002020202000', 'MCTｵｲﾙ/250ml', 'MCTオイル', '単品', null],
    ['FH0002020202000ｔ', '【定期】MCTｵｲﾙ/250ml', 'MCTオイル', '定期', null],
    [null, null, null, null, null], // blank row must not crash or produce a bogus entry
    ['FH0003030303000', '', '', '単品', null], // blank brand must be skipped, not stored as ''
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return wb;
}

test('parseBrandLookup builds a 商品コード -> ブランド map from the 商品細分 column', () => {
  const mapping = parseBrandLookup(buildBrandLookupWorkbook());
  assert.equal(mapping['FH0001010101000'], 'フローエッセンスリキッド');
  assert.equal(mapping['FH0002020202000'], 'MCTオイル');
  // keys are normalized (trim + upper-case) so lookups match regardless of source casing;
  // JS's toUpperCase() also upper-cases fullwidth latin letters (ｔ -> Ｔ), so the stored key
  // for a code ending in a fullwidth "ｔ" comes back with a fullwidth "Ｔ"
  assert.equal(mapping['FH0002020202000Ｔ'], 'MCTオイル');
});

test('parseBrandLookup skips rows with a blank product code or blank brand', () => {
  const mapping = parseBrandLookup(buildBrandLookupWorkbook());
  assert.equal('FH0003030303000' in mapping, false);
  assert.equal(Object.keys(mapping).length, 3);
});

test('parseBrandLookup throws a clear error when required columns are missing', () => {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([['商品コード', '商品名']]); // no 商品細分
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  assert.throws(() => parseBrandLookup(wb), /商品細分/);
});

test('detectFileType recognizes 分解詳細リスト by filename prefix', () => {
  assert.equal(detectFileType('分解詳細リスト.xlsx', ['Sheet1']), 'brandLookup');
  assert.equal(detectFileType('分解詳細リスト_20260710.xlsx', ['Sheet1']), 'brandLookup');
});

const REAL_SHAPE_MAPPING = {
  'FH0001280401000': 'ベルメ',
  'FH0001280401000B': 'ベルメ',
  'FH0001280401000K': 'ベルメ',
  'FH0001990403000Ｔ': 'ベルメ',
  'FH0001010601000': 'MSMパウダー',
  'FH0001017002000': 'MSMパウダー',
};

test('guessBrandForProductCode suggests a brand when only a trailing 1-2 char variant suffix differs', () => {
  // "FH0001280401000F" differs from the known "FH0001280401000" only by a trailing "F" suffix
  assert.equal(guessBrandForProductCode('FH0001280401000F', REAL_SHAPE_MAPPING), 'ベルメ');
  // "FH0001990403000" differs from the known "FH0001990403000Ｔ" only by the trailing "Ｔ"
  assert.equal(guessBrandForProductCode('FH0001990403000', REAL_SHAPE_MAPPING), 'ベルメ');
});

test('guessBrandForProductCode returns null when the shared prefix is too short to be confident', () => {
  // "FH0001017301100" only shares "FH0001017" (9 chars) with the known "FH0001017002000" -- differs
  // well before the trailing variant-suffix region, so this must NOT guess
  assert.equal(guessBrandForProductCode('FH0001017301100', REAL_SHAPE_MAPPING), null);
  // a structurally unrelated short code must not match anything
  assert.equal(guessBrandForProductCode('FH06-2T', REAL_SHAPE_MAPPING), null);
});

test('guessBrandForProductCode returns null on an ambiguous tie between different brands', () => {
  const ambiguous = {
    'FH0001280401000B': 'ベルメ',
    'FH0001280401000K': 'MCTオイル', // same-length equal-prefix neighbor, but a different brand
  };
  assert.equal(guessBrandForProductCode('FH0001280401000F', ambiguous), null);
});

test('guessBrandForProductCode returns null for blank input or an empty mapping', () => {
  assert.equal(guessBrandForProductCode('', REAL_SHAPE_MAPPING), null);
  assert.equal(guessBrandForProductCode(null, REAL_SHAPE_MAPPING), null);
  assert.equal(guessBrandForProductCode('FH0001280401000F', {}), null);
});
