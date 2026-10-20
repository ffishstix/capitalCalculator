<script setup lang="ts">
import { calculateHistoricalEconomics, forecastNextBid, traceOutputChain } from '../utils/price-history.js'

type Ingredient = { item_id: string; name: string; quantity: number }
type Recipe = { id: string; label: string; product_id: string; product: string; batch: number; rate: number; ingredients: Ingredient[] }
type Node = { id: string; recipeId: string; machines: number }
type Flow = { id: string; name: string; amount: number }
type Quote = { symbol: string; name: string; price: number; buyPrice?: number | null; sellPrice?: number | null }
type Point = { at: string; reference: number | null; bid: number | null; ask: number | null }
type Series = { symbol: string; name: string; points: Point[] }
type HistoryResponse = { range: string; from: string; to: string; series: Series[] }
type Range = '24h' | '7d' | '30d' | '90d'
type Side = 'bid' | 'ask' | 'reference'
const props = defineProps<{
  quotes: Quote[]
  recipes: Recipe[]
  nodes: Node[]
  connections: Record<string, string>
  planFlows: { sales: Flow[]; costs: Flow[] }
  initialSymbol?: string
}>()
const emit = defineEmits<{ close: [] }>()
const mode = ref<'item' | 'chain'>('item')
const range = ref<Range>('30d')
const side = ref<Side>('bid')
const allSides = ref(false)
const compareScale = ref<'indexed' | 'absolute'>('indexed')
const showForecast = ref(true)
const itemSearch = ref('')
const selectedSymbols = ref<string[]>([])
const selectedChain = ref('plan')
const history = ref<HistoryResponse | null>(null)
const loading = ref(false)
const failure = ref('')
let requestNumber = 0

const recipeById = computed(() => new Map(props.recipes.map(recipe => [recipe.id, recipe])))
const quoteBySymbol = computed(() => new Map(props.quotes.map(quote => [quote.symbol, quote])))
const sortedQuotes = computed(() => [...props.quotes].sort((a, b) => a.name.localeCompare(b.name)))
watch(() => [props.initialSymbol, props.quotes.length] as const, () => {
  const requested = props.initialSymbol?.toLowerCase()
  if (requested && quoteBySymbol.value.has(requested)) selectedSymbols.value = [requested]
  else if (!selectedSymbols.value.length && sortedQuotes.value[0]) selectedSymbols.value = [sortedQuotes.value[0].symbol]
}, { immediate: true })

const rootOptions = computed(() => {
  const providerIds = new Set(Object.values(props.connections))
  return props.nodes.filter(node => !providerIds.has(node.id)).map(node => {
    const recipe = recipeById.value.get(node.recipeId)
    return { id: node.id, label: recipe ? `${recipe.product} · ${formatAmount(recipe.rate * node.machines)}/min` : node.id }
  })
})
const currentFlows = computed(() => selectedChain.value === 'plan'
  ? props.planFlows
  : traceOutputChain(selectedChain.value, props.nodes, props.connections, recipeById.value))
const neededSymbols = computed(() => mode.value === 'item'
  ? selectedSymbols.value
  : [...new Set([...currentFlows.value.sales, ...currentFlows.value.costs].filter(flow => flow.amount > 0).map(flow => flow.id))])
const requestKey = computed(() => [...neededSymbols.value].sort().join(','))

watch([range, requestKey], async () => {
  const ownRequest = ++requestNumber
  const symbols = requestKey.value ? requestKey.value.split(',') : []
  if (!symbols.length) { history.value = null; loading.value = false; failure.value = ''; return }
  loading.value = true
  failure.value = ''
  try {
    const batches: string[][] = []
    for (let index = 0; index < symbols.length; index += 100) batches.push(symbols.slice(index, index + 100))
    const responses = await Promise.all(batches.map(batch => $fetch<HistoryResponse>('/api/prices/history', { query: { symbols: batch.join(','), range: range.value } })))
    if (ownRequest !== requestNumber) return
    const first = responses[0]
    history.value = first ? { ...first, series: responses.flatMap(response => response.series) } : null
  } catch {
    if (ownRequest !== requestNumber) return
    history.value = null
    failure.value = 'Could not load saved price history. Try another range or reopen History.'
  } finally {
    if (ownRequest === requestNumber) loading.value = false
  }
}, { immediate: true })

