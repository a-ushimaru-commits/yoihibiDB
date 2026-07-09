# よい日々 売上進捗ダッシュボード Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single self-contained HTML dashboard that lets the user drag-and-drop three source files (1期ベース実績xlsx, 月次実績xlsx, 日次売上csv) and see channel-level (TV/yahoo/その他/アマゾン/卸/楽天/自社) sales progress vs. 1期同月実績 and vs. user-entered monthly targets.

**Architecture:** Pure client-side JS modules (mapping, parsing, storage, aggregation, rendering) that are dual-exported (Node `module.exports` for unit tests, `window.YoiHibi` namespace for the browser). `dashboard.html` loads vendored SheetJS + Chart.js and the app modules with plain `<script>` tags — no build step, no bundler, no server. Data persists in `localStorage`.

**Tech Stack:** Vanilla JS (ES2017+), SheetJS (`xlsx`) for spreadsheet parsing, Chart.js for charts, Node's built-in `node:test` + `node:assert/strict` for unit tests (dev-only, not shipped to the browser).

## Global Constraints

- No CDN dependency at runtime — SheetJS and Chart.js must be vendored as local files under `js/vendor/` so the tool works fully offline.
- Single HTML entry point: `dashboard.html`, opened directly by double-click (no dev server required for end use).
- All ingested data persists in browser `localStorage` under one JSON blob; closing the file must not lose data.
- MVP scope is channel(7区分) × 定期/通常 only — no brand-level breakdown.
- Unknown/unmapped 媒体名 must default to channel `その他` and be surfaced as a warning, never silently dropped or crash the import.
- Re-importing a monthly/daily file for a `yearMonth` that already has data must overwrite that month's records, never double-count.
- Target records (`targets`) are whole-month totals only (no per-channel target in MVP) — resolves an ambiguity in the design spec's "channel: ALL想定" note. The channel-level table therefore shows 売上/粗利/粗利率/1期比 only (no 目標比 column); 目標達成率 appears only on the whole-month KPI cards.
- 1期 base data covers 2025-06〜2026-05; 2期 (current) data starts 2026-06. "1期同月比" always compares a 2期 `yearMonth` against the same calendar month one year earlier (`shiftYearMonth(yearMonth, -1)`), not equal-string lookup.

---

## File Structure

```
dashboard/
  dashboard.html
  css/
    styles.css
  js/
    vendor/
      xlsx.full.min.js
      chart.umd.js
    mapping.js
    parsers.js
    store.js
    aggregate.js
    ui.js
    main.js
  tests/
    scaffold.test.js
    mapping.test.js
    parsers.base.test.js
    parsers.monthly.test.js
    parsers.daily.test.js
    filetype.test.js
    store.test.js
    aggregate.test.js
    ui.test.js
  package.json
  docs/superpowers/{specs,plans}/...
```

---

### Task 1: Project scaffolding + vendored libraries

**Files:**
- Create: `dashboard/package.json`
- Create: `dashboard/js/vendor/xlsx.full.min.js` (copied from `node_modules/xlsx/dist/xlsx.full.min.js`)
- Create: `dashboard/js/vendor/chart.umd.js` (copied from `node_modules/chart.js/dist/chart.umd.js`)
- Create: `dashboard/tests/scaffold.test.js`

