# 月次推移(ブランド選択式・色分け) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the wide, all-brands-at-once pivot table with a brand-selectable (Excel-sheet-tab-like) monthly series view, with 定期/通常 column-family background colors and a sales/profit heatmap.

**Architecture:** One new aggregation function (`getBrandMonthlySeries`) built as a thin projection over the existing `getBrandMonthlyPivot` (which stays, unchanged, as the underlying month×brand×type data source). One new renderer (`renderBrandMonthlySeriesHTML`, plus a small pure `heatmapColor` helper) replaces the old wide-table renderer (`renderBrandMonthlyPivotHTML`, deleted). `main.js` gains one piece of UI-only state (`selectedPivotBrand`) and a select-element wiring pattern identical to the existing `setupBrandAssignForm`.

**Tech Stack:** Same as the existing dashboard — vanilla JS, `node:test`.

## Global Constraints

- `getBrandMonthlyPivot` (existing, in `js/aggregate.js`) is NOT modified — it remains the single source of month×brand×定期/通常 data. `getBrandMonthlySeries` is a projection on top of it, not a reimplementation.
- `renderBrandMonthlyPivotHTML` and its two tests are DELETED (replaced, not kept alongside) — this feature is a replacement, not an addition. `getBrandMonthlyPivot`'s own tests in `tests/aggregate.test.js` are untouched (that function isn't changing).
- The brand selector's options are exactly `全体（合計）` (value `ALL`) followed by every brand in `series.brands`, in the same order `getBrandMonthlyPivot` already sorts them (descending total sales).
- A brand with no data in a given month must render as zero (`teikiSales/teikiProfit/tsujoSales/tsujoProfit` all `0`), matching `getBrandMonthlyPivot`'s existing zero-fill guarantee — `getBrandMonthlySeries` must preserve this when projecting.
- Heatmap: computed independently per column (定期売上/定期粗利/通常売上/通常粗利each have their own max-abs-value scale), a cell's intensity is `abs(value)/columnMaxAbs`. Positive values render green-tinted, negative render red-tinted, exactly `0` gets no heatmap overlay (the plain 定期/通常 column-family color shows through instead — zero must never look "slightly positive").
- No 1期比較(YoY) columns in this view (carried over from the prior design decision) — this table shows only the selected 定期/通常 series across all available months.
- `npm test` must keep running the whole `tests/*.test.js` suite and stay green throughout (currently 81 tests; expect a net change since 2 old tests are deleted and more new ones added).

---

## File Structure

```
dashboard/
  js/
    aggregate.js   (MODIFY: add getBrandMonthlySeries; getBrandMonthlyPivot untouched)
    ui.js          (MODIFY: remove renderBrandMonthlyPivotHTML; add heatmapColor + renderBrandMonthlySeriesHTML)
    main.js        (MODIFY: replace pivot render call with series render call + selector wiring)
  css/
    styles.css     (MODIFY: remove now-unused .brand-pivot-* rules; add .brand-series-* / .col-teiki / .col-tsujo rules)
  tests/
    aggregate.test.js  (MODIFY: add getBrandMonthlySeries coverage; existing getBrandMonthlyPivot tests untouched)
    ui.test.js         (MODIFY: remove the 2 renderBrandMonthlyPivotHTML tests; add heatmapColor + renderBrandMonthlySeriesHTML coverage)
```

`dashboard/dashboard.html` is NOT modified — the `<div id="brandMonthlyPivot"></div>` container already exists from the prior feature and is reused as-is; only what gets rendered inside it changes.

---

### Task 1: `getBrandMonthlySeries` aggregation

**Files:**
- Modify: `dashboard/js/aggregate.js`
- Modify: `dashboard/tests/aggregate.test.js`

**Interfaces:**
- Consumes: `getBrandMonthlyPivot` (same file, existing, unchanged).
- Produces: `getBrandMonthlySeries(state, selection)` → `{ brands: string[], rows: Array<{yearMonth, teikiSales, teikiProfit, tsujoSales, tsujoProfit}> }`. `selection` is `'ALL'`, a brand name, or omitted (defaults to `'ALL'`). Consumed by `ui.js`/`main.js` (Task 2/3).

- [ ] **Step 1: Write the failing test**

Append to `dashboard/tests/aggregate.test.js` (after the existing `getBrandMonthlyPivot returns empty months/brands/rows...` test, reusing the `pivotSampleState()` helper already defined earlier in this file):