function addItem(symbol: string) {
  if (selectedSymbols.value.includes(symbol) || selectedSymbols.value.length >= 4) return
  selectedSymbols.value = [...selectedSymbols.value, symbol]
  itemSearch.value = ''
}
function removeItem(symbol: string) {
  if (selectedSymbols.value.length <= 1) return
  selectedSymbols.value = selectedSymbols.value.filter(value => value !== symbol)
}
const searchMatches = computed(() => {
  const search = itemSearch.value.trim().toLowerCase()
  if (!search) return []
  return sortedQuotes.value.filter(quote => !selectedSymbols.value.includes(quote.symbol) && `${quote.name} ${quote.symbol}`.toLowerCase().includes(search)).slice(0, 8)
})
const palette = ['#a8d8aa', '#dab985', '#96b9e1', '#ca9fcf']
const sideNames: Record<Side, string> = { bid: 'Instant sell · best bid', ask: 'Quick buy · best ask', reference: 'Ticker reference' }
const itemLines = computed(() => {
  const series = history.value?.series ?? []
  if (selectedSymbols.value.length === 1 && allSides.value) {
    const item = series.find(entry => entry.symbol === selectedSymbols.value[0])
    if (!item) return []
    return ([['bid', '#a8d8aa'], ['ask', '#dab985'], ['reference', '#96b9e1']] as const).map(([key, color]) => ({
      key: `${item.symbol}:${key}`, label: sideNames[key], color, points: item.points.map(point => ({ at: point.at, value: point[key] }))
    }))
  }
  return selectedSymbols.value.map((symbol, index) => {
    const item = series.find(entry => entry.symbol === symbol)
    if (!item) return null
    const first = item.points.find(point => typeof point[side.value] === 'number' && point[side.value]! > 0)?.[side.value]
    return { key: `${symbol}:${side.value}`, label: item.name, color: palette[index % palette.length] ?? '#a8d8aa', points: item.points.map(point => ({
      at: point.at,
      value: selectedSymbols.value.length > 1 && compareScale.value === 'indexed'
        ? point[side.value] === null || !first ? null : (point[side.value]! / first - 1) * 100
        : point[side.value]
    })) }
  }).filter((line): line is NonNullable<typeof line> => Boolean(line))
})
const economics = computed(() => calculateHistoricalEconomics(history.value?.series ?? [], currentFlows.value))
const chainLines = computed(() => ([
  { key: 'chain:sales', label: 'Output sales / min', color: '#a8d8aa', points: economics.value.map(point => ({ at: point.at, value: point.sales })) },
  { key: 'chain:costs', label: 'External input cost / min', color: '#dab985', points: economics.value.map(point => ({ at: point.at, value: point.costs })) },
  { key: 'chain:net', label: 'Net margin / min', color: '#96b9e1', points: economics.value.map(point => ({ at: point.at, value: point.net })) }
]))
const lines = computed(() => mode.value === 'item' ? itemLines.value : chainLines.value)
const chartUnit = computed(() => mode.value === 'item' && selectedSymbols.value.length > 1 && compareScale.value === 'indexed' ? '%' : '$')
const currentItem = computed(() => history.value?.series.find(entry => entry.symbol === selectedSymbols.value[0]))
const forecast = computed(() => mode.value === 'item' && selectedSymbols.value.length === 1 && showForecast.value && (allSides.value || side.value === 'bid')
  ? forecastNextBid(currentItem.value?.points ?? [])
  : null)
const recordedCount = computed(() => [...new Set((history.value?.series ?? []).flatMap(item => item.points.map(point => point.at)))].length)
const completeChainPoints = computed(() => economics.value.filter(point => point.net !== null).length)
const latestItemPoint = computed(() => currentItem.value?.points.findLast(point => point[side.value] !== null))
const latestChainPoint = computed(() => economics.value.findLast(point => point.net !== null))
const latestSelectedTime = computed(() => mode.value === 'item' ? latestItemPoint.value?.at : latestChainPoint.value?.at)
function formatAmount(value: number) { return value.toLocaleString(undefined, { maximumFractionDigits: 2 }) }
function money(value: number | null | undefined) { return value == null ? '$...' : `$${formatAmount(value)}` }
function readableTime(at?: string) { return at ? new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'No saved snapshot' }
</script>