**Interfaces:**
- Produces: `node_modules/xlsx` and `node_modules/chart.js` available for later tasks' unit tests (`require('xlsx')`); vendored browser files present for Task 10.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "yoihibi-sales-dashboard",
  "version": "1.0.0",
  "private": true,
  "description": "よい日々 売上進捗ダッシュボード（単一HTML、クライアントサイドのみ）",
  "scripts": {
    "test": "node --test tests/"
  },
  "devDependencies": {
    "xlsx": "^0.18.5",
    "chart.js": "^4.4.0",
    "iconv-lite": "^0.6.3"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run (from `dashboard/`):
```
npm install
```
Expected: `node_modules/xlsx`, `node_modules/chart.js`, `node_modules/iconv-lite` created, no errors.

- [ ] **Step 3: Vendor the browser builds**

PowerShell (from `dashboard/`):
```powershell
New-Item -ItemType Directory -Force -Path js\vendor | Out-Null
Copy-Item node_modules\xlsx\dist\xlsx.full.min.js js\vendor\xlsx.full.min.js
Copy-Item node_modules\chart.js\dist\chart.umd.js js\vendor\chart.umd.js
```
If either source path doesn't exist under the installed version, run `Get-ChildItem node_modules\xlsx\dist` / `Get-ChildItem node_modules\chart.js\dist` to find the correct minified UMD/browser bundle filename and adjust the copy command accordingly — the goal is a single file that defines a global (`XLSX` / `Chart`) when loaded via `<script>`.

- [ ] **Step 4: Write the failing test**

`dashboard/tests/scaffold.test.js`:
```js
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
```

- [ ] **Step 5: Run test to verify it passes** (write-then-verify since this task has no separate "make it fail" step — the files must already exist from Steps 1-3)

Run: `npm test`
Expected: both tests in `scaffold.test.js` PASS.

- [ ] **Step 6: Commit**

```powershell
git add package.json package-lock.json js/vendor/xlsx.full.min.js js/vendor/chart.umd.js tests/scaffold.test.js .gitignore
git commit -m "chore: scaffold project and vendor xlsx/chart.js"
```

Before committing, create `dashboard/.gitignore` containing:
```
node_modules/
```

---

### Task 2: Media mapping module

**Files:**
- Create: `dashboard/js/mapping.js`
- Create: `dashboard/tests/mapping.test.js`

**Interfaces:**
- Produces: `mapMediaToChannel(rawName, mappingOverride?)` → `{ channel: string|null, mapped: boolean }`; `DEFAULT_MEDIA_MAPPING` (object); `EXCLUDED_MEDIA` (array of strings). Consumed by `parsers.js` (Task 4, 5) and `ui.js` (Task 9, for warning display).

- [ ] **Step 1: Write the failing test**

`dashboard/tests/mapping.test.js`:
```js
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

test('excluded media names map to null channel and are marked mapped (not a warning)', () => {
  const r1 = mapMediaToChannel('倉庫移動');
  assert.equal(r1.channel, null);
  assert.equal(r1.mapped, true);
  const r2 = mapMediaToChannel('本社');
  assert.equal(r2.channel, null);
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../js/mapping.js'`.

- [ ] **Step 3: Write minimal implementation**

`dashboard/js/mapping.js`:
```js
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.YoiHibi = Object.assign(root.YoiHibi || {}, factory());
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const DEFAULT_MEDIA_MAPPING = {
    'よい日々': '自社',
    '楽天よい日々': '楽天',
    'Amazon': 'アマゾン',
    'Amazon　FBA': 'アマゾン',
    'Amazon FBA': 'アマゾン',
    'TikTok': 'その他',
    'Creema': 'その他',
    'メルカリ': 'その他',
    '会報誌': 'その他',
  };

  const EXCLUDED_MEDIA = ['倉庫移動', '本社'];

  function mapMediaToChannel(rawName, mappingOverride) {
    const table = Object.assign({}, DEFAULT_MEDIA_MAPPING, mappingOverride || {});
    const name = (rawName == null ? '' : String(rawName)).trim();

    if (EXCLUDED_MEDIA.includes(name)) {
      return { channel: null, mapped: true };
    }
    if (Object.prototype.hasOwnProperty.call(table, name)) {
      return { channel: table[name], mapped: true };
    }
    if (name.startsWith('BtoB')) {
      return { channel: '卸', mapped: true };
    }
    if (name.startsWith('YAHOO')) {
      return { channel: 'yahoo', mapped: true };
    }
    return { channel: 'その他', mapped: false };
  }

  return { mapMediaToChannel, DEFAULT_MEDIA_MAPPING, EXCLUDED_MEDIA };
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: all tests in `mapping.test.js` PASS.

- [ ] **Step 5: Commit**

```powershell
git add js/mapping.js tests/mapping.test.js
git commit -m "feat: add media name to channel mapping module"
```

---

### Task 3: Base workbook parser (1期実績)

**Files:**
- Create: `dashboard/js/parsers.js`
- Create: `dashboard/tests/parsers.base.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `findHeaderRowIndex(rows, requiredNames)` → `number` (row index, or `-1`); `parseBaseWorkbook(workbook)` → `Record[]` where `Record = { yearMonth, channel, type, sales, cost, profit }`. Both consumed by later tasks (`parseMonthlyWorkbook`, `parseDailyCsv` reuse `findHeaderRowIndex`; `main.js` calls `parseBaseWorkbook`).

- [ ] **Step 1: Write the failing test**

`dashboard/tests/parsers.base.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const { findHeaderRowIndex, parseBaseWorkbook } = require('../js/parsers.js');

function buildBaseWorkbook() {
  const aoa = [
    [null, 'よい日々1期　戦略考察レポート', null],
    [],
    ['月', '販売区分', 'よい日々', '定期/通常', '数量', '売上', '仕入額', '粗利', '粗利率'],
    ['2025-06', 'TV', 'MCTオイル', '通常', 2, 1000, 400, 600, 0.6],
    ['2025-06', 'TV', 'MSMクリーム', '通常', 1, 500, 200, 300, 0.6],
    ['2025-06', '自社', 'MCTオイル', '定期', 5, 5000, 2000, 3000, 0.6],
    ['2025-07', 'TV', 'MCTオイル', '通常', 3, 1500, 600, 900, 0.6],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '詳細明細');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['dummy']]), '戦略考察');
  return wb;
}

test('findHeaderRowIndex finds row containing all required names', () => {
  const rows = [[null, 'title'], [], ['月', '販売区分', '売上'], ['2025-06', 'TV', 100]];
  assert.equal(findHeaderRowIndex(rows, ['月', '販売区分', '売上']), 2);
});

test('findHeaderRowIndex returns -1 when not found', () => {
  const rows = [['a', 'b'], ['c', 'd']];
  assert.equal(findHeaderRowIndex(rows, ['月', '売上']), -1);
});

test('parseBaseWorkbook aggregates across brand rows within same month/channel/type', () => {
  const records = parseBaseWorkbook(buildBaseWorkbook());
  const junTV = records.find(r => r.yearMonth === '2025-06' && r.channel === 'TV' && r.type === '通常');
  assert.ok(junTV, 'expected an aggregated 2025-06/TV/通常 record');
  assert.equal(junTV.sales, 1500);
  assert.equal(junTV.cost, 600);
  assert.equal(junTV.profit, 900);
});

test('parseBaseWorkbook keeps distinct channel/type/month combinations separate', () => {
  const records = parseBaseWorkbook(buildBaseWorkbook());
  const junJisha = records.find(r => r.yearMonth === '2025-06' && r.channel === '自社' && r.type === '定期');
  const julTV = records.find(r => r.yearMonth === '2025-07' && r.channel === 'TV' && r.type === '通常');
  assert.equal(junJisha.sales, 5000);
  assert.equal(julTV.sales, 1500);
  assert.equal(records.length, 3);
});

test('parseBaseWorkbook throws a clear error when 詳細明細 sheet is missing', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['x']]), 'Sheet1');
  assert.throws(() => parseBaseWorkbook(wb), /詳細明細/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../js/parsers.js'`.

- [ ] **Step 3: Write minimal implementation**

`dashboard/js/parsers.js`:
```js
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.YoiHibi = Object.assign(root.YoiHibi || {}, factory());
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {

  function findHeaderRowIndex(rows, requiredNames) {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || [];
      const rowStrings = row.map(v => (v == null ? '' : String(v).trim()));
      const hasAll = requiredNames.every(name => rowStrings.includes(name));
      if (hasAll) return i;
    }
    return -1;
  }

  function sheetToRows(workbook, sheetName) {
    const XLSX = require('xlsx');
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return null;
    return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
  }

  function parseBaseWorkbook(workbook) {
    const rows = sheetToRows(workbook, '詳細明細');
    if (!rows) {
      throw new Error('シート「詳細明細」が見つかりません。1期実績ファイルを確認してください。');
    }
    const required = ['月', '販売区分', '定期/通常', '売上', '仕入額', '粗利'];
    const headerIdx = findHeaderRowIndex(rows, required);
    if (headerIdx === -1) {
      throw new Error('詳細明細シートに必要な列（月・販売区分・定期/通常・売上・仕入額・粗利）が見つかりません。');
    }
    const header = rows[headerIdx].map(v => (v == null ? '' : String(v).trim()));
    const col = name => header.indexOf(name);
    const idx = {
      month: col('月'),
      channel: col('販売区分'),
      type: col('定期/通常'),
      sales: col('売上'),
      cost: col('仕入額'),
      profit: col('粗利'),
    };

    const agg = new Map();
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      const yearMonth = row[idx.month];
      if (!yearMonth || !/^\d{4}-\d{2}$/.test(String(yearMonth))) continue;
      const channel = row[idx.channel];
      const type = row[idx.type];
      if (!channel || !type) continue;
      const key = `${yearMonth}|${channel}|${type}`;
      if (!agg.has(key)) {
        agg.set(key, { yearMonth: String(yearMonth), channel: String(channel), type: String(type), sales: 0, cost: 0, profit: 0 });
      }
      const rec = agg.get(key);
      rec.sales += Number(row[idx.sales]) || 0;
      rec.cost += Number(row[idx.cost]) || 0;
      rec.profit += Number(row[idx.profit]) || 0;
    }
    return Array.from(agg.values());
  }

  return { findHeaderRowIndex, parseBaseWorkbook };
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: all tests in `parsers.base.test.js` PASS.

- [ ] **Step 5: Commit**

```powershell
git add js/parsers.js tests/parsers.base.test.js
git commit -m "feat: parse 1期 base workbook into monthly channel records"
```

---

### Task 4: Shipping-date parsing + monthly workbook parser (2期月次実績)

**Files:**
- Modify: `dashboard/js/parsers.js` (add `parseShippingDate`, `parseMonthlyWorkbook`)
- Create: `dashboard/tests/parsers.monthly.test.js`

**Interfaces:**
- Consumes: `findHeaderRowIndex` (Task 3), `mapMediaToChannel` (Task 2, via `require('./mapping.js')`).
- Produces: `parseShippingDate(value)` → `{ yearMonth: 'YYYY-MM', date: 'YYYY-MM-DD' } | null`; `parseMonthlyWorkbook(workbook, mediaMapping?)` → `{ records: Record[], unmappedMedia: { [rawName]: { count: number, sales: number } } }`. Consumed by `main.js` (Task 10).

- [ ] **Step 1: Write the failing test**

`dashboard/tests/parsers.monthly.test.js`:
```js
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
  // Excel serial 46182 = 2026-06-09 (days since 1899-12-30). Verified via:
  // new Date(Date.UTC(1899,11,30) + 46182*86400000).toISOString() === '2026-06-09T00:00:00.000Z'
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `parseShippingDate is not a function` / `parseMonthlyWorkbook is not a function`.

- [ ] **Step 3: Write minimal implementation**

Replace the factory body in `dashboard/js/parsers.js` (keep `findHeaderRowIndex` and `parseBaseWorkbook` from Task 3, add the following inside the same factory function, and update the final `return`):

```js
  function excelSerialToDate(serial) {
    const ms = Date.UTC(1899, 11, 30) + serial * 86400000;
    return new Date(ms);
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function ymdFromDate(d) {
    return {
      yearMonth: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`,
      date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
    };
  }

  function parseShippingDate(value) {
    if (value == null || value === '') return null;
    if (value instanceof Date) return ymdFromDate(value);
    if (typeof value === 'number') return ymdFromDate(excelSerialToDate(value));

    const s = String(value).trim();
    let m = s.match(/^(\d{2})\/(\d{2})\/(\d{2})$/); // YY/MM/DD
    if (m) return ymdFromDate(new Date(2000 + Number(m[1]), Number(m[2]) - 1, Number(m[3])));

    m = s.match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/); // YYYY-MM-DD or YYYY/MM/DD
    if (m) return ymdFromDate(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));

    return null;
  }

  function aggregateSalesRows(rows, headerIdx, idx, mediaMapping) {
    const agg = new Map();
    const unmappedMedia = {};
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      if (String(row[idx.brand]) !== '22') continue;

      const parsedDate = parseShippingDate(row[idx.shipDate]);
      if (!parsedDate) continue;

      const mapping = require('./mapping.js');
      const mapped = mapping.mapMediaToChannel(row[idx.media], mediaMapping);
      const sales = Number(row[idx.sales]) || 0;

      if (!mapped.mapped) {
        const rawName = (row[idx.media] == null ? '' : String(row[idx.media])).trim();
        if (!unmappedMedia[rawName]) unmappedMedia[rawName] = { count: 0, sales: 0 };
        unmappedMedia[rawName].count += 1;
        unmappedMedia[rawName].sales += sales;
      }
      if (mapped.channel === null) continue; // excluded (e.g. 倉庫移動)

      const type = row[idx.type];
      if (!type) continue;

      const key = { monthly: `${parsedDate.yearMonth}|${mapped.channel}|${type}`, daily: `${parsedDate.date}|${mapped.channel}|${type}` };
      return { parsedDate, mapped, sales, type, key };
    }
    return null; // unreachable, replaced below
  }

  function parseMonthlyWorkbook(workbook, mediaMapping) {
    const rows = sheetToRows(workbook, '売上明細_提出');
    if (!rows) {
      throw new Error('シート「売上明細_提出」が見つかりません。月次実績ファイルを確認してください。');
    }
    const required = ['出荷日', '媒体名', '販売区分', 'ブランド区分'];
    const headerIdx = findHeaderRowIndex(rows, required);
    if (headerIdx === -1) {
      throw new Error('売上明細_提出シートに必要な列（出荷日・媒体名・販売区分・ブランド区分）が見つかりません。');
    }
    const header = rows[headerIdx].map(v => (v == null ? '' : String(v).trim()));
    const col = name => header.indexOf(name);
    const idx = {
      shipDate: col('出荷日'), media: col('媒体名'), type: col('販売区分'), brand: col('ブランド区分'),
      sales: col('金額'), cost: col('仕入金額'), profit: col('粗利額'),
    };

    const mapping = require('./mapping.js');
    const agg = new Map();
    const unmappedMedia = {};

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      if (String(row[idx.brand]) !== '22') continue;

      const parsedDate = parseShippingDate(row[idx.shipDate]);
      if (!parsedDate) continue;

      const mapped = mapping.mapMediaToChannel(row[idx.media], mediaMapping);
      const sales = Number(row[idx.sales]) || 0;
      const cost = Number(row[idx.cost]) || 0;
      const profit = Number(row[idx.profit]) || 0;

      if (!mapped.mapped) {
        const rawName = (row[idx.media] == null ? '' : String(row[idx.media])).trim();
        if (!unmappedMedia[rawName]) unmappedMedia[rawName] = { count: 0, sales: 0 };
        unmappedMedia[rawName].count += 1;
        unmappedMedia[rawName].sales += sales;
      }
      if (mapped.channel === null) continue;

      const type = row[idx.type];
      if (!type) continue;

      const key = `${parsedDate.yearMonth}|${mapped.channel}|${type}`;
      if (!agg.has(key)) {
        agg.set(key, { yearMonth: parsedDate.yearMonth, channel: mapped.channel, type: String(type), sales: 0, cost: 0, profit: 0 });
      }
      const rec = agg.get(key);
      rec.sales += sales;
      rec.cost += cost;
      rec.profit += profit;
    }

    return { records: Array.from(agg.values()), unmappedMedia };
  }
