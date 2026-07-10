const test = require('node:test');
const assert = require('node:assert/strict');
const { mapMediaToChannel, DEFAULT_MEDIA_MAPPING, EXCLUDED_MEDIA } = require('../js/mapping.js');

test('known exact media names map to expected channel', () => {
  assert.equal(mapMediaToChannel('よい日々').channel, '自社');
  assert.equal(mapMediaToChannel('楽天よい日々').channel, '楽天');
  assert.equal(mapMediaToChannel('Amazon').channel, 'アマゾン');
  assert.equal(mapMediaToChannel('Amazon　FBA').channel, 'アマゾン');
  assert.equal(mapMediaToChannel('TikTok').channel, 'その他');
  assert.equal(mapMediaToChannel('Creema').channel, 'その他');
  assert.equal(mapMediaToChannel('メルカリ').channel, 'その他');
  assert.equal(mapMediaToChannel('会報誌').channel, 'その他');
});

test('BtoB(*) and YAHOO* prefixes map regardless of paren style', () => {
  assert.equal(mapMediaToChannel('BtoB(株式会社labellvie)').channel, '卸');
  assert.equal(mapMediaToChannel('BtoB（株式会社F-HOUSE）').channel, '卸');
  assert.equal(mapMediaToChannel('YAHOO　プライムダイレクト').channel, 'yahoo');
});

test('倉庫移動/本社 map to その他 and are marked mapped (not a warning) — real-data verified: excluding them from totals broke reconciliation with the user\'s reference figures by exactly the amount these rows contribute, so they must be counted, not dropped', () => {
  const r1 = mapMediaToChannel('倉庫移動');
  assert.equal(r1.channel, 'その他');
  assert.equal(r1.mapped, true);
  const r2 = mapMediaToChannel('本社');
  assert.equal(r2.channel, 'その他');
  assert.equal(r2.mapped, true);
});

test('unknown media name falls back to その他 and is flagged unmapped', () => {
  const r = mapMediaToChannel('謎の新規媒体');
  assert.equal(r.channel, 'その他');
  assert.equal(r.mapped, false);
});

test('mappingOverride takes precedence over defaults', () => {
  const r = mapMediaToChannel('謎の新規媒体', { '謎の新規媒体': 'TV' });
  assert.equal(r.channel, 'TV');
  assert.equal(r.mapped, true);
});

test('null/undefined/blank raw name treated as unknown, not a crash', () => {
  assert.equal(mapMediaToChannel(null).channel, 'その他');
  assert.equal(mapMediaToChannel(undefined).channel, 'その他');
  assert.equal(mapMediaToChannel('   ').channel, 'その他');
});

test('DEFAULT_MEDIA_MAPPING and EXCLUDED_MEDIA are exported', () => {
  assert.equal(typeof DEFAULT_MEDIA_MAPPING, 'object');
  assert.ok(Array.isArray(EXCLUDED_MEDIA));
});
