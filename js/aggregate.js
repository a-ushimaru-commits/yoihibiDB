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
    const monthlyMonths = new Set((state.monthlyRecords || []).map(r => r.yearMonth));
    const dailyFallback = (state.dailyRecords || []).filter(r => !monthlyMonths.has(r.yearMonth));
    return (state.baseRecords || []).concat(state.monthlyRecords || []).concat(dailyFallback);
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

  function getDailyCumulativeSeries(state, yearMonth) {
    const daily = filterRecords(state.dailyRecords, { yearMonth });
    const nDays = daysInMonth(yearMonth);
    const dailyTotals = Array.from({ length: nDays }, () => ({ sales: 0, profit: 0 }));
    daily.forEach(r => {
      const day = Number(r.date.slice(8, 10));
      if (day >= 1 && day <= nDays) {
        dailyTotals[day - 1].sales += r.sales;
        dailyTotals[day - 1].profit += r.profit;
      }
    });
    const baseMonth = shiftYearMonth(yearMonth, -1);
    const baseTotals = sumRecords(filterRecords(state.baseRecords, { yearMonth: baseMonth }));

    const series = [];
    let cumSales = 0, cumProfit = 0;
    for (let d = 0; d < nDays; d++) {
      cumSales += dailyTotals[d].sales;
      cumProfit += dailyTotals[d].profit;
      series.push({
        day: d + 1,
        actualSales: cumSales,
        actualProfit: cumProfit,
        paceSales: baseTotals.sales * ((d + 1) / nDays),
        paceProfit: baseTotals.profit * ((d + 1) / nDays),
      });
    }
    return series;
  }

  function getMonthlyTrend(state) {
    const months = Array.from(new Set(
      state.monthlyRecords.map(r => r.yearMonth).concat((state.dailyRecords || []).map(r => r.yearMonth))
    )).sort();
    return months.map(yearMonth => {
      const current = sumRecords(monthlyOrDailyRecords(state, yearMonth));
      const baseMonth = shiftYearMonth(yearMonth, -1);
      const base = sumRecords(filterRecords(state.baseRecords, { yearMonth: baseMonth }));
      const target = findTarget(state, yearMonth);
      return {
        yearMonth,
        currentSales: current.sales,
        currentProfit: current.profit,
        baseSales: base.sales,
        baseProfit: base.profit,
        targetSales: target ? target.salesTarget : null,
        targetProfit: target ? target.profitTarget : null,
      };
    });
  }

  return {
    CHANNELS, shiftYearMonth, sumRecords, filterRecords, profitRate, pctChange, daysInMonth,
    getMonthlyComparison, getChannelTable, getBrandTable, getDailyCumulativeSeries, getMonthlyTrend,
    getBrandMonthlyPivot, getChannelMonthlyPivot, previousMonth, getElapsedDays,
  };
});
