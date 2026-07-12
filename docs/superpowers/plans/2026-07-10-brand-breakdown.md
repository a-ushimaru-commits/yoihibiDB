# ブランド別内訳 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a brand-level (MCTオイル, MSMパウダー, etc.) breakdown to the existing よい日々 sales dashboard, sourced from a new `商品コード→ブランド` lookup file, joined against the already-working monthly/daily order data.

**Architecture:** Extend the existing `Record` shape with a `brand` field. Add one new pure parser (`parseBrandLookup`) that turns `分解詳細リスト.xlsx` into a `{商品コード: ブランド}` object, stored in `store.js` exactly like the existing `mediaMapping`. `parseMonthlyWorkbook`/`parseDailyCsv` join each row's `商品コード` against that mapping to attach `brand` (defaulting to `"未分類"` + a warning, mirroring the existing unmapped-media pattern). `parseBaseWorkbook` already reads a sheet that has a brand column (`よい日々`) — it just wasn't being kept; this plan keeps it. A new `getBrandTable` aggregate function and `renderBrandTableHTML`/`renderProductBrandWarningsHTML` UI renderers surface it, wired into `main.js`/`dashboard.html` alongside the existing channel table.

**Tech Stack:** Same as the existing dashboard — vanilla JS, SheetJS, Chart.js, `node:test`.

## Global Constraints

- `Record` shape becomes `{ yearMonth, channel, type, brand, sales, cost, profit }` (daily adds `date`). `brand` is `string | null` for 1期 base records (straight from the `よい日々` column, `null` if the cell is blank) and `string` (`"未分類"` for unmapped) for 2期 monthly/daily records.
- Adding `brand` to the monthly/daily aggregation key (`${yearMonth}|${channel}|${type}|${brand}`) must NOT change any existing channel-level or whole-month total — `getChannelTable`/`getMonthlyComparison` filter by `{yearMonth}`/`{yearMonth, channel}` only, so summing several brand-split records still yields the same total as before. This is the single most important regression to verify: the real-data-verified figures (sales ¥12,144,126 / profit ¥8,218,941 for 2026-06) must remain byte-for-byte identical after this feature ships.
- Unmapped/unknown product codes must default to brand `"未分類"` and be surfaced as a warning, never silently dropped or crash the import — mirrors the existing `unmappedMedia` pattern exactly (`unmappedProducts: { [商品コード]: { count, sales } }`).
- The brand-assignment UX follows the existing "import now, warn, let the user fix the mapping via the settings panel, re-import to apply" pattern — no blocking modal, no pausing mid-import.
- `分解詳細リスト.xlsx` detection is filename-pattern-only (`/^分解詳細リスト/`). Its single sheet is generically named (`Sheet1` in the real file), so there is no reliable sheet-name fallback for this type, unlike `base`/`monthly`.
- No new npm dependencies. `npm test` must keep running the whole `tests/*.test.js` suite (currently 53 tests) and stay green throughout.

---

## File Structure

```
dashboard/
  js/
    parsers.js     (MODIFY: parseBaseWorkbook keeps brand; new parseBrandLookup; parseMonthlyWorkbook/parseDailyCsv gain productBrandMapping param; detectFileType gains 'brandLookup')
    store.js       (MODIFY: add productBrandMapping to state + setProductBrandMapping)
    aggregate.js   (MODIFY: add getBrandTable)
    ui.js          (MODIFY: add renderBrandTableHTML, renderProductBrandWarningsHTML)
    main.js        (MODIFY: wire brandLookup import, brand table render, brand-assignment form)
  dashboard.html   (MODIFY: add brand table + brand warning containers, update dropzone hint)
  tests/
    parsers.base.test.js     (MODIFY: brand-aware fixture/assertions)
    parsers.brandLookup.test.js (CREATE)
    parsers.monthly.test.js  (MODIFY: productBrandMapping coverage)
    parsers.daily.test.js    (MODIFY: productBrandMapping coverage)
    filetype.test.js         (MODIFY: brandLookup detection)
    store.test.js            (MODIFY: productBrandMapping coverage)
    aggregate.test.js        (MODIFY: getBrandTable coverage)
    ui.test.js               (MODIFY: renderBrandTableHTML/renderProductBrandWarningsHTML coverage)
```

---

### Task 1: Keep brand through `parseBaseWorkbook`

