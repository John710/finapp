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
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
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
const isDark = ref(document.documentElement.classList.contains('dark'))

// Сливаем пользовательские опции с базовыми (прозрачный фон)
const chartOption = computed(() => ({
  backgroundColor: 'transparent',
  ...props.option
}))

let themeObserver = null
onMounted(() => {
  themeObserver = new MutationObserver(() => {
    isDark.value = document.documentElement.classList.contains('dark')
  })
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class']
  })
})

onUnmounted(() => {
  themeObserver?.disconnect()
})
</script>

<style scoped>
.chart-container {
  width: 100%;
  overflow: hidden;
}
</style>
