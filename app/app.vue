<script setup lang="ts">
import { calculateDemandByProducer, calculateNetworkSummary, consolidateOutputNodes as mergeDuplicateOutputs, machinesForDemand } from './utils/production-solver.js'
type Ingredient = { item_id: string; name: string; quantity: number; image_url?: string | null }
type Recipe = { id: string; label: string; station: string; image_url?: string | null; product_image_url?: string | null; batch: number; rate: number; product_id: string; product: string; ingredients: Ingredient[] }
type MachineNode = { id: string; recipeId: string; x: number; y: number; machines: number }
type Connection = { key: string; from: MachineNode; to: MachineNode; ingredient: Ingredient; produced: number }
type GraphEndpoint = { id: string; x: number; y: number }
type GraphLayer = { itemId: string; name: string; rate: number; row: number }
type GraphPanel = GraphEndpoint & { rows: GraphLayer[] }
type GraphConnection = { key: string; kind: 'recipe' | 'input' | 'output'; from: GraphEndpoint; to: GraphEndpoint; produced: number; inputKey?: string; row?: number }
type PlannerView = 'network' | 'tree' | 'items' | 'buildings' | 'targets' | 'prices'
type TargetSection = 'outputs' | 'inputs' | 'options'
type ProductionTarget = { id: string; itemId: string; recipeId: string; rate: number }
type ImportedInput = { id: string; itemId: string; rate: number }
type PlanSnapshot = { nodes: MachineNode[]; connections: Record<string, string>; productionTargets: ProductionTarget[]; importedInputs: ImportedInput[]; autoArrangeGenerated: boolean; preserveExistingPlan: boolean }
type TreeRow = { key: string; depth: number; kind: 'product' | 'ingredient'; itemId: string; name: string; detail: string; machines?: number; external?: boolean; nodeId?: string; hasChildren?: boolean; collapsed?: boolean }
type ItemBalance = { id: string; name: string; produced: number; required: number; connected: number; external: number; surplus: number }
type BuildingSummary = { id: string; name: string; recipeCount: number; machines: number; products: { id: string; name: string }[] }
type MarketQuote = { symbol: string; name: string; price: number; buyPrice?: number | null; sellPrice?: number | null; suggestedSellOffer?: number | null; orderBookAsOf?: string | null; units24h: number; volumeKnown?: boolean; dayChangePercent?: number | null; previousPrice: number | null; history: number[]; changeSincePreviousPercent: number | null }
type MarketData = { asOf: string; refreshedAt: string | null; refreshOutcome: string; refreshIntervalHours: number; catalogueCoverage?: { priced: number; total: number }; orderBookCoverage?: { priced: number; total: number }; quotes: MarketQuote[]; source: string }
type OptimizerInputCost = { itemId: string; name: string; amountPerItem: number; unitCost: number; totalCost: number; routeRecipe?: Recipe }
type OptimizerOpportunity = { recipe: Recipe; outputPrice: number; inputCostPerItem: number; marginPerItem: number; marginPercent: number; profitPerMinute: number; outputVolumeShare: number | undefined; inputCosts: OptimizerInputCost[]; routeRecipes: Map<string, Recipe> }
type RecipeGroup = { id: string; name: string; recipes: Recipe[] }
type PortPoint = { x: number; y: number }
const recipes = ref<Recipe[]>([])
const recipeById = computed(() => new Map(recipes.value.map(recipe => [recipe.id, recipe])))
const metadata = ref<{ recipeCount: number; itemCount: number; retrievedAt: string } | null>(null)
const marketData = ref<MarketData | null>(null)
const priceOverrides = ref<Record<string, { buy?: number; sell?: number }>>({})
const marketLoading = ref(false)
const marketError = ref('')
const search = ref('')
const selectedCategory = ref('all')
const viewSearch = ref('')
const optimizerSearch = ref('')
const activeView = ref<PlannerView>('network')
const showPriceHistory = ref(false)
const historyInitialSymbol = ref<string | undefined>()
function openPriceHistory(symbol?: string) {
  historyInitialSymbol.value = symbol
  showPriceHistory.value = true
  activeView.value = 'prices'
}
const plannerTabs: [PlannerView, string][] = [['network', 'Network Graph'], ['tree', 'Tree List'], ['items', 'Items'], ['buildings', 'Buildings'], ['targets', 'Targets'], ['prices', 'Prices']]
const targetSections: [TargetSection, string][] = [['outputs', 'Outputs'], ['inputs', 'Inputs'], ['options', 'Options']]
const stationColors: Record<string, string> = {
  brick_kiln: '#cb8669', carpentry_bench: '#b69a65', chemical_plant: '#74b79e',
  chip_fab: '#8a9ed5', electronics_bench: '#a48bd3', foundry: '#ca9079',
  furnace: '#c77b72', gaming_workshop: '#bf8ec1', glazing_line: '#81b5bd',
  hydraulics_shop: '#7dacc8', kitchen: '#c5a46b', loom: '#c18caa',
  machine_shop: '#87a9bd', manufacturing_press: '#a993c3', metal_shop: '#9daab8',
  mill: '#a7b879', oil_refinery: '#82b5a3', sawmill: '#8eb884',
  steel_mill: '#a39db8', stonecutter: '#b8a88b',
  vehicle_assembly_platform: '#8da6d0', vulcanizer: '#bf9a78'
}
function stationAccent(station?: string) { return stationColors[station ?? ''] ?? '#9aab9b' }
const activeTargetSection = ref<TargetSection>('outputs')
const productionTargets = ref<ProductionTarget[]>([])
const importedInputs = ref<ImportedInput[]>([])
const autoArrangeGenerated = ref(true)
const preserveExistingPlan = ref(true)
const nodes = ref<MachineNode[]>([])
const selectedNodeIds = ref<string[]>([])
const compactGraph = ref(0)
const collapsedTreeNodeIds = ref<string[]>([])
const connections = ref<Record<string, string>>({})
const activeInput = ref('')
const importPlanInput = ref<HTMLInputElement | null>(null)
const undoHistory = ref<PlanSnapshot[]>([])
const redoHistory = ref<PlanSnapshot[]>([])
const canvas = ref<HTMLElement | null>(null)
const canvasBoard = ref<HTMLElement | null>(null)
const nodeElements = new Map<string, HTMLElement>()
const portPositions = ref<Record<string, PortPoint>>({})
const portElements = new Map<string, HTMLElement>()
const portOffsets = new Map<string, PortPoint>()
const movingNodes = ref<{ nodes: { node: MachineNode; x: number; y: number }[]; pointerId: number; clientX: number; clientY: number; historyRecorded: boolean } | null>(null)
const selecting = ref<{ pointerId: number; startX: number; startY: number; endX: number; endY: number; additive: boolean } | null>(null)
const draggedRecipe = ref<Recipe | null>(null)
const dragPreview = ref<{ x: number; y: number } | null>(null)
const panning = ref<{ pointerId: number; clientX: number; clientY: number; scrollLeft: number; scrollTop: number } | null>(null)
let saveTimer: ReturnType<typeof setTimeout> | undefined
let moveFrame = 0
let portMeasureFrame = 0
let lastMarketFetch = 0
let marketRequest: Promise<void> | undefined
let marketRefreshTimer: ReturnType<typeof setInterval> | undefined
const pending = ref(true)
const error = ref('')
const zoom = ref(100)
const storageKey = 'capitalrift-factory-plan-v1'
const priceOverridesStorageKey = 'capitalrift-price-overrides-v1'
const GRID = 24
const TREE_GAP = 24
const CANVAS_GROW = 2400
const EDGE_BUFFER = 420
const canvasExtent = ref({ left: -12000, top: -3000, right: 2200, bottom: 1600 })
let extendingCanvas = false

onMounted(async () => {
  document.addEventListener('keydown', searchShortcut)
  marketRefreshTimer = setInterval(() => { void loadMarketPrices(true) }, 60 * 60 * 1000)
  try {
    const saved = localStorage.getItem(storageKey)
    if (saved) {
      const plan = JSON.parse(saved)
      if (Array.isArray(plan.nodes)) nodes.value = plan.nodes
      if (plan.connections && typeof plan.connections === 'object') connections.value = plan.connections
      if (Array.isArray(plan.productionTargets)) productionTargets.value = plan.productionTargets
      if (Array.isArray(plan.importedInputs)) importedInputs.value = plan.importedInputs
      if (typeof plan.autoArrangeGenerated === 'boolean') autoArrangeGenerated.value = plan.autoArrangeGenerated
      if (typeof plan.preserveExistingPlan === 'boolean') preserveExistingPlan.value = plan.preserveExistingPlan
    }
  } catch { localStorage.removeItem(storageKey) }
  try {
    const savedOverrides = localStorage.getItem(priceOverridesStorageKey)
    if (savedOverrides) priceOverrides.value = JSON.parse(savedOverrides)
  } catch { localStorage.removeItem(priceOverridesStorageKey) }
  try {
    const [catalog, sourceInfo] = await Promise.all([
      $fetch<Recipe[]>('/api/recipes'),
      $fetch<typeof metadata.value>('/api/meta')
    ])
    recipes.value = catalog
    metadata.value = sourceInfo
    consolidateOutputNodes()
    nodes.value = nodes.value.filter(node => catalog.some(recipe => recipe.id === node.recipeId))
    await nextTick()
    centerCanvas()
    // Load quotes with the planner so known prices are visible across every view,
    // not only after opening the Prices tab.
    void loadMarketPrices()
  } catch { error.value = 'Could not load the recipe catalogue. Refresh to try again.' }
  finally { pending.value = false }
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', searchShortcut)
  if (marketRefreshTimer) clearInterval(marketRefreshTimer)
  if (saveTimer) clearTimeout(saveTimer)
  if (moveFrame) cancelAnimationFrame(moveFrame)
  if (portMeasureFrame) cancelAnimationFrame(portMeasureFrame)
})
onUpdated(() => {
  if (portMeasureFrame) return
  portMeasureFrame = requestAnimationFrame(() => {
    portMeasureFrame = 0
    updatePortPositions()
  })
})
function searchShortcut(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null
  const editingText = !!target?.closest('input,textarea,select,[contenteditable="true"]')
  if ((event.ctrlKey || event.metaKey) && !editingText && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    if (event.shiftKey) redoPlan()
    else undoPlan()
    return
  }
  if ((event.ctrlKey || event.metaKey) && !editingText && event.key.toLowerCase() === 'y') {
    event.preventDefault()
    redoPlan()
    return
  }
  if (event.key === '/' && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
    event.preventDefault()
    document.querySelector<HTMLInputElement>('.search-box input')?.focus()
  }
}

function zoomCanvasWheel(event: WheelEvent) {
  if (!event.ctrlKey || !canvas.value) return
  event.preventDefault()

  const viewport = canvas.value
  const bounds = viewport.getBoundingClientRect()
  const cursorX = event.clientX - bounds.left
  const cursorY = event.clientY - bounds.top
  const oldScrollLeft = viewport.scrollLeft
  const oldScrollTop = viewport.scrollTop
  const oldScale = zoom.value / 100
  const nextScale = Math.min(1.4, Math.max(0.6, oldScale * (1.1 ** (-event.deltaY / 100))))
  const nextZoom = Math.min(140, Math.max(60, Math.round(nextScale * 20) * 5))
  if (nextZoom === zoom.value) return

  zoom.value = nextZoom
  requestAnimationFrame(() => {
    viewport.scrollLeft = (oldScrollLeft + cursorX) / oldScale * (nextZoom / 100) - cursorX
    viewport.scrollTop = (oldScrollTop + cursorY) / oldScale * (nextZoom / 100) - cursorY
  })
}

watch([nodes, connections, productionTargets, importedInputs, autoArrangeGenerated, preserveExistingPlan], () => {
  if (import.meta.client) {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => localStorage.setItem(storageKey, JSON.stringify({ nodes: nodes.value, connections: connections.value, productionTargets: productionTargets.value, importedInputs: importedInputs.value, autoArrangeGenerated: autoArrangeGenerated.value, preserveExistingPlan: preserveExistingPlan.value })), 250)
  }
}, { deep: true })
watch(activeView, view => {
  if (view === 'network') void nextTick(centerCanvas)
  if (view === 'prices') void loadMarketPrices()
})
watch(compactGraph, () => {
  portOffsets.clear()
  portPositions.value = {}
})

function snapshotPlan(): PlanSnapshot {
  return JSON.parse(JSON.stringify({
    nodes: nodes.value,
    connections: connections.value,
    productionTargets: productionTargets.value,
    importedInputs: importedInputs.value,
    autoArrangeGenerated: autoArrangeGenerated.value,
    preserveExistingPlan: preserveExistingPlan.value
  })) as PlanSnapshot
}
function recordPlanChange() {
  undoHistory.value.push(snapshotPlan())
  if (undoHistory.value.length > 50) undoHistory.value.shift()
  redoHistory.value = []
}
function restorePlan(snapshot: PlanSnapshot) {
  const restored = JSON.parse(JSON.stringify(snapshot)) as PlanSnapshot
  nodes.value = restored.nodes
  connections.value = restored.connections
  productionTargets.value = restored.productionTargets
  importedInputs.value = restored.importedInputs
  autoArrangeGenerated.value = restored.autoArrangeGenerated
  preserveExistingPlan.value = restored.preserveExistingPlan
}
function undoPlan() {
  const previous = undoHistory.value.pop()
  if (!previous) return
  redoHistory.value.push(snapshotPlan())
  restorePlan(previous)
}
function redoPlan() {
  const next = redoHistory.value.pop()
  if (!next) return
  undoHistory.value.push(snapshotPlan())
  restorePlan(next)
}
function clearPlan() {
  if (!nodes.value.length && !productionTargets.value.length && !importedInputs.value.length) return
  if (!window.confirm('Clear this factory plan and its saved targets?')) return
  recordPlanChange()
  nodes.value = []
  connections.value = {}
  productionTargets.value = []
  importedInputs.value = []
  selectedNodeIds.value = []
}
function exportPlan() {
  const file = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), plan: snapshotPlan() }, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = `capitalrift-plan-${new Date().toISOString().slice(0, 10)}.json`
  link.click()
  URL.revokeObjectURL(url)
}
async function importPlanFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (file.size > 2_000_000) {
    error.value = 'Plan files must be smaller than 2 MB.'
    return
  }
  try {
    const parsed = JSON.parse(await file.text())
    const candidate = parsed.plan ?? parsed
    if (!Array.isArray(candidate.nodes) || candidate.nodes.length > 5000 || !candidate.connections || typeof candidate.connections !== 'object') throw new Error('invalid')
    const validNodes = candidate.nodes.every((node: unknown) => {
      if (!node || typeof node !== 'object') return false
      const value = node as Partial<MachineNode>
      return typeof value.id === 'string' && typeof value.recipeId === 'string' && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.machines) && (value.machines ?? 0) >= 1 && recipeById.value.has(value.recipeId)
    })
    if (!validNodes) throw new Error('invalid')
    const nodeIds = new Set<string>(candidate.nodes.map((node: MachineNode) => node.id))
    const cleanConnections = Object.fromEntries(Object.entries(candidate.connections).filter(([key, source]) => {
      if (typeof source !== 'string' || !nodeIds.has(source)) return false
      const consumerId = key.slice(0, key.lastIndexOf(':'))
      return nodeIds.has(consumerId)
    })) as Record<string, string>
    recordPlanChange()
    restorePlan({
      nodes: candidate.nodes,
      connections: cleanConnections,
      productionTargets: Array.isArray(candidate.productionTargets) ? candidate.productionTargets.filter((target: ProductionTarget) => typeof target?.id === 'string' && typeof target.itemId === 'string' && Number.isFinite(target.rate)) : [],
      importedInputs: Array.isArray(candidate.importedInputs) ? candidate.importedInputs.filter((item: ImportedInput) => typeof item?.id === 'string' && typeof item.itemId === 'string' && Number.isFinite(item.rate)) : [],
      autoArrangeGenerated: typeof candidate.autoArrangeGenerated === 'boolean' ? candidate.autoArrangeGenerated : true,
      preserveExistingPlan: typeof candidate.preserveExistingPlan === 'boolean' ? candidate.preserveExistingPlan : true
    })
    selectedNodeIds.value = []
    arrangeNetwork()
    activeView.value = 'network'
    void nextTick(centerCanvas)
    error.value = ''
  } catch {
    error.value = 'This file is not a valid CapitalRift factory plan.'
  }
}

async function loadMarketPrices(force = false) {
  if (marketRequest) return marketRequest
  if (!force && marketData.value && Date.now() - lastMarketFetch < 60_000) return
  marketLoading.value = true
  marketError.value = ''
  marketRequest = (async () => {
    try {
      marketData.value = await $fetch<MarketData>('/api/prices')
      lastMarketFetch = Date.now()
    } catch {
      marketError.value = 'Live market quotes could not be loaded. Try again shortly.'
    } finally {
      marketLoading.value = false
      marketRequest = undefined
    }
  })()
  return marketRequest
}

