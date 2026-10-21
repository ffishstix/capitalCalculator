<script setup lang="ts">
type Point = { at: string; value: number | null }
type Line = { key: string; label: string; color: string; points: Point[] }
type Forecast = { at: string; estimate: number; low: number; high: number } | null
const props = withDefaults(defineProps<{ lines: Line[]; range: string; unit?: string; forecast?: Forecast }>(), { unit: '$', forecast: null })
const selectedIndex = ref(0)
const svgRef = ref<SVGSVGElement | null>(null)
const width = ref(1000)
const height = ref(340)
let resizeObserver: ResizeObserver | undefined
watch(svgRef, element => {
  resizeObserver?.disconnect()
  if (!element || typeof ResizeObserver === 'undefined') return
  resizeObserver = new ResizeObserver(entries => {
    const entry = entries[0]
    if (!entry) return
    width.value = Math.max(320, entry.contentRect.width)
    height.value = entry.contentRect.height
  })
  resizeObserver.observe(element)
}, { flush: 'post' })
onBeforeUnmount(() => resizeObserver?.disconnect())
const plot = { left: 76, right: 24, top: 20, bottom: 50 }
const times = computed(() => [...new Set(props.lines.flatMap(line => line.points.map(point => point.at)))].sort())
const hasValues = computed(() => props.lines.some(line => line.points.some(point => typeof point.value === 'number' && Number.isFinite(point.value))))
watch(times, values => { selectedIndex.value = Math.max(0, values.length - 1) }, { immediate: true })
const timeNumbers = computed(() => times.value.map(value => Date.parse(value)))
const domain = computed(() => {
  const values = props.lines.flatMap(line => line.points.map(point => point.value)).filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  if (props.forecast) values.push(props.forecast.low, props.forecast.high)
  if (!values.length) return { min: 0, max: 1 }
  const min = Math.min(...values)
  const max = Math.max(...values)
  const pad = Math.max((max - min) * 0.1, Math.abs(max) * 0.015, 0.01)
  return { min: min >= 0 ? Math.max(0, min - pad) : min - pad, max: max + pad }
})
const minTime = computed(() => timeNumbers.value[0] ?? Date.now())
const maxTime = computed(() => Math.max(timeNumbers.value.at(-1) ?? minTime.value + 1, props.forecast ? Date.parse(props.forecast.at) : -Infinity))
function x(at: string) {
  const span = maxTime.value - minTime.value
  return span > 0 ? plot.left + (Date.parse(at) - minTime.value) / span * (width.value - plot.left - plot.right) : width.value / 2
}
function y(value: number) { return plot.top + (domain.value.max - value) / (domain.value.max - domain.value.min) * (height.value - plot.top - plot.bottom) }
function path(points: Point[]) {
  const byTime = new Map(points.map(point => [point.at, point.value]))
  let drawing = false
  let previousTime = 0
  return times.value.map(at => {
    const value = byTime.get(at)
    if (typeof value !== 'number' || !Number.isFinite(value)) { drawing = false; return '' }
    if (Date.parse(at) - previousTime > 90 * 60 * 1000) drawing = false
    const part = `${drawing ? 'L' : 'M'} ${x(at).toFixed(2)} ${y(value).toFixed(2)}`
    drawing = true
    previousTime = Date.parse(at)
    return part
  }).filter(Boolean).join(' ')
}
function markers(points: Point[]) {
  const every = Math.max(1, Math.ceil(points.length / 180))
  return points.filter((point, index) => point.value !== null && (index % every === 0 || index === points.length - 1))
}
const ticks = computed(() => Array.from({ length: 5 }, (_, index) => domain.value.min + (domain.value.max - domain.value.min) * index / 4))
const timeTicks = computed(() => {
  const count = Math.min(width.value < 550 ? 3 : 5, times.value.length)
  return Array.from({ length: count }, (_, index) => times.value[Math.round((times.value.length - 1) * index / (count - 1 || 1))]).filter((value): value is string => value !== undefined)
})
const selectedTime = computed(() => times.value[Math.min(selectedIndex.value, times.value.length - 1)] ?? '')
const selectedValues = computed(() => props.lines.map(line => ({ ...line, value: line.points.find(point => point.at === selectedTime.value)?.value ?? null })))
const forecastOrigin = computed(() => props.lines.find(line => line.key.endsWith(':bid'))?.points.findLast(point => point.value !== null))
function selectFromPointer(event: PointerEvent) {
  if (!times.value.length) return
  const rect = (event.currentTarget as SVGElement).getBoundingClientRect()
  const pointX = (event.clientX - rect.left) / rect.width * width.value
  let best = 0
  let distance = Infinity
  for (let i = 0; i < times.value.length; i++) {
    const delta = Math.abs(x(times.value[i] ?? '') - pointX)
    if (delta < distance) { distance = delta; best = i }
  }
  selectedIndex.value = best
}
function formatMoney(value: number | null) { return value === null ? 'No quote' : props.unit === '%' ? `${value >= 0 ? '+' : ''}${value.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}%` : `${props.unit}${value.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}` }
function formatTime(value: string) { return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) }
function formatTick(value: string) { return new Date(value).toLocaleString(undefined, props.range === '24h' ? { hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric' }) }
</script>

<template>
  <div class="history-chart">
    <div v-if="!times.length" class="history-chart-empty">No recorded prices in this range yet. Collect another market snapshot to begin the chart.</div>
    <template v-else>
      <div class="history-chart-head">
        <div><span class="history-chart-kicker">SNAPSHOT INSPECTOR</span><strong>{{ formatTime(selectedTime) }}</strong></div>
        <div class="history-chart-values"><span v-for="line in selectedValues" :key="line.key"><i :style="{ background: line.color }" /><ItemIcon v-if="!line.key.startsWith('chain:')" :item-id="line.key.split(':')[0]" :name="line.label" />{{ line.label }} <strong>{{ formatMoney(line.value) }}</strong></span></div>
      </div>
      <svg v-if="hasValues" ref="svgRef" class="history-svg" :viewBox="`0 0 ${width} ${height}`" preserveAspectRatio="none" role="img" :aria-label="`Price history chart with ${times.length} recorded times from ${formatTime(times[0] ?? '')} to ${formatTime(times.at(-1) ?? '')}`" @pointermove="selectFromPointer" @pointerdown="selectFromPointer">
        <defs><linearGradient id="history-area-glow" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#9ed4a4" stop-opacity=".18"/><stop offset="1" stop-color="#9ed4a4" stop-opacity="0"/></linearGradient></defs>
        <g v-for="tick in ticks" :key="tick"><line :x1="plot.left" :x2="width - plot.right" :y1="y(tick)" :y2="y(tick)" class="history-grid"/><text :x="plot.left - 12" :y="y(tick) + 4" text-anchor="end" class="history-axis">{{ unit === '%' ? `${tick.toLocaleString(undefined, { maximumFractionDigits: 1 })}%` : `${unit}${tick.toLocaleString(undefined, { maximumFractionDigits: 2 })}` }}</text></g>
        <g v-for="(tick, index) in timeTicks" :key="index"><text :x="x(tick)" :y="height - 17" :text-anchor="index === 0 ? 'start' : index === timeTicks.length - 1 ? 'end' : 'middle'" class="history-axis">{{ formatTick(tick) }}</text></g>
        <path v-for="line in lines" :key="line.key" :d="path(line.points)" fill="none" :stroke="line.color" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
        <g v-for="line in lines" :key="`${line.key}:points`"><circle v-for="point in markers(line.points)" :key="point.at" :cx="x(point.at)" :cy="y(point.value!)" r="2.5" :fill="line.color" opacity=".85" vector-effect="non-scaling-stroke"/></g>
        <template v-if="forecast && forecastOrigin && forecastOrigin.value !== null">
          <path :d="`M ${x(forecastOrigin.at)} ${y(forecastOrigin.value)} L ${x(forecast.at)} ${y(forecast.estimate)}`" fill="none" stroke="#d6bf8a" stroke-width="2" stroke-dasharray="6 5" vector-effect="non-scaling-stroke"/>
          <line :x1="x(forecast.at)" :x2="x(forecast.at)" :y1="y(forecast.low)" :y2="y(forecast.high)" stroke="#d6bf8a" stroke-width="7" opacity=".65" vector-effect="non-scaling-stroke"/>
        </template>
        <line :x1="x(selectedTime)" :x2="x(selectedTime)" :y1="plot.top" :y2="height - plot.bottom" stroke="#a7c4a8" stroke-opacity=".7" stroke-dasharray="4 5" vector-effect="non-scaling-stroke"/>
        <g v-for="line in selectedValues" :key="line.key"><circle v-if="line.value !== null" :cx="x(selectedTime)" :cy="y(line.value)" r="5" fill="#142018" :stroke="line.color" stroke-width="3" vector-effect="non-scaling-stroke"/></g>
      </svg>
      <div v-else class="history-chart-empty">No values were saved for this price side in the selected range. Choose another side or collect a new market snapshot.</div>
      <div v-if="hasValues" class="history-scrub"><span>{{ formatTime(times[0] ?? '') }}</span><input v-model.number="selectedIndex" type="range" :min="0" :max="Math.max(0, times.length - 1)" step="1" aria-label="Inspect recorded price time"><span>{{ formatTime(times.at(-1) ?? '') }}</span></div>
      <div class="history-legend"><span v-for="line in lines" :key="line.key"><i :style="{ background: line.color }" /><ItemIcon v-if="!line.key.startsWith('chain:')" :item-id="line.key.split(':')[0]" :name="line.label" />{{ line.label }}</span><span v-if="forecast" class="forecast-key">┄ One-hour estimate</span></div>
    </template>
  </div>
</template>
