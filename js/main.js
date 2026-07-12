(function () {
  const { parseBaseWorkbook, parseMonthlyWorkbook, parseDailyCsv, parseBrandLookup, detectFileType } = window.YoiHibi;
  const { createStore } = window.YoiHibi;
  const { getMonthlyComparison, getChannelTable, getBrandTable, getDailyCumulativeSeries, getMonthlyTrend } = window.YoiHibi;
  const { renderKpiCardsHTML, renderChannelTableHTML, renderMappingWarningsHTML, renderBrandTableHTML, renderProductBrandWarningsHTML } = window.YoiHibi;

  const store = createStore(window.localStorage);
  let trendChart = null;
  let dailyChart = null;

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

  function showStatus(message, isError) {
    const box = el('status');
    box.textContent = message;
    box.style.color = isError ? '#d93025' : '#188038';
  }

  function showWarnings(unmappedMedia) {
    el('warnings').innerHTML = renderMappingWarningsHTML(unmappedMedia);
  }

  function showBrandWarnings(unmappedProducts) {
    const knownBrands = Array.from(new Set(Object.values(store.getState().productBrandMapping))).sort();
    el('brandWarnings').innerHTML = renderProductBrandWarningsHTML(unmappedProducts, knownBrands);
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
      if (Object.keys(overrides).length === 0) return;
      const merged = Object.assign({}, store.getState().productBrandMapping, overrides);
      store.setProductBrandMapping(merged);
      showStatus('ブランドの割り当てを保存しました。対象月の月次実績／日次売上ファイルを再取込みすると反映されます。');
      el('brandWarnings').innerHTML = '';
    });
  }

  function refreshMonthOptions() {
    const state = store.getState();
    const months = Array.from(new Set(state.monthlyRecords.map(r => r.yearMonth))).sort();
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
    el('channelTable').innerHTML = renderChannelTableHTML(getChannelTable(state, yearMonth));
    el('brandTable').innerHTML = renderBrandTableHTML(getBrandTable(state, yearMonth));

    renderTrendChart(getMonthlyTrend(state));
    renderDailyChart(getDailyCumulativeSeries(state, yearMonth));
  }

  function renderTrendChart(trend) {
    const ctx = el('trendChart').getContext('2d');
    const data = {
      labels: trend.map(t => t.yearMonth),
      datasets: [
        { label: '2期 売上', data: trend.map(t => t.currentSales), borderColor: '#1a73e8', fill: false },
        { label: '1期 売上', data: trend.map(t => t.baseSales), borderColor: '#9aa0a6', borderDash: [6, 4], fill: false },
      ],
    };
    if (trendChart) { trendChart.data = data; trendChart.update(); return; }
    trendChart = new Chart(ctx, { type: 'line', data, options: { responsive: true } });
  }

  function renderDailyChart(series) {
    const ctx = el('dailyChart').getContext('2d');
    const data = {
      labels: series.map(s => s.day),
      datasets: [
        { label: '当月累積売上', data: series.map(s => s.actualSales), borderColor: '#1a73e8', fill: false },
        { label: '1期同月ペース', data: series.map(s => s.paceSales), borderColor: '#9aa0a6', borderDash: [6, 4], fill: false },
      ],
    };
    if (dailyChart) { dailyChart.data = data; dailyChart.update(); return; }
    dailyChart = new Chart(ctx, { type: 'line', data, options: { responsive: true } });
  }

  function setupDropzone() {
    const zone = el('dropzone');
    ['dragenter', 'dragover'].forEach(evt => zone.addEventListener(evt, e => { e.preventDefault(); zone.classList.add('dragover'); }));
    ['dragleave', 'drop'].forEach(evt => zone.addEventListener(evt, e => { e.preventDefault(); zone.classList.remove('dragover'); }));
    zone.addEventListener('drop', e => { Array.from(e.dataTransfer.files).forEach(handleFile); });
    el('fileInput').addEventListener('change', e => { Array.from(e.target.files).forEach(handleFile); });
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
