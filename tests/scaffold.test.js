const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('vendored libraries exist', () => {
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'js', 'vendor', 'xlsx.full.min.js')), 'xlsx vendor file missing');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'js', 'vendor', 'chart.umd.js')), 'chart.js vendor file missing');
});

test('xlsx package importable', () => {
  const XLSX = require('xlsx');
  assert.ok(XLSX.read, 'XLSX.read should exist');
});