<template>
  <div class="history-page">
    <div class="history-intro"><div><p class="eyebrow">RECORDED MARKET DATA</p><h2>Price history</h2><p>Explore every saved item quote, or see how a production chain's input cost and output value moved together.</p></div><button class="history-back" @click="emit('close')">← Price overview</button></div>
    <div class="history-mode-tabs" role="group" aria-label="History view"><button :class="{ active: mode === 'item' }" :aria-pressed="mode === 'item'" @click="mode = 'item'">Individual items</button><button :class="{ active: mode === 'chain' }" :aria-pressed="mode === 'chain'" @click="mode = 'chain'">Production chains</button></div>
    <div class="history-control-card">
      <div v-if="mode === 'item'" class="history-pick-items">
        <div class="history-label"><strong>Items to inspect</strong><span>Compare up to four</span></div>
        <div class="history-picked"><span v-for="symbol in selectedSymbols" :key="symbol" class="history-item-pill"><ItemIcon :item-id="symbol" :name="quoteBySymbol.get(symbol)?.name ?? symbol" />{{ quoteBySymbol.get(symbol)?.name ?? symbol }}<button v-if="selectedSymbols.length > 1" :aria-label="`Remove ${quoteBySymbol.get(symbol)?.name ?? symbol}`" @click="removeItem(symbol)">×</button></span></div>
        <div class="history-search-wrap"><input v-model="itemSearch" type="search" placeholder="Search all market items to compare" aria-label="Search market items" :disabled="selectedSymbols.length >= 4"><div v-if="searchMatches.length" class="history-search-results"><button v-for="quote in searchMatches" :key="quote.symbol" @click="addItem(quote.symbol)"><ItemIcon :item-id="quote.symbol" :name="quote.name" />{{ quote.name }} <small>{{ quote.symbol }}</small></button></div></div>
        <div class="history-side-controls"><label><span>Price to compare</span><select v-model="side"><option value="bid">Instant sell · best bid</option><option value="ask">Quick buy · best ask</option><option value="reference">Ticker reference</option></select></label><label v-if="selectedSymbols.length > 1"><span>Comparison scale</span><select v-model="compareScale"><option value="indexed">Change from first quote (%)</option><option value="absolute">Actual prices ($)</option></select></label><label v-else class="history-check"><input v-model="allSides" type="checkbox"> Show bid, ask, and reference together</label></div>
      </div>
      <div v-else class="history-pick-chain"><div class="history-label"><strong>Production flow</strong><span>Rates and values per minute</span></div><select v-model="selectedChain" aria-label="Choose production chain"><option value="plan">Entire current plan</option><option v-for="root in rootOptions" :key="root.id" :value="root.id">{{ root.label }} chain</option></select><p>A selected output traces its linked ingredients at the amount it needs. The entire plan uses its current external inputs and surplus. Shared producers are allocated to the chosen output only.</p></div>
      <div class="history-range"><span>HISTORY WINDOW</span><div role="group" aria-label="History time range"><button v-for="option in (['24h', '7d', '30d', '90d'] as Range[])" :key="option" :class="{ active: range === option }" :aria-pressed="range === option" @click="range = option">{{ option }}</button></div></div>
    </div>

    <div v-if="mode === 'chain' && !neededSymbols.length" class="history-empty-state">Add a production chain in Targets or on the graph to see its price history here.</div>
    <div v-else-if="loading" class="history-empty-state">Loading recorded snapshots…</div>
    <div v-else-if="failure" class="history-empty-state history-error" role="alert">{{ failure }}</div>
    <template v-else>
      <div class="history-metrics"><div><span>RECORDED TIMES</span><strong>{{ recordedCount }}</strong><small>within the selected range</small></div><div><span>{{ mode === 'item' ? 'LATEST QUOTE' : 'COMPLETE CHAIN POINTS' }}</span><strong>{{ mode === 'item' ? money(latestItemPoint?.[side]) : completeChainPoints }}</strong><small>{{ mode === 'item' ? sideNames[side] : 'each needed item has a bid or ask' }}</small></div><div><span>LATEST SAVED TIME</span><strong class="history-date">{{ readableTime(latestSelectedTime) }}</strong><small>Historical prices are saved at collection time</small></div></div>
      <PriceHistoryChart :lines="lines" :range="range" :unit="chartUnit" :forecast="forecast" />
      <div v-if="mode === 'item'" class="history-explain"><div><h3>One-hour price estimate</h3><p>Shown only for one item’s best bid when at least 32 recent hourly observations are fresh and a simple trend has beaten a no-change estimate on recent checks.</p></div><label class="history-check"><input v-model="showForecast" type="checkbox"> Show estimate when supported</label><p v-if="forecast" class="history-forecast">Estimated next bid {{ money(forecast.estimate) }} · plausible range {{ money(forecast.low) }}–{{ money(forecast.high) }}. Based on {{ forecast.sampleCount }} recent points; recent average error {{ money(forecast.backtestError) }}.</p><p v-else class="history-unavailable">No reliable estimate for this selection yet. More recent, regular snapshots may make one possible.</p></div>
      <div v-else class="history-explain"><div><h3>How this chain is priced</h3><p>Output sale rates use recorded best bids, or asks as a proxy when a bid is missing. External input rates use recorded best asks, or bids as a proxy when an ask is missing. Both must be absent to leave a chain value blank. Local what-if prices do not rewrite history.</p></div><div class="history-flow-list"><span v-for="flow in currentFlows.sales" :key="`sale-${flow.id}`"><ItemIcon :item-id="flow.id" :name="flow.name" />↑ {{ flow.name }} · {{ formatAmount(flow.amount) }}/min</span><span v-for="flow in currentFlows.costs" :key="`cost-${flow.id}`"><ItemIcon :item-id="flow.id" :name="flow.name" />↓ {{ flow.name }} · {{ formatAmount(flow.amount) }}/min</span></div><p v-if="recordedCount && !completeChainPoints" class="history-unavailable">There are recorded prices, but no hour has a bid or ask for every item this chain needs yet.</p></div>
    </template>
  </div>