**Files:**
- Modify: `dashboard/js/parsers.js` (function `parseBaseWorkbook`, lines 29-69)
- Modify: `dashboard/tests/parsers.base.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `parseBaseWorkbook(workbook)` now returns `Record[]` where each `Record` includes `brand: string | null`. Consumed by Task 5 (`getBrandTable`'s 1期 lookup) and `main.js` (unchanged call site — it doesn't need to know about `brand` to keep working).

The `詳細明細` sheet already has a brand column literally named `よい日々` (confirmed against real files — this is not a typo, it holds values like `"MCTオイル"`, `"MSMクリーム"`). `parseBaseWorkbook` already required `['月', '販売区分', '定期/通常', '売上', '仕入額', '粗利']` — this task adds `'よい日々'` to that required list and threads it into the aggregation key.

- [ ] **Step 1: Write the failing test**

Replace the entire contents of `dashboard/tests/parsers.base.test.js` with:

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
    ['2025-06', 'TV', 'MCTオイル', '通常', 2, 700, 300, 400, 0.57],
    ['2025-06', 'TV', 'MCTオイル', '通常', 1, 300, 100, 200, 0.67], // same brand+channel+type+month -> must still merge
    ['2025-06', 'TV', 'MSMクリーム', '通常', 1, 500, 200, 300, 0.6], // different brand -> must stay separate
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

test('parseBaseWorkbook aggregates across rows sharing the same brand within month/channel/type', () => {
  const records = parseBaseWorkbook(buildBaseWorkbook());
  const mct = records.find(r => r.yearMonth === '2025-06' && r.channel === 'TV' && r.type === '通常' && r.brand === 'MCTオイル');
  assert.ok(mct, 'expected an aggregated MCTオイル/2025-06/TV/通常 record');
  assert.equal(mct.sales, 1000); // 700 + 300
  assert.equal(mct.cost, 400); // 300 + 100
  assert.equal(mct.profit, 600); // 400 + 200
});

test('parseBaseWorkbook keeps different brands separate even within the same month/channel/type', () => {
  const records = parseBaseWorkbook(buildBaseWorkbook());
  const msm = records.find(r => r.yearMonth === '2025-06' && r.channel === 'TV' && r.type === '通常' && r.brand === 'MSMクリーム');
  assert.ok(msm, 'expected a separate MSMクリーム/2025-06/TV/通常 record');
  assert.equal(msm.sales, 500);

  // channel-level rollup (ignoring brand) must equal the pre-brand-split total
  const tvTotal = records
    .filter(r => r.yearMonth === '2025-06' && r.channel === 'TV' && r.type === '通常')
    .reduce((s, r) => s + r.sales, 0);
  assert.equal(tvTotal, 1500); // 1000 (MCTオイル) + 500 (MSMクリーム)
});

test('parseBaseWorkbook keeps distinct channel/type/month/brand combinations separate', () => {
  const records = parseBaseWorkbook(buildBaseWorkbook());
  const junJisha = records.find(r => r.yearMonth === '2025-06' && r.channel === '自社' && r.type === '定期');
  const julTV = records.find(r => r.yearMonth === '2025-07' && r.channel === 'TV' && r.type === '通常');
  assert.equal(junJisha.sales, 5000);
  assert.equal(junJisha.brand, 'MCTオイル');
  assert.equal(julTV.sales, 1500);
  assert.equal(julTV.brand, 'MCTオイル');
  assert.equal(records.length, 4); // MCTオイル/TV/通常/06, MSMクリーム/TV/通常/06, MCTオイル/自社/定期/06, MCTオイル/TV/通常/07
});

test('parseBaseWorkbook throws a clear error when 詳細明細 sheet is missing', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['x']]), 'Sheet1');
  assert.throws(() => parseBaseWorkbook(wb), /詳細明細/);
});

test('parseBaseWorkbook throws a clear error when required columns (including brand) are missing', () => {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([['月', '販売区分']]);
  XLSX.utils.book_append_sheet(wb, ws, '詳細明細');
  assert.throws(() => parseBaseWorkbook(wb), /よい日々/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — the new/changed assertions (brand-split records, `records.length === 4`, the missing-brand-column error mentioning `よい日々`) don't match the current implementation, which merges everything within month/channel/type regardless of brand.

- [ ] **Step 3: Write minimal implementation**

In `dashboard/js/parsers.js`, replace the `parseBaseWorkbook` function (currently lines 29-69) with:

```js
  function parseBaseWorkbook(workbook) {
    const rows = sheetToRows(workbook, '詳細明細');
    if (!rows) {
      throw new Error('シート「詳細明細」が見つかりません。1期実績ファイルを確認してください。');
    }
    const required = ['月', '販売区分', 'よい日々', '定期/通常', '売上', '仕入額', '粗利'];
    const headerIdx = findHeaderRowIndex(rows, required);
    if (headerIdx === -1) {
      throw new Error('詳細明細シートに必要な列（月・販売区分・よい日々・定期/通常・売上・仕入額・粗利）が見つかりません。');
    }
    const header = rows[headerIdx].map(v => (v == null ? '' : String(v).trim()));
    const col = name => header.indexOf(name);
    const idx = {
      month: col('月'),
      channel: col('販売区分'),
      brand: col('よい日々'),
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
      const brandCell = row[idx.brand];
      const brand = (brandCell == null || String(brandCell).trim() === '') ? null : String(brandCell).trim();
      const key = `${yearMonth}|${channel}|${type}|${brand}`;
      if (!agg.has(key)) {
        agg.set(key, { yearMonth: String(yearMonth), channel: String(channel), type: String(type), brand, sales: 0, cost: 0, profit: 0 });
      }
      const rec = agg.get(key);
      rec.sales += Number(row[idx.sales]) || 0;
      rec.cost += Number(row[idx.cost]) || 0;
      rec.profit += Number(row[idx.profit]) || 0;
    }
    return Array.from(agg.values());
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: all tests in `parsers.base.test.js` PASS, full suite still green.

- [ ] **Step 5: Commit**

```powershell
git add js/parsers.js tests/parsers.base.test.js
git commit -m "feat: keep brand through parseBaseWorkbook"
```

---

### Task 2: `parseBrandLookup` + `detectFileType('brandLookup')`

**Files:**
- Modify: `dashboard/js/parsers.js` (add `parseBrandLookup`; modify `detectFileType`)
- Create: `dashboard/tests/parsers.brandLookup.test.js`
- Modify: `dashboard/tests/filetype.test.js`

**Interfaces:**
- Consumes: `findHeaderRowIndex`, `sheetToRows` (existing, same file).
- Produces: `parseBrandLookup(workbook)` → `{ [商品コード]: ブランド名 }` (plain object). `detectFileType` gains a `'brandLookup'` return value. Consumed by `main.js` (Task 7) and Task 3 (as the `productBrandMapping` shape `parseMonthlyWorkbook`/`parseDailyCsv` expect).

`分解詳細リスト.xlsx` has a single, generically-named sheet (`Sheet1` in the real file — no fixed sheet name to target like `詳細明細`/`売上明細_提出`), header on row 1 (no title rows): `商品コード, 商品名, 商品細分, 定期/単品, 修正`. `商品細分` is the brand name (e.g. `MCTオイル`, `MSMパウダー`).

- [ ] **Step 1: Write the failing test**

`dashboard/tests/parsers.brandLookup.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const { parseBrandLookup, detectFileType } = require('../js/parsers.js');

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
  assert.equal(mapping['FH0002020202000ｔ'], 'MCTオイル');
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `parseBrandLookup is not a function`, and the `detectFileType` assertions return `'unknown'` instead of `'brandLookup'`.

- [ ] **Step 3: Write minimal implementation**

Add to the factory body in `dashboard/js/parsers.js` (before the final `return`):

```js
  function normalizeProductCode(value) {
    return (value == null ? '' : String(value).trim().toUpperCase());
  }

  function parseBrandLookup(workbook) {
    const sheetName = workbook.SheetNames[0];
    const rows = sheetToRows(workbook, sheetName);
    if (!rows) {
      throw new Error('商品コード→ブランド対応表のシートが読み込めません。');
    }
    const required = ['商品コード', '商品細分'];
    const headerIdx = findHeaderRowIndex(rows, required);
    if (headerIdx === -1) {
      throw new Error('分解詳細リストに必要な列（商品コード・商品細分）が見つかりません。');
    }
    const header = rows[headerIdx].map(v => (v == null ? '' : String(v).trim()));
    const col = name => header.indexOf(name);
    const idx = { productCode: col('商品コード'), brand: col('商品細分') };

    const mapping = {};
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      const code = normalizeProductCode(row[idx.productCode]);
      const brand = row[idx.brand];
      if (code === '') continue;
      if (brand == null || String(brand).trim() === '') continue;
      mapping[code] = String(brand).trim();
    }
    return mapping;
  }
