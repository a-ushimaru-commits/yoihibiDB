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

  function excelSerialToDate(serial) {
    // Excel serial 1 = January 1, 1900 (epoch from December 30, 1899)
    const ms = Date.UTC(1899, 11, 30) + serial * 86400000;
    return new Date(ms);
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function ymdFromDate(d) {
    return {
      yearMonth: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`,
      date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
    };
  }

  function parseShippingDate(value) {
    if (value == null || value === '') return null;
    if (value instanceof Date) return ymdFromDate(value);
    if (typeof value === 'number') {
      // For Excel serial numbers, use UTC methods since they're calendar-based
      const d = excelSerialToDate(value);
      return {
        yearMonth: `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`,
        date: `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`,
      };
    }

    const s = String(value).trim();
    let m = s.match(/^(\d{2})\/(\d{2})\/(\d{2})$/); // YY/MM/DD
    if (m) return ymdFromDate(new Date(2000 + Number(m[1]), Number(m[2]) - 1, Number(m[3])));

    m = s.match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/); // YYYY-MM-DD or YYYY/MM/DD
    if (m) return ymdFromDate(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));

    return null;
  }

  function parseMonthlyWorkbook(workbook, mediaMapping) {
    const rows = sheetToRows(workbook, '売上明細_提出');
    if (!rows) {
      throw new Error('シート「売上明細_提出」が見つかりません。月次実績ファイルを確認してください。');
    }
    const required = ['出荷日', '媒体名', '販売区分', 'ブランド区分'];
    const headerIdx = findHeaderRowIndex(rows, required);
    if (headerIdx === -1) {
      throw new Error('売上明細_提出シートに必要な列（出荷日・媒体名・販売区分・ブランド区分）が見つかりません。');
    }
    const header = rows[headerIdx].map(v => (v == null ? '' : String(v).trim()));
    const col = name => header.indexOf(name);
    const idx = {
      shipDate: col('出荷日'), media: col('媒体名'), type: col('販売区分'), brand: col('ブランド区分'),
      sales: col('金額'), cost: col('仕入金額'), profit: col('粗利額'),
    };

    const mapping = require('./mapping.js');
    const agg = new Map();
    const unmappedMedia = {};

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      if (String(row[idx.brand]) !== '22') continue;

      const parsedDate = parseShippingDate(row[idx.shipDate]);
      if (!parsedDate) continue;

      const mapped = mapping.mapMediaToChannel(row[idx.media], mediaMapping);
      const sales = Number(row[idx.sales]) || 0;
      const cost = Number(row[idx.cost]) || 0;
      const profit = Number(row[idx.profit]) || 0;

      if (!mapped.mapped) {
        const rawName = (row[idx.media] == null ? '' : String(row[idx.media])).trim();
        if (!unmappedMedia[rawName]) unmappedMedia[rawName] = { count: 0, sales: 0 };
        unmappedMedia[rawName].count += 1;
        unmappedMedia[rawName].sales += sales;
      }
      if (mapped.channel === null) continue;

      const type = row[idx.type];
      if (!type) continue;

      const key = `${parsedDate.yearMonth}|${mapped.channel}|${type}`;
      if (!agg.has(key)) {
        agg.set(key, { yearMonth: parsedDate.yearMonth, channel: mapped.channel, type: String(type), sales: 0, cost: 0, profit: 0 });
      }
      const rec = agg.get(key);
      rec.sales += sales;
      rec.cost += cost;
      rec.profit += profit;
    }

    return { records: Array.from(agg.values()), unmappedMedia };
  }

  return { findHeaderRowIndex, parseBaseWorkbook, parseShippingDate, parseMonthlyWorkbook };
});
