(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.YoiHibi = Object.assign(root.YoiHibi || {}, factory());
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const CHANNELS = ['TV', 'yahoo', 'その他', 'アマゾン', '卸', '楽天', '自社'];

  function shiftYearMonth(yearMonth, yearDelta) {
    const [y, m] = yearMonth.split('-').map(Number);
    return `${y + yearDelta}-${String(m).padStart(2, '0')}`;
  }

  function sumRecords(records) {
    return records.reduce((acc, r) => {
      acc.sales += r.sales; acc.cost += r.cost; acc.profit += r.profit;
      return acc;
    }, { sales: 0, cost: 0, profit: 0 });
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

  function getMonthlyComparison(state, yearMonth) {
    const current = sumRecords(filterRecords(state.monthlyRecords, { yearMonth }));
    const baseMonth = shiftYearMonth(yearMonth, -1);
    const base = sumRecords(filterRecords(state.baseRecords, { yearMonth: baseMonth }));
    const target = findTarget(state, yearMonth);
    return {
      yearMonth,
      sales: current.sales,
      profit: current.profit,
      profitRate: profitRate(current),
      salesYoY: pctChange(current.sales, base.sales),
      profitYoY: pctChange(current.profit, base.profit),
      salesTargetRate: target && target.salesTarget ? current.sales / target.salesTarget : null,
      profitTargetRate: target && target.profitTarget ? current.profit / target.profitTarget : null,
    };
  }

  function getChannelTable(state, yearMonth) {
    const baseMonth = shiftYearMonth(yearMonth, -1);
    return CHANNELS.map(channel => {
      const current = sumRecords(filterRecords(state.monthlyRecords, { yearMonth, channel }));
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
    const current = filterRecords(state.monthlyRecords, { yearMonth });
    const brands = Array.from(new Set(current.filter(r => r.brand != null).map(r => r.brand)));
    const rows = brands.map(brand => {
      const cur = sumRecords(filterRecords(state.monthlyRecords, { yearMonth, brand }));
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
    const months = Array.from(new Set(state.monthlyRecords.map(r => r.yearMonth))).sort();
    return months.map(yearMonth => {
      const current = sumRecords(filterRecords(state.monthlyRecords, { yearMonth }));
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
  };
});