```

**Important:** `mapping` keys are normalized via `normalizeProductCode` (trimmed, upper-cased) — this is required so that a product code appearing as `fh0002020202000` in one file and `FH0002020202000` in another (real files are not always consistent about this) still matches. Task 3's `parseMonthlyWorkbook`/`parseDailyCsv` must look up using the same normalization, not the raw cell value, or lookups will silently miss on case differences.

Update `detectFileType` (currently lines 252-259) to add the new branch as the first check:

```js
  function detectFileType(fileName, sheetNames) {
    const name = fileName || '';
    const sheets = sheetNames || [];
    if (/^分解詳細リスト/.test(name)) return 'brandLookup';
    if (/^粗利分析_よい日々1期/.test(name) || sheets.includes('詳細明細')) return 'base';
    if (/^商品別収益/.test(name) || sheets.includes('売上明細_提出')) return 'monthly';
    if (/\.csv$/i.test(name) || /^受注_売上一覧表/.test(name)) return 'daily';
    return 'unknown';
  }
```

Update the final `return` statement to add `parseBrandLookup`:
```js
  return { findHeaderRowIndex, parseBaseWorkbook, parseShippingDate, parseMonthlyWorkbook, parseCsv, parseDailyCsv, detectFileType, isYoiHibiProductCode, parseBrandLookup };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: all tests in `parsers.brandLookup.test.js` and `filetype.test.js` PASS, full suite still green.

- [ ] **Step 5: Commit**

```powershell
git add js/parsers.js tests/parsers.brandLookup.test.js tests/filetype.test.js
git commit -m "feat: parse 商品コード->ブランド lookup table and detect its file type"
```

---

### Task 3: Attach `brand` to monthly/daily records via the lookup

**Files:**
- Modify: `dashboard/js/parsers.js` (functions `parseMonthlyWorkbook`, `parseDailyCsv`)
- Modify: `dashboard/tests/parsers.monthly.test.js`
- Modify: `dashboard/tests/parsers.daily.test.js`