```js
test('getBrandMonthlySeries with selection "ALL" returns each month\'s whole-company totals renamed to teiki/tsujo fields', () => {
  const series = getBrandMonthlySeries(pivotSampleState(), 'ALL');
  assert.deepEqual(series.brands, ['MCTオイル', 'MSMパウダー', '未分類']);
  const june2025 = series.rows.find(r => r.yearMonth === '2025-06');
  assert.deepEqual(june2025, { yearMonth: '2025-06', teikiSales: 100, teikiProfit: 60, tsujoSales: 250, tsujoProfit: 150 });
});

test("getBrandMonthlySeries with a brand name returns that brand's month series, zero-filled where absent", () => {
  const series = getBrandMonthlySeries(pivotSampleState(), 'MSMパウダー');
  const june2025 = series.rows.find(r => r.yearMonth === '2025-06');
  const june2026 = series.rows.find(r => r.yearMonth === '2026-06');
  assert.deepEqual(june2025, { yearMonth: '2025-06', teikiSales: 0, teikiProfit: 0, tsujoSales: 200, tsujoProfit: 120 });
  assert.deepEqual(june2026, { yearMonth: '2026-06', teikiSales: 0, teikiProfit: 0, tsujoSales: 0, tsujoProfit: 0 });
});

test('getBrandMonthlySeries defaults to ALL when selection is omitted', () => {
  const withoutSelection = getBrandMonthlySeries(pivotSampleState());
  const allSelection = getBrandMonthlySeries(pivotSampleState(), 'ALL');
  assert.deepEqual(withoutSelection, allSelection);
});
```

Also update the import line at the top of the file. Replace:
```js
const {
  shiftYearMonth, sumRecords, filterRecords, profitRate, pctChange, daysInMonth,
  getMonthlyComparison, getChannelTable, getDailyCumulativeSeries, getMonthlyTrend, getBrandTable,
  getBrandMonthlyPivot,
} = require('../js/aggregate.js');
```
with:
```js
const {
  shiftYearMonth, sumRecords, filterRecords, profitRate, pctChange, daysInMonth,
  getMonthlyComparison, getChannelTable, getDailyCumulativeSeries, getMonthlyTrend, getBrandTable,
  getBrandMonthlyPivot, getBrandMonthlySeries,
} = require('../js/aggregate.js');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `getBrandMonthlySeries is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to the factory body in `dashboard/js/aggregate.js` (right after `getBrandMonthlyPivot`, before `getDailyCumulativeSeries`):

```js
  function getBrandMonthlySeries(state, selection) {
    const pivot = getBrandMonthlyPivot(state);
    const rows = pivot.rows.map(row => {
      if (!selection || selection === 'ALL') {
        return {
          yearMonth: row.yearMonth,
          teikiSales: row.totalTeikiSales, teikiProfit: row.totalTeikiProfit,
          tsujoSales: row.totalTsujoSales, tsujoProfit: row.totalTsujoProfit,
        };
      }
      const cell = row.byBrand[selection] || { teikiSales: 0, teikiProfit: 0, tsujoSales: 0, tsujoProfit: 0 };
      return {
        yearMonth: row.yearMonth,
        teikiSales: cell.teikiSales, teikiProfit: cell.teikiProfit,
        tsujoSales: cell.tsujoSales, tsujoProfit: cell.tsujoProfit,
      };
    });
    return { brands: pivot.brands, rows };
  }
```

