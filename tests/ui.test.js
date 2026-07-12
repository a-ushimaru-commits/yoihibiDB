const test = require('node:test');
const assert = require('node:assert/strict');
const { formatYen, formatPct, renderKpiCardsHTML, renderChannelTableHTML, renderMappingWarningsHTML, renderBrandTableHTML, renderProductBrandWarningsHTML, heatmapColor, renderBrandMonthlyPivotHTML, renderChannelMonthlyPivotHTML } = require('../js/ui.js');

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

test('renderProductBrandWarningsHTML falls back to a free-text input when no known brands are given', () => {
  const html = renderProductBrandWarningsHTML({ 'FH0009999999999': { count: 3, sales: 4500 } });
  assert.match(html, /FH0009999999999/);
  assert.match(html, /<input type="text" data-product-code="FH0009999999999"/);
  assert.match(html, /<form id="brandAssignForm"/);
  assert.equal(renderProductBrandWarningsHTML({}), '');
});

test('renderProductBrandWarningsHTML renders a <select> of known brands plus a "new brand" text fallback', () => {
  const html = renderProductBrandWarningsHTML({ 'FH0009999999999': { count: 3, sales: 4500, productName: 'テスト商品' } }, ['MCTオイル', 'MSMパウダー']);
  assert.match(html, /<select data-product-code="FH0009999999999">/);
  assert.match(html, /<option value="MCTオイル">MCTオイル<\/option>/);
  assert.match(html, /<option value="MSMパウダー">MSMパウダー<\/option>/);
  assert.match(html, /data-product-code-new="FH0009999999999"/);
  assert.equal(renderProductBrandWarningsHTML({}, ['MCTオイル']), '');
});

test('renderProductBrandWarningsHTML shows the product name alongside the product code', () => {
  const html = renderProductBrandWarningsHTML({ 'FH0009999999999': { count: 3, sales: 4500, productName: 'テスト商品/500ml' } }, []);
  assert.match(html, /テスト商品\/500ml/);
});

test('renderProductBrandWarningsHTML pre-selects a guessed brand in the <select> when one is given', () => {
  const html = renderProductBrandWarningsHTML(
    { 'FH0009999999999': { count: 3, sales: 4500, productName: 'テスト商品' } },
    ['MCTオイル', 'MSMパウダー'],
    { 'FH0009999999999': 'MSMパウダー' },
  );
  assert.match(html, /<option value="MSMパウダー" selected>MSMパウダー<\/option>/);
  assert.match(html, /<option value="MCTオイル">MCTオイル<\/option>/); // the non-guessed option has no selected attribute
});

test('heatmapColor returns no color for a zero value or a zero column max, and a green/red hsl scale otherwise', () => {
  assert.equal(heatmapColor(0, 100), '');
  assert.equal(heatmapColor(50, 0), '');
  assert.equal(heatmapColor(100, 100), 'background-color: hsl(140, 65%, 50%);'); // full intensity, positive -> green
  assert.equal(heatmapColor(-100, 100), 'background-color: hsl(0, 65%, 50%);'); // full intensity, negative -> red
  assert.equal(heatmapColor(-50, 100), 'background-color: hsl(0, 65%, 71%);'); // half intensity, negative
});

function samplePivot() {
  return {
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
}

test('renderBrandMonthlyPivotHTML renders a wide pivot table with month rows and brand column groups', () => {
  const html = renderBrandMonthlyPivotHTML(samplePivot());
  assert.match(html, /<table class="brand-pivot-table">/);
  assert.match(html, /2025-06/);
  assert.match(html, /2026-06/);
  assert.match(html, /<th colspan="4">MCTオイル<\/th>/);
  assert.match(html, /<th colspan="4" class="brand-band">MSMパウダー<\/th>/);
  assert.match(html, /¥100/);
  assert.match(html, /¥300/);
});

test('renderBrandMonthlyPivotHTML colors columns by 定期(blue-family class)/通常(green-family class) for both the totals and every brand group', () => {
  const html = renderBrandMonthlyPivotHTML(samplePivot());
  assert.match(html, /class="col-teiki"/);
  assert.match(html, /class="col-tsujo"/);
});

test('renderBrandMonthlyPivotHTML applies a heatmap inline style to at least one non-zero cell', () => {
  const html = renderBrandMonthlyPivotHTML(samplePivot());
  assert.match(html, /style="background-color: hsl\(140, 65%, \d+%\);"/);
});

test('renderBrandMonthlyPivotHTML bands alternating brand column groups with a "brand-band" class so adjacent brands are visually distinct', () => {
  const html = renderBrandMonthlyPivotHTML(samplePivot());
  // first brand (index 0, MCTオイル): no band class
  assert.match(html, /<th colspan="4">MCTオイル<\/th>/);
  // second brand (index 1, MSMパウダー): banded
  assert.match(html, /<th colspan="4" class="brand-band">MSMパウダー<\/th>/);
  assert.match(html, /class="col-teiki brand-band"/);
  assert.match(html, /class="col-tsujo brand-band"/);
});

test('renderBrandMonthlyPivotHTML shows an empty-state message when there are no brands yet', () => {
  const html = renderBrandMonthlyPivotHTML({ months: [], brands: [], rows: [] });
  assert.doesNotMatch(html, /<table/);
  assert.match(html, /表示できるデータがありません/);
});

function sampleChannelPivot() {
  return {
    months: ['2025-06', '2026-06'],
    channels: ['自社', 'アマゾン'],
    rows: [
      {
        yearMonth: '2025-06',
        totalTeikiSales: 100, totalTeikiProfit: 60, totalTsujoSales: 250, totalTsujoProfit: 150,
        byChannel: {
          '自社': { teikiSales: 100, teikiProfit: 60, tsujoSales: 0, tsujoProfit: 0 },
          'アマゾン': { teikiSales: 0, teikiProfit: 0, tsujoSales: 200, tsujoProfit: 120 },
        },
      },
      {
        yearMonth: '2026-06',
        totalTeikiSales: 300, totalTeikiProfit: 180, totalTsujoSales: 10, totalTsujoProfit: 5,
        byChannel: {
          '自社': { teikiSales: 300, teikiProfit: 180, tsujoSales: 0, tsujoProfit: 0 },
          'アマゾン': { teikiSales: 0, teikiProfit: 0, tsujoSales: 0, tsujoProfit: 0 },
        },
      },
    ],
  };
}

test('renderChannelMonthlyPivotHTML renders a wide pivot table with month rows and channel column groups, banded and colored the same way as the brand table', () => {
  const html = renderChannelMonthlyPivotHTML(sampleChannelPivot());
  assert.match(html, /<table class="channel-pivot-table">/);
  assert.match(html, /2025-06/);
  assert.match(html, /2026-06/);
  assert.match(html, /<th colspan="4">自社<\/th>/);
  assert.match(html, /<th colspan="4" class="brand-band">アマゾン<\/th>/);
  assert.match(html, /class="col-teiki"/);
  assert.match(html, /class="col-tsujo"/);
  assert.match(html, /¥100/);
  assert.match(html, /¥300/);
});

test('renderChannelMonthlyPivotHTML shows an empty-state message when there are no months yet', () => {
  const html = renderChannelMonthlyPivotHTML({ months: [], channels: ['自社', 'アマゾン', '楽天', 'yahoo', '卸', 'TV', 'その他'], rows: [] });
  assert.doesNotMatch(html, /<table/);
  assert.match(html, /表示できるデータがありません/);
});
