import { useI18n } from 'vue-i18n'
import { formatFull } from '@/utils/currency'

// Shared ECharts option builders for the trend (grouped bars) and category
// (donut) charts — previously duplicated, with styling drift, between
// DashboardView and ReportsView. Values are read lazily so the returned
// options stay reactive when wrapped in computed().
export function useChartOptions({ isDark, baseCurrency, ratesStore }) {
  const { t } = useI18n()

  function tooltipStyle() {
    return {
      backgroundColor: isDark.value ? '#1e293b' : '#ffffff',
      borderColor: isDark.value ? '#334155' : '#eceaf6',
      textStyle: { color: isDark.value ? '#e2e8f0' : '#3f3d56' }
    }
  }

  function barSeries(name, data, from, to) {
    return {
      name,
      type: 'bar',
      data,
      itemStyle: {
        color: {
          type: 'linear',
          x: 0,
          y: 0,
          x2: 0,
          y2: 1,
          colorStops: [
            { offset: 0, color: from },
            { offset: 1, color: to }
          ]
        },
        borderRadius: [8, 8, 0, 0]
      }
    }
  }

  function trendChartOption(trend) {
    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        ...tooltipStyle(),
        formatter: (params) => {
          let result = params[0].axisValue + '<br/>'
          params.forEach(p => {
            result += `${p.marker} ${p.seriesName}: ${formatFull(p.value, baseCurrency.value, baseCurrency.value, ratesStore.rates)}<br/>`
          })
          return result
        }
      },
      legend: { show: false },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '3%',
        top: '10%',
        containLabel: true
      },
      xAxis: {
        type: 'category',
        data: trend.map(m => m.month),
        axisLine: { lineStyle: { color: isDark.value ? '#334155' : '#eceaf6' } },
        axisTick: { show: false }
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: isDark.value ? 'rgba(148,163,184,0.12)' : '#f1f1f7' } }
      },
      series: [
        barSeries(t('reports.income'), trend.map(m => m.income), '#8b7fe8', '#7c6fde'),
        barSeries(t('reports.expense'), trend.map(m => m.expense), '#c3cbef', '#b8c1ea'),
        barSeries(t('transactions.types.transfer'), trend.map(m => m.transfer || 0), '#a5d4f6', '#8fc3ee')
      ]
    }
  }

  function categoryChartOption(items) {
    return {
      tooltip: {
        trigger: 'item',
        ...tooltipStyle(),
        formatter: (params) => {
          return `${params.marker} ${params.name}: ${formatFull(params.value, baseCurrency.value, baseCurrency.value, ratesStore.rates)} (${params.percent}%)`
        }
      },
      legend: { show: false },
      series: [
        {
          name: t('categories.title'),
          type: 'pie',
          radius: ['42%', '72%'],
          center: ['50%', '50%'],
          avoidLabelOverlap: true,
          itemStyle: {
            borderRadius: 8,
            borderColor: isDark.value ? '#0f172a' : '#ffffff',
            borderWidth: 3
          },
          label: {
            show: true,
            formatter: '{b}: {d}%',
            fontSize: 11
          },
          emphasis: {
            scale: true,
            scaleSize: 10,
            label: {
              show: true,
              fontSize: 14,
              fontWeight: 'bold'
            }
          },
          data: items.map(c => ({
            value: parseFloat(c.total),
            name: c.name || t('categories.uncategorized'),
            itemStyle: { color: c.color || '#94a3b8' }
          }))
        }
      ]
    }
  }

  return { trendChartOption, categoryChartOption }
}
