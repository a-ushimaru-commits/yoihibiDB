# 月次推移(ブランド×定期/通常)ピボット表 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a wide, month-by-month pivot table (brand × 定期/通常 column groups) spanning both 1期 and 2期 data, alongside the existing single-month KPI/channel/brand views.

**Architecture:** One new pure aggregation function (`getBrandMonthlyPivot`) that concatenates `baseRecords` and `monthlyRecords` (both already share the same `{yearMonth, channel, type, brand, sales, cost, profit}` shape) into one continuous monthly timeline, grouped by month × type × brand. One new pure HTML renderer (`renderBrandMonthlyPivotHTML`) turns that into a wide, horizontally-scrollable table. Both wire into the existing `main.js`/`dashboard.html` alongside the current channel/brand tables — no new data source, no changes to existing views.

**Tech Stack:** Same as the existing dashboard — vanilla JS, `node:test`.

## Global Constraints

- No new import file type or parser — this feature is built entirely from data already captured by `parseBaseWorkbook`/`parseMonthlyWorkbook`/`parseDailyCsv` (which the dashboard already stores as `state.baseRecords`/`state.monthlyRecords`).
- The pivot spans the union of months present in `baseRecords` and `monthlyRecords`, sorted ascending — this is what makes it a genuine "1期→2期" continuous time series, not just a 2期-only view.
- Records with `brand == null` (blank brand cell in older 1期 data, per `parseBaseWorkbook`) must still count toward the month's whole-company totals but must NOT appear as their own column group or otherwise be included in the `brands` list.
- A brand with no data in a given month must render as zero (`0` sales/profit), not be omitted from that month's row or cause a missing-key error.
- This is purely additive: no existing function's signature, return shape, or rendered output changes. `getChannelTable`, `getBrandTable`, `getMonthlyComparison`, `renderChannelTableHTML`, `renderBrandTableHTML`, etc. are untouched.
- `npm test` must keep running the whole `tests/*.test.js` suite and stay green throughout (currently 74 tests).

---

## File Structure

```
dashboard/
  js/
    aggregate.js   (MODIFY: add getBrandMonthlyPivot)
    ui.js          (MODIFY: add renderBrandMonthlyPivotHTML)
    main.js        (MODIFY: wire the new section into renderAll)
  dashboard.html   (MODIFY: add heading + container for the new section)
  css/
    styles.css     (MODIFY: add table styling + horizontal-scroll container for the wide pivot, and for the previously-unstyled .brand-table/.brand-warning from the last feature)
  tests/
    aggregate.test.js  (MODIFY: add getBrandMonthlyPivot coverage)
    ui.test.js         (MODIFY: add renderBrandMonthlyPivotHTML coverage)
```

---

### Task 1: `getBrandMonthlyPivot` aggregation

**Files:**
- Modify: `dashboard/js/aggregate.js`
- Modify: `dashboard/tests/aggregate.test.js`

**Interfaces:**
- Consumes: `filterRecords`, `sumRecords` (same file, existing).
- Produces: `getBrandMonthlyPivot(state)` → `{ months: string[], brands: string[], rows: Array<{ yearMonth, totalTeikiSales, totalTeikiProfit, totalTsujoSales, totalTsujoProfit, byBrand: { [brand]: { teikiSales, teikiProfit, tsujoSales, tsujoProfit } } }> }`. Consumed by `main.js`/`ui.js` (Task 2/3).

- [ ] **Step 1: Write the failing test**

Add to `dashboard/tests/aggregate.test.js`: update the import line, then append new tests at the end of the file.

Replace:
```js
const {
  shiftYearMonth, sumRecords, filterRecords, profitRate, pctChange, daysInMonth,
  getMonthlyComparison, getChannelTable, getDailyCumulativeSeries, getMonthlyTrend, getBrandTable,
} = require('../js/aggregate.js');
```
with:
```js
const {
  shiftYearMonth, sumRecords, filterRecords, profitRate, pctChange, daysInMonth,
  getMonthlyComparison, getChannelTable, getDailyCumulativeSeries, getMonthlyTrend, getBrandTable,
  getBrandMonthlyPivot,
} = require('../js/aggregate.js');
```