**Interfaces:**
- Consumes: nothing new from other files (works on the plain `{code: brand}` object Task 2 produces, doesn't call `parseBrandLookup` directly).
- Produces: `parseMonthlyWorkbook(workbook, mediaMapping, productBrandMapping)` and `parseDailyCsv(csvText, mediaMapping, productBrandMapping)` — third parameter is optional (defaults to `{}` if omitted, so existing callers with 2 args keep working). Both now return `{ records, unmappedMedia, unmappedProducts }` where `unmappedProducts` has the same shape as `unmappedMedia` (`{ [商品コード]: { count, sales } }`), and each record gains a `brand` field (`"未分類"` when the product code isn't in the mapping). Consumed by `main.js` (Task 7) and Task 5/6 (`getBrandTable`, `renderProductBrandWarningsHTML`).

- [ ] **Step 1: Write the failing test**

Replace the `buildMonthlyWorkbook`/test block in `dashboard/tests/parsers.monthly.test.js` (everything from `function buildMonthlyWorkbook()` to the end of the file) with:

```js
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
```

Note: this file's imports at the top (`const { parseShippingDate, parseMonthlyWorkbook, isYoiHibiProductCode } = require('../js/parsers.js');`) and the `isYoiHibiProductCode`/`parseShippingDate` tests above `buildMonthlyWorkbook` are unchanged — only replace from `function buildMonthlyWorkbook()` onward.

Now do the equivalent for `dashboard/tests/parsers.daily.test.js` — replace from `function buildDailyCsv()` onward with:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — records lack a `brand` field, `unmappedProducts` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `dashboard/js/parsers.js`, replace `parseMonthlyWorkbook` (currently the function starting at `function parseMonthlyWorkbook(workbook, mediaMapping) {`) with:

```js
  function parseMonthlyWorkbook(workbook, mediaMapping, productBrandMapping) {
    const rows = sheetToRows(workbook, '売上明細_提出');
    if (!rows) {
      throw new Error('シート「売上明細_提出」が見つかりません。月次実績ファイルを確認してください。');
    }
    const required = ['出荷日', '媒体名', '販売区分', '商品コード', '金額合計'];
    const headerIdx = findHeaderRowIndex(rows, required);
    if (headerIdx === -1) {
      throw new Error('売上明細_提出シートに必要な列（出荷日・媒体名・販売区分・商品コード・金額合計）が見つかりません。');
    }
    const header = rows[headerIdx].map(v => (v == null ? '' : String(v).trim()));
    const col = name => header.indexOf(name);
    const idx = {
      shipDate: col('出荷日'), media: col('媒体名'), type: col('販売区分'), productCode: col('商品コード'),
      sales: col('金額合計'), cost: col('仕入金額'), profit: col('粗利額'),
    };

    const mapping = mappingLib;
    const brandMap = productBrandMapping || {};
    const agg = new Map();
    const unmappedMedia = {};
    const unmappedProducts = {};

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      if (!isYoiHibiProductCode(row[idx.productCode])) continue;

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

      const productCode = normalizeProductCode(row[idx.productCode]);
      const hasBrand = Object.prototype.hasOwnProperty.call(brandMap, productCode);
      const brand = hasBrand ? brandMap[productCode] : '未分類';
      if (!hasBrand) {
        if (!unmappedProducts[productCode]) unmappedProducts[productCode] = { count: 0, sales: 0 };
        unmappedProducts[productCode].count += 1;
        unmappedProducts[productCode].sales += sales;
      }

      const key = `${parsedDate.yearMonth}|${mapped.channel}|${type}|${brand}`;
      if (!agg.has(key)) {
        agg.set(key, { yearMonth: parsedDate.yearMonth, channel: mapped.channel, type: String(type), brand, sales: 0, cost: 0, profit: 0 });
      }
      const rec = agg.get(key);
      rec.sales += sales;
      rec.cost += cost;
      rec.profit += profit;
    }

    return { records: Array.from(agg.values()), unmappedMedia, unmappedProducts };
  }
```

Note: `productCode` here uses the same `normalizeProductCode` helper Task 2 added (trim + upper-case) — matching `parseBrandLookup`'s stored keys exactly, so a lowercase code in the order data (like the `fh0002020202000` row in this task's test fixture) still matches an upper-case key in the mapping (like `FH0002020202000`). This is also why `unmappedProducts` is keyed by the normalized code, not the raw cell value.

Replace `parseDailyCsv` (currently the function starting at `function parseDailyCsv(csvText, mediaMapping) {`) with:

```js
  function parseDailyCsv(csvText, mediaMapping, productBrandMapping) {
    const rows = parseCsv(csvText);
    const required = ['出荷日', '媒体名', '販売区分', '商品コード'];
    const headerIdx = findHeaderRowIndex(rows, required);
    if (headerIdx === -1) {
      throw new Error('CSVに必要な列（出荷日・媒体名・販売区分・商品コード）が見つかりません。');
    }
    const header = rows[headerIdx].map(v => (v == null ? '' : String(v).trim()));
    const col = name => header.indexOf(name);
    const idx = {
      shipDate: col('出荷日'), media: col('媒体名'), type: col('販売区分'), productCode: col('商品コード'),
      sales: col('金額'), cost: col('仕入金額'), profit: col('粗利額'),
    };

    const mapping = mappingLib;
    const brandMap = productBrandMapping || {};
    const agg = new Map();
    const unmappedMedia = {};
    const unmappedProducts = {};

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      if (!isYoiHibiProductCode(row[idx.productCode])) continue;

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

      const productCode = normalizeProductCode(row[idx.productCode]);
      const hasBrand = Object.prototype.hasOwnProperty.call(brandMap, productCode);
      const brand = hasBrand ? brandMap[productCode] : '未分類';
      if (!hasBrand) {
        if (!unmappedProducts[productCode]) unmappedProducts[productCode] = { count: 0, sales: 0 };
        unmappedProducts[productCode].count += 1;
        unmappedProducts[productCode].sales += sales;
      }

      const key = `${parsedDate.date}|${mapped.channel}|${type}|${brand}`;
      if (!agg.has(key)) {
        agg.set(key, { yearMonth: parsedDate.yearMonth, date: parsedDate.date, channel: mapped.channel, type: String(type), brand, sales: 0, cost: 0, profit: 0 });
      }
      const rec = agg.get(key);
      rec.sales += sales;
      rec.cost += cost;
      rec.profit += profit;
    }

    return { records: Array.from(agg.values()), unmappedMedia, unmappedProducts };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: all tests in `parsers.monthly.test.js` and `parsers.daily.test.js` PASS, full suite still green.

- [ ] **Step 5: Commit**

```powershell
git add js/parsers.js tests/parsers.monthly.test.js tests/parsers.daily.test.js
git commit -m "feat: attach brand to monthly/daily records via product-code lookup"
```

---

### Task 4: `productBrandMapping` in the store

**Files:**
- Modify: `dashboard/js/store.js`
- Modify: `dashboard/tests/store.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `state.productBrandMapping` (object, defaults to `{}`); `store.setProductBrandMapping(mapping)` (mirrors `setMediaMapping`). Consumed by `main.js` (Task 7, reads `store.getState().productBrandMapping` to pass into the parsers, and calls `setProductBrandMapping` from the brandLookup import branch and the brand-assignment form).

- [ ] **Step 1: Write the failing test**

In `dashboard/tests/store.test.js`, update the first test and add one new test. Replace:

```js
test('getState returns empty structure when nothing stored', () => {
  const store = createStore(fakeBackend());
  const state = store.getState();
  assert.deepEqual(state, { baseRecords: [], monthlyRecords: [], dailyRecords: [], targets: [], mediaMapping: {} });
});
```

with:

```js
test('getState returns empty structure when nothing stored', () => {
  const store = createStore(fakeBackend());
  const state = store.getState();
  assert.deepEqual(state, { baseRecords: [], monthlyRecords: [], dailyRecords: [], targets: [], mediaMapping: {}, productBrandMapping: {} });
});
```

Replace the `'setTargets and setMediaMapping replace their sections'` test with:

```js
test('setTargets, setMediaMapping, and setProductBrandMapping replace their sections', () => {
  const store = createStore(fakeBackend());
  store.setTargets([{ yearMonth: '2026-06', salesTarget: 1000000, profitTarget: 400000 }]);
  store.setMediaMapping({ '新媒体': 'TV' });
  store.setProductBrandMapping({ 'FH0009999999999': 'MCTオイル' });
  const state = store.getState();
  assert.equal(state.targets[0].salesTarget, 1000000);
  assert.equal(state.mediaMapping['新媒体'], 'TV');
  assert.equal(state.productBrandMapping['FH0009999999999'], 'MCTオイル');
});
```

(The `exportJSON`/`importJSON` round-trip test and the `clearAll` test need no changes — they already compare whole-state objects generically, so they automatically cover the new field once `emptyState()` includes it.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `deepEqual` mismatch (missing `productBrandMapping` key), `store.setProductBrandMapping is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `dashboard/js/store.js`, replace `emptyState`:

```js
  function emptyState() {
    return { baseRecords: [], monthlyRecords: [], dailyRecords: [], targets: [], mediaMapping: {}, productBrandMapping: {} };
  }
```

Add `setProductBrandMapping` to the returned object from `createStore` (alongside `setMediaMapping`):

```js
      setMediaMapping(mapping) { const s = load(); s.mediaMapping = mapping; save(s); return s; },
      setProductBrandMapping(mapping) { const s = load(); s.productBrandMapping = mapping; save(s); return s; },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: all tests in `store.test.js` PASS, full suite still green.

- [ ] **Step 5: Commit**

```powershell
git add js/store.js tests/store.test.js
git commit -m "feat: add productBrandMapping to the store"
```

---

### Task 5: `getBrandTable` aggregate function

**Files:**
- Modify: `dashboard/js/aggregate.js`
- Modify: `dashboard/tests/aggregate.test.js`

**Interfaces:**
- Consumes: `shiftYearMonth`, `sumRecords`, `filterRecords`, `profitRate`, `pctChange` (same file, existing).
- Produces: `getBrandTable(state, yearMonth)` → `Array<{ brand, sales, profit, profitRate, salesYoY }>`, sorted by descending `sales`, containing only brands present in `state.monthlyRecords` for `yearMonth` (empty array if none — e.g. a month imported before this feature shipped, whose records have no `brand` field). Consumed by `main.js`/`ui.js` (Task 6/7).

- [ ] **Step 1: Write the failing test**

Add to `dashboard/tests/aggregate.test.js`: first, update the import line and `sampleState()` to include brand-bearing records, then add a new test.

Replace the import line:
```js
const {
  shiftYearMonth, sumRecords, filterRecords, profitRate, pctChange, daysInMonth,
  getMonthlyComparison, getChannelTable, getDailyCumulativeSeries, getMonthlyTrend,
} = require('../js/aggregate.js');
```
with:
```js
const {
  shiftYearMonth, sumRecords, filterRecords, profitRate, pctChange, daysInMonth,
  getMonthlyComparison, getChannelTable, getDailyCumulativeSeries, getMonthlyTrend, getBrandTable,
} = require('../js/aggregate.js');
```

Replace `sampleState()` with a version that adds `brand` to every record (existing tests filter/assert on `channel`/`yearMonth` only, so adding a `brand` field doesn't change any of their behavior — `filterRecords` only checks keys present in the filter object):

```js
function sampleState() {
  return {
    baseRecords: [
      { yearMonth: '2025-06', channel: 'TV', type: '通常', brand: 'MCTオイル', sales: 1000, cost: 400, profit: 600 },
      { yearMonth: '2025-06', channel: '自社', type: '定期', brand: 'MSMパウダー', sales: 2000, cost: 800, profit: 1200 },
    ],
    monthlyRecords: [
      { yearMonth: '2026-06', channel: 'TV', type: '通常', brand: 'MCTオイル', sales: 1200, cost: 480, profit: 720 },
      { yearMonth: '2026-06', channel: '自社', type: '定期', brand: 'MSMパウダー', sales: 1800, cost: 720, profit: 1080 },
    ],
    dailyRecords: [
      { yearMonth: '2026-06', date: '2026-06-01', channel: 'TV', type: '通常', brand: 'MCTオイル', sales: 100, cost: 40, profit: 60 },
      { yearMonth: '2026-06', date: '2026-06-02', channel: 'TV', type: '通常', brand: 'MCTオイル', sales: 200, cost: 80, profit: 120 },
    ],
    targets: [{ yearMonth: '2026-06', salesTarget: 3000, profitTarget: 1800 }],
    mediaMapping: {},
    productBrandMapping: {},
  };
}
```

Add these new tests at the end of the file:

```js
test('getBrandTable returns one row per brand present in the month, sorted by descending sales, with 1期比', () => {
  const table = getBrandTable(sampleState(), '2026-06');
  assert.equal(table.length, 2);
  assert.equal(table[0].brand, 'MSMパウダー'); // 1800 > 1200, so it sorts first
  assert.equal(table[0].sales, 1800);
  assert.equal(table[0].profit, 1080);
  assert.equal(table[0].profitRate, 0.6);
  assert.equal(table[0].salesYoY, -0.1); // (1800-2000)/2000
  assert.equal(table[1].brand, 'MCTオイル');
  assert.equal(table[1].sales, 1200);
  assert.equal(table[1].salesYoY, 0.2); // (1200-1000)/1000
});

test('getBrandTable returns an empty array when the month has no brand-bearing records', () => {
  const state = sampleState();
  state.monthlyRecords = state.monthlyRecords.map(r => { const { brand, ...rest } = r; return rest; }); // simulate pre-feature records
  const table = getBrandTable(state, '2026-06');
  assert.deepEqual(table, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `getBrandTable is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to the factory body in `dashboard/js/aggregate.js` (after `getChannelTable`, before `getDailyCumulativeSeries`):

```js
  function getBrandTable(state, yearMonth) {
    const baseMonth = shiftYearMonth(yearMonth, -1);
    const current = filterRecords(state.monthlyRecords, { yearMonth });
    const brands = Array.from(new Set(current.filter(r => r.brand != null).map(r => r.brand)));
    const rows = brands.map(brand => {
      const cur = sumRecords(filterRecords(state.monthlyRecords, { yearMonth, brand }));
      const base = sumRecords(filterRecords(state.baseRecords, { yearMonth: baseMonth, brand }));
      return {
        brand,
        sales: cur.sales,
        profit: cur.profit,
        profitRate: profitRate(cur),
        salesYoY: pctChange(cur.sales, base.sales),
      };
    });
    rows.sort((a, b) => b.sales - a.sales);
    return rows;
  }
```

Update the final `return` statement to add `getBrandTable`:
```js
  return {
    CHANNELS, shiftYearMonth, sumRecords, filterRecords, profitRate, pctChange, daysInMonth,
    getMonthlyComparison, getChannelTable, getBrandTable, getDailyCumulativeSeries, getMonthlyTrend,
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: all tests in `aggregate.test.js` PASS, full suite still green.

- [ ] **Step 5: Commit**

```powershell
git add js/aggregate.js tests/aggregate.test.js
git commit -m "feat: add getBrandTable aggregation"
```

---

### Task 6: Brand table + brand-assignment warning renderers

**Files:**
- Modify: `dashboard/js/ui.js`
- Modify: `dashboard/tests/ui.test.js`

**Interfaces:**
- Consumes: `formatYen`, `formatPct` (same file, existing). Shapes produced by `getBrandTable` (Task 5) and `unmappedProducts` (Task 3).
- Produces: `renderBrandTableHTML(rows)` (empty-state message when `rows.length === 0`), `renderProductBrandWarningsHTML(unmappedProducts)` (returns `''` when there's nothing unmapped; otherwise a `<form id="brandAssignForm">` with one text input per unmapped product code, `data-product-code="<code>"`, plus a submit button). Consumed by `main.js` (Task 7).

- [ ] **Step 1: Write the failing test**

Add to `dashboard/tests/ui.test.js`: update the import line, then append new tests.

Replace:
```js
const { formatYen, formatPct, renderKpiCardsHTML, renderChannelTableHTML, renderMappingWarningsHTML } = require('../js/ui.js');
```
with:
```js
const { formatYen, formatPct, renderKpiCardsHTML, renderChannelTableHTML, renderMappingWarningsHTML, renderBrandTableHTML, renderProductBrandWarningsHTML } = require('../js/ui.js');
```

Append:
```js
test('renderBrandTableHTML emits one row per brand with sales/profit/profitRate/salesYoY', () => {
  const html = renderBrandTableHTML([
    { brand: 'MCTオイル', sales: 1000, profit: 400, profitRate: 0.4, salesYoY: 0.2 },
    { brand: 'MSMパウダー', sales: 500, profit: 200, profitRate: 0.4, salesYoY: null },
  ]);
  assert.match(html, /<table/);
  assert.match(html, /MCTオイル/);
  assert.match(html, /MSMパウダー/);
  assert.match(html, /N\/A/);
});

test('renderBrandTableHTML shows an empty-state message instead of a table when there are no brand rows', () => {
  const html = renderBrandTableHTML([]);
  assert.doesNotMatch(html, /<table/);
  assert.match(html, /ブランド別データがありません/);
});

test('renderProductBrandWarningsHTML lists unmapped product codes with an assignable input, empty string when none', () => {
  const html = renderProductBrandWarningsHTML({ 'FH0009999999999': { count: 3, sales: 4500 } });
  assert.match(html, /FH0009999999999/);
  assert.match(html, /data-product-code="FH0009999999999"/);
  assert.match(html, /<form id="brandAssignForm"/);
  assert.equal(renderProductBrandWarningsHTML({}), '');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `renderBrandTableHTML is not a function`, `renderProductBrandWarningsHTML is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to the factory body in `dashboard/js/ui.js` (after `renderMappingWarningsHTML`, before the final `return`):

```js
  function renderBrandTableHTML(rows) {
    if (!rows || rows.length === 0) {
      return '<p class="brand-table-empty">この月はブランド別データがありません（分解詳細リストを取込むとブランド別に表示されます）。</p>';
    }
    const body = rows.map(r => `
      <tr>
        <td>${r.brand}</td>
        <td>${formatYen(r.sales)}</td>
        <td>${formatYen(r.profit)}</td>
        <td>${formatPct(r.profitRate)}</td>
        <td>${formatPct(r.salesYoY)}</td>
      </tr>`).join('');
    return `<table class="brand-table">
      <thead><tr><th>ブランド</th><th>売上</th><th>粗利</th><th>粗利率</th><th>1期比</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
  }

  function renderProductBrandWarningsHTML(unmappedProducts) {
    const codes = Object.keys(unmappedProducts || {});
    if (codes.length === 0) return '';
    const rows = codes.map(code => {
      const info = unmappedProducts[code];
      return `<tr>
        <td>${code}</td>
        <td>${info.count}件, ${formatYen(info.sales)}</td>
        <td><input type="text" data-product-code="${code}" placeholder="ブランド名"></td>
      </tr>`;
    }).join('');
    return `<div class="brand-warning">
      <p>ブランド未分類の商品コードがあります。ブランド名を指定して保存してください（保存後、対象月のファイルを再取込みすると反映されます）:</p>
      <form id="brandAssignForm">
        <table>${rows}</table>
        <button type="submit">割り当てを保存</button>
      </form>
    </div>`;
  }
```

Update the final `return` statement:
```js
  return { formatYen, formatPct, renderKpiCardsHTML, renderChannelTableHTML, renderMappingWarningsHTML, renderBrandTableHTML, renderProductBrandWarningsHTML };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: all tests in `ui.test.js` PASS, full suite still green (this is the last Node-testable module before Task 7 wires everything into the browser).

- [ ] **Step 5: Commit**

```powershell
git add js/ui.js tests/ui.test.js
git commit -m "feat: add brand table and brand-assignment warning renderers"
```

---

### Task 7: Wire brand lookup, brand table, and brand-assignment form into the browser

**Files:**
- Modify: `dashboard/dashboard.html`
- Modify: `dashboard/js/main.js`

**Interfaces:**
- Consumes: `parseBrandLookup`, `parseMonthlyWorkbook`, `parseDailyCsv` (updated 3-arg form), `detectFileType` (Tasks 2-3); `store.setProductBrandMapping` (Task 4); `getBrandTable` (Task 5); `renderBrandTableHTML`, `renderProductBrandWarningsHTML` (Task 6).
- Produces: the runnable end-user feature. No further tasks consume this one — verified manually in Task 8.

This task is not unit-testable with `node:test` (needs `FileReader`/DOM). Verified in Task 8 with Playwright against the user's real `分解詳細リスト.xlsx`.

- [ ] **Step 1: Update `dashboard/dashboard.html`**

Change the dropzone hint text (currently `ここに1期実績xlsx／月次実績xlsx／日次売上csvをドラッグ&ドロップ、または`) to:
```html
  ここに1期実績xlsx／月次実績xlsx／日次売上csv／商品コード→ブランド対応表xlsxをドラッグ&ドロップ、または
```

Add a brand-warning container next to the existing one, and a brand table container after `channelTable`. Replace:
```html
<p id="status"></p>
<div id="warnings"></div>
```
with:
```html
<p id="status"></p>
<div id="warnings"></div>
<div id="brandWarnings"></div>
```

Replace:
```html
<div id="channelTable"></div>
```
with:
```html
<div id="channelTable"></div>
<h2>ブランド別</h2>
<div id="brandTable"></div>
```

- [ ] **Step 2: Update `dashboard/js/main.js`**

Update the destructuring block at the top of the IIFE. Replace:
```js
  const { mapMediaToChannel } = window.YoiHibi;
  const { parseBaseWorkbook, parseMonthlyWorkbook, parseDailyCsv, detectFileType } = window.YoiHibi;
  const { createStore } = window.YoiHibi;
  const { getMonthlyComparison, getChannelTable, getDailyCumulativeSeries, getMonthlyTrend } = window.YoiHibi;
  const { renderKpiCardsHTML, renderChannelTableHTML, renderMappingWarningsHTML } = window.YoiHibi;
```
with:
```js
  const { parseBaseWorkbook, parseMonthlyWorkbook, parseDailyCsv, parseBrandLookup, detectFileType } = window.YoiHibi;
  const { createStore } = window.YoiHibi;
  const { getMonthlyComparison, getChannelTable, getBrandTable, getDailyCumulativeSeries, getMonthlyTrend } = window.YoiHibi;
  const { renderKpiCardsHTML, renderChannelTableHTML, renderMappingWarningsHTML, renderBrandTableHTML, renderProductBrandWarningsHTML } = window.YoiHibi;
```
(`mapMediaToChannel` is dropped — it was already unused in `main.js`, flagged as a Minor finding in Task 10's review; this is a good moment to clean it up since the destructuring block is being touched anyway.)

Update `handleFile` — replace the whole function:
```js
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
      } else if (type === 'brandLookup') {
        const mapping = parseBrandLookup(workbook);
        store.setProductBrandMapping(mapping);
        showStatus(`商品コード→ブランド対応表を取込みました（${Object.keys(mapping).length}件）`);
      } else if (type === 'monthly') {
        const { records, unmappedMedia, unmappedProducts } = parseMonthlyWorkbook(workbook, store.getState().mediaMapping, store.getState().productBrandMapping);
        const months = Array.from(new Set(records.map(r => r.yearMonth)));
        months.forEach(ym => store.upsertMonthlyRecords(ym, records.filter(r => r.yearMonth === ym)));
        showStatus(`月次実績を取込みました（${records.length}件）`);
        showWarnings(unmappedMedia);
        showBrandWarnings(unmappedProducts);
      } else if (type === 'daily') {
        const text = decodeShiftJis(buffer);
        const { records, unmappedMedia, unmappedProducts } = parseDailyCsv(text, store.getState().mediaMapping, store.getState().productBrandMapping);
        const months = Array.from(new Set(records.map(r => r.yearMonth)));
        months.forEach(ym => store.upsertDailyRecords(ym, records.filter(r => r.yearMonth === ym)));
        showStatus(`日次売上を取込みました（${records.length}件）`);
        showWarnings(unmappedMedia);
        showBrandWarnings(unmappedProducts);
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
```

Add `showBrandWarnings` and `setupBrandAssignForm` right after the existing `showWarnings` function:
```js
  function showWarnings(unmappedMedia) {
    el('warnings').innerHTML = renderMappingWarningsHTML(unmappedMedia);
  }

  function showBrandWarnings(unmappedProducts) {
    el('brandWarnings').innerHTML = renderProductBrandWarningsHTML(unmappedProducts);
    setupBrandAssignForm();
  }

  function setupBrandAssignForm() {
    const form = document.getElementById('brandAssignForm');
    if (!form) return;
    form.addEventListener('submit', e => {
      e.preventDefault();
      const inputs = form.querySelectorAll('input[data-product-code]');
      const overrides = {};
      inputs.forEach(input => {
        const value = input.value.trim();
        if (value) overrides[input.getAttribute('data-product-code')] = value;
      });
      if (Object.keys(overrides).length === 0) return;
      const merged = Object.assign({}, store.getState().productBrandMapping, overrides);
      store.setProductBrandMapping(merged);
      showStatus('ブランドの割り当てを保存しました。対象月の月次実績／日次売上ファイルを再取込みすると反映されます。');
      el('brandWarnings').innerHTML = '';
    });
  }
```

Update `renderAll` — replace:
```js
  function renderAll() {
    const state = store.getState();
    const yearMonth = el('monthSelect').value;
    if (!yearMonth) return;

    el('kpiRow').innerHTML = renderKpiCardsHTML(getMonthlyComparison(state, yearMonth));
    el('channelTable').innerHTML = renderChannelTableHTML(getChannelTable(state, yearMonth));

    renderTrendChart(getMonthlyTrend(state));
    renderDailyChart(getDailyCumulativeSeries(state, yearMonth));
  }
```
with:
```js
  function renderAll() {
    const state = store.getState();
    const yearMonth = el('monthSelect').value;
    if (!yearMonth) return;

    el('kpiRow').innerHTML = renderKpiCardsHTML(getMonthlyComparison(state, yearMonth));
    el('channelTable').innerHTML = renderChannelTableHTML(getChannelTable(state, yearMonth));
    el('brandTable').innerHTML = renderBrandTableHTML(getBrandTable(state, yearMonth));

    renderTrendChart(getMonthlyTrend(state));
    renderDailyChart(getDailyCumulativeSeries(state, yearMonth));
  }
```

- [ ] **Step 3: Sanity-check the browser-only files for obvious mistakes**

Run (from `dashboard/`):
```powershell
node -e "const fs=require('fs'); const html=fs.readFileSync('dashboard.html','utf8'); ['brandWarnings','brandTable'].forEach(id => { if (!html.includes('id=\"'+id+'\"')) throw new Error('missing container: '+id); }); console.log('containers OK');"
node -e "const fs=require('fs'); const js=fs.readFileSync('js/main.js','utf8'); ['parseBrandLookup','getBrandTable','renderBrandTableHTML','renderProductBrandWarningsHTML','showBrandWarnings','setupBrandAssignForm'].forEach(name => { if (!js.includes(name)) throw new Error('main.js missing reference: '+name); }); console.log('main.js references OK');"
```
Expected: both print their `OK` line.

- [ ] **Step 4: Run the full Node suite to confirm no regression**

Run: `npm test`
Expected: all 53+ tests still passing (this task touches no Node-testable code, but must not have broken anything else).

- [ ] **Step 5: Commit**

```powershell
git add dashboard.html js/main.js
git commit -m "feat: wire brand lookup import, brand table, and brand-assignment form into the browser"
```

---

### Task 8: Real-data Playwright verification

**Files:** none created — this task drives the browser against the files already on disk.

**Interfaces:** none (end-to-end verification only).

- [ ] **Step 1: Serve the dashboard locally**

PowerShell (from `dashboard/`):
```powershell
Start-Process -FilePath "python" -ArgumentList "-m","http.server","8768" -WindowStyle Hidden
Start-Sleep -Seconds 2
Invoke-WebRequest -Uri "http://localhost:8768/dashboard.html" -UseBasicParsing | Select-Object -ExpandProperty StatusCode
```
Expected: `200`.

- [ ] **Step 2: Open in Playwright and check for console errors**

Navigate to `http://localhost:8768/dashboard.html`, check console messages at `error` level.
Expected: no errors besides the pre-existing, harmless favicon 404.

- [ ] **Step 3: Import the base file, the brand lookup file, and the monthly/daily files together**

Upload (via the file input, in one `browser_file_upload` call so all four import in the same batch):
- `C:\Users\a.ushimaru\Desktop\連携\よい日々媒体商品別\粗利分析_よい日々1期_20260709.xlsx`
- `C:\Users\a.ushimaru\Desktop\連携\よい日々媒体商品別\分解詳細リスト.xlsx`
- `C:\Users\a.ushimaru\Desktop\連携\よい日々媒体商品別\商品別収益202606.xlsx`
- `C:\Users\a.ushimaru\Desktop\連携\よい日々媒体商品別\受注_売上一覧表ライト_202606.csv`

Expected via snapshot: status messages show all four imports succeeding, including "商品コード→ブランド対応表を取込みました（473件）" (or whatever the real row count is).

- [ ] **Step 4: Confirm the channel-level KPI regression check**

Snapshot the KPI cards for month `2026-06`.
Expected: 売上 shows exactly `¥12,144,126` and 粗利 shows exactly `¥8,218,941` — unchanged from the values confirmed before this feature (this is the most important check in this task: brand data must not have altered the channel-level totals).

- [ ] **Step 5: Confirm the brand table and unmapped-product warning**

Snapshot the new "ブランド別" section.
Expected: a table with real brand names (MCTオイル, MSMパウダー, ベルメ, etc.) and plausible sales/profit figures; if any product codes from the real June 2026 monthly file aren't in `分解詳細リスト.xlsx`, a `brandWarnings` banner listing them with input fields — inspect this list and note it in the report (no code change expected, this is just confirming the warning path fires on real data, same as the media-mapping warning already does).

- [ ] **Step 6: Confirm the brand-assignment save flow**

If any unmapped product code appeared in Step 5, fill its input with a plausible brand name and submit the form.
Expected: status message confirms the save; `localStorage`'s `productBrandMapping` (inspect via `browser_evaluate`) contains the new entry.

- [ ] **Step 7: Stop the local server**

```powershell
Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" | Where-Object { $_.CommandLine -like '*http.server*8768*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

- [ ] **Step 8: Report findings**

Write a short summary of what was observed in Steps 4-6 (exact KPI figures, brand table contents, any unmapped codes found and how they were resolved). No commit needed unless a real bug was found and fixed, in which case follow the same fix→re-review→commit pattern used for the two post-ship hotfixes earlier in this project.

---

## Self-Review Notes

- **Spec coverage:** every section of `docs/superpowers/specs/2026-07-10-brand-breakdown-design.md` maps to a task — 1期 brand retention (Task 1), the new lookup file + its file-type detection (Task 2), brand attribution + unmapped-product warning collection for monthly/daily (Task 3), persistent storage (Task 4), the brand table's aggregation (Task 5), its rendering plus the assignment form (Task 6), full browser wiring (Task 7), and real-data verification including the channel-KPI regression check (Task 8).
- **Resolved ambiguity carried forward:** the spec's "1期2期比較.xlsx needs no new parser" insight is reflected directly in Task 1 — no `parseComparisonWorkbook` exists in this plan; `parseBaseWorkbook`'s existing month-regex already ignores `"2期 ..."`-labeled rows.
- **Type/name consistency checked:** `Record` shape (`yearMonth, channel, type, brand, sales, cost, profit`, `+date` for daily) is identical across Tasks 1, 3, 5. `unmappedProducts` shape (`{count, sales}`) matches `unmappedMedia`'s existing shape exactly, as required by the spec. Function names match between definition (Tasks 2/3/5/6) and consumption (Task 7): `parseBrandLookup`, `getBrandTable`, `renderBrandTableHTML`, `renderProductBrandWarningsHTML`, `setProductBrandMapping`.
- **Regression risk called out explicitly:** Task 8 Step 4 re-verifies the exact figures (¥12,144,126 / ¥8,218,941) fixed in the two prior hotfixes, since this is the one place brand-splitting the aggregation key could plausibly (but should not) have changed a total.