```

Remove the placeholder `aggregateSalesRows` helper (it was scratch work, not part of the final module — do not include it). Update the final `return` statement of the factory to:

```js
  return { findHeaderRowIndex, parseBaseWorkbook, parseShippingDate, parseMonthlyWorkbook };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: all tests in `parsers.base.test.js` and `parsers.monthly.test.js` PASS.

- [ ] **Step 5: Commit**

```powershell
git add js/parsers.js tests/parsers.monthly.test.js
git commit -m "feat: parse monthly workbook with brand filter and media mapping"
```

---

### Task 5: Generic CSV parser + daily CSV parser (2期日次実績)

**Files:**
- Modify: `dashboard/js/parsers.js` (add `parseCsv`, `parseDailyCsv`)
- Create: `dashboard/tests/parsers.daily.test.js`

**Interfaces:**
- Consumes: `findHeaderRowIndex`, `parseShippingDate` (this file), `mapMediaToChannel` (Task 2).
- Produces: `parseCsv(text)` → `string[][]`; `parseDailyCsv(csvText, mediaMapping?)` → `{ records: (Record & {date})[], unmappedMedia: {...} }`. Consumed by `main.js` (Task 10).

- [ ] **Step 1: Write the failing test**

`dashboard/tests/parsers.daily.test.js`:
```js
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
  const header = '出荷日,媒体名,販売区分,ブランド区分,金額,仕入金額,粗利額';
  const lines = [
    header,
    '26/06/09,よい日々,通常,22,1000,400,600',
    '26/06/09,よい日々,通常,22,500,200,300',
    '26/06/10,楽天よい日々,定期,22,2000,800,1200',
    '26/06/11,謎の新規媒体,通常,22,300,100,200',
    '26/06/12,よい日々,通常,9,9999,0,0',
  ];
  return lines.join('\n') + '\n';
}

test('parseDailyCsv filters brand 22, maps media, aggregates by date/channel/type', () => {
  const { records, unmappedMedia } = parseDailyCsv(buildDailyCsv());
  const day9 = records.find(r => r.date === '2026-06-09' && r.channel === '自社' && r.type === '通常');
  assert.ok(day9);
  assert.equal(day9.sales, 1500);
  assert.equal(day9.yearMonth, '2026-06');

  const day10 = records.find(r => r.date === '2026-06-10' && r.channel === '楽天');
  assert.equal(day10.sales, 2000);

  const total = records.reduce((s, r) => s + r.sales, 0);
  assert.equal(total, 1500 + 2000 + 300); // brand-9 row excluded

  assert.ok(unmappedMedia['謎の新規媒体']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `parseCsv is not a function` / `parseDailyCsv is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to the factory body in `dashboard/js/parsers.js` (before the final `return`):

```js
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    let i = 0;
    const n = text.length;

    while (i < n) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i += 1; continue;
        }
        field += c; i += 1; continue;
      }
      if (c === '"') { inQuotes = true; i += 1; continue; }
      if (c === ',') { row.push(field); field = ''; i += 1; continue; }
      if (c === '\r') { i += 1; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i += 1; continue; }
      field += c; i += 1;
    }
    if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
    return rows.filter(r => !(r.length === 1 && r[0] === ''));
  }

  function parseDailyCsv(csvText, mediaMapping) {
    const rows = parseCsv(csvText);
    const required = ['出荷日', '媒体名', '販売区分', 'ブランド区分'];
    const headerIdx = findHeaderRowIndex(rows, required);
    if (headerIdx === -1) {
      throw new Error('CSVに必要な列（出荷日・媒体名・販売区分・ブランド区分）が見つかりません。');
    }
    const header = rows[headerIdx].map(v => (v == null ? '' : String(v).trim()));
    const col = name => header.indexOf(name);
    const idx = {
      shipDate: col('出荷日'), media: col('媒体名'), type: col('販売区分'), brand: col('ブランド区分'),
      sales: col('金額'), cost: col('仕入金額'), profit: col('粗利額'),
    };

    const mapping = require('./mapping.js');
    const agg = new Map();
    const unmappedMedia = {};

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      if (String(row[idx.brand]) !== '22') continue;

      const parsedDate = parseShippingDate(row[idx.shipDate]);
      if (!parsedDate) continue;

      const mapped = mapping.mapMediaToChannel(row[idx.media], mediaMapping);
      const sales = Number(row[idx.sales]) || 0;
      const cost = Number(row[idx.cost]) || 0;
      const profit = Number(row[idx.profit]) || 0;

      if (!mapped.mapped) {
        const rawName = (row[idx.media] == null ? '' : String(row[idx.media])).trim();
        if (!unmappedMedia[rawName]) unmappedMedia[rawName] = { count: 0, sales: 0 };
        unmappedMedia[rawName].count += 1;
        unmappedMedia[rawName].sales += sales;
      }
      if (mapped.channel === null) continue;

      const type = row[idx.type];
      if (!type) continue;

      const key = `${parsedDate.date}|${mapped.channel}|${type}`;
      if (!agg.has(key)) {
        agg.set(key, { yearMonth: parsedDate.yearMonth, date: parsedDate.date, channel: mapped.channel, type: String(type), sales: 0, cost: 0, profit: 0 });
      }
      const rec = agg.get(key);
      rec.sales += sales;
      rec.cost += cost;
      rec.profit += profit;
    }

    return { records: Array.from(agg.values()), unmappedMedia };
  }
```

