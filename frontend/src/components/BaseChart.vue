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
  const { textStyle, series, ...rest } = props.option
  const option = {
    backgroundColor: 'transparent',
    ...rest,
    series: applyLabelDefaults(series)
  }
  if (isDark.value) {
    option.textStyle = { color: themeTextColor.value, ...textStyle }
  } else if (textStyle) {
    option.textStyle = textStyle
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