Append at the end of the file:
```js
function pivotSampleState() {
  return {
    baseRecords: [
      { yearMonth: '2025-06', channel: 'TV', type: '定期', brand: 'MCTオイル', sales: 100, cost: 40, profit: 60 },
      { yearMonth: '2025-06', channel: '自社', type: '通常', brand: 'MSMパウダー', sales: 200, cost: 80, profit: 120 },
      { yearMonth: '2025-06', channel: 'TV', type: '通常', brand: null, sales: 50, cost: 20, profit: 30 }, // blank-brand row: counts in totals, not in byBrand
    ],
    monthlyRecords: [
      { yearMonth: '2026-06', channel: 'TV', type: '定期', brand: 'MCTオイル', sales: 300, cost: 120, profit: 180 },
      { yearMonth: '2026-06', channel: '自社', type: '通常', brand: '未分類', sales: 10, cost: 5, profit: 5 }, // "未分類" is a real string brand, unlike null
    ],
    dailyRecords: [],
    targets: [],
    mediaMapping: {},
    productBrandMapping: {},
  };
}

test('getBrandMonthlyPivot spans both 1期 (baseRecords) and 2期 (monthlyRecords) as one continuous month list', () => {
  const pivot = getBrandMonthlyPivot(pivotSampleState());
  assert.deepEqual(pivot.months, ['2025-06', '2026-06']);
});

test('getBrandMonthlyPivot sorts brands by total sales across all months, descending, excluding null-brand rows', () => {
  const pivot = getBrandMonthlyPivot(pivotSampleState());
  // MCTオイル: 100 + 300 = 400 total; MSMパウダー: 200; 未分類: 10 -- and no separate "null" entry
  assert.deepEqual(pivot.brands, ['MCTオイル', 'MSMパウダー', '未分類']);
});

test('getBrandMonthlyPivot totals include blank-brand rows even though they are excluded from byBrand', () => {
  const pivot = getBrandMonthlyPivot(pivotSampleState());
  const june2025 = pivot.rows.find(r => r.yearMonth === '2025-06');
  assert.equal(june2025.totalTeikiSales, 100);
  assert.equal(june2025.totalTeikiProfit, 60);
  assert.equal(june2025.totalTsujoSales, 250); // 200 (MSMパウダー) + 50 (blank brand)
  assert.equal(june2025.totalTsujoProfit, 150); // 120 + 30
});

test('getBrandMonthlyPivot zero-fills a brand with no data in a given month, per-brand split by 定期/通常', () => {
  const pivot = getBrandMonthlyPivot(pivotSampleState());
  const june2025 = pivot.rows.find(r => r.yearMonth === '2025-06');
  assert.deepEqual(june2025.byBrand['MCTオイル'], { teikiSales: 100, teikiProfit: 60, tsujoSales: 0, tsujoProfit: 0 });
  assert.deepEqual(june2025.byBrand['MSMパウダー'], { teikiSales: 0, teikiProfit: 0, tsujoSales: 200, tsujoProfit: 120 });
  assert.deepEqual(june2025.byBrand['未分類'], { teikiSales: 0, teikiProfit: 0, tsujoSales: 0, tsujoProfit: 0 }); // no 2025-06 row for 未分類 at all

  const june2026 = pivot.rows.find(r => r.yearMonth === '2026-06');
  assert.deepEqual(june2026.byBrand['MCTオイル'], { teikiSales: 300, teikiProfit: 180, tsujoSales: 0, tsujoProfit: 0 });
  assert.deepEqual(june2026.byBrand['MSMパウダー'], { teikiSales: 0, teikiProfit: 0, tsujoSales: 0, tsujoProfit: 0 });
  assert.deepEqual(june2026.byBrand['未分類'], { teikiSales: 0, teikiProfit: 0, tsujoSales: 10, tsujoProfit: 5 });
});

test('getBrandMonthlyPivot returns empty months/brands/rows when both record sets are empty', () => {
  const pivot = getBrandMonthlyPivot({ baseRecords: [], monthlyRecords: [] });
  assert.deepEqual(pivot, { months: [], brands: [], rows: [] });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `getBrandMonthlyPivot is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to the factory body in `dashboard/js/aggregate.js` (after `getBrandTable`, before `getDailyCumulativeSeries`):