const filteredRecipes = computed(() => {
  const needle = search.value.trim().toLowerCase()
  return recipes.value.filter(recipe => (selectedCategory.value === 'all' || recipe.station === selectedCategory.value) && (!needle || `${recipe.product} ${recipe.label} ${recipe.station}`.toLowerCase().includes(needle)))
})
const recipeGroups = computed<RecipeGroup[]>(() => {
  const groups = new Map<string, RecipeGroup>()
  for (const recipe of recipes.value) {
    let group = groups.get(recipe.station)
    if (!group) {
      group = { id: recipe.station, name: recipe.station.replaceAll('_', ' '), recipes: [] }
      groups.set(recipe.station, group)
    }
    group.recipes.push(recipe)
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name))
})
const groupedRecipes = computed(() => {
  const groups = new Map<string, RecipeGroup>()
  for (const recipe of filteredRecipes.value) {
    let group = groups.get(recipe.station)
    if (!group) {
      group = { id: recipe.station, name: recipe.station.replaceAll('_', ' '), recipes: [] }
      groups.set(recipe.station, group)
    }
    group.recipes.push(recipe)
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name))
})
const productOptions = computed(() => {
  const items = new Map<string, string>()
  for (const recipe of recipes.value) items.set(recipe.product_id, recipe.product)
  return [...items].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
})
const recipesByProduct = computed(() => {
  const grouped = new Map<string, Recipe[]>()
  for (const recipe of recipes.value) {
    if (recipe.rate <= 0) continue
    const matches = grouped.get(recipe.product_id) ?? []
    matches.push(recipe)
    grouped.set(recipe.product_id, matches)
  }
  for (const matches of grouped.values()) matches.sort((a, b) => a.station.localeCompare(b.station) || a.label.localeCompare(b.label))
  return grouped
})
const nodesById = computed(() => new Map(nodes.value.map(node => [node.id, node])))
const consumersByProducer = computed(() => {
  const grouped = new Map<string, string[]>()
  for (const [key, producerId] of Object.entries(connections.value)) {
    const consumers = grouped.get(producerId) ?? []
    consumers.push(key.slice(0, key.lastIndexOf(':')))
    grouped.set(producerId, consumers)
  }
  return grouped
})
const nodesByProduct = computed(() => {
  const grouped = new Map<string, MachineNode[]>()
  for (const node of nodes.value) {
    const productId = recipeById.value.get(node.recipeId)?.product_id
    if (!productId) continue
    const matches = grouped.get(productId) ?? []
    matches.push(node)
    grouped.set(productId, matches)
  }
  return grouped
})
const materialOptions = computed(() => {
  const items = new Map<string, string>()
  for (const recipe of recipes.value) {
    items.set(recipe.product_id, recipe.product)
    for (const ingredient of recipe.ingredients) items.set(ingredient.item_id, ingredient.name)
  }
  return [...items].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
})
function recipeFor(node: MachineNode) { return recipeById.value.get(node.recipeId) }
function inputKey(nodeId: string, itemId: string) { return `${nodeId}:${itemId}` }
function isImportedItem(itemId: string) { return importedInputs.value.some(input => input.itemId === itemId) }
function recipesForItem(itemId: string) { return recipesByProduct.value.get(itemId) ?? [] }
function addProductionTarget() {
  recordPlanChange()
  productionTargets.value.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, itemId: '', recipeId: '', rate: 1 })
}
function buildTargetFromSearch(target: ProductionTarget, name: string) {
  setTargetItemByName(target, name)
  buildProductionTargets()
}
function setTargetItemByName(target: ProductionTarget, name: string) {
  const item = productOptions.value.find(candidate => candidate.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase())
  const recipe = item && recipesForItem(item.id)[0]
  const itemId = item?.id ?? ''
  if (target.itemId !== itemId) recordPlanChange()
  target.itemId = itemId
  target.recipeId = recipe?.id ?? ''
}
function addImportedInput() {
  const item = materialOptions.value.find(candidate => !importedInputs.value.some(input => input.itemId === candidate.id))
  if (item) {
    recordPlanChange()
    importedInputs.value.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, itemId: item.id, rate: 1 })
  }
}
function setImportedItemById(inputId: string, itemId: string) {
  if (importedInputs.value.some(input => input.id !== inputId && input.itemId === itemId)) return
  const input = importedInputs.value.find(candidate => candidate.id === inputId)
  if (input && input.itemId !== itemId) {
    recordPlanChange()
    input.itemId = itemId
  }
}
function setImportedRate(inputId: string, value: string | number) {
  const input = importedInputs.value.find(candidate => candidate.id === inputId)
  const rate = Math.max(0, Number(value) || 0)
  if (input && input.rate !== rate) {
    recordPlanChange()
    input.rate = rate
  }
}
function removeProductionTarget(id: string) {
  if (!productionTargets.value.some(target => target.id === id)) return
  recordPlanChange()
  productionTargets.value = productionTargets.value.filter(target => target.id !== id)
}
function removeImportedInput(id: string) {
  if (!importedInputs.value.some(input => input.id === id)) return
  recordPlanChange()
  importedInputs.value = importedInputs.value.filter(input => input.id !== id)
}
function configureImportForItem(itemId: string) {
  if (!importedInputs.value.some(input => input.itemId === itemId)) {
    recordPlanChange()
    importedInputs.value.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, itemId, rate: 0 })
  }
  activeTargetSection.value = 'inputs'
  activeView.value = 'targets'
}
function reviewItemBalance(name: string) {
  viewSearch.value = name
  activeView.value = 'items'
}
function providersFor(consumer: MachineNode, itemId: string) {
  return (nodesByProduct.value.get(itemId) ?? []).filter(node => node.id !== consumer.id && !wouldCreateCycle(consumer.id, node.id))
}
function wouldCreateCycle(consumerId: string, providerId: string) {
  const pending = [consumerId]
  const visited = new Set<string>()
  while (pending.length) {
    const current = pending.pop()!
    if (current === providerId) return true
    if (visited.has(current)) continue
    visited.add(current)
    pending.push(...(consumersByProducer.value.get(current) ?? []))
  }
  return false
}
function addRecipe(recipe: Recipe, position?: { x: number; y: number }) {
  const existing = nodesByProduct.value.get(recipe.product_id)?.[0]
  if (existing) {
    selectedNodeIds.value = [existing.id]
    void nextTick(centerCanvas)
    return
  }
  recordPlanChange()
  const index = nodes.value.length
  const node = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    recipeId: recipe.id,
    x: position ? Math.round(position.x / GRID) * GRID : 48 + (index % 4) * 350,
    y: position ? Math.round(position.y / GRID) * GRID : 48 + Math.floor(index / 4) * 600,
    machines: 1
  }
  nodes.value.push(node)
  selectedNodeIds.value = [node.id]
  arrangeNetwork()
  void nextTick(centerCanvas)
}
function startCatalogDrag(event: DragEvent, recipe: Recipe) {
  draggedRecipe.value = recipe
  dragPreview.value = null
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData('text/plain', recipe.id)
  }
}
function updateDragPreview(event: DragEvent) {
  if (!draggedRecipe.value || !canvasBoard.value) return
  const rect = canvasBoard.value.getBoundingClientRect()
  const scale = zoom.value / 100
  const pointerX = boardBounds.value.left + (event.clientX - rect.left) / scale
  const pointerY = boardBounds.value.top + (event.clientY - rect.top) / scale
  dragPreview.value = { x: pointerX - 150, y: pointerY - 48 }
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}
function dropCatalogRecipe(event: DragEvent) {
  const recipe = draggedRecipe.value
  if (!recipe) return
  updateDragPreview(event)
  if (dragPreview.value) addRecipe(recipe, dragPreview.value)
  draggedRecipe.value = null
  dragPreview.value = null
}
function finishCatalogDrag() {
  draggedRecipe.value = null
  dragPreview.value = null
}
function machineCardHeight(recipe?: Recipe) {
  // Saved plans are restored before the catalogue request completes. Keep graph
  // layout safe while those recipe IDs are temporarily unresolved.
  const ingredientCount = recipe?.ingredients?.length ?? 0
  return compactGraph.value ? 82 + ingredientCount * 22 : 250 + ingredientCount * 29
}
function estimateBranchHeight(recipe: Recipe, path = new Set<string>(), recipeChooser?: (itemId: string) => Recipe | undefined): number {
  const ownHeight = machineCardHeight(recipe)
  if (path.has(recipe.product_id)) return ownHeight
  const nextPath = new Set(path).add(recipe.product_id)
  const children = recipe.ingredients
    .map(ingredient => recipeChooser ? recipeChooser(ingredient.item_id) : recipesForItem(ingredient.item_id)[0])
    .filter((candidate): candidate is Recipe => !!candidate)
  const childrenHeight = children.reduce((sum, child) => sum + estimateBranchHeight(child, nextPath, recipeChooser), 0) + Math.max(0, children.length - 1) * TREE_GAP
  return Math.max(ownHeight, childrenHeight)
}
function removeNode(nodeId: string) {
  recordPlanChange()
  nodes.value = nodes.value.filter(node => node.id !== nodeId)
  selectedNodeIds.value = selectedNodeIds.value.filter(id => id !== nodeId)
  for (const [key, value] of Object.entries(connections.value)) {
    if (key.startsWith(`${nodeId}:`) || value === nodeId) delete connections.value[key]
  }
}
function canExpandChain(node: MachineNode) {
  return recipeFor(node)?.ingredients.some(ingredient => {
    const providerId = connections.value[inputKey(node.id, ingredient.item_id)]
    const provider = providerId ? nodesById.value.get(providerId) : undefined
    const providerRecipe = provider && recipeFor(provider)
    if (providerRecipe?.product_id === ingredient.item_id && providerRecipe.rate > 0) return false
    return !isImportedItem(ingredient.item_id) && recipesForItem(ingredient.item_id).length > 0
  }) ?? false
}
function canExpandNodeId(nodeId: string) {
  const node = nodesById.value.get(nodeId)
  return node ? canExpandChain(node) : false
}
function expandTreeNode(nodeId: string) {
  const node = nodesById.value.get(nodeId)
  if (node) expandChain(node)
}
function toggleTreeNode(nodeId: string) {
  collapsedTreeNodeIds.value = collapsedTreeNodeIds.value.includes(nodeId)
    ? collapsedTreeNodeIds.value.filter(id => id !== nodeId)
    : [...collapsedTreeNodeIds.value, nodeId]
}
function focusNode(nodeId: string) {
  if (!nodesById.value.has(nodeId)) return
  selectedNodeIds.value = [nodeId]
  activeView.value = 'network'
  void nextTick(() => {
    const viewport = canvas.value
    const element = nodeElements.get(nodeId)
    if (!viewport || !element) return
    const viewRect = viewport.getBoundingClientRect()
    const nodeRect = element.getBoundingClientRect()
    viewport.scrollTo({
      left: viewport.scrollLeft + nodeRect.left + nodeRect.width / 2 - viewRect.left - viewRect.width / 2,
      top: viewport.scrollTop + nodeRect.top + nodeRect.height / 2 - viewRect.top - viewRect.height / 2,
      behavior: 'smooth'
    })
  })
}
function setPortElement(key: string, element: unknown) {
  if (import.meta.client && element instanceof HTMLElement) portElements.set(key, element)
  else portElements.delete(key)
}
function setNodeElement(key: string, element: unknown) {
  if (import.meta.client && element instanceof HTMLElement) nodeElements.set(key, element)
  else nodeElements.delete(key)
}
function updatePortPositions() {
  const board = canvasBoard.value
  if (!board) return
  const scale = zoom.value / 100
  const positions: Record<string, PortPoint> = {}
  const activeKeys = new Set<string>()
  const nodeIndex = nodesById.value
  for (const [key, element] of portElements) {
    if (!element.isConnected) continue
    const nodeId = key.startsWith('output:') ? key.slice('output:'.length) : key.slice('input:'.length, key.lastIndexOf(':'))
    const node = nodeIndex.get(nodeId)
    const nodeElement = nodeElements.get(nodeId)
    if (!node || !nodeElement) continue
    activeKeys.add(key)
    let offset = portOffsets.get(key)
    if (!offset) {
      const nodeRect = nodeElement.getBoundingClientRect()
      const portRect = element.getBoundingClientRect()
      offset = { x: (portRect.left + portRect.width / 2 - nodeRect.left) / scale, y: (portRect.top + portRect.height / 2 - nodeRect.top) / scale }
      portOffsets.set(key, offset)
    }
    positions[key] = {
      x: node.x + offset.x,
      y: node.y + offset.y
    }
  }
  for (const key of portOffsets.keys()) if (!activeKeys.has(key) && !portElements.has(key)) portOffsets.delete(key)
  const old = portPositions.value
  const changed = Object.keys(positions).length !== Object.keys(old).length || Object.entries(positions).some(([key, position]) => !old[key] || Math.abs(old[key].x - position.x) > 0.5 || Math.abs(old[key].y - position.y) > 0.5)
  if (changed) portPositions.value = positions
}
function startNodeMove(event: PointerEvent, node: MachineNode) {
  if (event.button !== 0 || (event.target as HTMLElement).closest('button,input,select,textarea')) return
  const additive = event.ctrlKey || event.metaKey || event.shiftKey
  const selected = selectedNodeIds.value.includes(node.id)
  if (additive && selected) {
    selectedNodeIds.value = selectedNodeIds.value.filter(id => id !== node.id)
    return
  }
  if (additive) selectedNodeIds.value = [...selectedNodeIds.value, node.id]
  else if (!selected) selectedNodeIds.value = [node.id]
  movingNodes.value = {
    nodes: nodes.value.filter(item => selectedNodeIds.value.includes(item.id)).map(item => ({ node: item, x: item.x, y: item.y })),
    pointerId: event.pointerId,
    clientX: event.clientX,
    clientY: event.clientY,
    historyRecorded: false
  }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}
function moveNode(event: PointerEvent) {
  const move = movingNodes.value
  if (!move || move.pointerId !== event.pointerId) return
  if (!move.historyRecorded) {
    recordPlanChange()
    move.historyRecorded = true
  }
  if (moveFrame) cancelAnimationFrame(moveFrame)
  moveFrame = requestAnimationFrame(() => {
    const scale = zoom.value / 100
    for (const item of move.nodes) {
      item.node.x = item.x + (event.clientX - move.clientX) / scale
      item.node.y = item.y + (event.clientY - move.clientY) / scale
    }
  })
}
function finishNodeMove(event: PointerEvent) {
  const move = movingNodes.value
  if (!move || move.pointerId !== event.pointerId) return
  if (moveFrame) cancelAnimationFrame(moveFrame)
  moveFrame = 0
  for (const item of move.nodes) {
    item.node.x = Math.round(item.node.x / GRID) * GRID
    item.node.y = Math.round(item.node.y / GRID) * GRID
  }
  movingNodes.value = null
}
function startSelectOrPan(event: PointerEvent) {
  if (event.button === 2 && !((event.target as HTMLElement).closest('.machine-card')) && canvas.value) {
    event.preventDefault()
    panning.value = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, scrollLeft: canvas.value.scrollLeft, scrollTop: canvas.value.scrollTop }
    canvas.value.classList.add('is-panning')
    canvas.value.setPointerCapture(event.pointerId)
    return
  }
  if (event.button !== 0 || (event.target as HTMLElement).closest('.machine-card') || !canvas.value) return
  const rect = canvas.value.getBoundingClientRect()
  selecting.value = { pointerId: event.pointerId, startX: event.clientX - rect.left, startY: event.clientY - rect.top, endX: event.clientX - rect.left, endY: event.clientY - rect.top, additive: event.ctrlKey || event.metaKey || event.shiftKey }
  canvas.value.setPointerCapture(event.pointerId)
}
function selectOrPanMove(event: PointerEvent) {
  const selection = selecting.value
  if (selection?.pointerId === event.pointerId && canvas.value) {
    const rect = canvas.value.getBoundingClientRect()
    selecting.value = { ...selection, endX: event.clientX - rect.left, endY: event.clientY - rect.top }
    return
  }
  panCanvas(event)
}
function finishSelectOrPan(event: PointerEvent) {
  const selection = selecting.value
  if (selection?.pointerId === event.pointerId && canvas.value) {
    const rect = canvas.value.getBoundingClientRect()
    const x1 = Math.min(selection.startX, selection.endX)
    const x2 = Math.max(selection.startX, selection.endX)
    const y1 = Math.min(selection.startY, selection.endY)
    const y2 = Math.max(selection.startY, selection.endY)
    if (x2 - x1 > 4 || y2 - y1 > 4) {
      const box = { left: rect.left + x1, right: rect.left + x2, top: rect.top + y1, bottom: rect.top + y2 }
      const hit = [...nodeElements.entries()].filter(([, element]) => {
        const nodeRect = element.getBoundingClientRect()
        return nodeRect.right >= box.left && nodeRect.left <= box.right && nodeRect.bottom >= box.top && nodeRect.top <= box.bottom
      }).map(([id]) => id)
      selectedNodeIds.value = selection.additive ? [...new Set([...selectedNodeIds.value, ...hit])] : hit
    } else if (!selection.additive) selectedNodeIds.value = []
    selecting.value = null
    return
  }
  finishPan(event)
}
function panCanvas(event: PointerEvent) {
  const pan = panning.value
  if (!pan || pan.pointerId !== event.pointerId || !canvas.value) return
  canvas.value.scrollLeft = pan.scrollLeft - (event.clientX - pan.clientX)
  canvas.value.scrollTop = pan.scrollTop - (event.clientY - pan.clientY)
  extendCanvasAtEdges()
}
function extendCanvasAtEdges() {
  if (!canvas.value || !panning.value || extendingCanvas) return
  const view = canvas.value
  const pan = panning.value
  const scale = zoom.value / 100
  const growPx = CANVAS_GROW * scale
  let shiftX = 0
  let shiftY = 0
  if (view.scrollLeft < EDGE_BUFFER) {
    canvasExtent.value.left -= CANVAS_GROW
    shiftX = growPx
  }
  if (view.scrollTop < EDGE_BUFFER) {
    canvasExtent.value.top -= CANVAS_GROW
    shiftY = growPx
  }
  if (view.scrollWidth - view.clientWidth - view.scrollLeft < EDGE_BUFFER) canvasExtent.value.right += CANVAS_GROW
  if (view.scrollHeight - view.clientHeight - view.scrollTop < EDGE_BUFFER) canvasExtent.value.bottom += CANVAS_GROW
  if (!shiftX && !shiftY) return
  extendingCanvas = true
  const scrollLeft = view.scrollLeft + shiftX
  const scrollTop = view.scrollTop + shiftY
  pan.scrollLeft += shiftX
  pan.scrollTop += shiftY
  void nextTick(() => {
    if (canvas.value) {
      canvas.value.scrollLeft = scrollLeft
      canvas.value.scrollTop = scrollTop
    }
    extendingCanvas = false
  })
}
function finishPan(event: PointerEvent) {
  if (!panning.value || panning.value.pointerId !== event.pointerId) return
  panning.value = null
  canvas.value?.classList.remove('is-panning')
}
function synchronizeUpstream(start: MachineNode) {
  const visited = new Set<string>()
  const postOrder: MachineNode[] = []
  function visit(consumer: MachineNode) {
    if (visited.has(consumer.id)) return
    visited.add(consumer.id)
    for (const ingredient of recipeFor(consumer)?.ingredients ?? []) {
      const provider = nodesById.value.get(connections.value[inputKey(consumer.id, ingredient.item_id)] ?? '')
      if (provider && recipeFor(provider)?.product_id !== ingredient.item_id) continue
      if (provider) visit(provider)
    }
    postOrder.push(consumer)
  }
  visit(start)
  const demandByProducer = calculateDemandByProducer(nodes.value, connections.value, recipeById.value)
  for (const producer of postOrder.reverse()) {
    if (producer.id === start.id) continue
    const recipe = recipeFor(producer)
    const demand = demandByProducer.get(producer.id) ?? 0
    if (recipe?.rate && demand > 0) producer.machines = machinesForDemand(demand, recipe.rate)
  }
}
function consolidateOutputNodes() {
  const result = mergeDuplicateOutputs(nodes.value, connections.value, selectedNodeIds.value, recipeById.value)
  if (result.nodes === nodes.value) return
  nodes.value = result.nodes
  connections.value = result.connections as Record<string, string>
  selectedNodeIds.value = result.selectedNodeIds
}
function expandChain(root: MachineNode, relayout = true, recipeChooser?: (itemId: string) => Recipe | undefined) {
  if (relayout) recordPlanChange()
  function expand(parent: MachineNode, path = new Set<string>()) {
    const recipe = recipeFor(parent)
    if (!recipe || path.has(recipe.product_id)) return
    const nextPath = new Set(path).add(recipe.product_id)
    const needs = recipe.ingredients.map(ingredient => {
      const demand = ingredient.quantity * recipe.rate / recipe.batch * parent.machines
      const key = inputKey(parent.id, ingredient.item_id)
      let producer = nodesById.value.get(connections.value[key] ?? '')
      let producerRecipe = producer && recipeFor(producer)
      if (!producerRecipe || producerRecipe.product_id !== ingredient.item_id || producerRecipe.rate <= 0) {
        if (producer) delete connections.value[key]
        producer = undefined
        producerRecipe = undefined
      }
      const candidate = producerRecipe ?? (isImportedItem(ingredient.item_id) ? undefined : recipeChooser ? recipeChooser(ingredient.item_id) : recipesForItem(ingredient.item_id)[0])
      return { ingredient, demand, key, producer, producerRecipe, candidate }
    })
    for (const need of needs) {
      const producer = need.producer ?? (!isImportedItem(need.ingredient.item_id) ? (nodesByProduct.value.get(need.ingredient.item_id) ?? []).find(node => node.id !== parent.id && (!recipeChooser || recipeFor(node)?.id === recipeChooser(need.ingredient.item_id)?.id) && !wouldCreateCycle(parent.id, node.id)) : undefined)
      const producerRecipe = producer && recipeFor(producer)
      if (producer && producerRecipe) {
        connections.value[need.key] = producer.id
        need.producer = producer
        need.producerRecipe = producerRecipe
      }
    }
    const demandByProducer = calculateDemandByProducer(nodes.value, connections.value, recipeById.value)
    for (const need of needs) {
      const producer = need.producer
      const producerRecipe = need.producerRecipe
      if (!producer || !producerRecipe) continue
      producer.machines = machinesForDemand(demandByProducer.get(producer.id) ?? need.demand, producerRecipe.rate)
      expand(producer, nextPath)
    }
    const newNeeds = needs.filter(need => !need.producer && need.candidate)
    const branchHeights = newNeeds.map(need => estimateBranchHeight(need.candidate!, nextPath, recipeChooser))
    const stackHeight = branchHeights.reduce((sum, height) => sum + height, 0) + Math.max(0, branchHeights.length - 1) * TREE_GAP
    let cursorY = parent.y + machineCardHeight(recipe) / 2 - stackHeight / 2
    newNeeds.forEach((need, index) => {
      const candidate = need.candidate!
      const branchHeight = branchHeights[index] ?? 0
      const child: MachineNode = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        recipeId: candidate.id,
        x: parent.x - 384,
        y: Math.round((cursorY + branchHeight / 2 - machineCardHeight(candidate) / 2) / GRID) * GRID,
        machines: machinesForDemand(need.demand, candidate.rate)
      }
      cursorY += branchHeight + TREE_GAP
      nodes.value.push(child)
      connections.value[need.key] = child.id
      expand(child, nextPath)
    })
  }
  expand(root)
  consolidateOutputNodes()
  if (relayout) {
    arrangeNetwork()
    void nextTick(centerCanvas)
  }
}
function setConnection(key: string, providerId: string) {
  if (connections.value[key] !== (providerId || undefined)) recordPlanChange()
  if (providerId) connections.value[key] = providerId
  else delete connections.value[key]
  activeInput.value = ''
}
function setMachineCount(node: MachineNode, value: string | number) {
  const next = Math.max(1, Math.min(999, Math.floor(Number(value) || 1)))
  if (node.machines !== next) recordPlanChange()
  node.machines = next
  synchronizeUpstream(node)
}
function amount(value: number) {
  return Math.abs(value) > 0 && Math.abs(value) < 0.01
    ? value.toLocaleString(undefined, { maximumSignificantDigits: 3 })
    : value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}