Update the final `return` statement to:
```js
  return { findHeaderRowIndex, parseBaseWorkbook, parseShippingDate, parseMonthlyWorkbook, parseCsv, parseDailyCsv };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: all tests across `parsers.*.test.js` PASS.

- [ ] **Step 5: Commit**

```powershell
git add js/parsers.js tests/parsers.daily.test.js
git commit -m "feat: parse daily CSV with quoted-field support"
```

---

### Task 6: File-type auto-detection

**Files:**
- Modify: `dashboard/js/parsers.js` (add `detectFileType`)
- Create: `dashboard/tests/filetype.test.js`

**Interfaces:**
- Produces: `detectFileType(fileName, sheetNames)` → `'base' | 'monthly' | 'daily' | 'unknown'`. Consumed by `main.js` (Task 10) to route a dropped file to the right parser.

- [ ] **Step 1: Write the failing test**

`dashboard/tests/filetype.test.js`:
```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `detectFileType is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to the factory body in `dashboard/js/parsers.js` (before the final `return`):

```js
  function detectFileType(fileName, sheetNames) {
    const name = fileName || '';
    const sheets = sheetNames || [];
    if (/^粗利分析_よい日々1期/.test(name) || sheets.includes('詳細明細')) return 'base';
    if (/^商品別収益/.test(name) || sheets.includes('売上明細_提出')) return 'monthly';
    if (/\.csv$/i.test(name) || /^受注_売上一覧表/.test(name)) return 'daily';
    return 'unknown';
  }
```

Update the final `return` statement to:
```js
  return { findHeaderRowIndex, parseBaseWorkbook, parseShippingDate, parseMonthlyWorkbook, parseCsv, parseDailyCsv, detectFileType };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: all tests in `filetype.test.js` PASS.

- [ ] **Step 5: Commit**

```powershell
git add js/parsers.js tests/filetype.test.js
git commit -m "feat: auto-detect dropped file type from name or sheet contents"
```

---

### Task 7: Storage module

**Files:**
- Create: `dashboard/js/store.js`
- Create: `dashboard/tests/store.test.js`

**Interfaces:**
- Consumes: nothing (backend is injected).
- Produces: `createStore(backend)` → object with `getState()`, `setBaseRecords(records)`, `upsertMonthlyRecords(yearMonth, records)`, `upsertDailyRecords(yearMonth, records)`, `setTargets(targets)`, `setMediaMapping(mapping)`, `clearAll()`, `exportJSON()`, `importJSON(json)`. `backend` must implement `getItem(key)`/`setItem(key, value)` (matches the browser `Storage` interface, so `createStore(window.localStorage)` works directly). Consumed by `main.js` (Task 10).

- [ ] **Step 1: Write the failing test**

`dashboard/tests/store.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../js/store.js');

function fakeBackend() {
  const data = {};
  return { getItem: k => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = v; } };
}

test('getState returns empty structure when nothing stored', () => {
  const store = createStore(fakeBackend());
  const state = store.getState();
  assert.deepEqual(state, { baseRecords: [], monthlyRecords: [], dailyRecords: [], targets: [], mediaMapping: {} });
});

test('setBaseRecords persists and getState reflects it', () => {
  const store = createStore(fakeBackend());
  store.setBaseRecords([{ yearMonth: '2025-06', channel: 'TV', type: '通常', sales: 100, cost: 40, profit: 60 }]);
  assert.equal(store.getState().baseRecords.length, 1);
});

test('upsertMonthlyRecords overwrites only the given yearMonth', () => {
  const store = createStore(fakeBackend());
  store.upsertMonthlyRecords('2026-06', [{ yearMonth: '2026-06', channel: 'TV', type: '通常', sales: 100, cost: 40, profit: 60 }]);
  store.upsertMonthlyRecords('2026-07', [{ yearMonth: '2026-07', channel: 'TV', type: '通常', sales: 200, cost: 80, profit: 120 }]);
  // re-import 2026-06 with different totals -> must replace, not add to, the old 2026-06 rows
  store.upsertMonthlyRecords('2026-06', [{ yearMonth: '2026-06', channel: 'TV', type: '通常', sales: 999, cost: 1, profit: 998 }]);

  const records = store.getState().monthlyRecords;
  assert.equal(records.filter(r => r.yearMonth === '2026-06').length, 1);
  assert.equal(records.find(r => r.yearMonth === '2026-06').sales, 999);
  assert.equal(records.find(r => r.yearMonth === '2026-07').sales, 200);
});

test('upsertDailyRecords overwrites only the given yearMonth', () => {
  const store = createStore(fakeBackend());
  store.upsertDailyRecords('2026-06', [{ yearMonth: '2026-06', date: '2026-06-01', channel: 'TV', type: '通常', sales: 10, cost: 4, profit: 6 }]);
  store.upsertDailyRecords('2026-06', [{ yearMonth: '2026-06', date: '2026-06-02', channel: 'TV', type: '通常', sales: 20, cost: 8, profit: 12 }]);
  const records = store.getState().dailyRecords;
  assert.equal(records.length, 1);
  assert.equal(records[0].date, '2026-06-02');
});

test('setTargets and setMediaMapping replace their sections', () => {
  const store = createStore(fakeBackend());
  store.setTargets([{ yearMonth: '2026-06', salesTarget: 1000000, profitTarget: 400000 }]);
  store.setMediaMapping({ '新媒体': 'TV' });
  const state = store.getState();
  assert.equal(state.targets[0].salesTarget, 1000000);
  assert.equal(state.mediaMapping['新媒体'], 'TV');
});

test('exportJSON/importJSON round-trip', () => {
  const store = createStore(fakeBackend());
  store.setBaseRecords([{ yearMonth: '2025-06', channel: 'TV', type: '通常', sales: 100, cost: 40, profit: 60 }]);
  const json = store.exportJSON();

  const store2 = createStore(fakeBackend());
  store2.importJSON(json);
  assert.deepEqual(store2.getState(), store.getState());
});

test('clearAll resets to empty structure', () => {
  const store = createStore(fakeBackend());
  store.setBaseRecords([{ yearMonth: '2025-06', channel: 'TV', type: '通常', sales: 1, cost: 1, profit: 0 }]);
  store.clearAll();
  assert.deepEqual(store.getState().baseRecords, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../js/store.js'`.

- [ ] **Step 3: Write minimal implementation**