```js
  function getBrandMonthlyPivot(state) {
    const allRecords = (state.baseRecords || []).concat(state.monthlyRecords || []);
    const months = Array.from(new Set(allRecords.map(r => r.yearMonth))).sort();

    const brandSales = new Map();
    allRecords.forEach(r => {
      if (r.brand == null) return;
      brandSales.set(r.brand, (brandSales.get(r.brand) || 0) + r.sales);
    });
    const brands = Array.from(brandSales.keys()).sort((a, b) => brandSales.get(b) - brandSales.get(a));

    const rows = months.map(yearMonth => {
      const monthRecords = filterRecords(allRecords, { yearMonth });
      const totalTeiki = sumRecords(filterRecords(monthRecords, { type: '定期' }));
      const totalTsujo = sumRecords(filterRecords(monthRecords, { type: '通常' }));

      const byBrand = {};
      brands.forEach(brand => {
        const teiki = sumRecords(filterRecords(monthRecords, { brand, type: '定期' }));
        const tsujo = sumRecords(filterRecords(monthRecords, { brand, type: '通常' }));
        byBrand[brand] = {
          teikiSales: teiki.sales, teikiProfit: teiki.profit,
          tsujoSales: tsujo.sales, tsujoProfit: tsujo.profit,
        };
      });

      return {
        yearMonth,
        totalTeikiSales: totalTeiki.sales, totalTeikiProfit: totalTeiki.profit,
        totalTsujoSales: totalTsujo.sales, totalTsujoProfit: totalTsujo.profit,
        byBrand,
      };
    });

    return { months, brands, rows };
  }
```

Update the final `return` statement to add `getBrandMonthlyPivot`:
```js
  return {
    CHANNELS, shiftYearMonth, sumRecords, filterRecords, profitRate, pctChange, daysInMonth,
    getMonthlyComparison, getChannelTable, getBrandTable, getDailyCumulativeSeries, getMonthlyTrend,
    getBrandMonthlyPivot,
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: all tests in `aggregate.test.js` PASS, full suite still green.

- [ ] **Step 5: Commit**

```powershell
git add js/aggregate.js tests/aggregate.test.js
git commit -m "feat: add getBrandMonthlyPivot spanning 1期+2期 months by brand and 定期/通常"
```

---

### Task 2: `renderBrandMonthlyPivotHTML` renderer

**Files:**
- Modify: `dashboard/js/ui.js`
- Modify: `dashboard/tests/ui.test.js`

**Interfaces:**
- Consumes: `formatYen` (same file, existing). The shape produced by `getBrandMonthlyPivot` (Task 1).
- Produces: `renderBrandMonthlyPivotHTML(pivot)` → HTML string. Empty-state message when `pivot.brands.length === 0`. Consumed by `main.js` (Task 3).

- [ ] **Step 1: Write the failing test**

Add to `dashboard/tests/ui.test.js`: update the import line, then append new tests.

Replace:
```js
const { formatYen, formatPct, renderKpiCardsHTML, renderChannelTableHTML, renderMappingWarningsHTML, renderBrandTableHTML, renderProductBrandWarningsHTML } = require('../js/ui.js');
```
with:
```js
const { formatYen, formatPct, renderKpiCardsHTML, renderChannelTableHTML, renderMappingWarningsHTML, renderBrandTableHTML, renderProductBrandWarningsHTML, renderBrandMonthlyPivotHTML } = require('../js/ui.js');
```

Append at the end of the file:
```js
test('renderBrandMonthlyPivotHTML renders a wide pivot table with month rows and brand column groups', () => {
  const pivot = {
    months: ['2025-06', '2026-06'],
    brands: ['MCTオイル', 'MSMパウダー'],
    rows: [
      {
        yearMonth: '2025-06',
        totalTeikiSales: 100, totalTeikiProfit: 60, totalTsujoSales: 250, totalTsujoProfit: 150,
        byBrand: {
          'MCTオイル': { teikiSales: 100, teikiProfit: 60, tsujoSales: 0, tsujoProfit: 0 },
          'MSMパウダー': { teikiSales: 0, teikiProfit: 0, tsujoSales: 200, tsujoProfit: 120 },
        },
      },
      {
        yearMonth: '2026-06',
        totalTeikiSales: 300, totalTeikiProfit: 180, totalTsujoSales: 10, totalTsujoProfit: 5,
        byBrand: {
          'MCTオイル': { teikiSales: 300, teikiProfit: 180, tsujoSales: 0, tsujoProfit: 0 },
          'MSMパウダー': { teikiSales: 0, teikiProfit: 0, tsujoSales: 0, tsujoProfit: 0 },
        },
      },
    ],
  };
  const html = renderBrandMonthlyPivotHTML(pivot);
  assert.match(html, /<table class="brand-pivot-table">/);
  assert.match(html, /2025-06/);
  assert.match(html, /2026-06/);
  assert.match(html, /<th colspan="4">MCTオイル<\/th>/);
  assert.match(html, /<th colspan="4">MSMパウダー<\/th>/);
  assert.match(html, /¥100/);
  assert.match(html, /¥300/);
});

