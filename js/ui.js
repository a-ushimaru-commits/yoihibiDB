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

  return { formatYen, formatPct, renderKpiCardsHTML, renderChannelTableHTML, renderMappingWarningsHTML, renderBrandTableHTML, renderProductBrandWarningsHTML, heatmapColor, renderBrandMonthlySeriesHTML };
});
