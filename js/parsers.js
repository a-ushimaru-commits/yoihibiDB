(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.YoiHibi = Object.assign(root.YoiHibi || {}, factory());
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {

  function findHeaderRowIndex(rows, requiredNames) {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || [];
      const rowStrings = row.map(v => (v == null ? '' : String(v).trim()));
      const hasAll = requiredNames.every(name => rowStrings.includes(name));
      if (hasAll) return i;
    }
    return -1;
  }

  function sheetToRows(workbook, sheetName) {
    const XLSX = require('xlsx');
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return null;
    return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
  }

  function parseBaseWorkbook(workbook) {
    const rows = sheetToRows(workbook, '詳細明細');
    if (!rows) {
      throw new Error('シート「詳細明細」が見つかりません。1期実績ファイルを確認してください。');
    }
    const required = ['月', '販売区分', '定期/通常', '売上', '仕入額', '粗利'];
    const headerIdx = findHeaderRowIndex(rows, required);
    if (headerIdx === -1) {
      throw new Error('詳細明細シートに必要な列（月・販売区分・定期/通常・売上・仕入額・粗利）が見つかりません。');
    }
    const header = rows[headerIdx].map(v => (v == null ? '' : String(v).trim()));
    const col = name => header.indexOf(name);
    const idx = {
      month: col('月'),
      channel: col('販売区分'),
      type: col('定期/通常'),
      sales: col('売上'),
      cost: col('仕入額'),
      profit: col('粗利'),
    };

    const agg = new Map();
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      const yearMonth = row[idx.month];
      if (!yearMonth || !/^\d{4}-\d{2}$/.test(String(yearMonth))) continue;
      const channel = row[idx.channel];
      const type = row[idx.type];
      if (!channel || !type) continue;
      const key = `${yearMonth}|${channel}|${type}`;
      if (!agg.has(key)) {
        agg.set(key, { yearMonth: String(yearMonth), channel: String(channel), type: String(type), sales: 0, cost: 0, profit: 0 });
      }
      const rec = agg.get(key);
      rec.sales += Number(row[idx.sales]) || 0;
      rec.cost += Number(row[idx.cost]) || 0;
      rec.profit += Number(row[idx.profit]) || 0;
    }
    return Array.from(agg.values());
  }

  return { findHeaderRowIndex, parseBaseWorkbook };
});
