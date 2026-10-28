import { useI18n } from 'vue-i18n'
import { format as echartsFormat } from 'echarts/core'
import { formatFull } from '@/utils/currency'

// Tooltip formatters return HTML, so every user-controlled string (category
// names, series names) goes through encodeHTML; `marker` is ECharts' own HTML.
const esc = (value) => echartsFormat.encodeHTML(String(value ?? ''))

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
          let result = esc(params[0].axisValue) + '<br/>'
          params.forEach(p => {
            result += `${p.marker} ${esc(p.seriesName)}: ${formatFull(p.value, baseCurrency.value, baseCurrency.value, ratesStore.rates)}<br/>`
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
          return `${params.marker} ${esc(params.name)}: ${formatFull(params.value, baseCurrency.value, baseCurrency.value, ratesStore.rates)} (${params.percent}%)`
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

  // Plan bars reuse the actual bar's hue at reduced opacity, so the eye compares
  // heights within a month instead of learning a fourth colour.
  function planBarSeries(name, data, color, opacity) {
    return {
      name,
      type: 'bar',
      data,
      itemStyle: { color, opacity, borderRadius: [6, 6, 0, 0] }
    }
  }

  function recurringPlanChartOption(plan) {
    const months = plan?.months || []
    const income = t('reports.income')
    const expense = t('reports.expense')
    const planLabel = t('reports.plan')
    const actualLabel = t('reports.actual')

    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        ...tooltipStyle(),
        formatter: (params) => {
          let result = esc(params[0].axisValue) + '<br/>'
          params.forEach(p => {
            result += `${p.marker} ${esc(p.seriesName)}: ${formatFull(p.value, baseCurrency.value, baseCurrency.value, ratesStore.rates)}<br/>`
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
        data: months.map(m => m.month),
        axisLine: { lineStyle: { color: isDark.value ? '#334155' : '#eceaf6' } },
        axisTick: { show: false }
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: isDark.value ? 'rgba(148,163,184,0.12)' : '#f1f1f7' } }
      },
      series: [
        planBarSeries(`${income} · ${planLabel}`, months.map(m => m.plan_income), '#7c6fde', 0.35),
        planBarSeries(`${income} · ${actualLabel}`, months.map(m => m.actual_income), '#7c6fde', 1),
        planBarSeries(`${expense} · ${planLabel}`, months.map(m => m.plan_expense), '#b8c1ea', 0.45),
        planBarSeries(`${expense} · ${actualLabel}`, months.map(m => m.actual_expense), '#8fa2d8', 1)
      ]
    }
  }

  return { trendChartOption, categoryChartOption, recurringPlanChartOption }
}
