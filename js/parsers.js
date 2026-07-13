(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.YoiHibi = Object.assign(root.YoiHibi || {}, factory());
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  // Environment-aware dependency resolution: works in both Node (require exists) and browser (falls back to globals)
  const XLSXLib = (typeof require === 'function') ? require('xlsx') : (typeof window !== 'undefined' ? window.XLSX : undefined);
  const mappingLib = (typeof require === 'function') ? require('./mapping.js') : (typeof window !== 'undefined' ? window.YoiHibi : undefined);

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
    const XLSX = XLSXLib;
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return null;
    return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
  }

  function parseBaseWorkbook(workbook) {
    const rows = sheetToRows(workbook, '詳細明細');
    if (!rows) {
      throw new Error('シート「詳細明細」が見つかりません。1期実績ファイルを確認してください。');
    }
    const required = ['月', '販売区分', 'よい日々', '定期/通常', '売上', '仕入額', '粗利'];
    const headerIdx = findHeaderRowIndex(rows, required);
    if (headerIdx === -1) {
      throw new Error('詳細明細シートに必要な列（月・販売区分・よい日々・定期/通常・売上・仕入額・粗利）が見つかりません。');
    }
    const header = rows[headerIdx].map(v => (v == null ? '' : String(v).trim()));
    const col = name => header.indexOf(name);
    const idx = {
      month: col('月'),
      channel: col('販売区分'),
      brand: col('よい日々'),
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
      const brandCell = row[idx.brand];
      const brand = (brandCell == null || String(brandCell).trim() === '') ? null : String(brandCell).trim();
      const key = `${yearMonth}|${channel}|${type}|${brand}`;
      if (!agg.has(key)) {
        agg.set(key, { yearMonth: String(yearMonth), channel: String(channel), type: String(type), brand, sales: 0, cost: 0, profit: 0 });
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

  function isYoiHibiProductCode(value) {
    return value != null && String(value).trim().toUpperCase().startsWith('FH');
  }

  function normalizeProductCode(value) {
    return (value == null ? '' : String(value).trim().toUpperCase());
  }

  function typeFromProductName(productName) {
    return productName.includes('定期') ? '定期' : '通常';
  }

  function parseBrandLookup(workbook) {
    const sheetName = workbook.SheetNames[0];
    const rows = sheetToRows(workbook, sheetName);
    if (!rows) {
      throw new Error('商品コード→ブランド対応表のシートが読み込めません。');
    }
    const required = ['商品コード', '商品細分'];
    const headerIdx = findHeaderRowIndex(rows, required);
    if (headerIdx === -1) {
      throw new Error('分解詳細リストに必要な列（商品コード・商品細分）が見つかりません。');
    }
    const header = rows[headerIdx].map(v => (v == null ? '' : String(v).trim()));
    const col = name => header.indexOf(name);
    const idx = { productCode: col('商品コード'), brand: col('商品細分') };

    const mapping = {};
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      const code = normalizeProductCode(row[idx.productCode]);
      const brand = row[idx.brand];
      if (code === '') continue;
      if (brand == null || String(brand).trim() === '') continue;
      mapping[code] = String(brand).trim();
    }
    return mapping;
  }

  function guessBrandForProductCode(code, productBrandMapping) {
    const target = normalizeProductCode(code);
    const brandMap = productBrandMapping || {};
    if (target === '') return null;

    let bestKey = null;
    let bestLen = 0;
    let ambiguous = false;

    for (const key of Object.keys(brandMap)) {
      const maxLen = Math.min(target.length, key.length);
      let len = 0;
      while (len < maxLen && target[len] === key[len]) len += 1;
      const threshold = maxLen - 2;
      if (len < 10 || len < threshold) continue;

      if (len > bestLen) {
        bestLen = len;
        bestKey = key;
        ambiguous = false;
      } else if (len === bestLen && bestKey && brandMap[key] !== brandMap[bestKey]) {
        ambiguous = true;
      }
    }

    if (!bestKey || ambiguous) return null;
    return brandMap[bestKey];
  }

  function parseMonthlyWorkbook(workbook, mediaMapping, productBrandMapping) {
    const rows = sheetToRows(workbook, '売上明細_提出');
    if (!rows) {
      throw new Error('シート「売上明細_提出」が見つかりません。月次実績ファイルを確認してください。');
    }
    const required = ['出荷日', '媒体名', '商品コード', '商品名', '金額合計'];
    const headerIdx = findHeaderRowIndex(rows, required);
    if (headerIdx === -1) {
      throw new Error('売上明細_提出シートに必要な列（出荷日・媒体名・商品コード・商品名・金額合計）が見つかりません。');
    }
    const header = rows[headerIdx].map(v => (v == null ? '' : String(v).trim()));
    const col = name => header.indexOf(name);
    const idx = {
      shipDate: col('出荷日'), media: col('媒体名'), productCode: col('商品コード'),
      productName: col('商品名'),
      sales: col('金額合計'), cost: col('仕入金額'), profit: col('粗利額'),
      jan: col('JANコード'), packCount: col('構成数'), qty: col('数量'),
    };

    const mapping = mappingLib;
    const brandMap = productBrandMapping || {};
    const agg = new Map();
    const unmappedMedia = {};
    const unmappedProducts = {};
    const janCostAcc = new Map();

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      if (!isYoiHibiProductCode(row[idx.productCode])) continue;

      const parsedDate = parseShippingDate(row[idx.shipDate]);
      if (!parsedDate) continue;

      const mapped = mapping.mapMediaToChannel(row[idx.media], mediaMapping);
      const sales = Number(row[idx.sales]) || 0;
      const cost = Number(row[idx.cost]) || 0;
      const profit = Number(row[idx.profit]) || 0;

      const jan = idx.jan === -1 || row[idx.jan] == null ? '' : String(row[idx.jan]).trim();
      const units = (Number(row[idx.packCount]) || 0) * (Number(row[idx.qty]) || 0);
      if (jan && units) {
        if (!janCostAcc.has(jan)) janCostAcc.set(jan, { totalCost: 0, totalUnits: 0 });
        const acc = janCostAcc.get(jan);
        acc.totalCost += cost;
        acc.totalUnits += units;
      }

      if (!mapped.mapped) {
        const rawName = (row[idx.media] == null ? '' : String(row[idx.media])).trim();
        if (!unmappedMedia[rawName]) unmappedMedia[rawName] = { count: 0, sales: 0 };
        unmappedMedia[rawName].count += 1;
        unmappedMedia[rawName].sales += sales;
      }
      if (mapped.channel === null) continue;

      const productName = row[idx.productName] == null ? '' : String(row[idx.productName]).trim();
      const type = typeFromProductName(productName);

      const productCode = normalizeProductCode(row[idx.productCode]);
      const hasBrand = Object.prototype.hasOwnProperty.call(brandMap, productCode);
      const brand = hasBrand ? brandMap[productCode] : '未分類';
      if (!hasBrand) {
        if (!unmappedProducts[productCode]) {
          unmappedProducts[productCode] = { count: 0, sales: 0, productName };
        }
        unmappedProducts[productCode].count += 1;
        unmappedProducts[productCode].sales += sales;
      }

      const key = `${parsedDate.yearMonth}|${mapped.channel}|${type}|${brand}`;
      if (!agg.has(key)) {
        agg.set(key, { yearMonth: parsedDate.yearMonth, channel: mapped.channel, type: String(type), brand, sales: 0, cost: 0, profit: 0 });
      }
      const rec = agg.get(key);
      rec.sales += sales;
      rec.cost += cost;
      rec.profit += profit;
    }

    const janUnitCosts = {};
    janCostAcc.forEach((acc, jan) => {
      janUnitCosts[jan] = acc.totalCost / acc.totalUnits;
    });

    return { records: Array.from(agg.values()), unmappedMedia, unmappedProducts, janUnitCosts };
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    let i = 0;
    const n = text.length;

    while (i < n) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i += 1; continue;
        }
        field += c; i += 1; continue;
      }
      if (c === '"') { inQuotes = true; i += 1; continue; }
      if (c === ',') { row.push(field); field = ''; i += 1; continue; }
      if (c === '\r') { i += 1; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i += 1; continue; }
      field += c; i += 1;
    }
    if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
    return rows.filter(r => !(r.length === 1 && r[0] === ''));
  }

  function parseDailyCsv(csvText, mediaMapping, productBrandMapping, janUnitCosts) {
    const rows = parseCsv(csvText);
    const required = ['出荷日', '媒体名', '商品コード', '商品名'];
    const headerIdx = findHeaderRowIndex(rows, required);
    if (headerIdx === -1) {
      throw new Error('CSVに必要な列（出荷日・媒体名・商品コード・商品名）が見つかりません。');
    }
    const header = rows[headerIdx].map(v => (v == null ? '' : String(v).trim()));
    const col = name => header.indexOf(name);
    const idx = {
      shipDate: col('出荷日'), media: col('媒体名'), productCode: col('商品コード'),
      productName: col('商品名'),
      sales: col('金額'), cost: col('仕入金額'), profit: col('粗利額'),
      jan: col('JANコード'), packCount: col('構成数'), qty: col('数量'),
    };
    const janCosts = janUnitCosts || {};

    const mapping = mappingLib;
    const brandMap = productBrandMapping || {};
    const agg = new Map();
    const unmappedMedia = {};
    const unmappedProducts = {};

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      if (!isYoiHibiProductCode(row[idx.productCode])) continue;

      const parsedDate = parseShippingDate(row[idx.shipDate]);
      if (!parsedDate) continue;

      const mapped = mapping.mapMediaToChannel(row[idx.media], mediaMapping);
      const sales = Number(row[idx.sales]) || 0;
      let cost = Number(row[idx.cost]) || 0;
      let profit = Number(row[idx.profit]) || 0;

      const jan = idx.jan === -1 || row[idx.jan] == null ? '' : String(row[idx.jan]).trim();
      const units = (Number(row[idx.packCount]) || 0) * (Number(row[idx.qty]) || 0);
      if (jan && units && Object.prototype.hasOwnProperty.call(janCosts, jan)) {
        cost = janCosts[jan] * units;
        profit = sales - cost;
      }

      if (!mapped.mapped) {
        const rawName = (row[idx.media] == null ? '' : String(row[idx.media])).trim();
        if (!unmappedMedia[rawName]) unmappedMedia[rawName] = { count: 0, sales: 0 };
        unmappedMedia[rawName].count += 1;
        unmappedMedia[rawName].sales += sales;
      }
      if (mapped.channel === null) continue;

      const productName = row[idx.productName] == null ? '' : String(row[idx.productName]).trim();
      const type = typeFromProductName(productName);

      const productCode = normalizeProductCode(row[idx.productCode]);
      const hasBrand = Object.prototype.hasOwnProperty.call(brandMap, productCode);
      const brand = hasBrand ? brandMap[productCode] : '未分類';
      if (!hasBrand) {
        if (!unmappedProducts[productCode]) {
          unmappedProducts[productCode] = { count: 0, sales: 0, productName };
        }
        unmappedProducts[productCode].count += 1;
        unmappedProducts[productCode].sales += sales;
      }

      const key = `${parsedDate.date}|${mapped.channel}|${type}|${brand}`;
      if (!agg.has(key)) {
        agg.set(key, { yearMonth: parsedDate.yearMonth, date: parsedDate.date, channel: mapped.channel, type: String(type), brand, sales: 0, cost: 0, profit: 0 });
      }
      const rec = agg.get(key);
      rec.sales += sales;
      rec.cost += cost;
      rec.profit += profit;
    }

    return { records: Array.from(agg.values()), unmappedMedia, unmappedProducts };
  }

  const TARGET_MONTH_NAME_TO_NUM = {
    '6月': 6, '7月': 7, '8月': 8, '9月': 9, '10月': 10, '11月': 11,
    '12月': 12, '1月': 1, '2月': 2, '3月': 3, '4月': 4, '5月': 5,
  };

  function parseTargetsWorkbook(workbook, fiscalYearStartYear) {
    const sheetName = workbook.SheetNames[0];
    const rows = sheetToRows(workbook, sheetName);
    if (!rows) {
      throw new Error('目標ファイルのシートが読み込めません。');
    }
    const headerIdx = rows.findIndex(row => row && row.includes('媒体') && row.includes('項目'));
    if (headerIdx === -1) {
      throw new Error('目標ファイルに必要な列（媒体・項目）が見つかりません。');
    }
    const header = rows[headerIdx].map(v => (v == null ? '' : String(v).trim()));
    const col = name => header.indexOf(name);
    const mediaCol = col('媒体');
    const itemCol = col('項目');
    const monthRow = (rows[headerIdx - 1] || []).map(v => (v == null ? '' : String(v).trim()));

    const budgetCols = [];
    const seenMonths = new Set();
    for (let i = 0; i < header.length; i++) {
      if (header[i] !== '予算') continue;
      const monthName = monthRow[i];
      const monthNum = TARGET_MONTH_NAME_TO_NUM[monthName];
      if (!monthNum || seenMonths.has(monthName)) continue;
      seenMonths.add(monthName);
      const year = monthNum >= 6 ? fiscalYearStartYear : fiscalYearStartYear + 1;
      budgetCols.push({ yearMonth: `${year}-${String(monthNum).padStart(2, '0')}`, colIndex: i });
    }

    const totalRowIdx = rows.findIndex(row => row && row[mediaCol] === '合計' && row[itemCol] === '売上');
    if (totalRowIdx === -1) {
      throw new Error('目標ファイルに「合計」の売上行が見つかりません。');
    }
    const salesRow = rows[totalRowIdx];
    const costRow = rows[totalRowIdx + 1];
    if (!costRow || (costRow[itemCol] == null ? '' : String(costRow[itemCol]).trim()) !== '原価') {
      throw new Error('目標ファイルの「合計」行の直後に原価行が見つかりません。');
    }

    const THOUSAND_YEN = 1000; // figures in this workbook are 千円 (thousand-yen) units, unlike the raw-yen records elsewhere
    return budgetCols.map(({ yearMonth, colIndex }) => {
      const sales = (Number(salesRow[colIndex]) || 0) * THOUSAND_YEN;
      const cost = (Number(costRow[colIndex]) || 0) * THOUSAND_YEN;
      return { yearMonth, salesTarget: sales, profitTarget: sales - cost };
    });
  }

  function detectFileType(fileName, sheetNames) {
    const name = fileName || '';
    const sheets = sheetNames || [];
    if (/^分解詳細リスト/.test(name)) return 'brandLookup';
    if (/^よい日々目標/.test(name)) return 'targets';
    if (/^粗利分析_よい日々1期/.test(name) || sheets.includes('詳細明細')) return 'base';
    if (/^商品別収益/.test(name) || sheets.includes('売上明細_提出')) return 'monthly';
    if (/\.csv$/i.test(name) || /^受注_売上一覧表/.test(name)) return 'daily';
    return 'unknown';
  }

  return { findHeaderRowIndex, parseBaseWorkbook, parseShippingDate, parseMonthlyWorkbook, parseCsv, parseDailyCsv, detectFileType, isYoiHibiProductCode, parseBrandLookup, guessBrandForProductCode, parseTargetsWorkbook };
});