`dashboard/js/store.js`:
```js
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.YoiHibi = Object.assign(root.YoiHibi || {}, factory());
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const STORAGE_KEY = 'yoihibi-dashboard-v1';

  function emptyState() {
    return { baseRecords: [], monthlyRecords: [], dailyRecords: [], targets: [], mediaMapping: {} };
  }

  function createStore(backend) {
    function load() {
      const raw = backend.getItem(STORAGE_KEY);
      if (!raw) return emptyState();
      try {
        const parsed = JSON.parse(raw);
        return Object.assign(emptyState(), parsed);
      } catch (e) {
        return emptyState();
      }
    }
    function save(state) { backend.setItem(STORAGE_KEY, JSON.stringify(state)); }

    return {
      getState: load,
      setBaseRecords(records) { const s = load(); s.baseRecords = records; save(s); return s; },
      upsertMonthlyRecords(yearMonth, records) {
        const s = load();
        s.monthlyRecords = s.monthlyRecords.filter(r => r.yearMonth !== yearMonth).concat(records);
        save(s); return s;
      },
      upsertDailyRecords(yearMonth, records) {
        const s = load();
        s.dailyRecords = s.dailyRecords.filter(r => r.yearMonth !== yearMonth).concat(records);
        save(s); return s;
      },
      setTargets(targets) { const s = load(); s.targets = targets; save(s); return s; },
      setMediaMapping(mapping) { const s = load(); s.mediaMapping = mapping; save(s); return s; },
      clearAll() { save(emptyState()); return emptyState(); },
      exportJSON() { return JSON.stringify(load(), null, 2); },
      importJSON(json) { const s = Object.assign(emptyState(), JSON.parse(json)); save(s); return s; },
    };
  }

  return { createStore };
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: all tests in `store.test.js` PASS.

- [ ] **Step 5: Commit**

```powershell
git add js/store.js tests/store.test.js
git commit -m "feat: add localStorage-backed data store with month overwrite semantics"
```

---

### Task 8: Aggregation / comparison calculations

**Files:**
- Create: `dashboard/js/aggregate.js`
- Create: `dashboard/tests/aggregate.test.js`

**Interfaces:**
- Consumes: state shape produced by `store.js` (`{ baseRecords, monthlyRecords, dailyRecords, targets, mediaMapping }`).
- Produces: `shiftYearMonth(yearMonth, yearDelta)`, `sumRecords(records)`, `filterRecords(records, filter)`, `profitRate(totals)`, `pctChange(current, base)`, `daysInMonth(yearMonth)`, `getMonthlyComparison(state, yearMonth)`, `getChannelTable(state, yearMonth)`, `getDailyCumulativeSeries(state, yearMonth)`, `getMonthlyTrend(state)`. Consumed by `ui.js` (Task 9) and `main.js` (Task 10).

- [ ] **Step 1: Write the failing test**

`dashboard/tests/aggregate.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  shiftYearMonth, sumRecords, filterRecords, profitRate, pctChange, daysInMonth,
  getMonthlyComparison, getChannelTable, getDailyCumulativeSeries, getMonthlyTrend,
} = require('../js/aggregate.js');

test('shiftYearMonth moves the year and keeps the month', () => {
  assert.equal(shiftYearMonth('2026-06', -1), '2025-06');
  assert.equal(shiftYearMonth('2025-12', 1), '2026-12');
});

test('sumRecords totals sales/cost/profit', () => {
  const totals = sumRecords([{ sales: 100, cost: 40, profit: 60 }, { sales: 50, cost: 20, profit: 30 }]);
  assert.deepEqual(totals, { sales: 150, cost: 60, profit: 90 });
});

test('filterRecords matches only provided keys', () => {
  const recs = [{ yearMonth: '2026-06', channel: 'TV' }, { yearMonth: '2026-06', channel: '自社' }];
  assert.equal(filterRecords(recs, { channel: 'TV' }).length, 1);
  assert.equal(filterRecords(recs, {}).length, 2);
});

test('profitRate and pctChange handle zero-base gracefully', () => {
  assert.equal(profitRate({ sales: 200, profit: 50 }), 0.25);
  assert.equal(profitRate({ sales: 0, profit: 0 }), 0);
  assert.equal(pctChange(150, 100), 0.5);
  assert.equal(pctChange(0, 0), 0);
  assert.equal(pctChange(50, 0), null);
});

test('daysInMonth returns correct day counts including leap Feb', () => {
  assert.equal(daysInMonth('2026-06'), 30);
  assert.equal(daysInMonth('2024-02'), 29);
  assert.equal(daysInMonth('2026-02'), 28);
});

function sampleState() {
  return {
    baseRecords: [
      { yearMonth: '2025-06', channel: 'TV', type: '通常', sales: 1000, cost: 400, profit: 600 },
      { yearMonth: '2025-06', channel: '自社', type: '定期', sales: 2000, cost: 800, profit: 1200 },
    ],
    monthlyRecords: [
      { yearMonth: '2026-06', channel: 'TV', type: '通常', sales: 1200, cost: 480, profit: 720 },
      { yearMonth: '2026-06', channel: '自社', type: '定期', sales: 1800, cost: 720, profit: 1080 },
    ],
    dailyRecords: [
      { yearMonth: '2026-06', date: '2026-06-01', channel: 'TV', type: '通常', sales: 100, cost: 40, profit: 60 },
      { yearMonth: '2026-06', date: '2026-06-02', channel: 'TV', type: '通常', sales: 200, cost: 80, profit: 120 },
    ],
    targets: [{ yearMonth: '2026-06', salesTarget: 3000, profitTarget: 1800 }],
    mediaMapping: {},
  };
}

test('getMonthlyComparison compares 2期 month against 1期 same month one year earlier', () => {
  const cmp = getMonthlyComparison(sampleState(), '2026-06');
  assert.equal(cmp.sales, 3000); // 1200 + 1800
  assert.equal(cmp.profit, 1800); // 720 + 1080
  assert.equal(cmp.profitRate, 0.6);
  assert.equal(cmp.salesYoY, 0); // (3000-3000)/3000
  assert.equal(cmp.salesTargetRate, 1); // 3000/3000
  assert.equal(cmp.profitTargetRate, 1);
});

test('getChannelTable returns all 7 channels with sales/profit/profitRate/salesYoY, no target column', () => {
  const table = getChannelTable(sampleState(), '2026-06');
  assert.equal(table.length, 7);
  const tv = table.find(r => r.channel === 'TV');
  assert.equal(tv.sales, 1200);
  assert.equal(tv.salesYoY, 0.2); // (1200-1000)/1000
  assert.equal('salesTargetRate' in tv, false);
  const kaso = table.find(r => r.channel === 'yahoo');
  assert.equal(kaso.sales, 0);
});

test('getDailyCumulativeSeries produces one entry per day with actual cumulative and prorated 1期 pace', () => {
  const series = getDailyCumulativeSeries(sampleState(), '2026-06');
  assert.equal(series.length, 30);
  assert.equal(series[0].actualSales, 100);
  assert.equal(series[1].actualSales, 300);
  // base month total sales = 3000, day 2 of 30 => pace = 3000 * 2/30 = 200
  assert.equal(series[1].paceSales, 200);
});

