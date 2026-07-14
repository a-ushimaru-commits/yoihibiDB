(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.YoiHibi = Object.assign(root.YoiHibi || {}, factory());
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const CHANNELS = ['自社', 'アマゾン', '楽天', 'yahoo', '卸', 'TV', 'その他'];

  function shiftYearMonth(yearMonth, yearDelta) {
    const [y, m] = yearMonth.split('-').map(Number);
    return `${y + yearDelta}-${String(m).padStart(2, '0')}`;
  }

  function sumRecords(records) {
    return records.reduce((acc, r) => {
      acc.qty += r.qty || 0; acc.sales += r.sales; acc.cost += r.cost; acc.profit += r.profit;
      return acc;
    }, { qty: 0, sales: 0, cost: 0, profit: 0 });
  }

  function filterRecords(records, filter) {
    const keys = Object.keys(filter);
    return records.filter(r => keys.every(k => r[k] === filter[k]));
  }

  function profitRate(totals) {
    return totals.sales === 0 ? 0 : totals.profit / totals.sales;
  }

  function pctChange(current, base) {
    if (base === 0) return current === 0 ? 0 : null;
    return (current - base) / base;
  }

  function daysInMonth(yearMonth) {
    const [y, m] = yearMonth.split('-').map(Number);
    return new Date(y, m, 0).getDate();
  }

  function findTarget(state, yearMonth) {
    return (state.targets || []).find(t => t.yearMonth === yearMonth) || null;
  }

  function previousMonth(yearMonth) {
    const [y, m] = yearMonth.split('-').map(Number);
    if (m === 1) return `${y - 1}-12`;
    return `${y}-${String(m - 1).padStart(2, '0')}`;
  }

  function getElapsedDays(state, yearMonth) {
    const totalDays = daysInMonth(yearMonth);
    const hasMonthly = filterRecords(state.monthlyRecords || [], { yearMonth }).length > 0;
    if (hasMonthly) return totalDays;
    const daily = filterRecords(state.dailyRecords || [], { yearMonth });
    if (daily.length === 0) return totalDays;
    return Math.max(...daily.map(r => Number(r.date.slice(8, 10))));
  }

  function monthlyOrDailyRecords(state, yearMonth) {
    const monthly = filterRecords(state.monthlyRecords || [], { yearMonth });
    if (monthly.length > 0) return monthly;
    return filterRecords(state.dailyRecords || [], { yearMonth });
  }

  function getMonthlyComparison(state, yearMonth, options) {
    const opts = options || {};
    const extraFilter = opts.channel ? { channel: opts.channel } : {};
    const targetsList = opts.targets || state.targets;

    const current = sumRecords(filterRecords(monthlyOrDailyRecords(state, yearMonth), extraFilter));
    const baseMonth = shiftYearMonth(yearMonth, -1);
    const base = sumRecords(filterRecords(state.baseRecords, Object.assign({ yearMonth: baseMonth }, extraFilter)));
    const prevMonth = previousMonth(yearMonth);
    const prev = sumRecords(filterRecords(monthlyOrDailyRecords(state, prevMonth), extraFilter));

    const target = (targetsList || []).find(t => t.yearMonth === yearMonth) || null;
    const elapsedDays = getElapsedDays(state, yearMonth);
    const totalDays = daysInMonth(yearMonth);
    const proratedSalesTarget = target && target.salesTarget ? target.salesTarget * elapsedDays / totalDays : null;
    const proratedProfitTarget = target && target.profitTarget ? target.profitTarget * elapsedDays / totalDays : null;

    return {
      yearMonth,
      sales: current.sales,
      profit: current.profit,
      profitRate: profitRate(current),
      salesYoY: pctChange(current.sales, base.sales),
      profitYoY: pctChange(current.profit, base.profit),
      salesMoM: pctChange(current.sales, prev.sales),
      profitMoM: pctChange(current.profit, prev.profit),
      salesTargetRate: target && target.salesTarget ? current.sales / target.salesTarget : null,
      profitTargetRate: target && target.profitTarget ? current.profit / target.profitTarget : null,
      salesTargetRateProrated: proratedSalesTarget ? current.sales / proratedSalesTarget : null,
      profitTargetRateProrated: proratedProfitTarget ? current.profit / proratedProfitTarget : null,
    };
  }

  function getChannelTable(state, yearMonth) {
    const baseMonth = shiftYearMonth(yearMonth, -1);
    const monthRecords = monthlyOrDailyRecords(state, yearMonth);
    return CHANNELS.map(channel => {
      const current = sumRecords(filterRecords(monthRecords, { channel }));
      const base = sumRecords(filterRecords(state.baseRecords, { yearMonth: baseMonth, channel }));
      return {
        channel,
        sales: current.sales,
        profit: current.profit,
        profitRate: profitRate(current),
        salesYoY: pctChange(current.sales, base.sales),
      };
    });
  }

  function getBrandTable(state, yearMonth) {
    const baseMonth = shiftYearMonth(yearMonth, -1);
    const current = monthlyOrDailyRecords(state, yearMonth);
    const brands = Array.from(new Set(current.filter(r => r.brand != null).map(r => r.brand)));
    const rows = brands.map(brand => {
      const cur = sumRecords(filterRecords(current, { brand }));
      const base = sumRecords(filterRecords(state.baseRecords, { yearMonth: baseMonth, brand }));
      return {
        brand,
        sales: cur.sales,
        profit: cur.profit,
        profitRate: profitRate(cur),
        salesYoY: pctChange(cur.sales, base.sales),
      };
    });
    rows.sort((a, b) => b.sales - a.sales);
    return rows;
  }

  function collectPivotRecords(state) {
    // 1期(baseRecords)のブランド値は、分解詳細リスト（productBrandMapping）の商品細分に
    // 存在するものだけを残し、それ以外はすべて「その他」に正規化する。
    // マッピング未取込み（空）の間は従来通り何もしない。
    const validBrands = new Set(Object.values(state.productBrandMapping || {}));
    const baseRecords = state.baseRecords || [];
    const normalizedBaseRecords = validBrands.size === 0 ? baseRecords : baseRecords.map(r => (
      r.brand != null && validBrands.has(r.brand) ? r : Object.assign({}, r, { brand: 'その他' })
    ));
    const monthlyMonths = new Set((state.monthlyRecords || []).map(r => r.yearMonth));
    const dailyFallback = (state.dailyRecords || []).filter(r => !monthlyMonths.has(r.yearMonth));
    return normalizedBaseRecords.concat(state.monthlyRecords || []).concat(dailyFallback);
  }

  function getBrandMonthlyPivot(state, filter) {
    let allRecords = collectPivotRecords(state);
    if (filter && filter.channel) {
      allRecords = filterRecords(allRecords, { channel: filter.channel });
    }
    const months = Array.from(new Set(allRecords.map(r => r.yearMonth))).sort();

    const brandSales = new Map();
    allRecords.forEach(r => {
      if (r.brand == null) return;
      brandSales.set(r.brand, (brandSales.get(r.brand) || 0) + r.sales);
    });
    const brands = Array.from(brandSales.keys()).sort((a, b) => brandSales.get(b) - brandSales.get(a));

    const rows = months.map(yearMonth => {
      const monthRecords = filterRecords(allRecords, { yearMonth });
      const totalTeiki = sumRecords(filterRecords(monthRecords, { type: '定期' }));
      const totalTsujo = sumRecords(filterRecords(monthRecords, { type: '通常' }));

      const byBrand = {};
      brands.forEach(brand => {
        const teiki = sumRecords(filterRecords(monthRecords, { brand, type: '定期' }));
        const tsujo = sumRecords(filterRecords(monthRecords, { brand, type: '通常' }));
        byBrand[brand] = {
          teikiSales: teiki.sales, teikiProfit: teiki.profit,
          tsujoSales: tsujo.sales, tsujoProfit: tsujo.profit,
        };
      });

      return {
        yearMonth,
        totalTeikiSales: totalTeiki.sales, totalTeikiProfit: totalTeiki.profit,
        totalTsujoSales: totalTsujo.sales, totalTsujoProfit: totalTsujo.profit,
        byBrand,
      };
    });

    return { months, brands, rows };
  }

  function getChannelMonthlyPivot(state) {
    const allRecords = collectPivotRecords(state);
    const months = Array.from(new Set(allRecords.map(r => r.yearMonth))).sort();

    const rows = months.map(yearMonth => {
      const monthRecords = filterRecords(allRecords, { yearMonth });
      const totalTeiki = sumRecords(filterRecords(monthRecords, { type: '定期' }));
      const totalTsujo = sumRecords(filterRecords(monthRecords, { type: '通常' }));

      const byChannel = {};
      CHANNELS.forEach(channel => {
        const teiki = sumRecords(filterRecords(monthRecords, { channel, type: '定期' }));
        const tsujo = sumRecords(filterRecords(monthRecords, { channel, type: '通常' }));
        byChannel[channel] = {
          teikiSales: teiki.sales, teikiProfit: teiki.profit,
          tsujoSales: tsujo.sales, tsujoProfit: tsujo.profit,
        };
      });

      return {
        yearMonth,
        totalTeikiSales: totalTeiki.sales, totalTeikiProfit: totalTeiki.profit,
        totalTsujoSales: totalTsujo.sales, totalTsujoProfit: totalTsujo.profit,
        byChannel,
      };
    });

    return { months, channels: CHANNELS, rows };
  }

  function ttmTotals(state, endYearMonth, extraFilter) {
    const months = [];
    let ym = endYearMonth;
    for (let i = 0; i < 12; i++) {
      months.push(ym);
      ym = previousMonth(ym);
    }
    const records = filterRecords(collectPivotRecords(state), extraFilter || {});
    return sumRecords(records.filter(r => months.includes(r.yearMonth)));
  }

  function yoyMetrics(current, base) {
    return {
      qtyPct: pctChange(current.qty, base.qty),
      salesPct: pctChange(current.sales, base.sales),
      profitPct: pctChange(current.profit, base.profit),
      profitRatePtDiff: base.sales === 0 ? (current.sales === 0 ? 0 : null) : (current.profitRate - base.profitRate),
    };
  }

  function getOwnChannelMonthlySummary(state, yearMonth) {
    const allSelfRecords = filterRecords(collectPivotRecords(state), { channel: '自社' });
    const months = yearMonth ? [yearMonth] : Array.from(new Set(allSelfRecords.map(r => r.yearMonth))).sort();

    const brandSales = new Map();
    allSelfRecords.forEach(r => {
      if (r.brand == null) return;
      brandSales.set(r.brand, (brandSales.get(r.brand) || 0) + r.sales);
    });
    const brands = Array.from(brandSales.keys()).sort((a, b) => brandSales.get(b) - brandSales.get(a));

    function withRate(totals) {
      return { qty: totals.qty, sales: totals.sales, profit: totals.profit, profitRate: profitRate(totals) };
    }

    function typeSplitFor(yearMonth, extraFilter) {
      const records = filterRecords(allSelfRecords, Object.assign({ yearMonth }, extraFilter || {}));
      return {
        teiki: withRate(sumRecords(filterRecords(records, { type: '定期' }))),
        tsujo: withRate(sumRecords(filterRecords(records, { type: '通常' }))),
        total: withRate(sumRecords(records)),
      };
    }

    function yoyFor(current, base) {
      return {
        teiki: yoyMetrics(current.teiki, base.teiki),
        tsujo: yoyMetrics(current.tsujo, base.tsujo),
        total: yoyMetrics(current.total, base.total),
      };
    }

    function ttmSplitFor(endYearMonth, extraFilter) {
      return {
        teiki: withRate(ttmTotals(state, endYearMonth, Object.assign({ channel: '自社', type: '定期' }, extraFilter || {}))),
        tsujo: withRate(ttmTotals(state, endYearMonth, Object.assign({ channel: '自社', type: '通常' }, extraFilter || {}))),
        total: withRate(ttmTotals(state, endYearMonth, Object.assign({ channel: '自社' }, extraFilter || {}))),
      };
    }

    const rows = months.map(yearMonth => {
      const baseMonth = shiftYearMonth(yearMonth, -1);
      const current = typeSplitFor(yearMonth);
      const base = typeSplitFor(baseMonth);
      const yoy = yoyFor(current, base);

      const ttmCurrent = ttmSplitFor(yearMonth);
      const ttmBase = ttmSplitFor(baseMonth);
      const ttmYoy = yoyFor(ttmCurrent, ttmBase);

      const byBrand = {};
      brands.forEach(brand => {
        const brandCurrent = typeSplitFor(yearMonth, { brand });
        const brandBase = typeSplitFor(baseMonth, { brand });
        const brandYoy = yoyFor(brandCurrent, brandBase);
        const brandTtmCurrent = ttmSplitFor(yearMonth, { brand });
        const brandTtmBase = ttmSplitFor(baseMonth, { brand });
        const brandTtmYoy = yoyFor(brandTtmCurrent, brandTtmBase);
        byBrand[brand] = {
          teiki: brandCurrent.teiki, tsujo: brandCurrent.tsujo, total: brandCurrent.total,
          yoy: brandYoy, ttmYoy: brandTtmYoy,
        };
      });

      return {
        yearMonth,
        teiki: current.teiki, tsujo: current.tsujo, total: current.total,
        yoy, ttmYoy,
        byBrand,
      };
    });

    return { months, brands, rows };
  }

  function getDailyCumulativeSeries(state, yearMonth) {
    const daily = filterRecords(state.dailyRecords, { yearMonth });
    const nDays = daysInMonth(yearMonth);
    const dailyTotals = Array.from({ length: nDays }, () => ({ sales: 0, profit: 0, teikiQty: 0, tsujoQty: 0 }));
    daily.forEach(r => {
      const day = Number(r.date.slice(8, 10));
      if (day >= 1 && day <= nDays) {
        dailyTotals[day - 1].sales += r.sales;
        dailyTotals[day - 1].profit += r.profit;
        if (r.type === '定期') dailyTotals[day - 1].teikiQty += r.qty || 0;
        else if (r.type === '通常') dailyTotals[day - 1].tsujoQty += r.qty || 0;
      }
    });
    const baseMonth = shiftYearMonth(yearMonth, -1);
    const baseMonthRecords = filterRecords(state.baseRecords, { yearMonth: baseMonth });
    const baseTotals = sumRecords(baseMonthRecords);
    const baseTeikiTotals = sumRecords(filterRecords(baseMonthRecords, { type: '定期' }));
    const baseTsujoTotals = sumRecords(filterRecords(baseMonthRecords, { type: '通常' }));

    const series = [];
    let cumSales = 0, cumProfit = 0, cumTeikiQty = 0, cumTsujoQty = 0;
    for (let d = 0; d < nDays; d++) {
      cumSales += dailyTotals[d].sales;
      cumProfit += dailyTotals[d].profit;
      cumTeikiQty += dailyTotals[d].teikiQty;
      cumTsujoQty += dailyTotals[d].tsujoQty;
      series.push({
        day: d + 1,
        actualSales: cumSales,
        actualProfit: cumProfit,
        actualTeikiQty: cumTeikiQty,
        actualTsujoQty: cumTsujoQty,
        paceSales: baseTotals.sales * ((d + 1) / nDays),
        paceProfit: baseTotals.profit * ((d + 1) / nDays),
        paceTeikiQty: baseTeikiTotals.qty * ((d + 1) / nDays),
        paceTsujoQty: baseTsujoTotals.qty * ((d + 1) / nDays),
      });
    }
    return series;
  }

  function getMonthlyTrend(state) {
    const allRecords = collectPivotRecords(state);
    const allMonths = Array.from(new Set(allRecords.map(r => r.yearMonth))).sort();
    const months = allMonths.slice(-12); // 直近12ヶ月分（1年間）に絞る
    return months.map(yearMonth => {
      const monthRecords = filterRecords(allRecords, { yearMonth });
      const current = sumRecords(monthRecords);
      const teiki = sumRecords(filterRecords(monthRecords, { type: '定期' }));
      const tsujo = sumRecords(filterRecords(monthRecords, { type: '通常' }));
      const baseMonth = shiftYearMonth(yearMonth, -1);
      const baseRecordsForMonth = filterRecords(state.baseRecords, { yearMonth: baseMonth });
      const base = sumRecords(baseRecordsForMonth);
      const baseTeiki = sumRecords(filterRecords(baseRecordsForMonth, { type: '定期' }));
      const baseTsujo = sumRecords(filterRecords(baseRecordsForMonth, { type: '通常' }));
      const hasBaseData = baseRecordsForMonth.length > 0;
      const target = findTarget(state, yearMonth);
      return {
        yearMonth,
        currentSales: current.sales,
        currentProfit: current.profit,
        teikiQty: teiki.qty,
        tsujoQty: tsujo.qty,
        // 1期データが全くない月は「比較不能」を表す null にする（0だと「前年売上ゼロ」と誤読されるため）
        baseSales: hasBaseData ? base.sales : null,
        baseProfit: hasBaseData ? base.profit : null,
        baseTeikiQty: hasBaseData ? baseTeiki.qty : null,
        baseTsujoQty: hasBaseData ? baseTsujo.qty : null,
        targetSales: target ? target.salesTarget : null,
        targetProfit: target ? target.profitTarget : null,
      };
    });
  }

  return {
    CHANNELS, shiftYearMonth, sumRecords, filterRecords, profitRate, pctChange, daysInMonth,
    getMonthlyComparison, getChannelTable, getBrandTable, getDailyCumulativeSeries, getMonthlyTrend,
    getBrandMonthlyPivot, getChannelMonthlyPivot, previousMonth, getElapsedDays,
    getOwnChannelMonthlySummary,
  };
});