function buildProductionTargets() {
  if (productionTargets.value.some(target => target.itemId && target.rate > 0)) recordPlanChange()
  if (!preserveExistingPlan.value) {
    nodes.value = []
    connections.value = {}
    selectedNodeIds.value = []
  }
  const targetsByProduct = new Map<string, { target: ProductionTarget; rate: number }>()
  for (const target of productionTargets.value) {
    const current = targetsByProduct.get(target.itemId)
    targetsByProduct.set(target.itemId, { target: current?.target ?? target, rate: (current?.rate ?? 0) + target.rate })
  }
  for (const { target, rate } of targetsByProduct.values()) {
    const recipe = recipes.value.find(candidate => candidate.id === target.recipeId && candidate.product_id === target.itemId)
      ?? recipesForItem(target.itemId)[0]
    if (!recipe || rate <= 0) continue
    let root = nodes.value.find(node => node.recipeId === recipe.id && !Object.values(connections.value).includes(node.id))
    if (!root) {
      const index = nodes.value.length
      root = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, recipeId: recipe.id, x: 48 + (index % 4) * 350, y: 48 + Math.floor(index / 4) * 600, machines: 1 }
      nodes.value.push(root)
    }
    root.machines = machinesForDemand(rate, recipe.rate)
    expandChain(root, false)
  }
  consolidateOutputNodes()
  if (autoArrangeGenerated.value) arrangeNetwork()
  activeView.value = 'network'
  void nextTick(centerCanvas)
}