test('renderBrandMonthlyPivotHTML shows an empty-state message when there are no brands yet', () => {
  const html = renderBrandMonthlyPivotHTML({ months: [], brands: [], rows: [] });
  assert.doesNotMatch(html, /<table/);
  assert.match(html, /表示できるデータがありません/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `renderBrandMonthlyPivotHTML is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to the factory body in `dashboard/js/ui.js` (after `renderProductBrandWarningsHTML`, before the final `return`):

```js
  function renderBrandMonthlyPivotHTML(pivot) {
    if (!pivot || !pivot.brands || pivot.brands.length === 0) {
      return '<p class="brand-pivot-empty">表示できるデータがありません（月次実績とブランド対応表を取込むと表示されます）。</p>';
    }
    const brandHeaderCells = pivot.brands.map(b => `<th colspan="4">${b}</th>`).join('');
    const brandSubHeaderCells = pivot.brands
      .map(() => '<th>定期売上</th><th>定期粗利</th><th>通常売上</th><th>通常粗利</th>')
      .join('');
    const bodyRows = pivot.rows.map(row => {
      const brandCells = pivot.brands.map(b => {
        const cell = row.byBrand[b];
        return `<td>${formatYen(cell.teikiSales)}</td><td>${formatYen(cell.teikiProfit)}</td><td>${formatYen(cell.tsujoSales)}</td><td>${formatYen(cell.tsujoProfit)}</td>`;
      }).join('');
      return `<tr>
        <td>${row.yearMonth}</td>
        <td>${formatYen(row.totalTeikiSales)}</td><td>${formatYen(row.totalTeikiProfit)}</td>
        <td>${formatYen(row.totalTsujoSales)}</td><td>${formatYen(row.totalTsujoProfit)}</td>
        ${brandCells}
      </tr>`;
    }).join('');

    return `<div class="brand-pivot-scroll">
      <table class="brand-pivot-table">
        <thead>
          <tr><th rowspan="2">月</th><th colspan="4">全体</th>${brandHeaderCells}</tr>
          <tr><th>定期売上</th><th>定期粗利</th><th>通常売上</th><th>通常粗利</th>${brandSubHeaderCells}</tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>`;
  }
```

Update the final `return` statement:
```js
  return { formatYen, formatPct, renderKpiCardsHTML, renderChannelTableHTML, renderMappingWarningsHTML, renderBrandTableHTML, renderProductBrandWarningsHTML, renderBrandMonthlyPivotHTML };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: all tests in `ui.test.js` PASS, full suite still green (last Node-testable module before Task 3 wires into the browser).

- [ ] **Step 5: Commit**

```powershell
git add js/ui.js tests/ui.test.js
git commit -m "feat: add wide month x brand x 定期/通常 pivot table renderer"
```

---

### Task 3: Wire the pivot into the browser + real-data verification

**Files:**
- Modify: `dashboard/dashboard.html`
- Modify: `dashboard/js/main.js`
- Modify: `dashboard/css/styles.css`

**Interfaces:**
- Consumes: `getBrandMonthlyPivot` (Task 1), `renderBrandMonthlyPivotHTML` (Task 2).
- Produces: the runnable end-user feature. No further tasks consume this one.

This task is not unit-testable with `node:test` (browser-only wiring). Verified with Playwright against the real files already used throughout this project (`粗利分析_よい日々1期_20260709.xlsx`, `分解詳細リスト.xlsx`, `商品別収益202606.xlsx`, `受注_売上一覧表ライト_202606.csv`).

- [ ] **Step 1: Add the section container to `dashboard/dashboard.html`**

Find:
```html
<h2>ブランド別</h2>
<div id="brandTable"></div>
```
Replace with:
```html
<h2>ブランド別</h2>
<div id="brandTable"></div>

<h2>月次推移（ブランド×定期/通常）</h2>
<div id="brandMonthlyPivot"></div>
```

- [ ] **Step 2: Wire it in `dashboard/js/main.js`**

Update the destructuring line that currently reads:
```js
  const { getMonthlyComparison, getChannelTable, getBrandTable, getDailyCumulativeSeries, getMonthlyTrend } = window.YoiHibi;
```
to:
```js
  const { getMonthlyComparison, getChannelTable, getBrandTable, getDailyCumulativeSeries, getMonthlyTrend, getBrandMonthlyPivot } = window.YoiHibi;
```

Update the destructuring line that currently reads:
```js
  const { renderKpiCardsHTML, renderChannelTableHTML, renderMappingWarningsHTML, renderBrandTableHTML, renderProductBrandWarningsHTML } = window.YoiHibi;
```
to:
```js
  const { renderKpiCardsHTML, renderChannelTableHTML, renderMappingWarningsHTML, renderBrandTableHTML, renderProductBrandWarningsHTML, renderBrandMonthlyPivotHTML } = window.YoiHibi;
```

In `renderAll`, add the new section. Find:
```js
    el('kpiRow').innerHTML = renderKpiCardsHTML(getMonthlyComparison(state, yearMonth));
    el('channelTable').innerHTML = renderChannelTableHTML(getChannelTable(state, yearMonth));
    el('brandTable').innerHTML = renderBrandTableHTML(getBrandTable(state, yearMonth));

    renderTrendChart(getMonthlyTrend(state));
```
Replace with:
```js
    el('kpiRow').innerHTML = renderKpiCardsHTML(getMonthlyComparison(state, yearMonth));
    el('channelTable').innerHTML = renderChannelTableHTML(getChannelTable(state, yearMonth));
    el('brandTable').innerHTML = renderBrandTableHTML(getBrandTable(state, yearMonth));
    el('brandMonthlyPivot').innerHTML = renderBrandMonthlyPivotHTML(getBrandMonthlyPivot(state));

    renderTrendChart(getMonthlyTrend(state));
```

(`getBrandMonthlyPivot(state)` takes no `yearMonth` — it always covers every month present in the data, unlike the other renders in this function which are scoped to the selected month.)

- [ ] **Step 3: Add styling in `dashboard/css/styles.css`**

Append at the end of the file:
```css
table.brand-table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; }
table.brand-table th, table.brand-table td { padding: 8px 12px; border-bottom: 1px solid #e0e0e0; text-align: right; }
table.brand-table th:first-child, table.brand-table td:first-child { text-align: left; }
.brand-pivot-scroll { overflow-x: auto; background: #fff; border-radius: 8px; }
table.brand-pivot-table { border-collapse: collapse; white-space: nowrap; }
table.brand-pivot-table th, table.brand-pivot-table td { padding: 6px 10px; border-bottom: 1px solid #e0e0e0; border-right: 1px solid #f1f3f4; text-align: right; font-size: 13px; }
table.brand-pivot-table th:first-child, table.brand-pivot-table td:first-child { text-align: left; position: sticky; left: 0; background: #fff; }
```

(`table.brand-table` styling was missing since the brand table and its warning banner were added in the previous feature without corresponding CSS — fixing that gap here since this task is already touching the stylesheet for the same family of tables. `position: sticky` keeps the month column visible while scrolling the wide pivot horizontally.)

- [ ] **Step 4: Sanity-check the browser-only files**

Run (from `dashboard/`):
```powershell
$html = Get-Content dashboard.html -Raw
if ($html -match 'id="brandMonthlyPivot"') { Write-Host "container OK" } else { throw "missing brandMonthlyPivot container" }
$js = Get-Content js/main.js -Raw
foreach ($name in @('getBrandMonthlyPivot','renderBrandMonthlyPivotHTML')) {
  if ($js -notmatch [regex]::Escape($name)) { throw "main.js missing reference: $name" }
}
Write-Host "main.js references OK"
```
Expected: both `OK` lines print, no thrown error.

- [ ] **Step 5: Run the full Node suite to confirm no regression**

Run: `npm test`
Expected: all tests still passing (this task touches no Node-testable code, but must not have broken anything else).

- [ ] **Step 6: Commit**

```powershell
git add dashboard.html js/main.js css/styles.css
git commit -m "feat: wire brand monthly pivot table into the browser"
```

- [ ] **Step 7: Real-data Playwright verification**

1. Serve the dashboard locally:
   ```powershell
   Start-Process -FilePath "python" -ArgumentList "-m","http.server","8772" -WindowStyle Hidden
   Start-Sleep -Seconds 2
   Invoke-WebRequest -Uri "http://localhost:8772/dashboard.html" -UseBasicParsing | Select-Object -ExpandProperty StatusCode
   ```
   Expected: `200`.
2. Navigate to `http://localhost:8772/dashboard.html`, check console errors (expect only the harmless favicon 404).
3. Import, in one batch: `粗利分析_よい日々1期_20260709.xlsx`, `分解詳細リスト.xlsx`, `商品別収益202606.xlsx`, `受注_売上一覧表ライト_202606.csv`.
4. Snapshot the page. Expected:
   - The existing KPI cards still show 売上 `¥12,144,126` and 粗利 `¥8,218,941` for `2026-06` — this feature must not have changed those (regression check, same as after every prior change to this codebase).
   - A new "月次推移（ブランド×定期/通常）" heading and a wide table below it, with one row per month from `2025-06` through `2026-06` and column groups per real brand name (MCTオイル, MSMパウダー, ベルメ, etc.).
5. Stop the server:
   ```powershell
   Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" | Where-Object { $_.CommandLine -like '*http.server*8772*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
   ```
6. No commit needed for this step unless a real bug is found and fixed, in which case follow the same fix → re-verify → commit pattern used for the earlier post-ship hotfixes in this project.

---

## Self-Review Notes

- **Spec coverage:** data source (concatenated baseRecords+monthlyRecords, Task 1), aggregation shape and zero-fill/null-brand rules (Task 1), wide pivot rendering with empty state (Task 2), browser wiring plus the explicit channel-KPI regression check (Task 3) all map directly to the design spec's sections.
- **Placeholder scan:** none found — every step has complete, runnable code.
- **Type/name consistency checked:** `getBrandMonthlyPivot`'s return shape (`months`, `brands`, `rows[].{yearMonth,totalTeikiSales,totalTeikiProfit,totalTsujoSales,totalTsujoProfit,byBrand}`) is used identically in Task 2's renderer and Task 3's wiring. `renderBrandMonthlyPivotHTML` name matches between Task 2's definition and Task 3's `main.js` reference.