test('getMonthlyTrend returns one row per month present in monthlyRecords with base and target', () => {
  const trend = getMonthlyTrend(sampleState());
  assert.equal(trend.length, 1);
  assert.equal(trend[0].yearMonth, '2026-06');
  assert.equal(trend[0].currentSales, 3000);
  assert.equal(trend[0].baseSales, 3000);
  assert.equal(trend[0].targetSales, 3000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../js/aggregate.js'`.

- [ ] **Step 3: Write minimal implementation**

`dashboard/js/aggregate.js`:
```js
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.YoiHibi = Object.assign(root.YoiHibi || {}, factory());
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const CHANNELS = ['TV', 'yahoo', 'その他', 'アマゾン', '卸', '楽天', '自社'];

  function shiftYearMonth(yearMonth, yearDelta) {
    const [y, m] = yearMonth.split('-').map(Number);
    return `${y + yearDelta}-${String(m).padStart(2, '0')}`;
  }

  function sumRecords(records) {
    return records.reduce((acc, r) => {
      acc.sales += r.sales; acc.cost += r.cost; acc.profit += r.profit;
      return acc;
    }, { sales: 0, cost: 0, profit: 0 });
  }

  function filterRecords(records, filter) {
    const keys = Object.keys(filter);
    return records.filter(r => keys.every(k => r[k] === filter[k]));
  }

  function profitRate(totals) {
    return totals.sales === 0 ? 0 : totals.profit / totals.sales;
  }

  function pctChange(current, base) {
    if (base === 0) return current === 0 ? 0 : null;
    return (current - base) / base;
  }

  function daysInMonth(yearMonth) {
    const [y, m] = yearMonth.split('-').map(Number);
    return new Date(y, m, 0).getDate();
  }

  function findTarget(state, yearMonth) {
    return (state.targets || []).find(t => t.yearMonth === yearMonth) || null;
  }

  function getMonthlyComparison(state, yearMonth) {
    const current = sumRecords(filterRecords(state.monthlyRecords, { yearMonth }));
    const baseMonth = shiftYearMonth(yearMonth, -1);
    const base = sumRecords(filterRecords(state.baseRecords, { yearMonth: baseMonth }));
    const target = findTarget(state, yearMonth);
    return {
      yearMonth,
      sales: current.sales,
      profit: current.profit,
      profitRate: profitRate(current),
      salesYoY: pctChange(current.sales, base.sales),
      profitYoY: pctChange(current.profit, base.profit),
      salesTargetRate: target && target.salesTarget ? current.sales / target.salesTarget : null,
      profitTargetRate: target && target.profitTarget ? current.profit / target.profitTarget : null,
    };
  }

  function getChannelTable(state, yearMonth) {
    const baseMonth = shiftYearMonth(yearMonth, -1);
    return CHANNELS.map(channel => {
      const current = sumRecords(filterRecords(state.monthlyRecords, { yearMonth, channel }));
      const base = sumRecords(filterRecords(state.baseRecords, { yearMonth: baseMonth, channel }));
      return {
        channel,
        sales: current.sales,
        profit: current.profit,
        profitRate: profitRate(current),
        salesYoY: pctChange(current.sales, base.sales),
      };
    });
  }

  function getDailyCumulativeSeries(state, yearMonth) {
    const daily = filterRecords(state.dailyRecords, { yearMonth });
    const nDays = daysInMonth(yearMonth);
    const dailyTotals = Array.from({ length: nDays }, () => ({ sales: 0, profit: 0 }));
    daily.forEach(r => {
      const day = Number(r.date.slice(8, 10));
      if (day >= 1 && day <= nDays) {
        dailyTotals[day - 1].sales += r.sales;
        dailyTotals[day - 1].profit += r.profit;
      }
    });
    const baseMonth = shiftYearMonth(yearMonth, -1);
    const baseTotals = sumRecords(filterRecords(state.baseRecords, { yearMonth: baseMonth }));

    const series = [];
    let cumSales = 0, cumProfit = 0;
    for (let d = 0; d < nDays; d++) {
      cumSales += dailyTotals[d].sales;
      cumProfit += dailyTotals[d].profit;
      series.push({
        day: d + 1,
        actualSales: cumSales,
        actualProfit: cumProfit,
        paceSales: baseTotals.sales * ((d + 1) / nDays),
        paceProfit: baseTotals.profit * ((d + 1) / nDays),
      });
    }
    return series;
  }

  function getMonthlyTrend(state) {
    const months = Array.from(new Set(state.monthlyRecords.map(r => r.yearMonth))).sort();
    return months.map(yearMonth => {
      const current = sumRecords(filterRecords(state.monthlyRecords, { yearMonth }));
      const baseMonth = shiftYearMonth(yearMonth, -1);
      const base = sumRecords(filterRecords(state.baseRecords, { yearMonth: baseMonth }));
      const target = findTarget(state, yearMonth);
      return {
        yearMonth,
        currentSales: current.sales,
        currentProfit: current.profit,
        baseSales: base.sales,
        baseProfit: base.profit,
        targetSales: target ? target.salesTarget : null,
        targetProfit: target ? target.profitTarget : null,
      };
    });
  }

  return {
    CHANNELS, shiftYearMonth, sumRecords, filterRecords, profitRate, pctChange, daysInMonth,
    getMonthlyComparison, getChannelTable, getDailyCumulativeSeries, getMonthlyTrend,
  };
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: all tests in `aggregate.test.js` PASS.

- [ ] **Step 5: Commit**

```powershell
git add js/aggregate.js tests/aggregate.test.js
git commit -m "feat: add monthly/channel/daily-pace comparison calculations"
```

---

### Task 9: Pure HTML-string rendering helpers

**Files:**
- Create: `dashboard/js/ui.js`
- Create: `dashboard/tests/ui.test.js`

**Interfaces:**
- Consumes: shapes returned by `getMonthlyComparison`, `getChannelTable` (Task 8), and `unmappedMedia` maps (Task 4/5).
- Produces: `formatYen(n)`, `formatPct(n)`, `renderKpiCardsHTML(comparison)`, `renderChannelTableHTML(rows)`, `renderMappingWarningsHTML(unmappedMedia)`. Consumed by `main.js` (Task 10) to inject into the DOM via `element.innerHTML = ...`.

- [ ] **Step 1: Write the failing test**

`dashboard/tests/ui.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { formatYen, formatPct, renderKpiCardsHTML, renderChannelTableHTML, renderMappingWarningsHTML } = require('../js/ui.js');

test('formatYen adds yen sign and thousands separators, rounds to integer', () => {
  assert.equal(formatYen(1234567.8), '¥1,234,568');
  assert.equal(formatYen(0), '¥0');
});

test('formatPct formats ratio as percent with 1 decimal, null as N/A', () => {
  assert.equal(formatPct(0.256), '25.6%');
  assert.equal(formatPct(-0.05), '-5.0%');
  assert.equal(formatPct(null), 'N/A');
});

test('renderKpiCardsHTML includes sales, profit, profitRate and both comparison figures', () => {
  const html = renderKpiCardsHTML({
    sales: 3000000, profit: 1200000, profitRate: 0.4,
    salesYoY: 0.1, profitYoY: 0.05, salesTargetRate: 0.8, profitTargetRate: 0.75,
  });
  assert.match(html, /¥3,000,000/);
  assert.match(html, /¥1,200,000/);
  assert.match(html, /40\.0%/);
  assert.match(html, /10\.0%/);
  assert.match(html, /80\.0%/);
});

test('renderChannelTableHTML emits one row per channel with sales/profit/profitRate/salesYoY', () => {
  const html = renderChannelTableHTML([
    { channel: 'TV', sales: 1000, profit: 400, profitRate: 0.4, salesYoY: 0.2 },
    { channel: '自社', sales: 500, profit: 200, profitRate: 0.4, salesYoY: null },
  ]);
  assert.match(html, /<table/);
  assert.match(html, /TV/);
  assert.match(html, /自社/);
  assert.match(html, /N\/A/);
});

test('renderMappingWarningsHTML lists unmapped media names with counts, empty string when none', () => {
  const html = renderMappingWarningsHTML({ '謎の媒体': { count: 3, sales: 4500 } });
  assert.match(html, /謎の媒体/);
  assert.match(html, /3/);
  assert.equal(renderMappingWarningsHTML({}), '');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../js/ui.js'`.

- [ ] **Step 3: Write minimal implementation**

`dashboard/js/ui.js`:
```js
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.YoiHibi = Object.assign(root.YoiHibi || {}, factory());
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  function formatYen(n) {
    return '¥' + Math.round(n).toLocaleString('ja-JP');
  }

  function formatPct(n) {
    if (n == null) return 'N/A';
    return (n * 100).toFixed(1) + '%';
  }

  function renderKpiCardsHTML(c) {
    return `
      <div class="kpi-card">
        <div class="kpi-label">売上</div>
        <div class="kpi-value">${formatYen(c.sales)}</div>
        <div class="kpi-sub">1期比 ${formatPct(c.salesYoY)} ／ 目標達成率 ${formatPct(c.salesTargetRate)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">粗利</div>
        <div class="kpi-value">${formatYen(c.profit)}</div>
        <div class="kpi-sub">1期比 ${formatPct(c.profitYoY)} ／ 目標達成率 ${formatPct(c.profitTargetRate)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">粗利率</div>
        <div class="kpi-value">${formatPct(c.profitRate)}</div>
      </div>
    `;
  }

  function renderChannelTableHTML(rows) {
    const body = rows.map(r => `
      <tr>
        <td>${r.channel}</td>
        <td>${formatYen(r.sales)}</td>
        <td>${formatYen(r.profit)}</td>
        <td>${formatPct(r.profitRate)}</td>
        <td>${formatPct(r.salesYoY)}</td>
      </tr>`).join('');
    return `<table class="channel-table">
      <thead><tr><th>チャネル</th><th>売上</th><th>粗利</th><th>粗利率</th><th>1期比</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
  }

  function renderMappingWarningsHTML(unmappedMedia) {
    const names = Object.keys(unmappedMedia || {});
    if (names.length === 0) return '';
    const items = names.map(name => {
      const info = unmappedMedia[name];
      return `<li>${name}（${info.count}件, ${formatYen(info.sales)}）→ 現在「その他」扱い</li>`;
    }).join('');
    return `<div class="mapping-warning"><p>未マッピングの媒体名があります。設定パネルで割り当てを見直してください:</p><ul>${items}</ul></div>`;
  }

  return { formatYen, formatPct, renderKpiCardsHTML, renderChannelTableHTML, renderMappingWarningsHTML };
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: all tests in `ui.test.js` PASS, and the full suite (`npm test`) is green end to end.

- [ ] **Step 5: Commit**

```powershell
git add js/ui.js tests/ui.test.js
git commit -m "feat: add pure HTML-string renderers for KPI cards, channel table, mapping warnings"
```

---

### Task 10: dashboard.html + main.js (browser wiring)

**Files:**
- Create: `dashboard/css/styles.css`
- Create: `dashboard/js/main.js`
- Create: `dashboard/dashboard.html`

**Interfaces:**
- Consumes: `window.YoiHibi.*` from every prior module (`mapping.js`, `parsers.js`, `store.js`, `aggregate.js`, `ui.js`), global `XLSX` and `Chart` from vendored scripts.
- Produces: the runnable end-user tool. No further tasks consume this one — it is verified manually in Task 11.

This task is not unit-testable with `node:test` (it requires `FileReader`, `<canvas>`, and DOM APIs that don't exist in Node). It is verified in Task 11 with Playwright against real files.

- [ ] **Step 1: Write `dashboard/css/styles.css`**

```css
* { box-sizing: border-box; font-family: 'Noto Sans JP', system-ui, sans-serif; }
body { margin: 0; padding: 24px; background: #fafafa; color: #202124; }
h1 { font-size: 22px; margin: 0 0 16px; }
.dropzone { border: 2px dashed #9aa0a6; border-radius: 8px; padding: 24px; text-align: center; margin-bottom: 16px; color: #5f6368; }
.dropzone.dragover { border-color: #1a73e8; background: #e8f0fe; }
.month-selector { margin-bottom: 16px; }
.kpi-row { display: flex; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
.kpi-card { background: #fff; border-radius: 8px; box-shadow: 0 1px 2px rgba(60,64,67,.3); padding: 16px; min-width: 200px; flex: 1; }
.kpi-label { font-size: 13px; color: #5f6368; }
.kpi-value { font-size: 32px; font-weight: 700; margin: 4px 0; }
.kpi-sub { font-size: 12px; color: #5f6368; }
.chart-row { display: flex; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
.chart-card { background: #fff; border-radius: 8px; box-shadow: 0 1px 2px rgba(60,64,67,.3); padding: 16px; flex: 1; min-width: 320px; }
table.channel-table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; }
table.channel-table th, table.channel-table td { padding: 8px 12px; border-bottom: 1px solid #e0e0e0; text-align: right; }
table.channel-table th:first-child, table.channel-table td:first-child { text-align: left; }
.mapping-warning { background: #fef7e0; border: 1px solid #f9ab00; border-radius: 8px; padding: 12px; margin-bottom: 16px; font-size: 13px; }
.settings-panel { margin-top: 24px; background: #fff; border-radius: 8px; padding: 16px; }
.settings-panel summary { cursor: pointer; font-weight: 700; }
.settings-panel table { width: 100%; margin-top: 12px; }
.settings-panel input { width: 100%; }
```

- [ ] **Step 2: Write `dashboard/js/main.js`**

```js
(function () {
  const { mapMediaToChannel } = window.YoiHibi;
  const { parseBaseWorkbook, parseMonthlyWorkbook, parseDailyCsv, detectFileType } = window.YoiHibi;
  const { createStore } = window.YoiHibi;
  const { getMonthlyComparison, getChannelTable, getDailyCumulativeSeries, getMonthlyTrend } = window.YoiHibi;
  const { renderKpiCardsHTML, renderChannelTableHTML, renderMappingWarningsHTML } = window.YoiHibi;

  const store = createStore(window.localStorage);
  let trendChart = null;
  let dailyChart = null;

  function el(id) { return document.getElementById(id); }

  function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  function decodeShiftJis(buffer) {
    return new TextDecoder('shift-jis').decode(buffer);
  }

  async function handleFile(file) {
    const buffer = await readFileAsArrayBuffer(file);
    let sheetNames = [];
    let workbook = null;
    const isCsv = /\.csv$/i.test(file.name);
    if (!isCsv) {
      workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
      sheetNames = workbook.SheetNames;
    }
    const type = detectFileType(file.name, sheetNames);

    try {
      if (type === 'base') {
        const records = parseBaseWorkbook(workbook);
        store.setBaseRecords(records);
        showStatus(`1期ベース実績を取込みました（${records.length}件）`);
      } else if (type === 'monthly') {
        const { records, unmappedMedia } = parseMonthlyWorkbook(workbook, store.getState().mediaMapping);
        const months = Array.from(new Set(records.map(r => r.yearMonth)));
        months.forEach(ym => store.upsertMonthlyRecords(ym, records.filter(r => r.yearMonth === ym)));
        showStatus(`月次実績を取込みました（${records.length}件）`);
        showWarnings(unmappedMedia);
      } else if (type === 'daily') {
        const text = decodeShiftJis(buffer);
        const { records, unmappedMedia } = parseDailyCsv(text, store.getState().mediaMapping);
        const months = Array.from(new Set(records.map(r => r.yearMonth)));
        months.forEach(ym => store.upsertDailyRecords(ym, records.filter(r => r.yearMonth === ym)));
        showStatus(`日次売上を取込みました（${records.length}件）`);
        showWarnings(unmappedMedia);
      } else {
        showStatus(`ファイル種別を判定できませんでした: ${file.name}`, true);
        return;
      }
    } catch (err) {
      showStatus(`取込エラー（${file.name}）: ${err.message}`, true);
      return;
    }

    refreshMonthOptions();
    renderAll();
  }

  function showStatus(message, isError) {
    const box = el('status');
    box.textContent = message;
    box.style.color = isError ? '#d93025' : '#188038';
  }

  function showWarnings(unmappedMedia) {
    el('warnings').innerHTML = renderMappingWarningsHTML(unmappedMedia);
  }

  function refreshMonthOptions() {
    const state = store.getState();
    const months = Array.from(new Set(state.monthlyRecords.map(r => r.yearMonth))).sort();
    const select = el('monthSelect');
    const current = select.value;
    select.innerHTML = months.map(m => `<option value="${m}">${m}</option>`).join('');
    if (months.includes(current)) select.value = current;
    else if (months.length) select.value = months[months.length - 1];
  }

  function renderAll() {
    const state = store.getState();
    const yearMonth = el('monthSelect').value;
    if (!yearMonth) return;

    el('kpiRow').innerHTML = renderKpiCardsHTML(getMonthlyComparison(state, yearMonth));
    el('channelTable').innerHTML = renderChannelTableHTML(getChannelTable(state, yearMonth));

    renderTrendChart(getMonthlyTrend(state));
    renderDailyChart(getDailyCumulativeSeries(state, yearMonth));
  }

  function renderTrendChart(trend) {
    const ctx = el('trendChart').getContext('2d');
    const data = {
      labels: trend.map(t => t.yearMonth),
      datasets: [
        { label: '2期 売上', data: trend.map(t => t.currentSales), borderColor: '#1a73e8', fill: false },
        { label: '1期 売上', data: trend.map(t => t.baseSales), borderColor: '#9aa0a6', borderDash: [6, 4], fill: false },
      ],
    };
    if (trendChart) { trendChart.data = data; trendChart.update(); return; }
    trendChart = new Chart(ctx, { type: 'line', data, options: { responsive: true } });
  }

  function renderDailyChart(series) {
    const ctx = el('dailyChart').getContext('2d');
    const data = {
      labels: series.map(s => s.day),
      datasets: [
        { label: '当月累積売上', data: series.map(s => s.actualSales), borderColor: '#1a73e8', fill: false },
        { label: '1期同月ペース', data: series.map(s => s.paceSales), borderColor: '#9aa0a6', borderDash: [6, 4], fill: false },
      ],
    };
    if (dailyChart) { dailyChart.data = data; dailyChart.update(); return; }
    dailyChart = new Chart(ctx, { type: 'line', data, options: { responsive: true } });
  }

  function setupDropzone() {
    const zone = el('dropzone');
    ['dragenter', 'dragover'].forEach(evt => zone.addEventListener(evt, e => { e.preventDefault(); zone.classList.add('dragover'); }));
    ['dragleave', 'drop'].forEach(evt => zone.addEventListener(evt, e => { e.preventDefault(); zone.classList.remove('dragover'); }));
    zone.addEventListener('drop', e => { Array.from(e.dataTransfer.files).forEach(handleFile); });
    el('fileInput').addEventListener('change', e => { Array.from(e.target.files).forEach(handleFile); });
  }

  function setupSettingsPanel() {
    el('exportBtn').addEventListener('click', () => {
      const blob = new Blob([store.exportJSON()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'yoihibi-dashboard-backup.json';
      a.click();
    });
    el('importInput').addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      const text = await file.text();
      store.importJSON(text);
      refreshMonthOptions();
      renderAll();
    });
    el('clearBtn').addEventListener('click', () => {
      if (confirm('取込済みデータをすべて削除します。よろしいですか？')) {
        store.clearAll();
        refreshMonthOptions();
        el('kpiRow').innerHTML = '';
        el('channelTable').innerHTML = '';
      }
    });
    el('salesTargetInput').addEventListener('change', saveTarget);
    el('profitTargetInput').addEventListener('change', saveTarget);
  }

  function saveTarget() {
    const yearMonth = el('monthSelect').value;
    if (!yearMonth) return;
    const state = store.getState();
    const targets = state.targets.filter(t => t.yearMonth !== yearMonth);
    targets.push({
      yearMonth,
      salesTarget: Number(el('salesTargetInput').value) || 0,
      profitTarget: Number(el('profitTargetInput').value) || 0,
    });
    store.setTargets(targets);
    renderAll();
  }

  function init() {
    setupDropzone();
    setupSettingsPanel();
    el('monthSelect').addEventListener('change', renderAll);
    refreshMonthOptions();
    renderAll();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
```

- [ ] **Step 3: Write `dashboard/dashboard.html`**

```html
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>よい日々 売上進捗ダッシュボード</title>
<link rel="stylesheet" href="css/styles.css">
</head>
<body>
<h1>よい日々 売上進捗ダッシュボード</h1>

<div id="dropzone" class="dropzone">
  ここに1期実績xlsx／月次実績xlsx／日次売上csvをドラッグ&ドロップ、または
  <input type="file" id="fileInput" multiple accept=".xlsx,.csv">
</div>
<p id="status"></p>
<div id="warnings"></div>

<div class="month-selector">
  対象月:
  <select id="monthSelect"></select>
</div>

<div id="kpiRow" class="kpi-row"></div>

<div class="chart-row">
  <div class="chart-card"><canvas id="trendChart" height="220"></canvas></div>
  <div class="chart-card"><canvas id="dailyChart" height="220"></canvas></div>
</div>

<div id="channelTable"></div>

<details class="settings-panel">
  <summary>設定</summary>
  <p>
    今月の目標　売上: <input type="number" id="salesTargetInput" placeholder="円">
    粗利: <input type="number" id="profitTargetInput" placeholder="円">
  </p>
  <p>
    <button id="exportBtn">データを書き出し(JSON)</button>
    データを読み込み: <input type="file" id="importInput" accept=".json">
    <button id="clearBtn">全データをクリア</button>
  </p>
</details>

<script src="js/vendor/xlsx.full.min.js"></script>
<script src="js/vendor/chart.umd.js"></script>
<script src="js/mapping.js"></script>
<script src="js/parsers.js"></script>
<script src="js/store.js"></script>
<script src="js/aggregate.js"></script>
<script src="js/ui.js"></script>
<script src="js/main.js"></script>
</body>
</html>
```

- [ ] **Step 4: Sanity-check module loading order with a headless load**

Run (from `dashboard/`):
```
node -e "const fs=require('fs'); const html=fs.readFileSync('dashboard.html','utf8'); const order=['xlsx.full.min.js','chart.umd.js','mapping.js','parsers.js','store.js','aggregate.js','ui.js','main.js']; let lastIdx=-1; for (const f of order) { const idx=html.indexOf(f); if (idx===-1) throw new Error('missing script tag for '+f); if (idx<lastIdx) throw new Error('script order wrong at '+f); lastIdx=idx; } console.log('script order OK');"
```
Expected: `script order OK`. (Full browser behavior is verified with Playwright in Task 11.)

- [ ] **Step 5: Commit**

```powershell
git add css/styles.css js/main.js dashboard.html
git commit -m "feat: wire dashboard.html and main.js to modules and vendored libraries"
```

---

### Task 11: Manual verification with real data (Playwright)

**Files:** none created — this task drives the browser against the files already on disk.

**Interfaces:** none (end-to-end verification only).

- [ ] **Step 1: Serve the dashboard locally**

PowerShell (from `dashboard/`):
```powershell
Start-Process powershell -ArgumentList '-NoExit','-Command','python -m http.server 8765'
```
Expected: server listening on `http://localhost:8765/dashboard.html`.

- [ ] **Step 2: Open in Playwright and check for console errors**

Use `mcp__playwright__browser_navigate` to `http://localhost:8765/dashboard.html`, then `mcp__playwright__browser_console_messages` with `level: "error"`.
Expected: no errors (confirms script load order and no runtime exceptions on initial render).

- [ ] **Step 3: Import the 1期ベース実績 file and verify KPI cards appear empty-but-no-crash**

Use `mcp__playwright__browser_file_upload` targeting `#fileInput` with path `C:\Users\a.ushimaru\Desktop\連携\よい日々媒体商品別\粗利分析_よい日々1期_20260709.xlsx`.
Expected via `mcp__playwright__browser_snapshot`: `#status` shows "1期ベース実績を取込みました（N件）" with N > 0.

- [ ] **Step 4: Import the monthly and daily files, verify KPI/table/charts populate**

Upload `商品別収益202606.xlsx` and `受注_売上一覧表ライト_202606.csv` (same folder) via `#fileInput`.
Expected: `#monthSelect` now offers `2026-06`; `#kpiRow` shows non-zero 売上/粗利 figures; `#channelTable` lists 7 channel rows; `#warnings` shows a list of unmapped 媒体名 (review this list against the mapping table — if any real channel is being misclassified as その他, add it to `DEFAULT_MEDIA_MAPPING` in `js/mapping.js` and re-run `npm test` + reload).

- [ ] **Step 5: Verify localStorage persistence and same-month overwrite**

Reload the page (`mcp__playwright__browser_navigate` to the same URL) and confirm `#monthSelect` and KPI cards still show data without re-importing. Re-upload `商品別収益202606.xlsx` a second time and confirm the KPI sales figure is unchanged (not doubled).

- [ ] **Step 6: Enter a target and confirm 目標達成率 appears**

Fill `#salesTargetInput` and `#profitTargetInput` via `mcp__playwright__browser_fill_form`, confirm `#kpiRow` sub-text updates to show a target rate percentage instead of `N/A`.

- [ ] **Step 7: Stop the local server**

```powershell
Get-Process python | Where-Object { $_.CommandLine -like '*http.server 8765*' } | Stop-Process
```

- [ ] **Step 8: Commit any mapping-table fixes discovered in Step 4**

```powershell
git add js/mapping.js
git commit -m "fix: extend media mapping table based on real June 2026 data"
```
(Skip this commit if no mapping changes were needed.)

---

## Self-Review Notes

- **Spec coverage:** every design-doc section has a task — ingestion/parsing (Tasks 3–6), persistence with overwrite semantics (Task 7), 1期同月比 + 目標達成率 calculations (Task 8), KPI/table/warning rendering (Task 9), full dashboard UI incl. drag-drop/settings/export-import (Task 10), and the spec's own testing plan (Task 11).
- **Resolved ambiguity:** target model is whole-month only; channel table has no 目標比 column (documented in Global Constraints, applied consistently in Task 8's `getChannelTable` and Task 9's `renderChannelTableHTML`).
- **Type/name consistency checked:** `Record` shape (`yearMonth, channel, type, sales, cost, profit`) and daily variant (`+ date`) are identical across Tasks 3, 4, 5, 7, 8. Store method names (`upsertMonthlyRecords`, `upsertDailyRecords`, `setBaseRecords`, `setTargets`, `setMediaMapping`, `clearAll`, `exportJSON`, `importJSON`) match between Task 7's definition and Task 10's usage. Aggregate function names match between Task 8's definition and Task 9/10's usage.