Update the final `return` statement to add `getBrandMonthlySeries`:
```js
  return {
    CHANNELS, shiftYearMonth, sumRecords, filterRecords, profitRate, pctChange, daysInMonth,
    getMonthlyComparison, getChannelTable, getBrandTable, getDailyCumulativeSeries, getMonthlyTrend,
    getBrandMonthlyPivot, getBrandMonthlySeries,
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: all tests in `aggregate.test.js` PASS, full suite still green.

- [ ] **Step 5: Commit**

```powershell
git add js/aggregate.js tests/aggregate.test.js
git commit -m "feat: add getBrandMonthlySeries projection (ALL or one brand) over getBrandMonthlyPivot"
```

---

### Task 2: Replace the wide-pivot renderer with a colored, brand-selectable series renderer

**Files:**
- Modify: `dashboard/js/ui.js`
- Modify: `dashboard/tests/ui.test.js`

**Interfaces:**
- Consumes: `formatYen` (same file, existing). The shape produced by `getBrandMonthlySeries` (Task 1).
- Produces: `heatmapColor(value, maxAbs)` → CSS `style` string fragment (e.g. `'background-color: hsl(140, 65%, 50%);'`) or `''`. `renderBrandMonthlySeriesHTML(series, selection)` → HTML string (selector + table), or an empty-state message when `series.brands.length === 0`. `renderBrandMonthlyPivotHTML` is REMOVED. Consumed by `main.js` (Task 3).

- [ ] **Step 1: Write the failing test**

In `dashboard/tests/ui.test.js`:

1. Update the import line. Replace:
```js
const { formatYen, formatPct, renderKpiCardsHTML, renderChannelTableHTML, renderMappingWarningsHTML, renderBrandTableHTML, renderProductBrandWarningsHTML, renderBrandMonthlyPivotHTML } = require('../js/ui.js');
```
with:
```js
const { formatYen, formatPct, renderKpiCardsHTML, renderChannelTableHTML, renderMappingWarningsHTML, renderBrandTableHTML, renderProductBrandWarningsHTML, heatmapColor, renderBrandMonthlySeriesHTML } = require('../js/ui.js');
```

2. DELETE these two existing tests entirely (they test the function being removed):
```js
test('renderBrandMonthlyPivotHTML renders a wide pivot table with month rows and brand column groups', () => {
  ...
});

test('renderBrandMonthlyPivotHTML shows an empty-state message when there are no brands yet', () => {
  ...
});
```

3. Append these new tests at the end of the file:
```js
test('heatmapColor returns no color for a zero value or a zero column max, and a green/red hsl scale otherwise', () => {
  assert.equal(heatmapColor(0, 100), '');
  assert.equal(heatmapColor(50, 0), '');
  assert.equal(heatmapColor(100, 100), 'background-color: hsl(140, 65%, 50%);'); // full intensity, positive -> green
  assert.equal(heatmapColor(-100, 100), 'background-color: hsl(0, 65%, 50%);'); // full intensity, negative -> red
  assert.equal(heatmapColor(-50, 100), 'background-color: hsl(0, 65%, 71%);'); // half intensity, negative
});

test('renderBrandMonthlySeriesHTML renders a selector (全体 + each brand) and a compact 定期/通常 table for the selection', () => {
  const series = {
    brands: ['MCTオイル', 'MSMパウダー'],
    rows: [
      { yearMonth: '2025-06', teikiSales: 100, teikiProfit: 60, tsujoSales: 200, tsujoProfit: 120 },
      { yearMonth: '2026-06', teikiSales: 300, teikiProfit: 180, tsujoSales: 0, tsujoProfit: 0 },
    ],
  };
  const html = renderBrandMonthlySeriesHTML(series, 'MCTオイル');
  assert.match(html, /<select id="brandSeriesSelect">/);
  assert.match(html, /<option value="ALL">全体（合計）<\/option>/);
  assert.match(html, /<option value="MCTオイル" selected>MCTオイル<\/option>/);
  assert.match(html, /<option value="MSMパウダー">MSMパウダー<\/option>/); // present, not selected
  assert.match(html, /class="col-teiki"/);
  assert.match(html, /class="col-tsujo"/);
  assert.match(html, /2025-06/);
  assert.match(html, /¥100/);
});

test('renderBrandMonthlySeriesHTML defaults the selector to ALL when no selection is given', () => {
  const html = renderBrandMonthlySeriesHTML({ brands: ['MCTオイル'], rows: [] }, undefined);
  assert.match(html, /<option value="ALL" selected>全体（合計）<\/option>/);
});

