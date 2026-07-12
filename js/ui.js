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

  function renderProductBrandWarningsHTML(unmappedProducts, knownBrands, guesses) {
    const codes = Object.keys(unmappedProducts || {});
    if (codes.length === 0) return '';
    const brands = knownBrands || [];
    const guessMap = guesses || {};
    const rows = codes.map(code => {
      const info = unmappedProducts[code];
      const guessed = guessMap[code];
      const assignCell = brands.length > 0
        ? `<select data-product-code="${code}">
            <option value="">-- 選択 --</option>
            ${brands.map(b => `<option value="${b}"${b === guessed ? ' selected' : ''}>${b}</option>`).join('')}
            <option value="__new__">新しいブランド名を入力...</option>
          </select>
          <input type="text" data-product-code-new="${code}" placeholder="新しいブランド名" style="display:none">`
        : `<input type="text" data-product-code="${code}" placeholder="ブランド名">`;
      return `<tr>
        <td>${code}</td>
        <td>${info.productName || ''}</td>
        <td>${info.count}件, ${formatYen(info.sales)}</td>
        <td>${assignCell}</td>
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

  function heatmapColor(value, maxAbs) {
    if (!maxAbs || value === 0) return '';
    const ratio = Math.min(Math.abs(value) / maxAbs, 1);
    const lightness = Math.round(92 - ratio * 42);
    const hue = value < 0 ? 0 : 140;
    return `background-color: hsl(${hue}, 65%, ${lightness}%);`;
  }

  function renderBrandMonthlyPivotHTML(pivot) {
    if (!pivot || !pivot.brands || pivot.brands.length === 0) {
      return '<p class="brand-pivot-empty">表示できるデータがありません（月次実績とブランド対応表を取込むと表示されます）。</p>';
    }
    const rows = pivot.rows;
    const maxAbsOf = accessor => Math.max(0, ...rows.map(r => Math.abs(accessor(r))));
    const totalMax = {
      teikiSales: maxAbsOf(r => r.totalTeikiSales), teikiProfit: maxAbsOf(r => r.totalTeikiProfit),
      tsujoSales: maxAbsOf(r => r.totalTsujoSales), tsujoProfit: maxAbsOf(r => r.totalTsujoProfit),
    };
    const brandMax = {};
    pivot.brands.forEach(b => {
      brandMax[b] = {
        teikiSales: maxAbsOf(r => r.byBrand[b].teikiSales), teikiProfit: maxAbsOf(r => r.byBrand[b].teikiProfit),
        tsujoSales: maxAbsOf(r => r.byBrand[b].tsujoSales), tsujoProfit: maxAbsOf(r => r.byBrand[b].tsujoProfit),
      };
    });

    const bandOf = i => (i % 2 === 1 ? ' brand-band' : '');

    const brandHeaderCells = pivot.brands.map((b, i) => (bandOf(i) ? `<th colspan="4" class="brand-band">${b}</th>` : `<th colspan="4">${b}</th>`)).join('');
    const brandSubHeaderCells = pivot.brands
      .map((b, i) => `<th class="col-teiki${bandOf(i)}">定期売上</th><th class="col-teiki${bandOf(i)}">定期粗利</th><th class="col-tsujo${bandOf(i)}">通常売上</th><th class="col-tsujo${bandOf(i)}">通常粗利</th>`)
      .join('');

    const bodyRows = rows.map(row => {
      const brandCells = pivot.brands.map((b, i) => {
        const cell = row.byBrand[b];
        const m = brandMax[b];
        const band = bandOf(i);
        return `<td class="col-teiki${band}" style="${heatmapColor(cell.teikiSales, m.teikiSales)}">${formatYen(cell.teikiSales)}</td>`
          + `<td class="col-teiki${band}" style="${heatmapColor(cell.teikiProfit, m.teikiProfit)}">${formatYen(cell.teikiProfit)}</td>`
          + `<td class="col-tsujo${band}" style="${heatmapColor(cell.tsujoSales, m.tsujoSales)}">${formatYen(cell.tsujoSales)}</td>`
          + `<td class="col-tsujo${band}" style="${heatmapColor(cell.tsujoProfit, m.tsujoProfit)}">${formatYen(cell.tsujoProfit)}</td>`;
      }).join('');
      return `<tr>
        <td>${row.yearMonth}</td>
        <td class="col-teiki" style="${heatmapColor(row.totalTeikiSales, totalMax.teikiSales)}">${formatYen(row.totalTeikiSales)}</td>
        <td class="col-teiki" style="${heatmapColor(row.totalTeikiProfit, totalMax.teikiProfit)}">${formatYen(row.totalTeikiProfit)}</td>
        <td class="col-tsujo" style="${heatmapColor(row.totalTsujoSales, totalMax.tsujoSales)}">${formatYen(row.totalTsujoSales)}</td>
        <td class="col-tsujo" style="${heatmapColor(row.totalTsujoProfit, totalMax.tsujoProfit)}">${formatYen(row.totalTsujoProfit)}</td>
        ${brandCells}
      </tr>`;
    }).join('');

    return `<div class="brand-pivot-scroll">
      <table class="brand-pivot-table">
        <thead>
          <tr><th rowspan="2">月</th><th colspan="4">全体</th>${brandHeaderCells}</tr>
          <tr><th class="col-teiki">定期売上</th><th class="col-teiki">定期粗利</th><th class="col-tsujo">通常売上</th><th class="col-tsujo">通常粗利</th>${brandSubHeaderCells}</tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>`;
  }

  return { formatYen, formatPct, renderKpiCardsHTML, renderChannelTableHTML, renderMappingWarningsHTML, renderBrandTableHTML, renderProductBrandWarningsHTML, heatmapColor, renderBrandMonthlyPivotHTML };
});