const network = computed(() => calculateNetworkSummary(nodes.value, connections.value, recipeById.value))
const quoteByItemName = computed(() => new Map((marketData.value?.quotes ?? []).map(quote => [quote.name.trim().toLocaleLowerCase(), quote])))
function bookPrice(quote: MarketQuote, side: 'buy' | 'sell') {
  return side === 'buy' ? quote.buyPrice ?? quote.sellPrice ?? undefined : quote.sellPrice ?? quote.buyPrice ?? undefined
}
function usesOppositeSide(quote: MarketQuote | undefined, side: 'buy' | 'sell') {
  return !!quote && (side === 'buy' ? quote.buyPrice == null && quote.sellPrice != null : quote.sellPrice == null && quote.buyPrice != null)
}
function priceFor(name: string, side: 'buy' | 'sell' = 'buy') {
  const quote = quoteByItemName.value.get(name.trim().toLocaleLowerCase())
  if (!quote) return undefined
  const override = priceOverrides.value[quote.symbol]?.[side]
  if (override !== undefined) return override
  return bookPrice(quote, side)
}
function estimatedPriceFor(name: string, side: 'buy' | 'sell' = 'buy') {
  const marketPrice = priceFor(name, side)
  if (marketPrice !== undefined) return marketPrice
  const reference = quoteByItemName.value.get(name.trim().toLocaleLowerCase())?.price
  return reference !== undefined && Number.isFinite(reference) ? reference : undefined
}
function itemPrice(name: string, side: 'buy' | 'sell' = 'buy') {
  const price = estimatedPriceFor(name, side)
  const quote = quoteByItemName.value.get(name.trim().toLocaleLowerCase())
  return price === undefined ? '$...' : `${priceFor(name, side) === undefined || (priceOverrides.value[quote?.symbol ?? '']?.[side] === undefined && usesOppositeSide(quote, side)) ? '≈' : ''}$${price.toFixed(2)}`
}
function setPriceOverride(symbol: string, side: 'buy' | 'sell', value: string) {
  const overrides = { ...priceOverrides.value }
  const entry = { ...overrides[symbol] }
  const parsed = value.trim() === '' ? undefined : Number(value)
  if (parsed !== undefined && (!Number.isFinite(parsed) || parsed < 0)) return
  if (parsed === undefined) delete entry[side]
  else entry[side] = parsed
  if (entry.buy === undefined && entry.sell === undefined) delete overrides[symbol]
  else overrides[symbol] = entry
  priceOverrides.value = overrides
  localStorage.setItem(priceOverridesStorageKey, JSON.stringify(overrides))
}
function resetPriceOverrides(symbol: string) {
  const overrides = { ...priceOverrides.value }
  delete overrides[symbol]
  priceOverrides.value = overrides
  localStorage.setItem(priceOverridesStorageKey, JSON.stringify(overrides))
}
function volumeSharePercent(ratePerMinute: number, units24h: number | undefined) {
  if (units24h === undefined || units24h <= 0) return undefined
  return ratePerMinute * 1440 / units24h * 100
}
function volumeShareClass(share: number | undefined) {
  return share === undefined ? '' : share >= 100 ? 'liquidity-high' : share >= 10 ? 'liquidity-watch' : ''
}
function sparklinePoints(values: number[]) {
  if (values.length < 2) return ''
  const min = Math.min(...values)
  const range = Math.max(...values) - min || 1
  return values.map((value, index) => `${(index / (values.length - 1)) * 100},${22 - ((value - min) / range) * 20}`).join(' ')
}
function processProfit(recipe: Recipe | undefined, machineCount = 1): number | undefined {
  if (!recipe) return undefined
  const outputPrice = estimatedPriceFor(recipe.product, 'sell')
  if (outputPrice === undefined) return undefined
  let profit = outputPrice * recipe.rate * machineCount
  for (const ingredient of recipe.ingredients) {
    const inputPrice = estimatedPriceFor(ingredient.name, 'buy')
    if (inputPrice === undefined) return undefined
    profit -= inputPrice * ingredient.quantity * recipe.rate / recipe.batch * machineCount
  }
  return profit
}
function recipeUsesReference(recipe: Recipe | undefined) {
  if (!recipe) return false
  const estimated = (name: string, side: 'buy' | 'sell') => {
    const quote = quoteByItemName.value.get(name.trim().toLocaleLowerCase())
    return priceFor(name, side) === undefined || (priceOverrides.value[quote?.symbol ?? '']?.[side] === undefined && usesOppositeSide(quote, side))
  }
  return estimated(recipe.product, 'sell') || recipe.ingredients.some(ingredient => estimated(ingredient.name, 'buy'))
}
function profitLabel(value: number | undefined, approximate = false) {
  if (value === undefined || !Number.isFinite(value)) return '$... / min'
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${approximate ? '≈' : ''}${sign}$${Math.abs(value).toFixed(2)} / min`
}
const graphPanels = computed(() => {
  const producedByInput = new Map(network.value.connectionRows.map(link => [link.key, link.produced]))
  const inputRows = network.value.external.map((item, row) => ({ itemId: item.id, name: item.name, rate: item.amount, row }))
  const inputRowById = new Map(inputRows.map(item => [item.itemId, item.row]))
  const inputFlows: GraphConnection[] = []
  for (const node of nodes.value) {
    const recipe = recipeFor(node)
    if (!recipe) continue
            recipe.ingredients.forEach(ingredient => {
      const portKey = inputKey(node.id, ingredient.item_id)
      const demand = ingredient.quantity * recipe.rate / recipe.batch * node.machines
      const missing = Math.max(0, demand - (producedByInput.get(portKey) ?? 0))
      if (missing <= 0.000001) return
      const row = inputRowById.get(ingredient.item_id)
      if (row === undefined) return
      inputFlows.push({ key: `input:${ingredient.item_id}:${node.id}`, kind: 'input', from: { id: 'input-panel', x: 0, y: 0 }, to: node, inputKey: portKey, row, produced: missing })
    })
  }
  const consumedProducts = new Set(Object.values(connections.value))
  const outputIds = new Set<string>(nodes.value.length ? productionTargets.value.filter(target => target.itemId && target.rate > 0).map(target => target.itemId) : [])
  for (const node of nodes.value) {
    const recipe = recipeFor(node)
    if (recipe && !consumedProducts.has(node.id)) outputIds.add(recipe.product_id)
  }
  const outputRows = [...outputIds].map(itemId => {
    const producers = nodesByProduct.value.get(itemId) ?? []
    const product = productOptions.value.find(item => item.id === itemId)
    const targetRate = productionTargets.value.filter(target => target.itemId === itemId).reduce((sum, target) => sum + target.rate, 0)
    const producedRate = producers.reduce((sum, node) => sum + (recipeFor(node)?.rate ?? 0) * node.machines, 0)
    return { itemId, name: product?.name ?? itemId, rate: producedRate || targetRate, producers }
  }).sort((a, b) => a.name.localeCompare(b.name)).map((item, row) => ({ ...item, row }))
  const outputRowById = new Map(outputRows.map(item => [item.itemId, item.row]))
  const outputFlows: GraphConnection[] = outputRows.flatMap(item => item.producers.map(producer => ({
    key: `output:${item.itemId}:${producer.id}`,
    kind: 'output' as const,
    from: producer,
    to: { id: 'output-panel', x: 0, y: 0 },
    row: outputRowById.get(item.itemId)!,
    produced: (recipeFor(producer)?.rate ?? 0) * producer.machines
  })))
  const graphTop = Math.min(...nodes.value.map(node => node.y))
  const graphBottom = Math.max(...nodes.value.map(node => node.y + machineCardHeight(recipeFor(node)!)))
  const inputPanel: GraphPanel | undefined = inputRows.length ? {
    id: 'input-panel', x: Math.min(...nodes.value.map(node => node.x)) - 340,
    y: (graphTop + graphBottom - (48 + inputRows.length * 29)) / 2,
    rows: inputRows
  } : undefined
  const outputPanel: GraphPanel | undefined = outputRows.length ? {
    id: 'output-panel', x: Math.max(...nodes.value.map(node => node.x + 300)) + 80,
    y: (graphTop + graphBottom - (48 + outputRows.length * 29)) / 2,
    rows: outputRows
  } : undefined
  const allFlows = [...network.value.connectionRows.map(link => ({ key: link.key, kind: 'recipe' as const, from: link.from, to: link.to, inputKey: link.key, produced: link.produced })), ...inputFlows, ...outputFlows]
  if (inputPanel) for (const flow of inputFlows) flow.from = inputPanel
  if (outputPanel) for (const flow of outputFlows) flow.to = outputPanel
  return { input: inputPanel, output: outputPanel, connections: allFlows }
})
const graphConnections = computed<GraphConnection[]>(() => graphPanels.value.connections)
const totalProfitPerMinute = computed<number | undefined>(() => {
  let total = 0
  for (const item of network.value.surplus) {
    const price = estimatedPriceFor(item.name, 'sell')
    if (price === undefined) return undefined
    total += price * item.amount
  }
  for (const item of network.value.external) {
    const price = estimatedPriceFor(item.name, 'buy')
    if (price === undefined) return undefined
    total -= price * item.amount
  }
  return total
})
const planEconomics = computed(() => {
  const valueRows = (items: Array<{ id: string; name: string; amount: number }>, side: 'buy' | 'sell') => {
    const rows = items.map(item => {
      const quote = quoteByItemName.value.get(item.name.trim().toLocaleLowerCase())
      const price = estimatedPriceFor(item.name, side)
      const referencePrice = price !== undefined && priceFor(item.name, side) === undefined
      const proxyPrice = !referencePrice && priceOverrides.value[quote?.symbol ?? '']?.[side] === undefined && usesOppositeSide(quote, side)
      return { ...item, quote, price, referencePrice, proxyPrice, valuePerMinute: price === undefined ? undefined : price * item.amount }
    })
    const knownTotal = rows.reduce((sum, row) => sum + (row.valuePerMinute ?? 0), 0)
    return { rows, knownTotal, pricedCount: rows.filter(row => row.price !== undefined).length, unpricedCount: rows.filter(row => row.price === undefined).length, referenceCount: rows.filter(row => row.referencePrice).length, proxyCount: rows.filter(row => row.proxyPrice).length }
  }
  const sales = valueRows(network.value.surplus, 'sell')
  const costs = valueRows(network.value.external, 'buy')
  const complete = sales.unpricedCount === 0 && costs.unpricedCount === 0
  return { sales, costs, netKnown: sales.knownTotal - costs.knownTotal, complete, usesReference: sales.referenceCount + costs.referenceCount > 0, usesEstimate: sales.referenceCount + costs.referenceCount + sales.proxyCount + costs.proxyCount > 0 }
})
const optimizerOpportunities = computed<OptimizerOpportunity[]>(() => {
  if (!marketData.value || !recipes.value.length) return []
  type ItemRoute = { unitCost: number; recipes: Map<string, Recipe> }
  const routeCache = new Map<string, ItemRoute | undefined>()
  function cheapestRoute(itemId: string, path = new Set<string>()): ItemRoute | undefined {
    const name = materialOptions.value.find(item => item.id === itemId)?.name
    const buyPrice = name ? priceFor(name, 'buy') : undefined
    if (path.has(itemId)) return buyPrice !== undefined ? { unitCost: buyPrice, recipes: new Map() } : undefined
    const cacheKey = `${itemId}|${[...path].sort().join(',')}`
    if (routeCache.has(cacheKey)) return routeCache.get(cacheKey)
    let best: ItemRoute | undefined = buyPrice !== undefined ? { unitCost: buyPrice, recipes: new Map() } : undefined
    const nextPath = new Set(path).add(itemId)
    for (const recipe of recipesForItem(itemId)) {
      let unitCost = 0
      const routeRecipes = new Map<string, Recipe>()
      let complete = true
      for (const ingredient of recipe.ingredients) {
        const ingredientRoute = cheapestRoute(ingredient.item_id, nextPath)
        if (!ingredientRoute) { complete = false; break }
        unitCost += ingredient.quantity / recipe.batch * ingredientRoute.unitCost
        for (const [routedItemId, routedRecipe] of ingredientRoute.recipes) routeRecipes.set(routedItemId, routedRecipe)
      }
      if (complete && (!best || unitCost < best.unitCost)) {
        routeRecipes.set(itemId, recipe)
        best = { unitCost, recipes: routeRecipes }
      }
    }
    routeCache.set(cacheKey, best)
    return best
  }

  const opportunities: OptimizerOpportunity[] = []
  for (const recipe of recipes.value) {
    const outputPrice = priceFor(recipe.product, 'sell')
    if (outputPrice === undefined || recipe.rate <= 0) continue
    const outputQuote = quoteByItemName.value.get(recipe.product.trim().toLocaleLowerCase())
    let inputCostPerItem = 0
    const routeRecipes = new Map<string, Recipe>()
    const inputCosts: OptimizerInputCost[] = []
    let complete = true
    const path = new Set([recipe.product_id])
    for (const ingredient of recipe.ingredients) {
      const route = cheapestRoute(ingredient.item_id, path)
      if (!route) { complete = false; break }
      const amountPerItem = ingredient.quantity / recipe.batch
      const totalCost = amountPerItem * route.unitCost
      inputCostPerItem += totalCost
      inputCosts.push({ itemId: ingredient.item_id, name: ingredient.name, amountPerItem, unitCost: route.unitCost, totalCost, routeRecipe: route.recipes.get(ingredient.item_id) })
      for (const [itemId, inputRecipe] of route.recipes) routeRecipes.set(itemId, inputRecipe)
    }
    const marginPerItem = outputPrice - inputCostPerItem
    const profitPerMinute = marginPerItem * recipe.rate
    if (complete) {
      routeRecipes.set(recipe.product_id, recipe)
      opportunities.push({ recipe, outputPrice, inputCostPerItem, marginPerItem, marginPercent: outputPrice > 0 ? marginPerItem / outputPrice * 100 : 0, profitPerMinute, outputVolumeShare: outputQuote ? volumeSharePercent(recipe.rate, outputQuote.units24h) : undefined, inputCosts, routeRecipes })
    }
  }
  return opportunities.sort((a, b) => b.profitPerMinute - a.profitPerMinute || a.recipe.product.localeCompare(b.recipe.product))
})
const filteredOptimizerOpportunities = computed(() => {
  const needle = optimizerSearch.value.trim().toLocaleLowerCase()
  return optimizerOpportunities.value.filter(({ recipe }) => !needle || `${recipe.product} ${recipe.label} ${recipe.station}`.toLocaleLowerCase().includes(needle))
})
const nextMarketCheck = computed(() => marketData.value?.refreshedAt
  ? new Date(Date.parse(marketData.value.refreshedAt) + marketData.value.refreshIntervalHours * 60 * 60 * 1000).toLocaleString()
  : undefined)

function buildOptimizedChain(opportunity: OptimizerOpportunity) {
  recordPlanChange()
  const index = nodes.value.length
  const root: MachineNode = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    recipeId: opportunity.recipe.id,
    x: 48 + (index % 4) * 350,
    y: 48 + Math.floor(index / 4) * 420,
    machines: 1
  }
  nodes.value.push(root)
  expandChain(root, false, itemId => opportunity.routeRecipes.get(itemId))
  arrangeNetwork()
  activeView.value = 'network'
  void nextTick(centerCanvas)
}

const viewTitle = computed(() => activeView.value === 'prices' && showPriceHistory.value
  ? 'History'
  : ({ network: 'Network Graph', tree: 'Tree List', items: 'Items', buildings: 'Buildings', targets: 'Production Targets', prices: 'Prices' })[activeView.value])
const catalogueAgeDays = computed(() => metadata.value ? Math.max(0, Math.floor((Date.now() - new Date(metadata.value.retrievedAt).getTime()) / 86_400_000)) : 0)
const importedInputBalances = computed(() => importedInputs.value.map(input => {
  const item = materialOptions.value.find(candidate => candidate.id === input.itemId)
  const required = network.value.external.find(candidate => candidate.id === input.itemId)?.amount ?? 0
  return { ...input, name: item?.name ?? input.itemId, required, shortage: Math.max(0, required - input.rate) }
}))
const treeRows = computed<TreeRow[]>(() => {
  const suppliedNodes = new Set(Object.values(connections.value))
  const roots = nodes.value.filter(node => !suppliedNodes.has(node.id))
  const rows: TreeRow[] = []
  const linksByInput = new Map(network.value.connectionRows.map(link => [link.key, link]))
  function visit(node: MachineNode, depth: number, path: Set<string>) {
    const recipe = recipeFor(node)
    if (!recipe) return
    const nodeRate = recipe.rate * node.machines
    const collapsed = collapsedTreeNodeIds.value.includes(node.id)
    rows.push({ key: `node:${node.id}:${depth}`, depth, kind: 'product', itemId: recipe.product_id, name: recipe.product, detail: `${recipe.station.replaceAll('_', ' ')} · ${amount(nodeRate)} / min`, machines: node.machines, nodeId: node.id, hasChildren: recipe.ingredients.length > 0, collapsed })
    if (path.has(node.id)) return
    if (collapsed) return
    const nextPath = new Set(path).add(node.id)
    for (const ingredient of recipe.ingredients) {
      const rate = ingredient.quantity * recipe.rate / recipe.batch * node.machines
      const supplier = nodesById.value.get(connections.value[inputKey(node.id, ingredient.item_id)] ?? '')
      const validSupplier = supplier && recipeFor(supplier)?.product_id === ingredient.item_id ? supplier : undefined
      const supplied = validSupplier ? linksByInput.get(inputKey(node.id, ingredient.item_id))?.produced ?? 0 : 0
      rows.push({ key: `input:${node.id}:${ingredient.item_id}:${depth}`, depth: depth + 1, kind: 'ingredient', itemId: ingredient.item_id, name: ingredient.name, detail: `${amount(supplied)} / ${amount(rate)} per min${validSupplier ? ' · connected' : ' · external supply'}`, external: !validSupplier })
      if (validSupplier && !nextPath.has(validSupplier.id)) visit(validSupplier, depth + 2, nextPath)
    }
  }
  for (const root of roots.length ? roots : nodes.value) visit(root, 0, new Set())
  return rows
})
const itemBalances = computed<ItemBalance[]>(() => {
  const balances = new Map<string, ItemBalance>()
  function get(id: string, name: string) {
    let item = balances.get(id)
    if (!item) {
      item = { id, name, produced: 0, required: 0, connected: 0, external: 0, surplus: 0 }
      balances.set(id, item)
    }
    return item
  }
  for (const node of nodes.value) {
    const recipe = recipeFor(node)
    if (!recipe) continue
    get(recipe.product_id, recipe.product).produced += recipe.rate * node.machines
    for (const ingredient of recipe.ingredients) get(ingredient.item_id, ingredient.name).required += ingredient.quantity * recipe.rate / recipe.batch * node.machines
  }
  for (const link of network.value.connectionRows) get(link.ingredient.item_id, link.ingredient.name).connected += link.produced
  for (const item of network.value.external) get(item.id, item.name).external = item.amount
  for (const item of network.value.surplus) get(item.id, item.name).surplus = item.amount
  const needle = viewSearch.value.trim().toLowerCase()
  return [...balances.values()].filter(item => !needle || item.name.toLowerCase().includes(needle)).sort((a, b) => a.name.localeCompare(b.name))
})
const buildingSummaries = computed<BuildingSummary[]>(() => {
  const summaries = new Map<string, BuildingSummary>()
  for (const recipe of recipes.value) {
    let building = summaries.get(recipe.station)
    if (!building) {
      building = { id: recipe.station, name: recipe.station.replaceAll('_', ' '), recipeCount: 0, machines: 0, products: [] }
      summaries.set(recipe.station, building)
    }
    building.recipeCount++
    if (!building.products.some(product => product.id === recipe.product_id)) building.products.push({ id: recipe.product_id, name: recipe.product })
  }
  for (const node of nodes.value) {
    const recipe = recipeFor(node)
    if (recipe) summaries.get(recipe.station)!.machines += node.machines
  }
  const needle = viewSearch.value.trim().toLowerCase()
  return [...summaries.values()].filter(building => !needle || `${building.name} ${building.products.map(product => product.name).join(' ')}`.toLowerCase().includes(needle)).sort((a, b) => a.name.localeCompare(b.name))
})
const filteredMarketQuotes = computed(() => {
  const needle = viewSearch.value.trim().toLowerCase()
  return (marketData.value?.quotes ?? []).filter(quote => !needle || `${quote.name} ${quote.symbol}`.toLowerCase().includes(needle))
})

const boardBounds = computed(() => ({
  left: Math.min(canvasExtent.value.left, ...nodes.value.map(node => node.x - 80), graphPanels.value.input?.x ?? Infinity),
  top: Math.min(canvasExtent.value.top, ...nodes.value.map(node => node.y - 80), graphPanels.value.input?.y ?? Infinity, graphPanels.value.output?.y ?? Infinity),
  right: Math.max(canvasExtent.value.right, ...nodes.value.map(node => node.x + 420), (graphPanels.value.output?.x ?? -Infinity) + 250),
  bottom: Math.max(canvasExtent.value.bottom, ...nodes.value.map(node => node.y + 620), (graphPanels.value.input?.y ?? -Infinity) + 48 + (graphPanels.value.input?.rows.length ?? 0) * 29, (graphPanels.value.output?.y ?? -Infinity) + 48 + (graphPanels.value.output?.rows.length ?? 0) * 29)
}))
const boardWidth = computed(() => boardBounds.value.right - boardBounds.value.left)
const boardHeight = computed(() => boardBounds.value.bottom - boardBounds.value.top)
const selectionBoxStyle = computed(() => {
  const selection = selecting.value
  if (!selection || !canvas.value) return {}
  const rect = canvas.value.getBoundingClientRect()
  const left = Math.max(0, Math.min(rect.width, Math.min(selection.startX, selection.endX)))
  const top = Math.max(0, Math.min(rect.height, Math.min(selection.startY, selection.endY)))
  const right = Math.max(0, Math.min(rect.width, Math.max(selection.startX, selection.endX)))
  const bottom = Math.max(0, Math.min(rect.height, Math.max(selection.startY, selection.endY)))
  return {
    left: `${rect.left + left}px`,
    top: `${rect.top + top}px`,
    width: `${right - left}px`,
    height: `${bottom - top}px`
  }
})

function arrangeNetwork() {
  if (!nodes.value.length) return
  const providersByConsumer = new Map<string, MachineNode[]>()
  const waitingConsumers = new Map(nodes.value.map(node => [node.id, 0]))
  for (const consumer of nodes.value) {
    for (const ingredient of recipeFor(consumer)?.ingredients ?? []) {
      const provider = nodesById.value.get(connections.value[inputKey(consumer.id, ingredient.item_id)] ?? '')
      if (!provider || recipeFor(provider)?.product_id !== ingredient.item_id) continue
      const providers = providersByConsumer.get(consumer.id) ?? []
      providers.push(provider)
      providersByConsumer.set(consumer.id, providers)
      waitingConsumers.set(provider.id, (waitingConsumers.get(provider.id) ?? 0) + 1)
    }
  }
  const roots = nodes.value.filter(node => waitingConsumers.get(node.id) === 0)
  const depths = new Map<string, number>(roots.map(node => [node.id, 0]))
  const queue = roots.length ? [...roots] : [...nodes.value]
  const processed = new Set<string>()
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const consumer = queue[cursor]
    if (!consumer) continue
    if (processed.has(consumer.id)) continue
    processed.add(consumer.id)
    const depth = depths.get(consumer.id) ?? 0
    for (const provider of providersByConsumer.get(consumer.id) ?? []) {
      depths.set(provider.id, Math.max(depths.get(provider.id) ?? 0, depth + 1))
      const waiting = (waitingConsumers.get(provider.id) ?? 0) - 1
      waitingConsumers.set(provider.id, waiting)
      if (waiting === 0) queue.push(provider)
    }
  }
  for (const node of nodes.value) if (!depths.has(node.id)) depths.set(node.id, 0)
  const layers = new Map<number, MachineNode[]>()
  for (const node of nodes.value) {
    const depth = depths.get(node.id) ?? 0
    const layer = layers.get(depth) ?? []
    layer.push(node)
    layers.set(depth, layer)
  }
  const maxDepth = Math.max(...layers.keys())
  const centerByNode = new Map<string, number>()
  for (let depth = 0; depth <= maxDepth; depth++) {
    const layer = layers.get(depth) ?? []
    layer.sort((a, b) => depth === 0
      ? a.y - b.y || (recipeFor(a)?.product ?? '').localeCompare(recipeFor(b)?.product ?? '')
      : (centerByNode.get(a.id) ?? a.y) - (centerByNode.get(b.id) ?? b.y) || (recipeFor(a)?.product ?? '').localeCompare(recipeFor(b)?.product ?? ''))
    const totalHeight = layer.reduce((sum, node) => sum + machineCardHeight(recipeFor(node)!), 0) + Math.max(0, layer.length - 1) * TREE_GAP
    let y = -totalHeight / 2
    for (const node of layer) {
      node.x = 600 - depth * 384
      node.y = Math.round(y / GRID) * GRID
      y += machineCardHeight(recipeFor(node)!) + TREE_GAP
    }
    const centerSums = new Map<string, { sum: number; count: number }>()
    for (const consumer of layer) {
      const center = consumer.y + machineCardHeight(recipeFor(consumer)!) / 2
      for (const provider of providersByConsumer.get(consumer.id) ?? []) {
        if (depths.get(provider.id) !== depth + 1) continue
        const result = centerSums.get(provider.id) ?? { sum: 0, count: 0 }
        result.sum += center
        result.count++
        centerSums.set(provider.id, result)
      }
    }
    for (const [nodeId, result] of centerSums) centerByNode.set(nodeId, result.sum / result.count)
  }
}

function centerCanvas() {
  if (!canvas.value || !canvas.value.clientWidth || !canvas.value.clientHeight) return
  const scale = zoom.value / 100
  if (!nodes.value.length) {
    canvas.value.scrollTo({ left: Math.max(0, -boardBounds.value.left * scale - canvas.value.clientWidth / 2), top: Math.max(0, -boardBounds.value.top * scale - canvas.value.clientHeight / 2), behavior: 'smooth' })
    return
  }
  const allGraphNodes = [
    ...nodes.value.map(node => ({ x: node.x, y: node.y, width: compactGraph.value ? 260 : 300, height: machineCardHeight(recipeFor(node)!) })),
    ...(graphPanels.value.input ? [{ x: graphPanels.value.input.x, y: graphPanels.value.input.y, width: 250, height: 42 + graphPanels.value.input.rows.length * 29 }] : []),
    ...(graphPanels.value.output ? [{ x: graphPanels.value.output.x, y: graphPanels.value.output.y, width: 250, height: 42 + graphPanels.value.output.rows.length * 29 }] : [])
  ]
  const minX = Math.min(...allGraphNodes.map(node => node.x))
  const minY = Math.min(...allGraphNodes.map(node => node.y))
  const maxX = Math.max(...allGraphNodes.map(node => node.x + node.width))
  const maxY = Math.max(...allGraphNodes.map(node => node.y + node.height))
  canvas.value.scrollTo({ left: Math.max(0, ((minX + maxX) / 2 - boardBounds.value.left) * scale - canvas.value.clientWidth / 2), top: Math.max(0, ((minY + maxY) / 2 - boardBounds.value.top) * scale - canvas.value.clientHeight / 2), behavior: 'smooth' })
}
function portPosition(key: string, fallback: PortPoint) { return portPositions.value[key] ?? fallback }
function linkStart(link: GraphConnection) {
  if (link.kind === 'input') return { x: link.from.x + 250, y: link.from.y + 46 + (link.row ?? 0) * 29 }
  return portPosition(`output:${link.from.id}`, { x: link.from.x + 300, y: link.from.y + 128 })
}
function linkEnd(link: GraphConnection) {
  if (link.kind === 'output') return { x: link.to.x, y: link.to.y + 46 + (link.row ?? 0) * 29 }
  const inputPortKey = link.inputKey ?? link.key
  const consumer = nodesById.value.get(link.to.id)
  const ingredientIndex = consumer ? recipeFor(consumer)?.ingredients.findIndex(item => item.item_id === inputPortKey.slice(inputPortKey.lastIndexOf(':') + 1)) ?? 0 : 0
  return portPosition(`input:${inputPortKey}`, { x: link.to.x, y: link.to.y + (compactGraph.value ? 48 : 180) + ingredientIndex * (compactGraph.value ? 22 : 29) })
}
function linkPath(link: GraphConnection) {
  const start = linkStart(link)
  const end = linkEnd(link)
  const direction = end.x >= start.x ? 1 : -1
  const curve = Math.max(50, Math.abs(end.x - start.x) * 0.48)
  return `M ${start.x} ${start.y} C ${start.x + direction * curve} ${start.y}, ${end.x - direction * curve} ${end.y}, ${end.x} ${end.y}`
}
</script>

<template>
  <main class="app-shell">
    <header class="topbar">
      <a class="brand" href="/" aria-label="Capital Rift Factory Planner home"><span class="brand-mark">CR</span><span>CAPITAL RIFT <small>FACTORY PLANNER</small></span></a>
      <div class="top-actions"><span class="save-state"><i /> Saved in this browser</span><button class="button subtle" :disabled="!undoHistory.length" title="Undo (Ctrl+Z)" @click="undoPlan">Undo</button><button class="button subtle" :disabled="!redoHistory.length" title="Redo (Ctrl+Shift+Z)" @click="redoPlan">Redo</button><button class="button subtle" :disabled="!nodes.length && !productionTargets.length && !importedInputs.length" @click="exportPlan">Export</button><button class="button subtle" @click="importPlanInput?.click()">Import</button><input ref="importPlanInput" type="file" accept="application/json,.json" hidden @change="importPlanFile"><button class="button subtle" :disabled="!nodes.length && !productionTargets.length && !importedInputs.length" @click="clearPlan">Clear plan</button></div>
    </header>

    <nav class="view-tabs" aria-label="Planner views">
      <button v-for="tab in plannerTabs" :key="tab[0]" class="view-tab" :class="{ active: activeView === tab[0] }" :aria-current="activeView === tab[0] ? 'page' : undefined" @click="activeView = tab[0]">{{ tab[1] }}</button>
    </nav>

    <div class="planner-layout">
      <aside class="sidebar">
        <div class="side-heading"><div><p class="eyebrow">BUILD YOUR NETWORK</p><h1>Production plan</h1></div><span class="node-count">{{ nodes.length }}</span></div>
        <label class="search-box"><span class="search-icon">⌕</span><input v-model="search" type="search" placeholder="Find an item or recipe" autocomplete="off"><kbd>/</kbd></label>
        <div class="category-strip" aria-label="Recipe categories">
          <button class="category-chip" :class="{ active: selectedCategory === 'all' }" @click="selectedCategory = 'all'">All <span>{{ recipes.length }}</span></button>
          <button v-for="group in recipeGroups" :key="group.id" class="category-chip factory-chip" :class="{ active: selectedCategory === group.id }" :style="{ '--station-accent': stationAccent(group.id) }" :title="group.name" @click="selectedCategory = group.id">{{ group.name }} <span>{{ group.recipes.length }}</span></button>
        </div>
        <div class="catalog-heading"><span>RECIPE CATALOGUE</span><span>{{ filteredRecipes.length }}</span></div>
        <div class="catalog-list">
          <div v-for="group in groupedRecipes" :key="group.id" class="recipe-group">
            <div class="recipe-group-heading" :style="{ '--station-accent': stationAccent(group.id) }"><span>{{ group.name }}</span><span>{{ group.recipes.length }}</span></div>
            <button v-for="recipe in group.recipes" :key="recipe.id" class="catalog-item" draggable="true" @click="addRecipe(recipe)" @dragstart="startCatalogDrag($event, recipe)" @dragend="finishCatalogDrag">
              <ItemIcon class="item-icon" :item-id="recipe.product_id" :name="recipe.product" />
              <span class="catalog-copy"><strong>{{ recipe.product }}</strong><small>{{ recipe.label }}</small></span>
              <span class="add-icon">+</span>
            </button>
          </div>
          <p v-if="pending" class="empty-state">Loading catalogue…</p>
          <p v-else-if="!filteredRecipes.length" class="empty-state">No matching recipes.</p>
        </div>
        <div class="sidebar-tip"><span class="tip-dot" />Click or drag recipes onto the graph. Select nodes to move them together; right-click and drag to pan, or hold Ctrl and scroll to zoom.</div>
      </aside>

      <section class="main-area" :class="{ 'history-main': activeView === 'prices' && showPriceHistory }">
        <div class="plan-toolbar">
          <div class="plan-title"><span class="crumb">FACTORY</span><span class="crumb-sep">/</span><strong>{{ viewTitle }}</strong><button v-if="activeView === 'prices'" class="history-toolbar-button" :class="{ active: showPriceHistory }" :aria-pressed="showPriceHistory" @click="showPriceHistory ? showPriceHistory = false : openPriceHistory()">{{ showPriceHistory ? 'Prices' : 'History' }} <span aria-hidden="true">{{ showPriceHistory ? '↖' : '↗' }}</span></button></div>
          <div v-if="activeView === 'network'" class="toolbar-actions"><label class="density-control"><span>Detailed</span><input v-model.number="compactGraph" type="range" min="0" max="1" step="1" aria-label="Graph detail"><span>Compact</span></label><div class="zoom-controls"><button class="icon-button" :disabled="zoom <= 60" title="Zoom out" aria-label="Zoom out" @click="zoom = Math.max(60, zoom - 10)">−</button><span class="zoom-label">{{ zoom }}%</span><button class="icon-button" :disabled="zoom >= 140" title="Zoom in" aria-label="Zoom in" @click="zoom = Math.min(140, zoom + 10)">+</button></div><button class="icon-button" title="Center machines" aria-label="Center machines" @click="centerCanvas">⌖</button></div>
          <span v-else-if="activeView === 'prices'" class="view-count">{{ marketData ? `${marketData.catalogueCoverage?.priced ?? marketData.quotes.length} / ${marketData.catalogueCoverage?.total ?? metadata?.itemCount ?? '?'} ITEMS PRICED` : 'LIVE MARKET' }}</span><span v-else class="view-count">{{ activeView === 'tree' ? treeRows.length : activeView === 'items' ? itemBalances.length : activeView === 'buildings' ? buildingSummaries.length : productionTargets.length }} {{ activeView === 'tree' ? 'STEPS' : activeView === 'items' ? 'ITEMS' : activeView === 'buildings' ? 'BUILDINGS' : 'OUTPUTS' }}</span>
        </div>
        <div v-show="activeView === 'network'" ref="canvas" class="canvas-viewport" :class="{ 'is-panning': panning }" @wheel="zoomCanvasWheel" @pointerdown="startSelectOrPan" @pointermove="selectOrPanMove" @pointerup="finishSelectOrPan" @pointercancel="finishSelectOrPan" @dragenter.prevent="updateDragPreview" @dragover.prevent="updateDragPreview" @drop.prevent="dropCatalogRecipe" @contextmenu.prevent>
        <div ref="canvasBoard" class="canvas-board" :class="{ 'has-nodes': nodes.length }" :style="{ zoom: `${zoom}%`, width: `${boardWidth}px`, height: `${boardHeight}px`, backgroundPosition: `${-boardBounds.left}px ${-boardBounds.top}px` }">
            <svg class="connections" :viewBox="`${boardBounds.left} ${boardBounds.top} ${boardWidth} ${boardHeight}`" preserveAspectRatio="none" aria-label="Material flow connections">
              <g v-for="link in graphConnections" :key="link.key">
                <path class="flow-shadow" :d="linkPath(link)" />
                <path class="flow-line" :d="linkPath(link)" />
                <circle class="flow-dot" :cx="linkStart(link).x" :cy="linkStart(link).y" r="4" />
              </g>
            </svg>
            <article v-if="graphPanels.input" class="flow-panel input-panel" :style="{ left: `${graphPanels.input.x - boardBounds.left}px`, top: `${graphPanels.input.y - boardBounds.top}px` }">
              <header><span class="flow-panel-mark">↓</span><strong>INPUT</strong></header>
              <div v-for="item in graphPanels.input.rows" :key="item.itemId" class="flow-panel-row input-layer">
                <span class="flow-panel-name"><ItemIcon :item-id="item.itemId" :name="item.name" />{{ item.name }}</span><small>{{ amount(item.rate) }} / min</small><strong>{{ itemPrice(item.name, 'buy') }}</strong><span class="port flow-panel-port right-port" />
              </div>
            </article>
            <article v-if="graphPanels.output" class="flow-panel output-panel" :style="{ left: `${graphPanels.output.x - boardBounds.left}px`, top: `${graphPanels.output.y - boardBounds.top}px` }">
              <header><span class="flow-panel-mark">↑</span><strong>OUTPUT</strong></header>
              <div v-for="item in graphPanels.output.rows" :key="item.itemId" class="flow-panel-row output-layer">
                <span class="port flow-panel-port left-port" /><span class="flow-panel-name"><ItemIcon :item-id="item.itemId" :name="item.name" />{{ item.name }}</span><small>{{ amount(item.rate) }} / min</small><strong>{{ itemPrice(item.name, 'sell') }}</strong>
              </div>
            </article>
            <article v-for="node in nodes" :key="node.id" :ref="element => setNodeElement(node.id, element)" class="machine-card" :class="{ selected: selectedNodeIds.includes(node.id), compact: compactGraph }" :style="{ left: `${node.x - boardBounds.left}px`, top: `${node.y - boardBounds.top}px`, '--station-accent': stationAccent(recipeFor(node)?.station) }" @pointerdown.stop="startNodeMove($event, node)" @pointermove="moveNode" @pointerup="finishNodeMove" @pointercancel="finishNodeMove">
              <header class="machine-head">
                <span class="grip" aria-hidden="true">⠿</span><img v-if="recipeFor(node)?.image_url" class="machine-thumbnail" :src="recipeFor(node)?.image_url ?? undefined" alt=""><span class="station-tag">{{ recipeFor(node)?.station.replaceAll('_', ' ') }}</span>
                <button class="delete-node" :aria-label="`Remove ${recipeFor(node)?.product}`" title="Remove machine" @click="removeNode(node.id)">×</button>
              </header>
              <div v-if="compactGraph" class="compact-body">
                <div v-for="ingredient in recipeFor(node)?.ingredients" :key="ingredient.item_id" class="compact-input">
                  <span class="port input-port" :class="{ connected: connections[inputKey(node.id, ingredient.item_id)] }" :ref="element => setPortElement(`input:${inputKey(node.id, ingredient.item_id)}`, element)" />
                  <span><ItemIcon :item-id="ingredient.item_id" :name="ingredient.name" />{{ ingredient.name }} ({{ itemPrice(ingredient.name, 'buy') }})</span>
                </div>
                <div class="compact-output"><span class="port output-port" :ref="element => setPortElement(`output:${node.id}`, element)" /><strong><ItemIcon :item-id="recipeFor(node)?.product_id" :name="recipeFor(node)?.product ?? ''" />{{ recipeFor(node)?.product }} ({{ itemPrice(recipeFor(node)?.product ?? '', 'sell') }})</strong><span class="compact-output-meta"><small :class="{ 'profit-positive': (processProfit(recipeFor(node), node.machines) ?? 0) > 0, 'profit-negative': (processProfit(recipeFor(node), node.machines) ?? 0) < 0 }">{{ profitLabel(processProfit(recipeFor(node), node.machines), recipeUsesReference(recipeFor(node))) }}</small><small class="compact-output-rate">{{ amount((recipeFor(node)?.rate ?? 0) * node.machines) }} / min</small></span></div>
              </div>
              <div v-else class="machine-body">
                <p class="node-label">PRODUCTION MACHINE</p>
                <h2><ItemIcon :item-id="recipeFor(node)?.product_id" :name="recipeFor(node)?.product ?? ''" />{{ recipeFor(node)?.product }}</h2>
                <div class="machine-control"><span>Machines</span><div class="stepper"><button :aria-label="`Remove one ${recipeFor(node)?.product} machine`" @click="setMachineCount(node, node.machines - 1)">−</button><input :aria-label="`${recipeFor(node)?.product} machine count`" type="number" min="1" max="999" :value="node.machines" @change="setMachineCount(node, ($event.target as HTMLInputElement).value)"><button :aria-label="`Add one ${recipeFor(node)?.product} machine`" @click="setMachineCount(node, node.machines + 1)">+</button></div></div>
                <button v-if="canExpandChain(node)" class="expand-chain" :title="`Create producer machines for ${recipeFor(node)?.product} inputs`" @pointerdown.stop @click="expandChain(node)"><span aria-hidden="true">↳</span> Expand ingredient chain</button>
                <div class="node-output"><span class="port output-port" :ref="element => setPortElement(`output:${node.id}`, element)" /><span class="port-copy"><small>OUTPUT</small><strong>{{ amount((recipeFor(node)?.rate ?? 0) * node.machines) }} <em>/ min</em></strong></span><span class="output-copy"><strong class="output-name"><ItemIcon :item-id="recipeFor(node)?.product_id" :name="recipeFor(node)?.product ?? ''" />{{ recipeFor(node)?.product }} ({{ itemPrice(recipeFor(node)?.product ?? '', 'sell') }})</strong><small class="node-profit" :class="{ 'profit-positive': (processProfit(recipeFor(node), node.machines) ?? 0) > 0, 'profit-negative': (processProfit(recipeFor(node), node.machines) ?? 0) < 0 }">{{ profitLabel(processProfit(recipeFor(node), node.machines), recipeUsesReference(recipeFor(node))) }}</small></span></div>
                <div class="input-heading"><span>INPUTS</span><span>/ MIN</span></div>
                <div v-for="ingredient in recipeFor(node)?.ingredients" :key="ingredient.item_id" class="node-input">
                  <span class="port input-port" :class="{ connected: connections[inputKey(node.id, ingredient.item_id)] }" :ref="element => setPortElement(`input:${inputKey(node.id, ingredient.item_id)}`, element)" />
                  <span class="input-name"><ItemIcon :item-id="ingredient.item_id" :name="ingredient.name" />{{ ingredient.name }} ({{ itemPrice(ingredient.name, 'buy') }})</span>
                  <strong>{{ amount(ingredient.quantity * (recipeFor(node)?.rate ?? 0) / (recipeFor(node)?.batch ?? 1) * node.machines) }}</strong>
                  <button v-if="providersFor(node, ingredient.item_id).length" class="connect-button" :class="{ linked: connections[inputKey(node.id, ingredient.item_id)] }" :title="connections[inputKey(node.id, ingredient.item_id)] ? 'Change material source' : 'Connect a producer'" @click="activeInput = activeInput === inputKey(node.id, ingredient.item_id) ? '' : inputKey(node.id, ingredient.item_id)">{{ connections[inputKey(node.id, ingredient.item_id)] ? '↔' : '○' }}</button>
                  <select v-if="activeInput === inputKey(node.id, ingredient.item_id)" class="provider-select" :value="connections[inputKey(node.id, ingredient.item_id)] ?? ''" :aria-label="`Choose source for ${ingredient.name}`" @change="setConnection(inputKey(node.id, ingredient.item_id), ($event.target as HTMLSelectElement).value)"><option value="">External supply</option><option v-for="provider in providersFor(node, ingredient.item_id)" :key="provider.id" :value="provider.id">{{ recipeFor(provider)?.product }} · {{ provider.machines }} machine{{ provider.machines === 1 ? '' : 's' }}</option></select>
                </div>
              </div>
            </article>
            <article v-if="dragPreview && draggedRecipe" class="machine-card drag-preview" :style="{ left: `${dragPreview.x - boardBounds.left}px`, top: `${dragPreview.y - boardBounds.top}px`, '--station-accent': stationAccent(draggedRecipe.station) }">
              <header class="machine-head"><span class="grip">＋</span><img v-if="draggedRecipe.image_url" class="machine-thumbnail" :src="draggedRecipe.image_url" alt=""><span class="station-tag">{{ draggedRecipe.station.replaceAll('_', ' ') }}</span></header>
              <div class="machine-body"><p class="node-label">NEW PRODUCTION MACHINE</p><h2><ItemIcon :item-id="draggedRecipe.product_id" :name="draggedRecipe.product" />{{ draggedRecipe.product }}</h2><p class="drop-hint">Release to add this output</p></div>
            </article>
            <div v-if="!nodes.length" class="canvas-empty" :style="{ left: `${-boardBounds.left}px`, top: `${-boardBounds.top}px` }"><div class="empty-symbol"><span>＋</span></div><h2>Your factory starts here</h2><p>Add a recipe from the catalogue to place your first machine.</p><div class="empty-shortcuts"><kbd>Click</kbd><span>to add</span><span class="shortcut-sep">·</span><kbd>Drag recipe</kbd><span>onto grid</span></div></div>
          </div>
          <div v-if="selecting" class="selection-box" :style="selectionBoxStyle" />
        </div>
        <section v-if="activeView !== 'network'" class="data-view" :class="{ 'prices-data-view': activeView === 'prices' }">
          <section v-if="activeView === 'targets'" class="target-panel">
            <div class="target-intro"><div><p class="eyebrow">PRODUCTION REQUEST</p><h2>Plan what you need</h2></div><p>Set output rates, then generate the machines and ingredient chain.</p></div>
            <nav class="target-tabs" aria-label="Production target sections"><button v-for="section in targetSections" :key="section[0]" :class="{ active: activeTargetSection === section[0] }" @click="activeTargetSection = section[0]">{{ section[1] }}</button></nav>
            <div v-if="activeTargetSection === 'outputs'" class="target-section">
              <div class="target-section-heading"><div><p class="eyebrow">DESIRED OUTPUTS</p><h3>Items to produce</h3></div><button class="target-add-button" @click="addProductionTarget"><span class="target-add-icon">+</span><span>Add output item</span></button></div>
              <div v-if="productionTargets.length" class="target-list">
                <article v-for="target in productionTargets" :key="target.id" class="target-card">
                  <div class="target-entry-row">
                    <label class="target-product target-search-control"><ItemIcon class="item-icon" :item-id="target.itemId" :name="materialOptions.find(item => item.id === target.itemId)?.name ?? '⌕'" /><span class="target-search-input"><span class="search-icon">⌕</span><input type="search" :list="`output-items-${target.id}`" :value="materialOptions.find(item => item.id === target.itemId)?.name ?? ''" placeholder="Search products..." :aria-label="`Search output item ${target.id}`" @change="setTargetItemByName(target, ($event.target as HTMLInputElement).value)" @keydown.enter.prevent="buildTargetFromSearch(target, ($event.target as HTMLInputElement).value)"><datalist :id="`output-items-${target.id}`"><option v-for="item in productOptions" :key="item.id" :value="item.name"></option></datalist></span></label>
                    <div class="target-amount"><label :for="`output-rate-${target.id}`">Output amount</label><div class="target-rate-control"><input :id="`output-rate-${target.id}`" :value="target.rate" type="number" min="0.01" step="0.1" aria-label="Output amount per minute" @focus="recordPlanChange" @change="target.rate = Math.max(0, Number(($event.target as HTMLInputElement).value) || 0)" @keydown.enter.prevent="buildProductionTargets"><span>items / min</span></div></div>
                    <button class="remove-target" :aria-label="`Remove ${materialOptions.find(item => item.id === target.itemId)?.name ?? 'output'} output`" title="Remove output" @click="removeProductionTarget(target.id)">×</button>
                  </div>
                </article>
              </div>
              <div v-else class="target-empty"><span class="empty-symbol">＋</span><strong>No output items yet</strong><p>Add an item and set the amount you need per minute.</p></div>
              <div class="target-actions"><p>Whole machines are rounded up to meet each requested rate. Shared ingredients use one producer sized for all connected outputs.</p><button class="button primary" :disabled="!productionTargets.some(target => target.itemId && target.rate > 0)" @click="buildProductionTargets">Generate production chain</button></div>
            </div>
            <div v-else-if="activeTargetSection === 'inputs'" class="target-section">
              <div class="target-section-heading"><div><p class="eyebrow">AVAILABLE INPUTS</p><h3>Items supplied from outside</h3></div><button class="target-add-button" :disabled="importedInputs.length >= materialOptions.length" @click="addImportedInput"><span class="target-add-icon">+</span><span>Add input item</span></button></div>
              <p class="target-help">Items listed here are treated as direct imports when a chain is generated, so no producer machines are added for them. Existing connected producers remain in your current plan.</p>
              <div v-if="importedInputs.length" class="target-list">
                <article v-for="input in importedInputBalances" :key="input.id" class="target-card input-target-card">
                  <div class="target-card-top"><label class="target-product"><ItemIcon class="item-icon" :item-id="input.itemId" :name="input.name" /><select :value="input.itemId" :aria-label="`Imported input ${input.name}`" @change="setImportedItemById(input.id, ($event.target as HTMLSelectElement).value)"><option v-for="item in materialOptions" :key="item.id" :value="item.id" :disabled="importedInputs.some(existing => existing.id !== input.id && existing.itemId === item.id)">{{ item.name }}</option></select></label><button class="remove-target" :aria-label="`Remove ${input.name} input`" title="Remove input" @click="removeImportedInput(input.id)">×</button></div>
                  <div class="input-target-summary"><span>External requirement <strong>{{ amount(input.required) }} / min</strong></span><span>Available <strong>{{ amount(input.rate) }} / min</strong></span><span :class="{ 'needs-supply': input.shortage > 0 }">Shortfall <strong>{{ amount(input.shortage) }} / min</strong><button v-if="input.shortage > 0" class="tree-expand" @click="reviewItemBalance(input.name)">Review flow</button></span></div>
                  <div class="target-rate"><label :for="`input-rate-${input.id}`">Available amount</label><div class="target-rate-control"><input :id="`input-rate-${input.id}`" :value="input.rate" type="number" min="0" step="0.1" @change="setImportedRate(input.id, ($event.target as HTMLInputElement).value)"><span>items / min</span></div></div>
                </article>
              </div>
              <div v-else class="target-empty"><span class="empty-symbol">↓</span><strong>No imported inputs set</strong><p>Raw materials will appear here as external requirements after the chain is generated.</p></div>
            </div>
            <div v-else class="target-section options-section">
              <div class="target-section-heading"><div><p class="eyebrow">GENERATION OPTIONS</p><h3>How to build the plan</h3></div></div>
              <label class="target-option"><input v-model="autoArrangeGenerated" type="checkbox" @focus="recordPlanChange"><span><strong>Arrange the graph automatically</strong><small>Place outputs on the right and ingredient producers in compact columns.</small></span></label>
              <label class="target-option"><input v-model="preserveExistingPlan" type="checkbox" @focus="recordPlanChange"><span><strong>Keep the current plan</strong><small>Reuse matching producers and add requested outputs to the existing graph.</small></span></label>
            </div>
          </section>
          <PriceHistory v-else-if="activeView === 'prices' && showPriceHistory" :quotes="marketData?.quotes ?? []" :recipes="recipes" :nodes="nodes" :connections="connections" :plan-flows="{ sales: network.surplus, costs: network.external }" :initial-symbol="historyInitialSymbol" @close="showPriceHistory = false" />
          <div v-else-if="activeView === 'prices'" class="prices-page">
            <div class="table-intro"><div><p class="eyebrow">LIVE MARKET</p><h2>Market prices</h2></div><span v-if="marketData" class="market-freshness">Order books as of {{ new Date(marketData.asOf).toLocaleString() }}<small v-if="nextMarketCheck">Next eligible update {{ nextMarketCheck }}</small><small v-if="marketData.refreshOutcome === 'failed'" class="market-refresh-failed">Hourly order-book refresh failed; showing saved prices.</small><small v-else-if="marketData.refreshOutcome === 'partial'" class="market-refresh-failed">Some order books failed; showing the last saved prices for those items.</small></span><span v-else>Current public quotes</span></div>
            <p class="prices-note">Quotes come from saved game market snapshots. Ticker references cover {{ marketData?.catalogueCoverage?.priced ?? 0 }}/{{ marketData?.catalogueCoverage?.total ?? metadata?.itemCount ?? '?' }} catalogue items; order books cover {{ marketData?.orderBookCoverage?.priced ?? 0 }}/{{ marketData?.orderBookCoverage?.total ?? metadata?.itemCount ?? '?' }} market items. Quick buy, instant sell, and suggested offer appear when their order books have been collected. Select <strong>History</strong> for detailed charts. Buy and sell assumptions stay in your browser. <a href="https://play.capitalrift.com/" target="_blank" rel="noreferrer">Source ↗</a></p>
            <section class="economics-section">
              <div class="economics-heading"><div><p class="eyebrow">CURRENT PLAN</p><h3>Profit and production value</h3></div><span>{{ planEconomics.sales.pricedCount + planEconomics.costs.pricedCount }} priced · {{ planEconomics.sales.proxyCount + planEconomics.costs.proxyCount }} opposite-side estimates · {{ planEconomics.sales.referenceCount + planEconomics.costs.referenceCount }} ticker estimates · {{ planEconomics.sales.unpricedCount + planEconomics.costs.unpricedCount }} unpriced flows</span></div>
              <div class="economics-cards">
                <article class="economics-card"><span>EST. SALES · SURPLUS</span><strong>{{ planEconomics.sales.unpricedCount ? '$' + planEconomics.sales.knownTotal.toFixed(2) + ' + ?' : '$' + planEconomics.sales.knownTotal.toFixed(2) }}</strong><small>per minute · {{ planEconomics.sales.pricedCount }}/{{ planEconomics.sales.rows.length }} outputs priced</small></article>
                <article class="economics-card"><span>EST. INPUT COST</span><strong>{{ planEconomics.costs.unpricedCount ? '$' + planEconomics.costs.knownTotal.toFixed(2) + ' + ?' : '$' + planEconomics.costs.knownTotal.toFixed(2) }}</strong><small>per minute · {{ planEconomics.costs.pricedCount }}/{{ planEconomics.costs.rows.length }} inputs priced</small></article>
                <article class="economics-card net-card"><span>EST. NET PROFIT</span><strong :class="{ 'profit-positive': planEconomics.complete && planEconomics.netKnown > 0, 'profit-negative': planEconomics.complete && planEconomics.netKnown < 0 }">{{ planEconomics.complete ? profitLabel(planEconomics.netKnown, planEconomics.usesEstimate) : '$... / min' }}</strong><small>{{ planEconomics.complete ? 'surplus sales minus external input costs' : 'requires prices for every external flow' }}</small></article>
              </div>
              <div class="economics-columns">
                <div class="economics-list"><h4>Surplus available to sell</h4><div v-for="item in planEconomics.sales.rows" :key="`sale-${item.id}`" class="economics-row"><span><ItemIcon :item-id="item.id" :name="item.name" />{{ item.name }}<small class="economics-rate">{{ amount(item.amount) }}/min × {{ item.price === undefined ? '$...' : `${item.referencePrice || item.proxyPrice ? '≈' : ''}$${item.price.toFixed(2)}` }} {{ item.referencePrice ? 'ticker estimate' : item.proxyPrice ? 'buy-side proxy' : 'sell price' }}</small><small v-if="item.quote && volumeSharePercent(item.amount, item.quote.units24h) !== undefined" class="liquidity-note" :class="volumeShareClass(volumeSharePercent(item.amount, item.quote.units24h))">≈{{ volumeSharePercent(item.amount, item.quote.units24h)?.toFixed(1) }}% of reported 24h volume</small></span><strong>{{ item.valuePerMinute === undefined ? '$...' : '$' + item.valuePerMinute.toFixed(2) }}/min</strong></div><p v-if="!planEconomics.sales.rows.length" class="economics-empty">No unconnected product surplus to sell.</p></div>
                <div class="economics-list"><h4>External materials to buy</h4><div v-for="item in planEconomics.costs.rows" :key="`cost-${item.id}`" class="economics-row"><span><ItemIcon :item-id="item.id" :name="item.name" />{{ item.name }}<small class="economics-rate">{{ amount(item.amount) }}/min × {{ item.price === undefined ? '$...' : `${item.referencePrice || item.proxyPrice ? '≈' : ''}$${item.price.toFixed(2)}` }} {{ item.referencePrice ? 'ticker estimate' : item.proxyPrice ? 'sell-side proxy' : 'buy price' }}</small><small v-if="item.quote && volumeSharePercent(item.amount, item.quote.units24h) !== undefined" class="liquidity-note" :class="volumeShareClass(volumeSharePercent(item.amount, item.quote.units24h))">≈{{ volumeSharePercent(item.amount, item.quote.units24h)?.toFixed(1) }}% of reported 24h volume</small></span><strong>{{ item.valuePerMinute === undefined ? '$...' : '$' + item.valuePerMinute.toFixed(2) }}/min</strong></div><p v-if="!planEconomics.costs.rows.length" class="economics-empty">No external input costs in this plan.</p></div>
              </div>
              <p class="economics-disclaimer">When one book side is unavailable, ≈ uses the opposite side as a proxy. If both sides are unavailable, ≈ uses the saved ticker reference where available. Neither is a guaranteed trade price. Volume share compares this plan’s estimated 24-hour rate with the feed’s 24-hour traded units; it is a scale indicator, not a fill guarantee. Estimates exclude machine/building costs, fees, and price impact.</p>
            </section>
            <section class="price-optimizer">
              <div class="economics-heading"><div><p class="eyebrow">RECIPE OPTIMIZER</p><h3>Most profitable production routes</h3></div><span>{{ optimizerOpportunities.length }} fully priced recipes</span></div>
              <p class="prices-note">Profit uses the output’s highest current buy bid (instant sell) minus the lowest sell ask for each purchased input (quick buy). Ingredient costs use the cheapest known buy-or-craft route; profit per minute assumes one machine running continuously. A suggested sell offer undercuts the lowest ask by $0.01. Your local buy/sell assumptions above are applied immediately.</p>
              <label class="view-search optimizer-search"><span>⌕</span><input v-model="optimizerSearch" type="search" placeholder="Search products, recipes, or buildings"></label>
              <div class="table-scroll optimizer-table-scroll"><table class="planner-table optimizer-table"><thead><tr><th>Product / inputs</th><th>Recipe · building</th><th>Sell / item</th><th>Input cost / item</th><th>Margin / item</th><th>Margin</th><th>Profit / min</th><th>Est. share of daily volume</th><th>Action</th></tr></thead><tbody>
                <tr v-for="opportunity in filteredOptimizerOpportunities" :key="opportunity.recipe.id" :class="{ 'loss-row': opportunity.marginPerItem < 0 }"><td><strong class="optimizer-product"><ItemIcon :item-id="opportunity.recipe.product_id" :name="opportunity.recipe.product" />{{ opportunity.recipe.product }}</strong><details class="optimizer-details"><summary>{{ opportunity.inputCosts.length }} input{{ opportunity.inputCosts.length === 1 ? '' : 's' }} · show cost breakdown</summary><div v-for="input in opportunity.inputCosts" :key="input.name" class="optimizer-input-detail"><span><ItemIcon :item-id="input.itemId" :name="input.name" />{{ input.name }} · {{ amount(input.amountPerItem) }}/item<span v-if="input.routeRecipe"> via {{ input.routeRecipe.label }}</span></span><b>{{ '$' + input.unitCost.toFixed(2) }}/unit · {{ '$' + input.totalCost.toFixed(2) }}</b></div></details></td><td>{{ opportunity.recipe.label }}<small class="optimizer-building">{{ opportunity.recipe.station.replaceAll('_', ' ') }}</small></td><td>{{ '$' + opportunity.outputPrice.toFixed(2) }}</td><td>{{ '$' + opportunity.inputCostPerItem.toFixed(2) }}</td><td :class="opportunity.marginPerItem >= 0 ? 'profit-positive' : 'profit-negative'">{{ (opportunity.marginPerItem < 0 ? '−$' : '+$') + Math.abs(opportunity.marginPerItem).toFixed(2) }}</td><td>{{ opportunity.marginPercent.toFixed(1) }}%</td><td :class="opportunity.profitPerMinute >= 0 ? 'profit-positive' : 'profit-negative'">{{ profitLabel(opportunity.profitPerMinute) }}</td><td :class="volumeShareClass(opportunity.outputVolumeShare)">{{ opportunity.outputVolumeShare === undefined ? '$...' : `≈${opportunity.outputVolumeShare.toFixed(1)}%` }}</td><td><button class="optimizer-build" @click="buildOptimizedChain(opportunity)">Add chain</button></td></tr>
                <tr v-if="!filteredOptimizerOpportunities.length"><td colspan="9" class="table-empty">{{ optimizerOpportunities.length ? 'No priced recipes match this search.' : 'No recipe has a fully priced output and ingredient route yet. More market coverage is needed.' }}</td></tr>
              </tbody></table></div>
              <p class="optimizer-footnote">When one book side is missing, the optimizer uses the opposite side as a proxy. It does not account for machine investment, throughput limits, market liquidity, taxes, recipe unlocks, or competing demand. Routes are theoretical until those rules and full item prices are available.</p>
            </section>
            <div class="prices-controls"><label class="view-search"><span>⌕</span><input v-model="viewSearch" type="search" placeholder="Search market quotes"></label><button class="button" :disabled="marketLoading" @click="loadMarketPrices(true)">{{ marketLoading ? 'Loading…' : 'Check for due update' }}</button></div>
            <p v-if="marketLoading && !marketData" class="table-empty prices-status">Loading live quotes…</p><p v-else-if="marketError" class="table-empty prices-status" role="alert">{{ marketError }}</p>
            <div v-else class="table-scroll market-table-scroll"><table class="planner-table market-table"><thead><tr><th>Item</th><th>Ticker</th><th>Ticker reference</th><th>Quick buy · best ask</th><th>Instant sell · best bid</th><th>Suggested sell offer</th><th>Your buy</th><th>Your sell</th><th>Units traded · 24h</th><th>30-day sell trend</th><th>Change since prior snapshot</th><th></th></tr></thead><tbody>
              <tr v-for="quote in filteredMarketQuotes" :key="quote.symbol"><th scope="row"><ItemIcon class="table-item-icon" :item-id="quote.symbol" :name="quote.name" />{{ quote.name }}</th><td>{{ quote.symbol }}</td><td>{{ '$' + quote.price.toFixed(2) }}</td><td>{{ bookPrice(quote, 'buy') === undefined ? '$...' : `${usesOppositeSide(quote, 'buy') ? '≈' : ''}$${bookPrice(quote, 'buy')!.toFixed(2)}` }}</td><td>{{ bookPrice(quote, 'sell') === undefined ? '$...' : `${usesOppositeSide(quote, 'sell') ? '≈' : ''}$${bookPrice(quote, 'sell')!.toFixed(2)}` }}</td><td>{{ quote.suggestedSellOffer == null ? '$...' : '$' + quote.suggestedSellOffer.toFixed(2) }}</td><td><input class="price-override-input" type="number" min="0" step="any" :aria-label="`Scenario buy price for ${quote.name}`" :placeholder="bookPrice(quote, 'buy')?.toFixed(2) ?? ''" :value="priceOverrides[quote.symbol]?.buy ?? ''" @change="setPriceOverride(quote.symbol, 'buy', ($event.target as HTMLInputElement).value)"></td><td><input class="price-override-input" type="number" min="0" step="any" :aria-label="`Scenario sell price for ${quote.name}`" :placeholder="bookPrice(quote, 'sell')?.toFixed(2) ?? ''" :value="priceOverrides[quote.symbol]?.sell ?? ''" @change="setPriceOverride(quote.symbol, 'sell', ($event.target as HTMLInputElement).value)"></td><td>{{ quote.volumeKnown === false ? '—' : amount(quote.units24h) }}</td><td><svg v-if="quote.history.length > 1" class="price-sparkline" viewBox="0 0 100 24" role="img" :aria-label="`${quote.history.length} hourly sell prices; ${quote.history[0]} to ${quote.sellPrice ?? quote.price}`"><polyline :points="sparklinePoints(quote.history)" /></svg><small v-else class="history-pending">Collecting</small></td><td :class="quote.changeSincePreviousPercent === null ? '' : quote.changeSincePreviousPercent >= 0 ? 'profit-positive' : 'profit-negative'">{{ quote.changeSincePreviousPercent === null ? 'Collecting order-book history' : `${quote.changeSincePreviousPercent >= 0 ? '+' : ''}${quote.changeSincePreviousPercent.toFixed(2)}%` }}</td><td><button v-if="priceOverrides[quote.symbol]" class="price-reset" @click="resetPriceOverrides(quote.symbol)">Reset</button></td></tr>
              <tr v-if="!filteredMarketQuotes.length"><td colspan="12" class="table-empty">{{ marketData?.quotes.length ? 'No market quotes match this search.' : marketData?.refreshOutcome === 'failed' ? 'The hourly market update failed and no saved quotes are available yet.' : 'No market quotes are available.' }}</td></tr>
            </tbody></table></div>
          </div>
          <label v-else-if="activeView === 'items' || activeView === 'buildings'" class="view-search"><span>⌕</span><input v-model="viewSearch" type="search" :placeholder="activeView === 'items' ? 'Search planned items' : 'Search buildings or products'"></label>
          <div v-if="activeView === 'tree'" class="tree-panel">
            <div class="table-intro"><div><p class="eyebrow">RECIPE DEPENDENCIES</p><h2>Production tree</h2></div><span>{{ nodes.length }} machines · {{ network.external.length }} raw inputs</span></div>
            <div v-if="treeRows.length" class="tree-list">
              <div v-for="row in treeRows" :key="row.key" class="tree-row" :class="[`tree-${row.kind}`, { 'is-external': row.external }]" :style="{ paddingLeft: `${14 + row.depth * 19}px` }">
                <ItemIcon :item-id="row.itemId" :name="row.name" /><strong>{{ row.name }}</strong><span class="tree-detail">{{ row.detail }}</span><button v-if="row.kind === 'product' && row.nodeId && row.hasChildren" class="tree-expand" :aria-expanded="!row.collapsed" :title="row.collapsed ? `Show ${row.name} ingredients` : `Hide ${row.name} ingredients`" @click.stop="toggleTreeNode(row.nodeId)">{{ row.collapsed ? 'Show chain' : 'Hide chain' }}</button><button v-if="row.kind === 'product' && row.nodeId" class="tree-focus" :title="`Focus ${row.name} in the graph`" @click.stop="focusNode(row.nodeId)">Graph</button><button v-if="row.kind === 'product' && row.nodeId && canExpandNodeId(row.nodeId)" class="tree-expand" :title="`Create producer machines for ${row.name} inputs`" @click.stop="expandTreeNode(row.nodeId)">Expand chain</button><span v-if="row.machines" class="tree-count">{{ row.machines }} machine{{ row.machines === 1 ? '' : 's' }}</span>
              </div>
            </div>
            <div v-else class="view-empty"><h2>No production tree yet</h2><p>Add a recipe and expand its ingredient chain to see how materials connect.</p></div>
          </div>
          <div v-else-if="activeView === 'items'" class="table-panel">
            <div class="table-intro"><div><p class="eyebrow">MATERIAL FLOW</p><h2>Item balances</h2></div><span>All rates per minute</span></div>
            <div class="table-scroll"><table class="planner-table"><thead><tr><th>Item</th><th>Produced</th><th>Required</th><th>Connected</th><th>External</th><th>Surplus</th><th></th></tr></thead><tbody>
              <tr v-for="item in itemBalances" :key="item.id"><th scope="row"><ItemIcon class="table-item-icon" :item-id="item.id" :name="item.name" />{{ item.name }}</th><td>{{ amount(item.produced) }}</td><td>{{ amount(item.required) }}</td><td>{{ amount(item.connected) }}</td><td :class="{ 'needs-supply': item.external > 0 }">{{ amount(item.external) }}</td><td :class="{ 'has-surplus': item.surplus > 0 }">{{ amount(item.surplus) }}</td><td><button v-if="item.external > 0" class="tree-expand" @click="configureImportForItem(item.id)">Set import</button></td></tr>
              <tr v-if="!itemBalances.length"><td colspan="7" class="table-empty">Add machines to see item balances.</td></tr>
            </tbody></table></div>
          </div>
          <div v-else-if="activeView === 'buildings'" class="table-panel">
            <div class="table-intro"><div><p class="eyebrow">PRODUCTION SITES</p><h2>Building catalogue</h2></div><span>{{ network.machineTotal }} machines in plan</span></div>
            <div class="table-scroll"><table class="planner-table"><thead><tr><th>Building</th><th>Recipes</th><th>In plan</th><th>Products made here</th></tr></thead><tbody>
              <tr v-for="building in buildingSummaries" :key="building.id"><th scope="row" class="building-name"><img v-if="recipes.find(recipe => recipe.station === building.id)?.image_url" class="building-thumbnail" :src="recipes.find(recipe => recipe.station === building.id)?.image_url ?? undefined" alt="">{{ building.name }}</th><td>{{ building.recipeCount }}</td><td><span class="machine-pill">{{ building.machines }} machine{{ building.machines === 1 ? '' : 's' }}</span></td><td class="products-cell"><span v-for="product in building.products" :key="product.id" class="building-product"><ItemIcon :item-id="product.id" :name="product.name" />{{ product.name }}</span></td></tr>
              <tr v-if="!buildingSummaries.length"><td colspan="4" class="table-empty">No buildings match this search.</td></tr>
            </tbody></table></div>
          </div>
        </section>
        <footer v-if="activeView === 'network'" class="canvas-footer"><span><i class="footer-dot" /> GRID SNAP ON</span><span>{{ network.connectionRows.length }} MATERIAL CONNECTION{{ network.connectionRows.length === 1 ? '' : 'S' }}</span></footer>
      </section>

      <aside class="inspector">
        <div class="inspector-top"><div><p class="eyebrow">PLAN OVERVIEW</p><h2>Network stats</h2></div></div>
        <div class="stat-grid"><div class="stat-card"><span>MACHINES</span><strong>{{ network.machineTotal }}</strong><small>across {{ nodes.length }} recipes</small></div><div class="stat-card"><span>CONNECTIONS</span><strong>{{ network.connectionRows.length }}</strong><small>material flows</small></div></div>
        <section class="total-profit-card"><span>TOTAL PROFIT · PER MIN</span><strong :class="{ 'profit-positive': (totalProfitPerMinute ?? 0) > 0, 'profit-negative': (totalProfitPerMinute ?? 0) < 0 }">{{ profitLabel(totalProfitPerMinute, planEconomics.usesEstimate) }}</strong><small>{{ planEconomics.usesEstimate ? 'Estimate uses an opposite-side price or ticker reference where needed' : 'Surplus sales minus external input costs' }}</small></section>
        <section class="summary-section"><div class="section-heading"><div><span class="section-mark import-mark">↓</span><h3>External inputs</h3></div><span class="section-count">{{ network.external.length }}</span></div>
          <div v-if="network.external.length" class="resource-list"><div v-for="item in network.external" :key="item.id" class="resource-row"><ItemIcon class="resource-icon" :item-id="item.id" :name="item.name" /><span class="resource-name">{{ item.name }}</span><strong>{{ amount(item.amount) }} <small>/ min</small></strong></div></div>
          <p v-else class="summary-empty">Add machines to see required materials.</p>
        </section>
        <section class="summary-section surplus-section"><div class="section-heading"><div><span class="section-mark surplus-mark">↑</span><h3>Surplus</h3></div><span class="section-count">{{ network.surplus.length }}</span></div>
          <div v-if="network.surplus.length" class="resource-list"><div v-for="item in network.surplus" :key="item.id" class="resource-row"><ItemIcon class="resource-icon" :item-id="item.id" :name="item.name" /><span class="resource-name">{{ item.name }}</span><strong>{{ amount(item.amount) }} <small>/ min</small></strong></div></div>
          <p v-else class="summary-empty">All production is connected.</p>
        </section>
        <div class="planner-note"><span class="note-icon">i</span><p>Connect a machine output to a matching input to balance the flow. Unconnected requirements are listed as external inputs.</p></div>
        <footer v-if="metadata" class="source-foot">{{ metadata.recipeCount }} recipes · Snapshot imported {{ new Date(metadata.retrievedAt).toLocaleDateString() }}<strong v-if="catalogueAgeDays >= 30" class="stale-source">Catalogue may be out of date</strong><a href="https://github.com/mrawsky/capitalrift-tools" target="_blank" rel="noreferrer">Data source ↗</a></footer>
      </aside>
    </div>
    <div v-if="error" class="toast" role="alert">{{ error }}</div>
  </main>
</template>

<style>
@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;600;700&display=swap');
:root{font-family:'DM Sans',sans-serif;color:#e8ede9;background:#111613;font-synthesis:none;text-rendering:optimizeLegibility;font-optical-sizing:auto}*{box-sizing:border-box}body{margin:0;min-width:360px}.app-shell{height:100vh;min-height:600px;overflow:hidden;display:flex;flex-direction:column;background:#111613}.topbar{height:58px;flex:none;display:flex;align-items:center;justify-content:space-between;padding:0 21px;border-bottom:1px solid #27302b;background:#151b17}.brand{display:flex;align-items:center;gap:10px;color:#e7eee8;text-decoration:none;font-size:11px;letter-spacing:.12em;font-weight:700}.brand-mark{width:29px;height:29px;border:1px solid #536c58;border-radius:6px;display:grid;place-items:center;color:#b9d7b8;font:500 10px 'DM Mono',monospace;letter-spacing:0}.brand small{display:block;margin-top:2px;color:#7e8a80;font:9px 'DM Mono',monospace;letter-spacing:.11em}.top-actions,.toolbar-actions{display:flex;align-items:center;gap:16px}.save-state{color:#8a988d;font-size:11px;display:flex;align-items:center;gap:7px}.save-state i,.footer-dot{width:6px;height:6px;border-radius:50%;background:#76b483;display:inline-block}.button{border:1px solid #354139;background:transparent;color:#c4cec6;border-radius:5px;padding:7px 11px;font:11px 'DM Sans',sans-serif;cursor:pointer}.button:hover:not(:disabled){background:#242d27}.button:disabled{opacity:.4;cursor:default}.planner-layout{display:grid;grid-template-columns:260px minmax(440px,1fr) 285px;min-height:0;flex:1}.sidebar,.inspector{background:#171d19;min-height:0;display:flex;flex-direction:column}.sidebar{border-right:1px solid #27302b;padding:22px 14px 14px}.side-heading{display:flex;align-items:flex-start;justify-content:space-between;padding:0 5px 19px}.eyebrow{margin:0 0 6px;color:#849487;font:9px 'DM Mono',monospace;letter-spacing:.12em}.side-heading h1{font-size:18px;line-height:1.2;letter-spacing:-.03em;margin:0;font-weight:600}.node-count,.section-count{font:10px 'DM Mono',monospace;color:#9eaca0;background:#242e27;padding:4px 7px;border-radius:4px}.search-box{height:34px;display:flex;align-items:center;gap:8px;padding:0 9px;border:1px solid #313c34;background:#111713;border-radius:5px}.search-icon{font-size:19px;color:#89958b;line-height:1}.search-box input{min-width:0;flex:1;border:0;outline:none;background:transparent;color:#dbe2db;font:11px 'DM Sans',sans-serif}.search-box input::placeholder{color:#68756b}.search-box kbd,.empty-shortcuts kbd{font:9px 'DM Mono',monospace;color:#879388;border:1px solid #37423a;border-radius:3px;padding:2px 4px}.catalog-heading{display:flex;justify-content:space-between;margin:22px 5px 8px;color:#748176;font:9px 'DM Mono',monospace;letter-spacing:.1em}.catalog-heading span:last-child{color:#9eaaa0}.catalog-list{overflow:auto;min-height:0;flex:1;scrollbar-width:thin;scrollbar-color:#526553 #171d19}.catalog-list::-webkit-scrollbar{width:8px}.catalog-list::-webkit-scrollbar-track{border-radius:6px;background:#171d19}.catalog-list::-webkit-scrollbar-thumb{border:2px solid #171d19;border-radius:6px;background:#526553}.catalog-list::-webkit-scrollbar-thumb:hover{background:#769276}.catalog-item{width:100%;border:0;border-radius:5px;background:transparent;color:#dde3dd;display:flex;align-items:center;gap:9px;padding:7px 5px;text-align:left;cursor:pointer}.catalog-item:hover{background:#232c25}.item-icon,.resource-icon{width:26px;height:26px;flex:none;border:1px solid #3d4a3f;border-radius:5px;display:grid;place-items:center;background:#202a22;color:#a6c6a8;font:10px 'DM Mono',monospace}.catalog-copy{min-width:0;flex:1;display:flex;flex-direction:column;gap:3px}.catalog-copy strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;font-weight:500}.catalog-copy small{font:9px 'DM Mono',monospace;color:#7f8b81;text-transform:capitalize}.add-icon{font-size:16px;color:#79877c;opacity:0}.catalog-item:hover .add-icon{opacity:1}.empty-state{padding:14px 7px;color:#879389;font-size:11px}.sidebar-tip{border-top:1px solid #2b342d;margin-top:12px;padding:12px 5px 0;color:#849087;font-size:10px;line-height:1.5}.tip-dot{display:inline-block;width:5px;height:5px;margin:0 5px 1px 0;border-radius:50%;background:#8cac89}.main-area{min-width:0;min-height:0;display:flex;flex-direction:column;background:#101511}.plan-toolbar{height:43px;flex:none;border-bottom:1px solid #252e28;display:flex;align-items:center;justify-content:space-between;padding:0 15px}.plan-title{display:flex;align-items:center;gap:9px;font-size:11px}.crumb{font:9px 'DM Mono',monospace;color:#859186;letter-spacing:.08em}.crumb-sep{color:#4c584f}.plan-title strong{font-weight:500;color:#dbe2dc}.zoom-label{font:9px 'DM Mono',monospace;color:#859186}.icon-button,.more-button{border:1px solid #303a32;background:#1a211c;color:#b1bdb2;border-radius:4px;width:25px;height:25px;cursor:pointer}.canvas-viewport{position:relative;min-height:0;flex:1;overflow:auto;scrollbar-width:none;-ms-overflow-style:none;cursor:crosshair;background-color:#111713}.canvas-viewport::-webkit-scrollbar{display:none}.canvas-viewport.is-panning{cursor:grabbing;user-select:none}.selection-box{position:fixed;z-index:20;border:2px solid #a5dca9;border-radius:2px;background:#77b98238;box-shadow:inset 0 0 0 1px #11161370;pointer-events:none}.machine-card.selected{border-color:#89bd8d;box-shadow:0 0 0 2px #80b58755,0 8px 26px #0005}.machine-card{user-select:none}.canvas-board{position:relative;width:2200px;height:1600px;background-image:radial-gradient(#343e35 0.75px,transparent .75px),linear-gradient(to right,rgba(48,59,50,.18) 1px,transparent 1px),linear-gradient(to bottom,rgba(48,59,50,.18) 1px,transparent 1px);background-size:24px 24px,120px 120px,120px 120px}.connections{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none}.flow-shadow{fill:none;stroke:#111613;stroke-width:6}.flow-line{fill:none;stroke:#7fb58a;stroke-width:2;stroke-dasharray:5 4;filter:drop-shadow(0 0 4px #70ac7a80)}.flow-dot{fill:#a7d5ad;stroke:#18211a;stroke-width:2}.machine-card{position:absolute;width:300px;min-height:150px;z-index:1;background:#1a211c;border:1px solid #3a463c;border-radius:7px;box-shadow:0 8px 26px #0005;color:#dce3dd}.machine-card:hover{border-color:#556651}.machine-head{height:30px;display:flex;align-items:center;gap:8px;padding:0 9px;background:#202821;border-bottom:1px solid #303a31;border-radius:6px 6px 0 0;cursor:grab;user-select:none}.machine-head:active{cursor:move}.grip{color:#68766b;font-size:14px}.station-tag{font:9px 'DM Mono',monospace;text-transform:uppercase;letter-spacing:.08em;color:#9aab9b}.delete-node{margin-left:auto;border:0;background:transparent;color:#718075;font-size:18px;cursor:pointer}.delete-node:hover{color:#e3a19a}.machine-body{padding:11px 12px 10px}.node-label,.input-heading,.port-copy small{margin:0;color:#718075;font:8px 'DM Mono',monospace;letter-spacing:.1em}.machine-body h2{margin:3px 0 10px;color:#e2e8e2;font-size:14px;font-weight:600;letter-spacing:-.02em;text-transform:capitalize}.machine-control{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;color:#9aa69b;font-size:10px}.expand-chain{width:100%;display:flex;align-items:center;gap:6px;margin:0 0 9px;padding:5px 7px;border:1px solid #3a4a3c;border-radius:4px;background:#202b22;color:#a8c8aa;font:9px 'DM Sans',sans-serif;cursor:pointer}.expand-chain:hover{border-color:#668469;background:#27372a}.expand-chain span{font:12px 'DM Mono',monospace}.stepper{height:24px;display:flex;align-items:center;border:1px solid #354038;border-radius:4px;overflow:hidden;background:#151b17}.stepper button{width:24px;height:22px;border:0;background:transparent;color:#b9c4bb;cursor:pointer}.stepper button:hover{background:#2c382e}.stepper input{width:30px;border:0;outline:none;background:transparent;color:#e2e8e2;text-align:center;font:10px 'DM Mono',monospace;appearance:textfield}.stepper input::-webkit-inner-spin-button{display:none}.node-output{position:relative;display:flex;align-items:center;gap:8px;padding:7px 0;border-top:1px solid #2d372f;border-bottom:1px solid #2d372f}.port{position:absolute;width:8px;height:8px;border:2px solid #9cc69e;border-radius:50%;background:#19211b}.output-port{right:-17px}.input-port{left:-17px;border-color:#899b8c}.input-port.connected{border-color:#a7d5ad;background:#73a77b;box-shadow:0 0 7px #77ad7e}.port-copy{display:flex;flex-direction:column;gap:3px}.port-copy strong{font:11px 'DM Mono',monospace;color:#d5e4d6}.port-copy em{color:#7d8c7e;font-style:normal;font-size:9px}.output-name{margin-left:auto;color:#93ae95;font-size:10px;text-transform:capitalize}.input-heading{display:flex;justify-content:space-between;padding:10px 0 4px}.node-input{position:relative;min-height:29px;display:flex;align-items:center;gap:5px;border-bottom:1px solid #252e27;color:#b0bbb1;font-size:9px}.input-name{flex:1;text-transform:capitalize}.node-input>strong{font:9px 'DM Mono',monospace;color:#c9d3ca}.connect-button{position:absolute;left:-43px;top:5px;width:19px;height:19px;padding:0;border:1px solid transparent;border-radius:4px;background:transparent;color:#79867b;cursor:pointer}.connect-button:hover,.connect-button.linked{border-color:#455748;color:#a8d2ab;background:#253328}.provider-select{position:absolute;z-index:4;left:-194px;right:auto;top:25px;width:185px;padding:7px;border:1px solid #4a5b4b;border-radius:4px;background:#202921;color:#dce5dd;font:10px 'DM Sans',sans-serif;box-shadow:0 6px 20px #0008}.canvas-empty{position:absolute;left:50%;top:43%;transform:translate(-50%,-50%);width:340px;text-align:center;color:#869187}.empty-symbol{width:44px;height:44px;display:grid;place-items:center;margin:0 auto 14px;border:1px dashed #58675a;border-radius:11px;color:#a9c7aa;font-size:20px}.canvas-empty h2{margin:0 0 7px;color:#dce4dc;font-size:15px;font-weight:500}.canvas-empty p{margin:0;font-size:11px}.empty-shortcuts{display:flex;justify-content:center;align-items:center;gap:6px;margin-top:18px;font-size:10px;color:#8a968c}.shortcut-sep{color:#576259;margin:0 4px}.canvas-footer{height:25px;flex:none;display:flex;align-items:center;justify-content:space-between;padding:0 12px;border-top:1px solid #27302a;color:#778378;font:8px 'DM Mono',monospace;letter-spacing:.08em}.canvas-footer span:first-child{display:flex;align-items:center;gap:6px}.footer-dot{width:5px;height:5px}.inspector{border-left:1px solid #27302b;padding:20px 14px 12px;overflow:auto}.inspector-top{display:flex;justify-content:space-between;align-items:flex-start}.inspector-top h2{margin:0;font-size:16px;font-weight:600;letter-spacing:-.02em}.more-button{font-size:15px;line-height:10px}.stat-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:16px 0 24px}.stat-card{min-height:80px;border:1px solid #303a32;background:#1b221d;border-radius:5px;padding:10px}.stat-card>span{display:block;color:#77847a;font:8px 'DM Mono',monospace;letter-spacing:.08em}.stat-card strong{display:block;margin:8px 0 2px;color:#e2e8e2;font:20px 'DM Mono',monospace}.stat-card small{color:#879388;font-size:9px}.summary-section{margin:0 0 20px}.section-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:9px}.section-heading>div{display:flex;align-items:center;gap:8px}.section-heading h3{margin:0;color:#d4ddd4;font-size:11px;font-weight:500}.section-mark{width:19px;height:19px;display:grid;place-items:center;border-radius:4px;font:12px 'DM Mono',monospace}.import-mark{color:#e5bc83;background:#332b20}.surplus-mark{color:#9fcda1;background:#253329}.resource-list{display:flex;flex-direction:column}.resource-row{display:flex;align-items:center;gap:7px;min-height:37px;border-bottom:1px solid #28312a}.resource-row .resource-icon{width:22px;height:22px;font-size:9px;border-color:#39443a;background:#202821}.resource-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#bbc5bc;font-size:10px;text-transform:capitalize}.resource-row>strong{color:#d7e2d7;font:9px 'DM Mono',monospace;white-space:nowrap}.resource-row>strong small{color:#718074;font-size:8px;font-weight:400}.summary-empty{padding:10px 0;color:#78857a;font-size:10px;line-height:1.5}.planner-note{display:flex;gap:8px;margin-top:auto;padding:10px;border:1px solid #344238;border-radius:5px;background:#202a22}.note-icon{width:15px;height:15px;flex:none;border:1px solid #78967a;border-radius:50%;display:grid;place-items:center;color:#a9c6aa;font:9px Georgia,serif}.planner-note p{margin:0;color:#9aa79b;font-size:9px;line-height:1.55}.source-foot{display:flex;flex-direction:column;gap:5px;padding-top:12px;color:#6f7d71;font:8px 'DM Mono',monospace}.source-foot a{color:#9ebfa0;text-decoration:none}.toast{position:fixed;bottom:35px;left:50%;transform:translateX(-50%);padding:10px 14px;border:1px solid #805b56;border-radius:5px;background:#322321;color:#f2c5bf;font-size:11px;z-index:10}
.zoom-controls{display:flex;align-items:center;gap:7px}.zoom-controls .icon-button{font-size:13px}.icon-button:disabled{opacity:.4;cursor:default}

.view-tabs{height:43px;flex:none;display:flex;align-items:stretch;gap:5px;padding:0 20px;border-bottom:1px solid #27302b;background:#151b17}.view-tab{position:relative;padding:0 14px;border:0;background:transparent;color:#8c988e;font:11px 'DM Sans',sans-serif;cursor:pointer}.view-tab:hover{color:#dce5dd}.view-tab.active{color:#c5e0c7}.view-tab.active:after{position:absolute;right:10px;bottom:-1px;left:10px;height:2px;background:#80b587;content:''}.view-count{color:#829085;font:9px 'DM Mono',monospace;letter-spacing:.08em}.data-view{min-height:0;flex:1;overflow:auto;background:#111713}.table-panel,.tree-panel{min-height:100%;padding:20px 22px}.table-intro{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;margin:0 0 18px}.table-intro .eyebrow{margin-bottom:5px}.table-intro h2{margin:0;color:#e1e8e1;font-size:17px;font-weight:600;letter-spacing:-.025em;text-transform:capitalize}.table-intro>span{color:#7d8b7f;font:9px 'DM Mono',monospace;white-space:nowrap}.view-search{height:34px;display:flex;align-items:center;gap:8px;margin:0 0 17px;padding:0 10px;border:1px solid #303a32;border-radius:5px;background:#171e19;color:#89968b}.view-search>span{font-size:18px}.view-search input{width:100%;border:0;outline:0;background:transparent;color:#dce5dd;font:11px 'DM Sans',sans-serif}.view-search input::placeholder{color:#68766b}.table-scroll{overflow:auto;border:1px solid #2b352d;border-radius:6px}.planner-table{width:100%;border-collapse:collapse;font-size:10px;text-align:right}.planner-table thead{position:sticky;top:0;z-index:1;background:#1b241d}.planner-table th,.planner-table td{height:39px;padding:7px 12px;border-bottom:1px solid #28312a;white-space:nowrap}.planner-table thead th{color:#8c9b8d;font:8px 'DM Mono',monospace;letter-spacing:.08em;text-transform:uppercase}.planner-table tbody td{color:#c5d0c6;font:10px 'DM Mono',monospace}.planner-table tbody tr:hover{background:#19221b}.planner-table tbody th[scope=row]{color:#dbe3dc;text-align:left;font-size:10px;font-weight:500;text-transform:capitalize}.planner-table tbody th:first-child,.planner-table thead th:first-child{text-align:left}.table-item-icon{width:22px;height:22px;display:inline-grid;place-items:center;margin-right:8px;border:1px solid #39463a;border-radius:4px;background:#202920;color:#a8c8aa;font:9px 'DM Mono',monospace}.needs-supply{color:#e5bd84!important}.has-surplus{color:#a5d2a9!important}.building-name{min-width:130px}.products-cell{max-width:360px;overflow:hidden;text-overflow:ellipsis;text-align:left!important;color:#8f9d91!important;font:9px 'DM Sans',sans-serif!important}.machine-pill{display:inline-block;padding:4px 6px;border:1px solid #354438;border-radius:4px;background:#202a22;color:#acd0ae;font:9px 'DM Mono',monospace}.table-empty{padding:32px!important;color:#829085!important;text-align:center!important;font-family:'DM Sans',sans-serif!important}.tree-list{overflow:hidden;border:1px solid #2b352d;border-radius:6px}.tree-row{min-height:35px;display:flex;align-items:center;gap:9px;padding-top:5px;padding-right:12px;padding-bottom:5px;border-bottom:1px solid #242e27;color:#c5d0c6;font-size:10px}.tree-row:last-child{border-bottom:0}.tree-row:hover{background:#18211a}.tree-row strong{min-width:95px;color:#dfe6df;font-size:10px;font-weight:500;text-transform:capitalize}.tree-marker{width:14px;flex:none;color:#9ec4a1;text-align:center;font:11px 'DM Mono',monospace}.tree-ingredient .tree-marker{color:#829285}.tree-ingredient.is-external .tree-marker,.tree-ingredient.is-external .tree-detail{color:#d6b57f}.tree-detail{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#879589;font:9px 'DM Mono',monospace}.tree-count{margin-left:auto;color:#a8c8aa;font:9px 'DM Mono',monospace;white-space:nowrap}.view-empty{padding:70px 20px;text-align:center}.view-empty h2{margin:0 0 8px;color:#dce4dc;font-size:15px;font-weight:500}.view-empty p{margin:0;color:#849087;font-size:11px}
.category-strip{display:flex;gap:5px;overflow-x:auto;flex:none;margin:10px 0 1px;padding:0 0 5px;scrollbar-width:none}.category-strip::-webkit-scrollbar{display:none}.category-chip{display:flex;align-items:center;gap:6px;flex:none;padding:5px 8px;border:1px solid #303a32;border-radius:4px;background:#1a211c;color:#aeb9af;font-size:9px;text-transform:capitalize;white-space:nowrap;cursor:pointer}.category-chip:hover{border-color:#526553;color:#dce5dd}.category-chip.active{border-color:#607f61;background:#263428;color:#cae0ca}.category-chip span,.recipe-group-heading>span:last-child{color:#7e8d80;font:8px 'DM Mono',monospace}.recipe-group{margin-bottom:4px}.recipe-group-heading{display:flex;align-items:center;justify-content:space-between;padding:8px 4px 5px;color:#a6b2a7;font:8px 'DM Mono',monospace;letter-spacing:.09em;text-transform:uppercase}.drag-preview{z-index:3;opacity:.86;border-style:dashed;border-color:#8fbc91;box-shadow:0 0 0 2px #80b58730,0 8px 26px #0005;pointer-events:none}.drag-preview .machine-head{background:#263328}.drop-hint{margin:0;color:#8fa491;font-size:10px}.tree-expand{flex:none;padding:4px 6px;border:1px solid #3a4a3c;border-radius:4px;background:#202b22;color:#a8c8aa;font:8px 'DM Sans',sans-serif;cursor:pointer}.tree-expand:hover{border-color:#668469;background:#27372a}.tree-expand+.tree-count{margin-left:0}.catalog-item{cursor:grab}.catalog-item:active{cursor:grabbing}.target-panel{width:min(860px,100%);margin:0 auto;padding:28px 22px 40px;overflow:auto}.target-intro{margin:0 0 20px;color:#89968b;font-size:11px;line-height:1.6}.target-tabs{display:flex;gap:5px;border-bottom:1px solid #303a32;margin-bottom:18px}.target-tabs button{padding:10px 16px;border:1px solid transparent;border-bottom:0;border-radius:5px 5px 0 0;background:transparent;color:#93a095;font:10px 'DM Sans',sans-serif;cursor:pointer}.target-tabs button.active{border-color:#303a32;background:#1b231d;color:#c9dfca}.target-section{padding:18px;border:1px solid #2b352d;border-radius:7px;background:#171e19}.target-section-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:15px}.target-section-heading h2{margin:0;color:#e0e7e1;font-size:14px;font-weight:500}.target-list{display:flex;flex-direction:column;gap:9px}.target-card{padding:13px;border:1px solid #303a32;border-radius:6px;background:#141a16}.target-card-top{display:flex;align-items:center;gap:12px}.target-product{display:flex;align-items:center;gap:10px;flex:1;min-width:0}.target-product .item-icon{width:34px;height:34px}.target-product select,.target-recipe select{height:34px;min-width:0;border:1px solid #39463c;border-radius:4px;background:#202822;color:#d9e1da;padding:0 9px;font:10px 'DM Sans',sans-serif}.target-product select{flex:1}.target-recipe{margin:9px 0 0 44px}.target-recipe select{width:min(100%,400px)}.remove-target{flex:none;border:1px solid #3a3932;border-radius:4px;background:#211d19;color:#b7a396;padding:6px 9px;font:9px 'DM Sans',sans-serif;cursor:pointer}.remove-target:hover{border-color:#795b4a;color:#e0b99e}.target-rate{display:flex;align-items:center;gap:10px;margin:10px 0 0 44px;color:#89978b;font:9px 'DM Mono',monospace}.rate-input{width:112px;height:30px;border:1px solid #3b473d;border-radius:4px;background:#202822;color:#e3ebe4;padding:0 8px;text-align:right;font:10px 'DM Mono',monospace}.target-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}.button.primary{border-color:#59765b;background:#2c402f;color:#d5ebd6}.button.primary:hover:not(:disabled){background:#38513a}.target-help{margin:14px 0 0;color:#7f8c81;font-size:10px;line-height:1.6}.input-target-summary{margin-top:14px;border-top:1px solid #2b352d;padding-top:10px}.input-target-summary p{display:flex;justify-content:space-between;gap:16px;margin:7px 0;color:#929e94;font:9px 'DM Mono',monospace}.input-target-summary strong{color:#d6e2d7;font-weight:400}.input-target-summary .shortfall{color:#e5bd84}.target-option{display:flex;align-items:flex-start;gap:10px;padding:13px 2px;border-bottom:1px solid #29332b;color:#cbd5cc;font-size:11px}.target-option:last-child{border-bottom:0}.target-option input{accent-color:#80aa82}.target-option small{display:block;margin-top:4px;color:#839086;font-size:9px;line-height:1.5}.target-empty{padding:20px 10px;text-align:center;color:#7f8c81;font-size:10px}.add-target{padding:6px 9px;border:1px solid #354139;border-radius:4px;background:#202822;color:#b9c7ba;font:9px 'DM Sans',sans-serif;cursor:pointer}.add-target:hover{border-color:#607f61;color:#d5e7d6}.target-add-button{height:38px;flex:none;display:inline-flex;align-items:center;gap:9px;padding:0 13px 0 7px;border:1px solid #456148;border-radius:6px;background:linear-gradient(180deg,#29392c,#202c22);color:#d1e4d2;font:500 10px 'DM Sans',sans-serif;white-space:nowrap;cursor:pointer;box-shadow:inset 0 1px #ffffff0b,0 2px 8px #0002;transition:background .15s,border-color .15s,transform .15s,box-shadow .15s}.target-add-button:hover:not(:disabled){border-color:#739375;background:linear-gradient(180deg,#344a36,#26372a);box-shadow:inset 0 1px #ffffff12,0 3px 12px #0004;transform:translateY(-1px)}.target-add-button:active:not(:disabled){transform:translateY(0);box-shadow:inset 0 2px 4px #0004}.target-add-button:focus-visible{outline:2px solid #8db990;outline-offset:2px}.target-add-button:disabled{opacity:.42;cursor:default}.target-add-icon{width:23px;height:23px;display:grid;place-items:center;border:1px solid #526e55;border-radius:4px;background:#314733;color:#d5ead6;font:17px 'DM Sans',sans-serif;line-height:1}@media(max-width:1100px){.planner-layout{grid-template-columns:230px minmax(400px,1fr)}.inspector{display:none}.sidebar{padding-left:10px;padding-right:10px}}
@media(max-width:700px){.app-shell{height:auto;min-height:100vh;overflow:visible}.topbar{height:52px;padding:0 12px}.save-state{display:none}.view-tabs{height:40px;overflow-x:auto;padding:0 8px}.view-tab{padding:0 11px;white-space:nowrap}.planner-layout{display:flex;flex-direction:column;min-height:calc(100vh - 92px)}.sidebar{height:280px;flex:none;border-right:0;border-bottom:1px solid #27302b}.catalog-list{display:block}.sidebar-tip{display:none}.main-area{height:calc(100vh - 372px);min-height:480px}.table-panel,.tree-panel{padding:15px 12px}.tree-row{gap:6px;padding-right:8px}.tree-row strong{min-width:72px}.tree-detail{font-size:8px}.planner-table th,.planner-table td{padding:7px 8px}.plan-toolbar{padding:0 10px}.canvas-viewport{min-height:0}.inspector{display:flex;min-height:300px;border-left:0;border-top:1px solid #27302b}.machine-card{width:280px}.flow-line{stroke-dasharray:4 4}}
.target-entry-row{display:grid;grid-template-columns:minmax(0,1fr) 190px 30px;align-items:end;gap:14px}.target-search-control{display:flex;align-items:center;gap:11px;min-width:0}.target-search-control>.item-icon{width:36px;height:36px}.target-search-input{height:36px;min-width:0;flex:1;display:flex;align-items:center;gap:8px;padding:0 10px;border:1px solid #313c34;border-radius:5px;background:#111713;transition:border-color .15s,box-shadow .15s}.target-search-input:focus-within{border-color:#668469;box-shadow:0 0 0 2px #80b58722}.target-search-input>.search-icon{flex:none;color:#89958b;font-size:19px;line-height:1}.target-search-input input{width:100%;min-width:0;border:0;outline:0;background:transparent;color:#dbe2db;font:11px 'DM Sans',sans-serif}.target-search-input input::placeholder{color:#68756b}.target-amount{display:flex;flex-direction:column;gap:5px}.target-amount>label{color:#849187;font:8px 'DM Mono',monospace;letter-spacing:.06em;text-transform:uppercase}.target-rate-control{height:36px;display:flex;align-items:center;gap:7px;padding:0 9px;border:1px solid #313c34;border-radius:5px;background:#111713;transition:border-color .15s,box-shadow .15s}.target-rate-control:focus-within{border-color:#668469;box-shadow:0 0 0 2px #80b58722}.target-rate-control input{width:100%;min-width:0;border:0;outline:0;background:transparent;color:#e1e9e2;text-align:right;font:11px 'DM Mono',monospace;appearance:textfield}.target-rate-control input::-webkit-inner-spin-button,.target-rate-control input::-webkit-outer-spin-button{margin:0;appearance:none}.target-rate-control>span{flex:none;color:#778579;font:8px 'DM Mono',monospace;white-space:nowrap}.target-entry-row>.remove-target{height:36px}.target-rate .target-rate-control{margin-left:auto}.target-rate .target-rate-control input{width:84px}.target-rate-control input:focus-visible,.target-search-input input:focus-visible{outline:none}@media(max-width:700px){.target-entry-row{grid-template-columns:minmax(0,1fr) 32px;gap:10px}.target-search-control{grid-column:1/-1}.target-amount{grid-column:1}.target-entry-row>.remove-target{grid-column:2;grid-row:2;align-self:end}.target-rate{margin-left:0}.target-section{padding:14px}.target-section-heading{align-items:flex-start}.target-add-button{height:35px;padding-right:8px}.target-add-button>span:last-child{font-size:9px}}
.prices-placeholder{min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px;text-align:center}.prices-mark{width:54px;height:54px;display:grid;place-items:center;margin-bottom:18px;border:1px solid #405443;border-radius:12px;background:#1d2920;color:#acd0ae;font:26px 'DM Mono',monospace}.prices-placeholder .eyebrow{margin-bottom:7px}.prices-placeholder h2{margin:0 0 8px;color:#dfe7df;font-size:17px;font-weight:500}.prices-placeholder>p:last-child{max-width:340px;margin:0;color:#87948a;font-size:11px;line-height:1.6}
.prices-page{min-height:100%;padding:20px 22px}.prices-page .table-intro{margin-bottom:8px}.prices-note{max-width:740px;margin:0 0 15px;color:#849187;font-size:10px;line-height:1.6}.prices-note a{margin-left:4px;color:#9fc6a2;text-decoration:none}.prices-note a:hover{text-decoration:underline}.prices-controls{display:flex;align-items:center;gap:10px;margin-bottom:14px}.prices-controls .view-search{flex:1;margin:0}.prices-status{padding:28px!important;text-align:center!important}.prices-page .planner-table td:nth-child(2){color:#98ad9b;text-align:left;font-family:'DM Mono',monospace}.prices-page .planner-table td:nth-child(3),.prices-page .planner-table td:nth-child(4){font-family:'DM Mono',monospace}.prices-page .planner-table tbody tr th[scope=row]{text-align:left}@media(max-width:700px){.prices-page{padding:15px 12px}.prices-controls{align-items:stretch}.prices-controls .button{padding:6px 8px;font-size:9px}.prices-page .planner-table th,.prices-page .planner-table td{padding:7px 6px}}
.density-control{display:flex;align-items:center;gap:6px;color:#8b988d;font:8px 'DM Mono',monospace;white-space:nowrap}.density-control input{width:38px;height:16px;margin:0;accent-color:#80b587;cursor:pointer}.source-card{position:absolute;width:220px;min-height:86px;padding:9px 11px;z-index:1;border:1px solid #806b48;border-radius:6px;background:#25231c;box-shadow:0 6px 20px #0004;color:#ded6c2}.source-card>header{display:flex;align-items:center;gap:6px;margin-bottom:9px;color:#c4a970;font:8px 'DM Mono',monospace;letter-spacing:.09em}.source-mark{display:grid;place-items:center;width:16px;height:16px;border:1px solid #806b48;border-radius:4px;font-size:11px}.source-port-row{position:relative;display:flex;align-items:center;gap:7px;min-height:24px}.source-item-name{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#e6ddc8;font-size:11px;text-transform:capitalize}.source-port-row strong{color:#ddc17d;font:10px 'DM Mono',monospace}.source-card>small{display:block;margin-top:4px;color:#9a8d6c;font:7px 'DM Mono',monospace;letter-spacing:.08em}.source-card .output-port{right:-16px}.machine-card.compact{width:260px;min-height:0}.machine-card.compact .machine-head{height:27px}.machine-card.compact .machine-body{display:none}.compact-body{padding:7px 10px 9px}.compact-input{position:relative;min-height:22px;display:flex;align-items:center;padding:2px 0 2px 2px;border-bottom:1px solid #28312a;color:#b9c6ba;font-size:9px}.compact-input>span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.compact-input .input-port{left:-15px;top:7px}.compact-output{position:relative;display:flex;align-items:center;min-height:25px;padding:4px 0 0;border-top:1px solid #39473a;color:#c9dfca;font-size:10px}.compact-output strong{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}.compact-output-rate{flex:none;margin-left:8px;color:#8eae91;font:8px 'DM Mono',monospace;text-align:right;white-space:nowrap}.compact-output .output-port{right:-15px;top:9px}.machine-card.compact .delete-node{font-size:15px}.machine-card.compact .station-tag{font-size:8px}@media(max-width:700px){.toolbar-actions{gap:8px}.density-control{gap:3px;font-size:7px}.density-control input{width:30px}}
.flow-panel{position:absolute;width:250px;z-index:1;overflow:visible;border:1px solid #806b48;border-radius:6px;background:#25231c;box-shadow:0 6px 20px #0004;color:#e6ddc8}.flow-panel>header{height:31px;display:flex;align-items:center;gap:7px;padding:0 10px;border-bottom:1px solid #4b4029;color:#d2b770;font:9px 'DM Mono',monospace;letter-spacing:.1em}.flow-panel-mark{width:17px;height:17px;display:grid;place-items:center;border:1px solid #806b48;border-radius:4px;font:12px 'DM Mono',monospace}.flow-panel-row{position:relative;height:29px;display:grid;grid-template-columns:minmax(0,1fr) 54px 42px;align-items:center;gap:5px;padding:0 9px;border-bottom:1px solid #403a2c}.flow-panel-row:last-child{border-bottom:0}.flow-panel-name{overflow:hidden;color:#ded6c2;text-overflow:ellipsis;white-space:nowrap;font-size:9px}.flow-panel-row>small{color:#a99a72;text-align:right;font:8px 'DM Mono',monospace;white-space:nowrap}.flow-panel-row>strong{color:#ddc17d;text-align:right;font:9px 'DM Mono',monospace;white-space:nowrap}.flow-panel-port.right-port{right:-15px;top:10px;border-color:#dfc783}.flow-panel-port.left-port{left:-15px;top:10px;border-color:#dfc783}.input-panel .flow-panel-mark{color:#e2c57b}.output-panel .flow-panel-mark{color:#9fcda1;border-color:#6a8d6b}.output-panel{border-color:#526e54}.output-panel>header{border-color:#344a35;color:#add2af}.output-panel .flow-panel-row>strong{color:#b7d8b8}
.output-copy{min-width:0;flex:1;display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-left:auto}.output-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#93ae95;font-size:10px;font-weight:600;text-transform:capitalize}.node-profit{flex:none;color:#d2bd87;font:8px 'DM Mono',monospace;white-space:nowrap}.profit-positive{color:#9fd1a2!important}.profit-negative{color:#e2a092!important}.compact-output{gap:6px;min-height:36px}.compact-output strong{font-weight:600}.compact-output-meta{flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:3px}.compact-output-meta small{font:7px 'DM Mono',monospace;white-space:nowrap}.compact-output .output-port{top:14px}.total-profit-card{display:flex;flex-direction:column;gap:7px;margin:-8px 0 19px;padding:12px;border:1px solid #3a503c;border-radius:5px;background:linear-gradient(135deg,#202c22,#1b241d)}.total-profit-card>span{color:#91a493;font:8px 'DM Mono',monospace;letter-spacing:.08em}.total-profit-card>strong{font:19px 'DM Mono',monospace;color:#dbe6dc}.total-profit-card>small{color:#849187;font-size:9px}.optimizer-section{padding-top:2px}.optimizer-mark{color:#a9d2ab;background:#253329}.optimizer-note,.optimizer-footnote{margin:0 0 8px;color:#879489;font-size:9px;line-height:1.5}.opportunity-list{display:flex;flex-direction:column;gap:7px}.opportunity-card{padding:8px;border:1px solid #303d32;border-radius:5px;background:#1b241d}.opportunity-top{display:flex;align-items:center;justify-content:space-between;gap:7px}.opportunity-top strong{min-width:0;overflow:hidden;color:#dce5dd;font-size:10px;text-overflow:ellipsis;white-space:nowrap;font-weight:600}.opportunity-top b{flex:none;color:#9fd1a2;font:8px 'DM Mono',monospace;white-space:nowrap}.opportunity-card>small{display:block;overflow:hidden;margin-top:4px;color:#859286;font-size:8px;text-overflow:ellipsis;white-space:nowrap}.optimizer-build{margin-top:7px;padding:4px 7px;border:1px solid #405743;border-radius:4px;background:#233126;color:#b9dabb;font:8px 'DM Sans',sans-serif;cursor:pointer}.optimizer-build:hover{border-color:#739375;background:#2b3c2e}.optimizer-footnote{margin:8px 0 0;color:#69776c;font-size:8px}
/* Market economics and recipe optimizer */
.economics-section,.price-optimizer{margin:18px 0 24px;padding:16px;border:1px solid #2c382f;border-radius:7px;background:linear-gradient(145deg,#171f19,#141a16)}.economics-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-bottom:13px}.economics-heading .eyebrow{margin-bottom:4px}.economics-heading h3{margin:0;color:#dce6dd;font-size:14px;font-weight:600}.economics-heading>span{color:#829085;font:8px 'DM Mono',monospace;white-space:nowrap}.economics-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.economics-card{min-width:0;display:flex;flex-direction:column;gap:7px;padding:12px;border:1px solid #303b32;border-radius:5px;background:#1a231c}.economics-card>span{color:#8b9b8e;font:8px 'DM Mono',monospace;letter-spacing:.06em}.economics-card>strong{overflow:hidden;color:#d9e3da;font:17px 'DM Mono',monospace;text-overflow:ellipsis;white-space:nowrap}.economics-card>small{color:#7f8c81;font-size:9px;line-height:1.4}.economics-card.net-card{border-color:#405541;background:#1d2a20}.economics-columns{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:15px}.economics-list{min-width:0}.economics-list h4{margin:0 0 7px;color:#a8b8aa;font-size:10px;font-weight:500}.economics-row{display:grid;grid-template-columns:minmax(75px,1fr) auto auto;align-items:center;gap:10px;padding:7px 0;border-top:1px solid #273129;font-size:9px}.economics-row>span{overflow:hidden;color:#d0d9d1;text-overflow:ellipsis;white-space:nowrap}.economics-row>small{color:#849186;font:8px 'DM Mono',monospace;white-space:nowrap}.economics-row>strong{color:#b8c9ba;font:8px 'DM Mono',monospace;white-space:nowrap}.economics-empty{margin:8px 0;color:#758277;font-size:9px}.economics-disclaimer{margin:13px 0 0;color:#718074;font-size:8px;line-height:1.5}.price-optimizer{padding-bottom:12px}.price-optimizer>.prices-note{margin-top:-4px}.optimizer-search{max-width:440px;margin-bottom:10px}.optimizer-table-scroll{max-height:540px;overflow:auto}.optimizer-table{min-width:900px}.optimizer-table td{vertical-align:top}.optimizer-table th{position:sticky;top:0;z-index:1;background:#1b231d}.optimizer-table td:nth-child(n+3):nth-child(-n+7){font:9px 'DM Mono',monospace;white-space:nowrap}.optimizer-table .loss-row{background:#251c1b}.optimizer-product{color:#dce6dd;font-size:10px;font-weight:600}.optimizer-building{display:block;margin-top:4px;color:#859287;font-size:8px;text-transform:capitalize}.optimizer-details{margin-top:5px;color:#91a092;font-size:8px}.optimizer-details summary{cursor:pointer;white-space:nowrap}.optimizer-details summary:hover{color:#c2d4c3}.optimizer-input-detail{display:flex;justify-content:space-between;gap:14px;padding:5px 7px;border-top:1px solid #303a32;color:#9aa79c;font:8px 'DM Sans',sans-serif}.optimizer-input-detail b{flex:none;color:#b6c5b7;font:8px 'DM Mono',monospace}.optimizer-table .optimizer-build{margin:0;white-space:nowrap}.optimizer-footnote{margin:10px 0 0;color:#758277;font-size:8px;line-height:1.5}.prices-controls{margin-top:18px;padding-top:12px;border-top:1px solid #29332b}@media(max-width:700px){.economics-section,.price-optimizer{padding:12px}.economics-heading{align-items:flex-start;flex-direction:column}.economics-cards{grid-template-columns:1fr}.economics-columns{grid-template-columns:1fr}.economics-row{grid-template-columns:minmax(65px,1fr) auto auto;gap:6px}.economics-row>small,.economics-row>strong{font-size:7px}}
.optimizer-table{min-width:1020px}.optimizer-table td{vertical-align:top}.optimizer-table td:nth-child(n+3):nth-child(-n+8){font:9px 'DM Mono',monospace;white-space:nowrap}.liquidity-high{color:#e2a092!important}.liquidity-watch{color:#e0c17e!important}.economics-rate,.liquidity-note{display:block;margin-top:3px;color:#849186;font:8px 'DM Mono',monospace}.market-table-scroll{overflow:auto}.market-table{min-width:1250px}.market-table td:nth-child(2),.market-table td:nth-child(3),.market-table td:nth-child(6),.market-table td:nth-child(8){font:9px 'DM Mono',monospace;white-space:nowrap}.price-sparkline{width:74px;height:20px;overflow:visible}.price-sparkline polyline{fill:none;stroke:#9fcda1;stroke-width:2;vector-effect:non-scaling-stroke}.history-pending{color:#728075;font:8px 'DM Mono',monospace}.price-override-input{width:90px;height:28px;border:1px solid #354139;border-radius:4px;background:#111713;color:#dbe2db;padding:0 6px;font:9px 'DM Mono',monospace}.price-override-input::placeholder{color:#617064}.price-reset{border:1px solid #435244;border-radius:4px;background:#202a22;color:#a8c8aa;padding:4px 7px;font:8px 'DM Sans',sans-serif;cursor:pointer}.price-reset:hover{border-color:#719174;color:#d2e6d2}
.market-freshness{display:flex;flex-direction:column;gap:4px;text-align:right;color:#7d8b7f;font:8px 'DM Mono',monospace}.market-freshness small{font-size:7px}.market-refresh-failed{color:#e2a092}
.prices-data-view,.prices-page *{scrollbar-width:thin;scrollbar-color:#526553 #171d19}.prices-data-view::-webkit-scrollbar,.prices-page *::-webkit-scrollbar{width:8px;height:8px}.prices-data-view::-webkit-scrollbar-track,.prices-page *::-webkit-scrollbar-track{border-radius:6px;background:#171d19}.prices-data-view::-webkit-scrollbar-thumb,.prices-page *::-webkit-scrollbar-thumb{border:2px solid #171d19;border-radius:6px;background:#526553}.prices-data-view::-webkit-scrollbar-thumb:hover,.prices-page *::-webkit-scrollbar-thumb:hover{background:#769276}
.item-icon img{width:100%;height:100%;object-fit:contain}.machine-thumbnail{width:25px;height:25px;flex:none;object-fit:contain}.building-thumbnail{width:38px;height:38px;vertical-align:middle;object-fit:contain;margin-right:10px}
.machine-card{background:linear-gradient(100deg,color-mix(in srgb,var(--station-accent) 8%,#1a211c),#1a211c 78%);border-color:color-mix(in srgb,var(--station-accent) 42%,#3a463c)}
.machine-card:hover{border-color:color-mix(in srgb,var(--station-accent) 72%,#556651)}
.machine-card .machine-head{background:color-mix(in srgb,var(--station-accent) 17%,#202821);box-shadow:inset 0 3px var(--station-accent)}
.machine-card .station-tag{color:color-mix(in srgb,var(--station-accent) 70%,#dce3dd)}
.machine-card.selected{border-color:#89bd8d;box-shadow:0 0 0 2px #80b58755,0 8px 26px #0005}
.category-chip.factory-chip::before{content:'';width:6px;height:6px;flex:none;border-radius:50%;background:var(--station-accent)}
.category-chip.factory-chip.active{border-color:color-mix(in srgb,var(--station-accent) 52%,#607f61);background:color-mix(in srgb,var(--station-accent) 14%,#263428)}
.recipe-group-heading{border-left:2px solid var(--station-accent);padding-left:7px}
.recipe-group-heading>span:first-child{color:color-mix(in srgb,var(--station-accent) 62%,#dce3dd)}
.machine-card.drag-preview{border-color:var(--station-accent)}
.plan-title{display:flex;align-items:center;min-width:0;gap:8px}.history-toolbar-button{display:inline-flex;align-items:center;gap:6px;margin-left:13px;padding:6px 10px;border:1px solid #527458;border-radius:5px;background:linear-gradient(180deg,#2d4432,#203427);color:#d7ebd9;font:10px 'DM Sans',sans-serif;cursor:pointer;white-space:nowrap}.history-toolbar-button:hover,.history-toolbar-button.active{border-color:#91c598;background:#35513a;color:#f1fff1}.history-toolbar-button span{font-size:12px;color:#a5d3aa}.history-toolbar-button:focus-visible{outline:2px solid #abddb1;outline-offset:2px}
@media(max-width:700px){.main-area.history-main{height:auto;min-height:0}.main-area.history-main .prices-data-view{overflow:visible;flex:none}}
.item-icon{--icon-size:26px}.target-product .item-icon{--icon-size:34px}.table-item-icon{--icon-size:22px}.resource-icon{--icon-size:26px}
.flow-panel-name{display:flex;align-items:center;gap:5px}.flow-panel-name .game-item-icon{--icon-size:18px}
.compact-input .game-item-icon,.compact-output .game-item-icon,.node-input .game-item-icon,.node-output .game-item-icon{--icon-size:18px;margin-right:5px}
.machine-body h2 .game-item-icon{--icon-size:26px;margin-right:7px}.optimizer-product .game-item-icon{--icon-size:22px;margin-right:6px}
.economics-row .game-item-icon,.optimizer-input-detail .game-item-icon{--icon-size:20px;margin-right:6px}
.building-product{display:inline-flex;align-items:center;gap:4px;margin:2px 8px 2px 0;white-space:nowrap}.building-product .game-item-icon{--icon-size:18px}
</style>
