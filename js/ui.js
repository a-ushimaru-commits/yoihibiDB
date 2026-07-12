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

  return { formatYen, formatPct, renderKpiCardsHTML, renderChannelTableHTML, renderMappingWarningsHTML, renderBrandTableHTML, renderProductBrandWarningsHTML };
});