test('renderBrandMonthlySeriesHTML shows an empty-state message when there are no brands yet', () => {
  const html = renderBrandMonthlySeriesHTML({ brands: [], rows: [] }, 'ALL');
  assert.doesNotMatch(html, /<table/);
  assert.match(html, /表示できるデータがありません/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `heatmapColor is not a function`, `renderBrandMonthlySeriesHTML is not a function` (and, transiently, `renderBrandMonthlyPivotHTML` import resolving to `undefined` is fine since those two tests were deleted, not left behind).

- [ ] **Step 3: Write minimal implementation**

In `dashboard/js/ui.js`, DELETE the entire `renderBrandMonthlyPivotHTML` function (the one whose body builds `brandHeaderCells`/`brandSubHeaderCells`/wide `<table class="brand-pivot-table">`).

Add in its place:
```js
  function heatmapColor(value, maxAbs) {
    if (!maxAbs || value === 0) return '';
    const ratio = Math.min(Math.abs(value) / maxAbs, 1);
    const lightness = Math.round(92 - ratio * 42);
    const hue = value < 0 ? 0 : 140;
    return `background-color: hsl(${hue}, 65%, ${lightness}%);`;
  }

  function renderBrandMonthlySeriesHTML(series, selection) {
    const brands = (series && series.brands) || [];
    if (brands.length === 0) {
      return '<p class="brand-series-empty">表示できるデータがありません（月次実績とブランド対応表を取込むと表示されます）。</p>';
    }
    const rows = (series && series.rows) || [];
    const selectValue = selection || 'ALL';
    const options = [`<option value="ALL"${selectValue === 'ALL' ? ' selected' : ''}>全体（合計）</option>`]
      .concat(brands.map(b => `<option value="${b}"${b === selectValue ? ' selected' : ''}>${b}</option>`))
      .join('');

    const maxAbs = {
      teikiSales: Math.max(0, ...rows.map(r => Math.abs(r.teikiSales))),
      teikiProfit: Math.max(0, ...rows.map(r => Math.abs(r.teikiProfit))),
      tsujoSales: Math.max(0, ...rows.map(r => Math.abs(r.tsujoSales))),
      tsujoProfit: Math.max(0, ...rows.map(r => Math.abs(r.tsujoProfit))),
    };

    const bodyRows = rows.map(r => `
      <tr>
        <td>${r.yearMonth}</td>
        <td class="col-teiki" style="${heatmapColor(r.teikiSales, maxAbs.teikiSales)}">${formatYen(r.teikiSales)}</td>
        <td class="col-teiki" style="${heatmapColor(r.teikiProfit, maxAbs.teikiProfit)}">${formatYen(r.teikiProfit)}</td>
        <td class="col-tsujo" style="${heatmapColor(r.tsujoSales, maxAbs.tsujoSales)}">${formatYen(r.tsujoSales)}</td>
        <td class="col-tsujo" style="${heatmapColor(r.tsujoProfit, maxAbs.tsujoProfit)}">${formatYen(r.tsujoProfit)}</td>
      </tr>`).join('');

    return `
      <div class="brand-series-controls">
        ブランド: <select id="brandSeriesSelect">${options}</select>
      </div>
      <table class="brand-series-table">
        <thead>
          <tr><th>月</th><th class="col-teiki">定期売上</th><th class="col-teiki">定期粗利</th><th class="col-tsujo">通常売上</th><th class="col-tsujo">通常粗利</th></tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>
    `;
  }
```

Update the final `return` statement. Replace:
```js
  return { formatYen, formatPct, renderKpiCardsHTML, renderChannelTableHTML, renderMappingWarningsHTML, renderBrandTableHTML, renderProductBrandWarningsHTML, renderBrandMonthlyPivotHTML };
```
with:
```js
  return { formatYen, formatPct, renderKpiCardsHTML, renderChannelTableHTML, renderMappingWarningsHTML, renderBrandTableHTML, renderProductBrandWarningsHTML, heatmapColor, renderBrandMonthlySeriesHTML };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: all tests in `ui.test.js` PASS (no leftover references to the deleted `renderBrandMonthlyPivotHTML`), full suite still green.

- [ ] **Step 5: Commit**

```powershell
git add js/ui.js tests/ui.test.js
git commit -m "feat: replace wide pivot table with a colored, brand-selectable monthly series view"
```

---

### Task 3: Wire the new view into the browser + CSS + real-data verification

**Files:**
- Modify: `dashboard/js/main.js`
- Modify: `dashboard/css/styles.css`

**Interfaces:**
- Consumes: `getBrandMonthlySeries` (Task 1), `renderBrandMonthlySeriesHTML` (Task 2).
- Produces: the runnable end-user feature. No further tasks consume this one.

`dashboard/dashboard.html` needs no changes — `<div id="brandMonthlyPivot"></div>` already exists and is reused. This task is not unit-testable with `node:test` (browser-only wiring). Verified with Playwright against the real files already used throughout this project.

- [ ] **Step 1: Update `dashboard/js/main.js`**

Update the aggregate-functions destructuring line. Replace:
```js
  const { getMonthlyComparison, getChannelTable, getBrandTable, getDailyCumulativeSeries, getMonthlyTrend, getBrandMonthlyPivot } = window.YoiHibi;
```
with:
```js
  const { getMonthlyComparison, getChannelTable, getBrandTable, getDailyCumulativeSeries, getMonthlyTrend, getBrandMonthlySeries } = window.YoiHibi;
```

Update the ui-functions destructuring line. Replace:
```js
  const { renderKpiCardsHTML, renderChannelTableHTML, renderMappingWarningsHTML, renderBrandTableHTML, renderProductBrandWarningsHTML, renderBrandMonthlyPivotHTML } = window.YoiHibi;
```
with:
```js
  const { renderKpiCardsHTML, renderChannelTableHTML, renderMappingWarningsHTML, renderBrandTableHTML, renderProductBrandWarningsHTML, renderBrandMonthlySeriesHTML } = window.YoiHibi;
```

Add a new module-scope variable alongside the existing chart variables. Replace:
```js
  const store = createStore(window.localStorage);
  let trendChart = null;
  let dailyChart = null;
```
with:
```js
  const store = createStore(window.localStorage);
  let trendChart = null;
  let dailyChart = null;
  let selectedPivotBrand = 'ALL';
```

Update `renderAll` to call the new render function and re-wire the selector. Replace:
```js
    el('kpiRow').innerHTML = renderKpiCardsHTML(getMonthlyComparison(state, yearMonth));
    el('channelTable').innerHTML = renderChannelTableHTML(getChannelTable(state, yearMonth));
    el('brandTable').innerHTML = renderBrandTableHTML(getBrandTable(state, yearMonth));
    el('brandMonthlyPivot').innerHTML = renderBrandMonthlyPivotHTML(getBrandMonthlyPivot(state));

    renderTrendChart(getMonthlyTrend(state));
```
with:
```js
    el('kpiRow').innerHTML = renderKpiCardsHTML(getMonthlyComparison(state, yearMonth));
    el('channelTable').innerHTML = renderChannelTableHTML(getChannelTable(state, yearMonth));
    el('brandTable').innerHTML = renderBrandTableHTML(getBrandTable(state, yearMonth));
    el('brandMonthlyPivot').innerHTML = renderBrandMonthlySeriesHTML(getBrandMonthlySeries(state, selectedPivotBrand), selectedPivotBrand);
    setupBrandSeriesSelector();

    renderTrendChart(getMonthlyTrend(state));
```

Add the new wiring function right after `setupBrandAssignForm` (reusing the exact same "re-attach after every render" pattern that function already establishes):
```js
  function setupBrandSeriesSelector() {
    const select = document.getElementById('brandSeriesSelect');
    if (!select) return;
    select.addEventListener('change', () => {
      selectedPivotBrand = select.value;
      renderAll();
    });
  }
```

- [ ] **Step 2: Update `dashboard/css/styles.css`**

Replace the now-unused wide-pivot rules:
```css
.brand-pivot-scroll { overflow-x: auto; background: #fff; border-radius: 8px; }
table.brand-pivot-table { border-collapse: collapse; white-space: nowrap; }
table.brand-pivot-table th, table.brand-pivot-table td { padding: 6px 10px; border-bottom: 1px solid #e0e0e0; border-right: 1px solid #f1f3f4; text-align: right; font-size: 13px; }
table.brand-pivot-table th:first-child, table.brand-pivot-table td:first-child { text-align: left; position: sticky; left: 0; background: #fff; }
```
with:
```css
.brand-series-controls { margin-bottom: 8px; }
table.brand-series-table { border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; }
table.brand-series-table th, table.brand-series-table td { padding: 8px 12px; border-bottom: 1px solid #e0e0e0; text-align: right; }
table.brand-series-table th:first-child, table.brand-series-table td:first-child { text-align: left; }
table.brand-series-table th.col-teiki, table.brand-series-table td.col-teiki { background: #e8f0fe; }
table.brand-series-table th.col-tsujo, table.brand-series-table td.col-tsujo { background: #e6f4ea; }
```

(Header cells get the plain column-family tint via the CSS class; body cells get the same class for when their heatmap `style` is empty — i.e. a `0` value — plus an inline `style` that overrides it when non-zero, per `heatmapColor`.)

- [ ] **Step 3: Sanity-check the browser-only files**

Run (from `dashboard/`):
```powershell
$js = Get-Content js/main.js -Raw
foreach ($name in @('getBrandMonthlySeries','renderBrandMonthlySeriesHTML','setupBrandSeriesSelector','selectedPivotBrand')) {
  if ($js -notmatch [regex]::Escape($name)) { throw "main.js missing reference: $name" }
}
if ($js -match 'getBrandMonthlyPivot|renderBrandMonthlyPivotHTML') { throw "main.js still references the removed pivot functions" }
Write-Host "main.js references OK"
```
Expected: `main.js references OK`, no thrown error.

- [ ] **Step 4: Run the full Node suite to confirm no regression**

Run: `npm test`
Expected: all tests still passing (this task touches no Node-testable code, but must not have broken anything else).

- [ ] **Step 5: Commit**

```powershell
git add js/main.js css/styles.css
git commit -m "feat: wire the brand-selectable colored monthly series into the browser"
```

- [ ] **Step 6: Real-data Playwright verification**

1. Serve the dashboard locally:
   ```powershell
   Start-Process -FilePath "python" -ArgumentList "-m","http.server","8773" -WindowStyle Hidden
   Start-Sleep -Seconds 2
   Invoke-WebRequest -Uri "http://localhost:8773/dashboard.html" -UseBasicParsing | Select-Object -ExpandProperty StatusCode
   ```
   Expected: `200`.
2. Navigate to `http://localhost:8773/dashboard.html`, check console errors (expect only the harmless favicon 404).
3. Import, in one batch: `粗利分析_よい日々1期_20260709.xlsx`, `分解詳細リスト.xlsx`, `商品別収益202606.xlsx`, `受注_売上一覧表ライト_202606.csv`.
4. Verify via `browser_evaluate` (not a full-page snapshot — this page is large with many brands, so pull only the specific values needed, same approach used for this feature's prior verification round):
   - KPI card text still shows exactly `¥12,144,126` (売上) and `¥8,218,941` (粗利) for `2026-06` — regression check, must be unchanged.
   - `document.getElementById('brandMonthlyPivot').querySelector('select#brandSeriesSelect')` exists and its first option is `全体（合計）` with value `ALL`.
   - The rendered table under `#brandMonthlyPivot` has exactly 5 header columns (月, 定期売上, 定期粗利, 通常売上, 通常粗利) and one row per month.
   - At least one `.col-teiki` and one `.col-tsujo` cell exists, and at least one body cell has a non-empty inline `style` attribute (confirms the heatmap actually applied to real data, not just zeros).
5. Select a specific brand from the dropdown (e.g. via `browser_select_option` on `#brandSeriesSelect`), then re-check the table's values changed to that brand's figures (spot-check one month's 定期売上/通常売上 against the values already confirmed in the prior feature's Playwright verification for that brand, e.g. ベルメ/MCTオイル).
6. Stop the server:
   ```powershell
   Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" | Where-Object { $_.CommandLine -like '*http.server*8773*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
   ```
7. No commit needed for this step unless a real bug is found and fixed, in which case follow the same fix → re-verify → commit pattern used for the earlier post-ship hotfixes in this project.

---

## Self-Review Notes

- **Spec coverage:** brand-tab-style selector (Task 2/3), 定期/通常 column-family colors (Task 2 CSS classes + Task 3 stylesheet), sales/profit heatmap (Task 2 `heatmapColor`), removal of the old wide pivot (Task 2 deletes `renderBrandMonthlyPivotHTML` and its tests; Task 3 removes the corresponding CSS and `main.js` wiring) all map directly to the design spec.
- **Placeholder scan:** none found.
- **Type/name consistency checked:** `getBrandMonthlySeries`'s return shape (`{brands, rows: [{yearMonth,teikiSales,teikiProfit,tsujoSales,tsujoProfit}]}`) is used identically in Task 2's renderer and Task 3's wiring. `heatmapColor`, `renderBrandMonthlySeriesHTML`, `getBrandMonthlySeries`, `setupBrandSeriesSelector`, `selectedPivotBrand` names match exactly between their defining task and every later reference. Verified no leftover reference to the deleted `getBrandMonthlyPivot`-in-`main.js` / `renderBrandMonthlyPivotHTML` anywhere outside `aggregate.js` itself (where `getBrandMonthlyPivot` legitimately still lives as Task 1's dependency).
