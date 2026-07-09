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
