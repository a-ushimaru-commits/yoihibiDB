const test = require('node:test');
const assert = require('node:assert/strict');
const { detectFileType } = require('../js/parsers.js');

test('detects base file by filename prefix', () => {
  assert.equal(detectFileType('粗利分析_よい日々1期_20260709.xlsx', []), 'base');
});

test('detects base file by sheet name when filename does not match', () => {
  assert.equal(detectFileType('renamed.xlsx', ['戦略考察', '詳細明細']), 'base');
});

test('detects monthly file by filename prefix', () => {
  assert.equal(detectFileType('商品別収益202606.xlsx', []), 'monthly');
});

test('detects monthly file by sheet name', () => {
  assert.equal(detectFileType('renamed.xlsx', ['売上明細_提出']), 'monthly');
});

test('detects daily file by .csv extension or filename prefix', () => {
  assert.equal(detectFileType('受注_売上一覧表ライト_202606.csv', null), 'daily');
  assert.equal(detectFileType('anything.csv', null), 'daily');
});

test('returns unknown for unrecognized files', () => {
  assert.equal(detectFileType('random.xlsx', ['Sheet1']), 'unknown');
});
