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

  function formatNumber(n) {
    return Math.round(n).toLocaleString('ja-JP');
  }

  function pctSpan(value) {
    const text = formatPct(value);
    if (value == null || value === 0) return text;
    const cls = value > 0 ? 'kpi-num-positive' : 'kpi-num-negative';
    return `<span class="${cls}">${text}</span>`;
  }

  function renderKpiCardsHTML(c) {
    return `
      <div class="kpi-card">
        <div class="kpi-label">売上</div>
        <div class="kpi-value">${formatYen(c.sales)}</div>
        <div class="kpi-sub">1期比 ${pctSpan(c.salesYoY)} ／ 前月比 ${pctSpan(c.salesMoM)}</div>
        <div class="kpi-sub">目標達成率（全体） ${pctSpan(c.salesTargetRate)}</div>
        <div class="kpi-sub">目標達成率（日割） ${pctSpan(c.salesTargetRateProrated)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">粗利</div>
        <div class="kpi-value">${formatYen(c.profit)}</div>
        <div class="kpi-sub">1期比 ${pctSpan(c.profitYoY)} ／ 前月比 ${pctSpan(c.profitMoM)}</div>
        <div class="kpi-sub">目標達成率（全体） ${pctSpan(c.profitTargetRate)}</div>
        <div class="kpi-sub">目標達成率（日割） ${pctSpan(c.profitTargetRateProrated)}</div>
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

  function renderChannelMonthlyPivotHTML(pivot) {
    if (!pivot || !pivot.rows || pivot.rows.length === 0) {
      return '<p class="channel-pivot-empty">表示できるデータがありません（月次実績を取込むと表示されます）。</p>';
    }
    const rows = pivot.rows;
    const maxAbsOf = accessor => Math.max(0, ...rows.map(r => Math.abs(accessor(r))));
    const totalMax = {
      teikiSales: maxAbsOf(r => r.totalTeikiSales), teikiProfit: maxAbsOf(r => r.totalTeikiProfit),
      tsujoSales: maxAbsOf(r => r.totalTsujoSales), tsujoProfit: maxAbsOf(r => r.totalTsujoProfit),
    };
    const channelMax = {};
    pivot.channels.forEach(c => {
      channelMax[c] = {
        teikiSales: maxAbsOf(r => r.byChannel[c].teikiSales), teikiProfit: maxAbsOf(r => r.byChannel[c].teikiProfit),
        tsujoSales: maxAbsOf(r => r.byChannel[c].tsujoSales), tsujoProfit: maxAbsOf(r => r.byChannel[c].tsujoProfit),
      };
    });

    const bandOf = i => (i % 2 === 1 ? ' brand-band' : '');

    const channelHeaderCells = pivot.channels.map((c, i) => (bandOf(i) ? `<th colspan="4" class="brand-band">${c}</th>` : `<th colspan="4">${c}</th>`)).join('');
    const channelSubHeaderCells = pivot.channels
      .map((c, i) => `<th class="col-teiki${bandOf(i)}">定期売上</th><th class="col-teiki${bandOf(i)}">定期粗利</th><th class="col-tsujo${bandOf(i)}">通常売上</th><th class="col-tsujo${bandOf(i)}">通常粗利</th>`)
      .join('');

    const bodyRows = rows.map(row => {
      const channelCells = pivot.channels.map((c, i) => {
        const cell = row.byChannel[c];
        const m = channelMax[c];
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
        ${channelCells}
      </tr>`;
    }).join('');

    return `<div class="channel-pivot-scroll">
      <table class="channel-pivot-table">
        <thead>
          <tr><th rowspan="2">月</th><th colspan="4">全体</th>${channelHeaderCells}</tr>
          <tr><th class="col-teiki">定期売上</th><th class="col-teiki">定期粗利</th><th class="col-tsujo">通常売上</th><th class="col-tsujo">通常粗利</th>${channelSubHeaderCells}</tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>`;
  }

  function renderOwnChannelMonthlySummaryHTML(summary) {
    if (!summary || !summary.rows || summary.rows.length === 0) {
      return '<p class="ocms-empty">表示できるデータがありません（自社チャネルの月次実績・日次実績を取込むと表示されます）。</p>';
    }
    const brands = summary.brands || [];

    function metricCells(m) {
      return `<td>${formatNumber(m.qty)}</td><td>${formatYen(m.sales)}</td><td>${formatYen(m.profit)}</td><td>${formatPct(m.profitRate)}</td>`;
    }
    function pctTd(value) {
      if (value == null) return '<td>N/A</td>';
      const cls = value > 0 ? 'pct-positive' : (value < 0 ? 'pct-negative' : '');
      return cls ? `<td class="${cls}">${formatPct(value)}</td>` : `<td>${formatPct(value)}</td>`;
    }
    function yoyCells(y) {
      return pctTd(y.qtyPct) + pctTd(y.salesPct) + pctTd(y.profitPct) + pctTd(y.profitRatePtDiff);
    }

    const brandHeaderCells = brands.map(b => `<th colspan="4">${b}</th>`).join('');
    const brandSubHeaderCells = brands.map(() => '<th>数量</th><th>売上</th><th>粗利</th><th>粗利率</th>').join('');

    const bodyRows = summary.rows.map(row => {
      const brandCellsFor = accessor => brands.map(b => metricCells(accessor(row.byBrand[b]))).join('');
      const brandYoyCellsFor = accessor => brands.map(b => yoyCells(accessor(row.byBrand[b]))).join('');

      return `<tr class="ocms-teiki"><td>${row.yearMonth}</td><td>定期</td>${metricCells(row.teiki)}${brandCellsFor(bb => bb.teiki)}</tr>
        <tr class="ocms-tsujo"><td>${row.yearMonth}</td><td>通常</td>${metricCells(row.tsujo)}${brandCellsFor(bb => bb.tsujo)}</tr>
        <tr class="ocms-total"><td>${row.yearMonth}</td><td>月計</td>${metricCells(row.total)}${brandCellsFor(bb => bb.total)}</tr>
        <tr class="ocms-yoy"><td>${row.yearMonth}</td><td>昨対比（定期）</td>${yoyCells(row.yoy.teiki)}${brandYoyCellsFor(bb => bb.yoy.teiki)}</tr>
        <tr class="ocms-yoy"><td>${row.yearMonth}</td><td>昨対比（通常）</td>${yoyCells(row.yoy.tsujo)}${brandYoyCellsFor(bb => bb.yoy.tsujo)}</tr>
        <tr class="ocms-yoy"><td>${row.yearMonth}</td><td>昨対比（月計）</td>${yoyCells(row.yoy.total)}${brandYoyCellsFor(bb => bb.yoy.total)}</tr>
        <tr class="ocms-ttm"><td>${row.yearMonth}</td><td>年計対比（定期）</td>${yoyCells(row.ttmYoy.teiki)}${brandYoyCellsFor(bb => bb.ttmYoy.teiki)}</tr>
        <tr class="ocms-ttm"><td>${row.yearMonth}</td><td>年計対比（通常）</td>${yoyCells(row.ttmYoy.tsujo)}${brandYoyCellsFor(bb => bb.ttmYoy.tsujo)}</tr>
        <tr class="ocms-ttm"><td>${row.yearMonth}</td><td>年計対比（月計）</td>${yoyCells(row.ttmYoy.total)}${brandYoyCellsFor(bb => bb.ttmYoy.total)}</tr>`;
    }).join('');

    return `<div class="ocms-scroll">
      <table class="ocms-table">
        <thead>
          <tr><th rowspan="2">月</th><th rowspan="2">区分</th><th colspan="4">自社全体</th>${brandHeaderCells}</tr>
          <tr><th>数量</th><th>売上</th><th>粗利</th><th>粗利率</th>${brandSubHeaderCells}</tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>`;
  }

  return { formatYen, formatPct, formatNumber, renderKpiCardsHTML, renderChannelTableHTML, renderMappingWarningsHTML, renderBrandTableHTML, renderProductBrandWarningsHTML, heatmapColor, renderBrandMonthlyPivotHTML, renderChannelMonthlyPivotHTML, renderOwnChannelMonthlySummaryHTML };
});
