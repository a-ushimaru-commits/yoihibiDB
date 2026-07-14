(function () {
  const { parseBaseWorkbook, parseMonthlyWorkbook, parseDailyCsv, parseBrandLookup, parseTargetsWorkbook, detectFileType, guessBrandForProductCode } = window.YoiHibi;
  const { createStore } = window.YoiHibi;
  const { getMonthlyComparison, getChannelTable, getBrandTable, getDailyCumulativeSeries, getMonthlyTrend, getBrandMonthlyPivot, getChannelMonthlyPivot, getOwnChannelMonthlySummary } = window.YoiHibi;
  const { renderKpiCardsHTML, renderChannelTableHTML, renderMappingWarningsHTML, renderBrandTableHTML, renderProductBrandWarningsHTML, renderBrandMonthlyPivotHTML, renderChannelMonthlyPivotHTML, renderOwnChannelMonthlySummaryHTML, renderJanCostWarningHTML } = window.YoiHibi;

  const store = createStore(window.localStorage);
  let trendSalesChart = null;
  let trendQtyChart = null;
  let dailySalesChart = null;
  let dailyQtyChart = null;

  // よい日々目標.xlsx の「6月」列は2026年度（2026-06〜2027-05）の6月を指す。
  // 翌年度分のファイルが来たら更新する。
  const TARGETS_FISCAL_YEAR_START = 2026;

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
      } else if (type === 'brandLookup') {
        const mapping = parseBrandLookup(workbook);
        store.setProductBrandMapping(mapping);
        showStatus(`商品コード→ブランド対応表を取込みました（${Object.keys(mapping).length}件）`);
      } else if (type === 'targets') {
        const { targets: parsedTargets, ownChannelTargets: parsedOwnChannelTargets } = parseTargetsWorkbook(workbook, TARGETS_FISCAL_YEAR_START);
        const parsedMonths = new Set(parsedTargets.map(t => t.yearMonth));
        store.setTargets(store.getState().targets.filter(t => !parsedMonths.has(t.yearMonth)).concat(parsedTargets));
        const parsedOwnMonths = new Set(parsedOwnChannelTargets.map(t => t.yearMonth));
        store.setOwnChannelTargets(store.getState().ownChannelTargets.filter(t => !parsedOwnMonths.has(t.yearMonth)).concat(parsedOwnChannelTargets));
        showStatus(`年間目標を取込みました（${parsedTargets.length}ヶ月分）`);
      } else if (type === 'monthly') {
        const { records, unmappedMedia, unmappedProducts, janUnitCosts } = parseMonthlyWorkbook(workbook, store.getState().mediaMapping, store.getState().productBrandMapping, store.getState().productTypeMapping);
        const months = Array.from(new Set(records.map(r => r.yearMonth)));
        months.forEach(ym => store.upsertMonthlyRecords(ym, records.filter(r => r.yearMonth === ym)));
        store.upsertJanUnitCosts(janUnitCosts);
        showStatus(`月次実績を取込みました（${records.length}件）`);
        showWarnings(unmappedMedia);
        showBrandWarnings(unmappedProducts);
      } else if (type === 'daily') {
        const text = decodeShiftJis(buffer);
        const { records, unmappedMedia, unmappedProducts, janCoverageRate } = parseDailyCsv(text, store.getState().mediaMapping, store.getState().productBrandMapping, store.getState().janUnitCosts, store.getState().productTypeMapping);
        const months = Array.from(new Set(records.map(r => r.yearMonth)));
        months.forEach(ym => store.upsertDailyRecords(ym, records.filter(r => r.yearMonth === ym)));
        showStatus(`日次売上を取込みました（${records.length}件）`);
        showWarnings(unmappedMedia);
        showBrandWarnings(unmappedProducts);
        el('janCostWarning').innerHTML = renderJanCostWarningHTML(janCoverageRate);
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

  function showBrandWarnings(unmappedProducts) {
    const productBrandMapping = store.getState().productBrandMapping;
    const knownBrands = Array.from(new Set(Object.values(productBrandMapping))).sort();
    const guesses = {};
    Object.keys(unmappedProducts || {}).forEach(code => {
      const guess = guessBrandForProductCode(code, productBrandMapping);
      if (guess) guesses[code] = guess;
    });
    el('brandWarnings').innerHTML = renderProductBrandWarningsHTML(unmappedProducts, knownBrands, guesses);
    setupBrandAssignForm();
  }

  function setupBrandAssignForm() {
    const form = document.getElementById('brandAssignForm');
    if (!form) return;
    form.querySelectorAll('select[data-product-code]').forEach(select => {
      const code = select.getAttribute('data-product-code');
      const newInput = form.querySelector(`input[data-product-code-new="${code}"]`);
      if (!newInput) return;
      select.addEventListener('change', () => {
        newInput.style.display = select.value === '__new__' ? '' : 'none';
      });
    });
    form.addEventListener('submit', e => {
      e.preventDefault();
      const overrides = {};
      form.querySelectorAll('[data-product-code]').forEach(field => {
        const code = field.getAttribute('data-product-code');
        let value = field.value.trim();
        if (field.tagName === 'SELECT' && value === '__new__') {
          const newInput = form.querySelector(`input[data-product-code-new="${code}"]`);
          value = newInput ? newInput.value.trim() : '';
        }
        if (value) overrides[code] = value;
      });
      const typeOverrides = {};
      form.querySelectorAll('[data-product-code-type]').forEach(field => {
        const code = field.getAttribute('data-product-code-type');
        const value = field.value.trim();
        if (value) typeOverrides[code] = value;
      });
      const hasBrandOverrides = Object.keys(overrides).length > 0;
      const hasTypeOverrides = Object.keys(typeOverrides).length > 0;
      if (!hasBrandOverrides && !hasTypeOverrides) return;
      if (hasBrandOverrides) {
        store.setProductBrandMapping(Object.assign({}, store.getState().productBrandMapping, overrides));
      }
      if (hasTypeOverrides) {
        store.setProductTypeMapping(Object.assign({}, store.getState().productTypeMapping, typeOverrides));
      }
      showStatus('ブランド／定期・通常区分の割り当てを保存しました。対象月の月次実績／日次売上ファイルを再取込みすると反映されます。');
      el('brandWarnings').innerHTML = '';
    });
  }

  function refreshMonthOptions() {
    const state = store.getState();
    const months = Array.from(new Set(
      state.monthlyRecords.map(r => r.yearMonth).concat(state.dailyRecords.map(r => r.yearMonth))
    )).sort();
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
    el('ownChannelKpiRow').innerHTML = renderKpiCardsHTML(getMonthlyComparison(state, yearMonth, { channel: '自社', targets: state.ownChannelTargets }), '自社');
    el('channelTable').innerHTML = renderChannelTableHTML(getChannelTable(state, yearMonth));
    el('brandTable').innerHTML = renderBrandTableHTML(getBrandTable(state, yearMonth));
    el('ownChannelBrandMonthlyPivot').innerHTML = renderBrandMonthlyPivotHTML(getBrandMonthlyPivot(state, { channel: '自社' }));
    el('ownChannelMonthlySummary').innerHTML = renderOwnChannelMonthlySummaryHTML(getOwnChannelMonthlySummary(state, yearMonth));
    el('brandMonthlyPivot').innerHTML = renderBrandMonthlyPivotHTML(getBrandMonthlyPivot(state));
    el('channelMonthlyPivot').innerHTML = renderChannelMonthlyPivotHTML(getChannelMonthlyPivot(state));

    renderTrendSalesChart(getMonthlyTrend(state));
    renderTrendQtyChart(getMonthlyTrend(state));
    renderDailySalesChart(getDailyCumulativeSeries(state, yearMonth));
    renderDailyQtyChart(getDailyCumulativeSeries(state, yearMonth));
  }

  const CHART_OPTIONS = { responsive: true, maintainAspectRatio: false };

  function renderTrendSalesChart(trend) {
    const ctx = el('trendSalesChart').getContext('2d');
    const data = {
      labels: trend.map(t => t.yearMonth),
      datasets: [
        // 2期売上=青、1期売上=水色で年度を区別
        { label: '2期 売上', data: trend.map(t => t.currentSales), borderColor: '#1a73e8', fill: false },
        { label: '1期 売上', data: trend.map(t => t.baseSales), borderColor: '#4fc3f7', fill: false },
      ],
    };
    if (trendSalesChart) { trendSalesChart.data = data; trendSalesChart.update(); return; }
    trendSalesChart = new Chart(ctx, { type: 'line', data, options: CHART_OPTIONS });
  }

  function renderTrendQtyChart(trend) {
    const ctx = el('trendQtyChart').getContext('2d');
    const data = {
      labels: trend.map(t => t.yearMonth),
      datasets: [
        // 定期=青系／通常=緑系は自社月別サマリー・月次推移表と同じ配色（サイト全体の定期/通常カラー規約）
        { label: '定期数', data: trend.map(t => t.teikiQty), borderColor: '#4285f4', fill: false },
        { label: '通常数', data: trend.map(t => t.tsujoQty), borderColor: '#188038', fill: false },
        // 1期定期数=グレー点線、1期通常数=黄緑点線
        { label: '1期 定期数', data: trend.map(t => t.baseTeikiQty), borderColor: '#9aa0a6', borderDash: [6, 4], fill: false },
        { label: '1期 通常数', data: trend.map(t => t.baseTsujoQty), borderColor: '#c0ca33', borderDash: [6, 4], fill: false },
      ],
    };
    if (trendQtyChart) { trendQtyChart.data = data; trendQtyChart.update(); return; }
    trendQtyChart = new Chart(ctx, { type: 'line', data, options: CHART_OPTIONS });
  }

  function renderDailySalesChart(series) {
    const ctx = el('dailySalesChart').getContext('2d');
    const data = {
      labels: series.map(s => s.day),
      datasets: [
        // 当月(2期)=青、1期同月ペース=水色で年度を区別
        { label: '当月累積売上', data: series.map(s => s.actualSales), borderColor: '#1a73e8', fill: false },
        { label: '1期同月ペース', data: series.map(s => s.paceSales), borderColor: '#4fc3f7', fill: false },
      ],
    };
    if (dailySalesChart) { dailySalesChart.data = data; dailySalesChart.update(); return; }
    dailySalesChart = new Chart(ctx, { type: 'line', data, options: CHART_OPTIONS });
  }

  function renderDailyQtyChart(series) {
    const ctx = el('dailyQtyChart').getContext('2d');
    const data = {
      labels: series.map(s => s.day),
      datasets: [
        // 定期=青系／通常=緑系は自社月別サマリー・月次推移表と同じ配色（サイト全体の定期/通常カラー規約）
        { label: '定期数（累積）', data: series.map(s => s.actualTeikiQty), borderColor: '#4285f4', fill: false },
        { label: '通常数（累積）', data: series.map(s => s.actualTsujoQty), borderColor: '#188038', fill: false },
        // 1期定期数=グレー点線、1期通常数=黄緑点線
        { label: '1期 定期数（ペース）', data: series.map(s => s.paceTeikiQty), borderColor: '#9aa0a6', borderDash: [6, 4], fill: false },
        { label: '1期 通常数（ペース）', data: series.map(s => s.paceTsujoQty), borderColor: '#c0ca33', borderDash: [6, 4], fill: false },
      ],
    };
    if (dailyQtyChart) { dailyQtyChart.data = data; dailyQtyChart.update(); return; }
    dailyQtyChart = new Chart(ctx, { type: 'line', data, options: CHART_OPTIONS });
  }

  function setupDropzone() {
    const zone = el('dropzone');
    ['dragenter', 'dragover'].forEach(evt => zone.addEventListener(evt, e => { e.preventDefault(); zone.classList.add('dragover'); }));
    ['dragleave', 'drop'].forEach(evt => zone.addEventListener(evt, e => { e.preventDefault(); zone.classList.remove('dragover'); }));
    zone.addEventListener('drop', async e => { await handleFiles(Array.from(e.dataTransfer.files)); });
    el('fileInput').addEventListener('change', async e => { await handleFiles(Array.from(e.target.files)); });
  }

  async function handleFiles(files) {
    // Processed one at a time (not in parallel) so that, e.g., a monthly file's janUnitCosts
    // are saved before a daily file selected alongside it is parsed and can use them.
    for (const file of files) {
      await handleFile(file);
    }
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