</template>

<style scoped>
.history-page{max-width:1320px;min-height:100%;margin:auto;padding:22px 24px 45px;color:#dce6dc}.history-intro{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:18px}.history-intro .eyebrow{margin:0 0 7px;color:#90b895;font:9px 'DM Mono',monospace;letter-spacing:.12em}.history-intro h2{margin:0;color:#ebf3eb;font-size:22px;font-weight:600;letter-spacing:-.03em}.history-intro p:last-child{max-width:650px;margin:8px 0 0;color:#94a396;font-size:11px;line-height:1.6}.history-back{border:1px solid #47604a;border-radius:6px;background:#243128;color:#c5dfc7;padding:9px 12px;font:10px 'DM Sans',sans-serif;white-space:nowrap;cursor:pointer}.history-back:hover{background:#304034}.history-mode-tabs{display:flex;gap:6px;margin-bottom:12px}.history-mode-tabs button,.history-range button{border:1px solid #344438;border-radius:6px;background:#19231c;color:#91a693;padding:9px 13px;font:10px 'DM Sans',sans-serif;cursor:pointer}.history-mode-tabs button.active,.history-range button.active{border-color:#83ab87;background:#2d4330;color:#e0f1e0;box-shadow:inset 0 1px #ffffff16}.history-control-card{display:flex;justify-content:space-between;gap:16px;margin-bottom:14px;padding:17px;border:1px solid #334337;border-radius:9px;background:#19231c}.history-pick-items,.history-pick-chain{min-width:0;flex:1}.history-label{display:flex;align-items:baseline;gap:10px;margin-bottom:10px}.history-label strong{font-size:11px;font-weight:600}.history-label span{color:#809386;font-size:9px}.history-picked{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:9px}.history-item-pill{display:inline-flex;align-items:center;gap:7px;padding:6px 8px;border:1px solid #58795c;border-radius:5px;background:#26392a;color:#d1e5d1;font-size:10px}.history-item-pill button{border:0;background:transparent;color:#a7c5aa;font-size:15px;line-height:10px;cursor:pointer}.history-search-wrap{position:relative;max-width:420px}.history-search-wrap>input,.history-pick-chain>select,.history-side-controls select{width:100%;height:33px;border:1px solid #455747;border-radius:5px;background:#121a15;color:#e0eae1;padding:0 9px;font:10px 'DM Sans',sans-serif}.history-search-wrap input:focus,.history-pick-chain select:focus,.history-side-controls select:focus{outline:2px solid #7da381;outline-offset:1px}.history-search-results{position:absolute;z-index:5;top:36px;left:0;right:0;max-height:230px;overflow:auto;border:1px solid #526a56;border-radius:6px;background:#202d23;box-shadow:0 12px 22px #0007}.history-search-results button{display:flex;justify-content:space-between;gap:8px;width:100%;padding:9px 10px;border:0;border-bottom:1px solid #324336;background:none;color:#e0ebe0;text-align:left;font-size:10px;cursor:pointer}.history-search-results button:hover{background:#334638}.history-search-results small{color:#88a18d}.history-side-controls{display:flex;align-items:end;flex-wrap:wrap;gap:16px;margin-top:12px}.history-side-controls label>span{display:block;margin-bottom:5px;color:#8ea390;font-size:9px}.history-side-controls select{width:210px}.history-check{display:inline-flex;align-items:center;gap:6px;color:#a8b9aa;font-size:10px}.history-check input{accent-color:#91bf96}.history-pick-chain>select{max-width:420px}.history-pick-chain>p{max-width:610px;margin:9px 0 0;color:#88998b;font-size:9px;line-height:1.5}.history-range{flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:9px}.history-range>span{color:#8ea390;font:9px 'DM Mono',monospace;letter-spacing:.08em}.history-range>div{display:flex;gap:5px}.history-range button{padding:7px 9px;font-family:'DM Mono',monospace}.history-empty-state{padding:65px 18px;border:1px dashed #49604d;border-radius:8px;background:#19231c;color:#aabfac;text-align:center;font-size:12px}.history-error{color:#e3aaa1}.history-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:13px}.history-metrics>div{display:flex;flex-direction:column;gap:7px;padding:15px;border:1px solid #344338;border-radius:7px;background:#1b271e}.history-metrics span{color:#8da993;font:9px 'DM Mono',monospace;letter-spacing:.08em}.history-metrics strong{overflow:hidden;color:#e3eee4;font:21px 'DM Mono',monospace;text-overflow:ellipsis;white-space:nowrap}.history-metrics strong.history-date{font:13px 'DM Sans',sans-serif}.history-metrics small{color:#8d9c8f;font-size:9px}.history-explain{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:12px;margin-top:14px;padding:18px;border:1px solid #344338;border-radius:8px;background:#19231c}.history-explain>div:first-child{max-width:670px}.history-explain h3{margin:0 0 6px;color:#dce9dd;font-size:12px}.history-explain p{margin:0;color:#93a595;font-size:10px;line-height:1.6}.history-explain .history-forecast,.history-explain .history-unavailable{width:100%;color:#d8c18e}.history-flow-list{display:flex;flex-wrap:wrap;gap:5px;max-width:720px}.history-flow-list span{padding:5px 7px;border:1px solid #405746;border-radius:4px;color:#b2c8b5;font:9px 'DM Mono',monospace}@media(max-width:850px){.history-control-card{flex-direction:column}.history-range{align-items:flex-start}.history-intro{flex-direction:column}.history-metrics{grid-template-columns:1fr 1fr}}@media(max-width:550px){.history-page{padding:16px 12px 35px}.history-metrics{grid-template-columns:1fr}.history-mode-tabs button{flex:1}.history-range>div{flex-wrap:wrap}}
.history-item-pill .game-item-icon,.history-search-results .game-item-icon,.history-flow-list .game-item-icon{--icon-size:20px}
.history-search-results button{align-items:center;justify-content:flex-start}.history-search-results small{margin-left:auto}
.history-flow-list span{display:inline-flex;align-items:center;gap:5px}
</style>
