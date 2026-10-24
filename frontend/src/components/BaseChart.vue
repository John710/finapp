<template>
  <v-chart
    ref="chartRef"
    :option="chartOption"
    :autoresize="true"
    :theme="isDark ? 'dark' : 'light'"
    class="chart-container"
    :style="{ height: height }"
  />
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import {
  BarChart,
  LineChart,
  PieChart,
  GaugeChart,
  SankeyChart
} from 'echarts/charts'
import {
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent,
  DatasetComponent,
  TransformComponent
} from 'echarts/components'
import VChart from 'vue-echarts'
import { useDarkMode } from '@/composables/useDarkMode.js'
import 'echarts/theme/dark.js'

use([
  CanvasRenderer,
  BarChart,
  LineChart,
  PieChart,
  GaugeChart,
  SankeyChart,
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent,
  DatasetComponent,
  TransformComponent
])

const props = defineProps({
  option: {
    type: Object,
    required: true
  },
  height: {
    type: String,
    default: '280px'
  }
})

const chartRef = ref(null)
const { isDark } = useDarkMode()

const themeTextColor = computed(() => (isDark.value ? '#e2e8f0' : '#1e293b'))

// Soft pastel axis styling matching the app design system
const axisDefaults = computed(() => isDark.value
  ? {
      axisLabel: { color: '#94a3b8' },
      splitLine: { lineStyle: { color: 'rgba(148,163,184,0.12)' } },
      axisLine: { lineStyle: { color: '#334155' } }
    }
  : {
      axisLabel: { color: '#9ca0b5' },
      splitLine: { lineStyle: { color: '#f1f1f7' } },
      axisLine: { lineStyle: { color: '#eceaf6' } }
    })

function withAxisDefaults(axis) {
  if (!axis) return undefined
  const apply = (a) => {
    if (!a || typeof a !== 'object') return a
    const d = axisDefaults.value
    const out = { ...a }
    out.axisLabel = { ...d.axisLabel, ...(a.axisLabel || {}) }
    out.splitLine = a.splitLine === false
      ? false
      : { ...(a.splitLine || {}), lineStyle: { ...d.splitLine.lineStyle, ...(a.splitLine?.lineStyle || {}) } }
    if (a.axisLine !== false) {
      out.axisLine = { ...(a.axisLine || {}), lineStyle: { ...d.axisLine.lineStyle, ...(a.axisLine?.lineStyle || {}) } }
    }
    return out
  }
  return Array.isArray(axis) ? axis.map(apply) : apply(axis)
}

function applyLabelDefaults(series) {
  if (!isDark.value || !Array.isArray(series)) return series
  return series.map((s) => {
    if (!s || typeof s !== 'object') return s
    const label = s.label ? { ...s.label } : {}
    if (label.color === undefined) label.color = themeTextColor.value
    if (label.textBorderColor === undefined) label.textBorderColor = 'transparent'

    const emphasis = s.emphasis ? { ...s.emphasis } : {}
    if (emphasis.label) {
      const empLabel = { ...emphasis.label }
      if (empLabel.color === undefined) empLabel.color = themeTextColor.value
      if (empLabel.textBorderColor === undefined) empLabel.textBorderColor = 'transparent'
      emphasis.label = empLabel
    }

    return { ...s, label, emphasis }
  })
}

// Merge user options with theme-aware defaults.
// In dark mode we force labels to a light color; in light mode we keep ECharts defaults.
const chartOption = computed(() => {
  const { textStyle, series, xAxis, yAxis, ...rest } = props.option
  const option = {
    backgroundColor: 'transparent',
    ...rest,
    series: applyLabelDefaults(series)
  }
  const dX = withAxisDefaults(xAxis)
  const dY = withAxisDefaults(yAxis)
  if (dX !== undefined) option.xAxis = dX
  if (dY !== undefined) option.yAxis = dY
  if (isDark.value) {
    option.textStyle = { color: themeTextColor.value, ...textStyle }
  } else if (textStyle) {
    option.textStyle = textStyle
  } else {
    option.textStyle = { color: '#6e7385' }
  }
  return option
})
</script>

<style scoped>
.chart-container {
  width: 100%;
  overflow: hidden;
}
</style>
