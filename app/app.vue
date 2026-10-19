<script setup lang="ts">
type Ingredient = { item_id: string; name: string; quantity: number }
type Recipe = { id: string; label: string; station: string; batch: number; rate: number; product_id: string; product: string; ingredients: Ingredient[] }
type MachineNode = { id: string; recipeId: string; x: number; y: number; machines: number }
type Connection = { key: string; from: MachineNode; to: MachineNode; ingredient: Ingredient; produced: number }
type PlannerView = 'network' | 'tree' | 'items' | 'buildings'
type TreeRow = { key: string; depth: number; kind: 'product' | 'ingredient'; name: string; detail: string; machines?: number; external?: boolean }
type ItemBalance = { id: string; name: string; produced: number; required: number; connected: number; external: number; surplus: number }
type BuildingSummary = { id: string; name: string; recipeCount: number; machines: number; products: string[] }
type RecipeGroup = { id: string; name: string; recipes: Recipe[] }
type PortPoint = { x: number; y: number }
const recipes = ref<Recipe[]>([])
const metadata = ref<{ recipeCount: number; itemCount: number; retrievedAt: string } | null>(null)
const search = ref('')
const selectedCategory = ref('all')
const viewSearch = ref('')
const activeView = ref<PlannerView>('network')
const plannerTabs: [PlannerView, string][] = [['network', 'Network Graph'], ['tree', 'Tree List'], ['items', 'Items'], ['buildings', 'Buildings']]
const nodes = ref<MachineNode[]>([])
const connections = ref<Record<string, string>>({})
const activeInput = ref('')
const canvas = ref<HTMLElement | null>(null)
const canvasBoard = ref<HTMLElement | null>(null)
const portPositions = ref<Record<string, PortPoint>>({})
const portElements = new Map<string, HTMLElement>()
const movingNode = ref<{ node: MachineNode; pointerId: number; clientX: number; clientY: number; x: number; y: number } | null>(null)
const panning = ref<{ pointerId: number; clientX: number; clientY: number; scrollLeft: number; scrollTop: number } | null>(null)
let saveTimer: ReturnType<typeof setTimeout> | undefined
let moveFrame = 0
const pending = ref(true)
const error = ref('')
const zoom = ref(100)
const storageKey = 'capitalrift-factory-plan-v1'
const GRID = 24
const TREE_GAP = 24
const CANVAS_GROW = 2400
const EDGE_BUFFER = 420
const canvasExtent = ref({ left: -12000, top: -3000, right: 2200, bottom: 1600 })
let extendingCanvas = false

onMounted(async () => {
  document.addEventListener('keydown', searchShortcut)
  try {
    const saved = localStorage.getItem(storageKey)
    if (saved) {
      const plan = JSON.parse(saved)
      if (Array.isArray(plan.nodes)) nodes.value = plan.nodes
      if (plan.connections && typeof plan.connections === 'object') connections.value = plan.connections
    }
  } catch { localStorage.removeItem(storageKey) }
  try {
    const [catalog, sourceInfo] = await Promise.all([
      $fetch<Recipe[]>('/api/recipes'),
      $fetch<typeof metadata.value>('/api/meta')
    ])
    recipes.value = catalog
    metadata.value = sourceInfo
    nodes.value = nodes.value.filter(node => catalog.some(recipe => recipe.id === node.recipeId))
    await nextTick()
    centerCanvas()
  } catch { error.value = 'Could not load the recipe catalogue. Refresh to try again.' }
  finally { pending.value = false }
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', searchShortcut)
  if (saveTimer) clearTimeout(saveTimer)
  if (moveFrame) cancelAnimationFrame(moveFrame)
})
onUpdated(updatePortPositions)
function searchShortcut(event: KeyboardEvent) {
  if (event.key === '/' && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
    event.preventDefault()
    document.querySelector<HTMLInputElement>('.search-box input')?.focus()
  }
}

watch([nodes, connections], () => {
  if (import.meta.client) {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => localStorage.setItem(storageKey, JSON.stringify({ nodes: nodes.value, connections: connections.value })), 250)
  }
}, { deep: true })

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
function recipeFor(node: MachineNode) { return recipes.value.find(recipe => recipe.id === node.recipeId) }
function inputKey(nodeId: string, itemId: string) { return `${nodeId}:${itemId}` }
function providersFor(consumer: MachineNode, itemId: string) {
  return nodes.value.filter(node => node.id !== consumer.id && recipeFor(node)?.product_id === itemId && !wouldCreateCycle(consumer.id, node.id))
}
function wouldCreateCycle(consumerId: string, providerId: string) {
  const pending = [consumerId]
  const visited = new Set<string>()
  while (pending.length) {
    const current = pending.pop()!
    if (current === providerId) return true
    if (visited.has(current)) continue
    visited.add(current)
    for (const [key, sourceId] of Object.entries(connections.value)) {
      if (sourceId === current) pending.push(key.slice(0, key.lastIndexOf(':')))
    }
  }
  return false
}
function addRecipe(recipe: Recipe) {
  const index = nodes.value.length
  nodes.value.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, recipeId: recipe.id, x: 48 + (index % 4) * 350, y: 48 + Math.floor(index / 4) * 600, machines: 1 })
}
function machineCardHeight(recipe: Recipe) { return 250 + recipe.ingredients.length * 29 }
function estimateBranchHeight(recipe: Recipe, path = new Set<string>()): number {
  const ownHeight = machineCardHeight(recipe)
  if (path.has(recipe.product_id)) return ownHeight
  const nextPath = new Set(path).add(recipe.product_id)
  const children = recipe.ingredients
    .map(ingredient => recipes.value.find(candidate => candidate.product_id === ingredient.item_id && candidate.rate > 0))
    .filter((candidate): candidate is Recipe => !!candidate)
  const childrenHeight = children.reduce((sum, child) => sum + estimateBranchHeight(child, nextPath), 0) + Math.max(0, children.length - 1) * TREE_GAP
  return Math.max(ownHeight, childrenHeight)
}
function removeNode(nodeId: string) {
  nodes.value = nodes.value.filter(node => node.id !== nodeId)
  for (const [key, value] of Object.entries(connections.value)) {
    if (key.startsWith(`${nodeId}:`) || value === nodeId) delete connections.value[key]
  }
}
function canExpandChain(node: MachineNode) {
  return recipeFor(node)?.ingredients.some(ingredient => recipes.value.some(recipe => recipe.product_id === ingredient.item_id && recipe.rate > 0)) ?? false
}
function setPortElement(key: string, element: unknown) {
  if (import.meta.client && element instanceof HTMLElement) portElements.set(key, element)
  else portElements.delete(key)
}
function updatePortPositions() {
  const board = canvasBoard.value
  if (!board) return
  const boardRect = board.getBoundingClientRect()
  if (!boardRect.width || !boardRect.height) return
  const scale = zoom.value / 100
  const positions: Record<string, PortPoint> = {}
  for (const [key, element] of portElements) {
    if (!element.isConnected) continue
    const rect = element.getBoundingClientRect()
    positions[key] = {
      x: boardBounds.value.left + (rect.left + rect.width / 2 - boardRect.left) / scale,
      y: boardBounds.value.top + (rect.top + rect.height / 2 - boardRect.top) / scale
    }
  }
  const old = portPositions.value
  const changed = Object.keys(positions).length !== Object.keys(old).length || Object.keys(positions).some(key => !old[key] || Math.abs(old[key].x - positions[key].x) > 0.5 || Math.abs(old[key].y - positions[key].y) > 0.5)
  if (changed) portPositions.value = positions
}
function startNodeMove(event: PointerEvent, node: MachineNode) {
  if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return
  movingNode.value = { node, pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, x: node.x, y: node.y }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}
function moveNode(event: PointerEvent) {
  const move = movingNode.value
  if (!move || move.pointerId !== event.pointerId) return
  if (moveFrame) cancelAnimationFrame(moveFrame)
  moveFrame = requestAnimationFrame(() => {
    const scale = zoom.value / 100
    move.node.x = move.x + (event.clientX - move.clientX) / scale
    move.node.y = move.y + (event.clientY - move.clientY) / scale
  })
}
function finishNodeMove(event: PointerEvent) {
  const move = movingNode.value
  if (!move || move.pointerId !== event.pointerId) return
  if (moveFrame) cancelAnimationFrame(moveFrame)
  moveFrame = 0
  move.node.x = Math.round(move.node.x / GRID) * GRID
  move.node.y = Math.round(move.node.y / GRID) * GRID
  movingNode.value = null
}
function startPan(event: PointerEvent) {
  if (event.button !== 0 || (event.target as HTMLElement).closest('.machine-card') || !canvas.value) return
  panning.value = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, scrollLeft: canvas.value.scrollLeft, scrollTop: canvas.value.scrollTop }
  canvas.value.classList.add('is-panning')
  canvas.value.setPointerCapture(event.pointerId)
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
function connectedDemand(producerId: string) {
  const producer = nodes.value.find(node => node.id === producerId)
  const producerRecipe = producer && recipeFor(producer)
  if (!producerRecipe) return 0
  let demand = 0
  for (const consumer of nodes.value) {
    const recipe = recipeFor(consumer)
    if (!recipe) continue
    for (const ingredient of recipe.ingredients) {
      if (connections.value[inputKey(consumer.id, ingredient.item_id)] === producerId && producerRecipe.product_id === ingredient.item_id) {
        demand += ingredient.quantity * recipe.rate / recipe.batch * consumer.machines
      }
    }
  }
  return demand
}
function machinesForDemand(demand: number, rate: number) {
  return Math.max(1, Math.ceil((demand - 1e-9) / rate))
}
function synchronizeUpstream(start: MachineNode) {
  const visited = new Set<string>()
  const postOrder: MachineNode[] = []
  function visit(consumer: MachineNode) {
    if (visited.has(consumer.id)) return
    visited.add(consumer.id)
    for (const ingredient of recipeFor(consumer)?.ingredients ?? []) {
      const provider = nodes.value.find(node => node.id === connections.value[inputKey(consumer.id, ingredient.item_id)] && recipeFor(node)?.product_id === ingredient.item_id)
      if (provider) visit(provider)
    }
    postOrder.push(consumer)
  }
  visit(start)
  for (const producer of postOrder.reverse()) {
    if (producer.id === start.id) continue
    const recipe = recipeFor(producer)
    if (recipe?.rate) producer.machines = machinesForDemand(connectedDemand(producer.id), recipe.rate)
  }
}
function expandChain(root: MachineNode) {
  function expand(parent: MachineNode, path = new Set<string>()) {
    const recipe = recipeFor(parent)
    if (!recipe || path.has(recipe.product_id)) return
    const nextPath = new Set(path).add(recipe.product_id)
    const needs = recipe.ingredients.map(ingredient => {
      const demand = ingredient.quantity * recipe.rate / recipe.batch * parent.machines
      const key = inputKey(parent.id, ingredient.item_id)
      let producer = nodes.value.find(node => node.id === connections.value[key])
      let producerRecipe = producer && recipeFor(producer)
      if (!producerRecipe || producerRecipe.product_id !== ingredient.item_id || producerRecipe.rate <= 0) {
        if (producer) delete connections.value[key]
        producer = undefined
        producerRecipe = undefined
      }
      const candidate = producerRecipe ?? recipes.value.find(item => item.product_id === ingredient.item_id && item.rate > 0)
      return { ingredient, demand, key, producer, producerRecipe, candidate }
    })
    for (const need of needs) {
      const producer = need.producer ?? nodes.value.find(node => node.id !== parent.id && recipeFor(node)?.product_id === need.ingredient.item_id && (recipeFor(node)?.rate ?? 0) > 0 && !wouldCreateCycle(parent.id, node.id))
      const producerRecipe = producer && recipeFor(producer)
      if (producer && producerRecipe) {
        connections.value[need.key] = producer.id
        need.producer = producer
        need.producerRecipe = producerRecipe
        producer.machines = Math.max(producer.machines, machinesForDemand(connectedDemand(producer.id), producerRecipe.rate))
        expand(producer, nextPath)
      }
    }
    const newNeeds = needs.filter(need => !need.producer && need.candidate)
    const branchHeights = newNeeds.map(need => estimateBranchHeight(need.candidate!, nextPath))
    const stackHeight = branchHeights.reduce((sum, height) => sum + height, 0) + Math.max(0, branchHeights.length - 1) * TREE_GAP
    let cursorY = parent.y + machineCardHeight(recipe) / 2 - stackHeight / 2
    newNeeds.forEach((need, index) => {
      const candidate = need.candidate!
      const branchHeight = branchHeights[index]
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
}
function setConnection(key: string, providerId: string) {
  if (providerId) connections.value[key] = providerId
  else delete connections.value[key]
  activeInput.value = ''
}
function setMachineCount(node: MachineNode, value: string | number) {
  node.machines = Math.max(1, Math.min(999, Math.floor(Number(value) || 1)))
  synchronizeUpstream(node)
}
function amount(value: number) {
  return Math.abs(value) > 0 && Math.abs(value) < 0.01
    ? value.toLocaleString(undefined, { maximumSignificantDigits: 3 })
    : value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

const network = computed(() => {
  const remaining = new Map<string, number>()
  const external = new Map<string, { name: string; amount: number }>()
  const connectionRows: Connection[] = []
  const machineTotal = nodes.value.reduce((sum, node) => sum + node.machines, 0)

  for (const node of nodes.value) {
    const recipe = recipeFor(node)
    if (!recipe) continue
    const output = recipe.rate * node.machines
    remaining.set(node.id, output)
  }

  for (const node of nodes.value) {
    const recipe = recipeFor(node)
    if (!recipe) continue
    for (const ingredient of recipe.ingredients) {
      const demand = ingredient.quantity * recipe.rate / recipe.batch * node.machines
      const key = inputKey(node.id, ingredient.item_id)
      const provider = nodes.value.find(candidate => candidate.id === connections.value[key] && recipeFor(candidate)?.product_id === ingredient.item_id)
      let supplied = 0
      if (provider) {
        supplied = Math.min(demand, remaining.get(provider.id) ?? 0)
        remaining.set(provider.id, Math.max(0, (remaining.get(provider.id) ?? 0) - supplied))
        connectionRows.push({ key, from: provider, to: node, ingredient, produced: supplied })
      }
      if (demand - supplied > 0.000001) {
        const missing = external.get(ingredient.item_id) ?? { name: ingredient.name, amount: 0 }
        missing.amount += demand - supplied
        external.set(ingredient.item_id, missing)
      }
    }
  }

  const surplus = new Map<string, { name: string; amount: number }>()
  for (const node of nodes.value) {
    const leftover = remaining.get(node.id) ?? 0
    const recipe = recipeFor(node)
    if (leftover > 0.000001 && recipe) {
      const item = surplus.get(recipe.product_id) ?? { name: recipe.product, amount: 0 }
      item.amount += leftover
      surplus.set(recipe.product_id, item)
    }
  }
  return {
    machineTotal,
    external: [...external.entries()].map(([id, item]) => ({ id, ...item })).sort((a, b) => a.name.localeCompare(b.name)),
    surplus: [...surplus.entries()].map(([id, item]) => ({ id, ...item })).sort((a, b) => a.name.localeCompare(b.name)),
    connectionRows
  }
})

const viewTitle = computed(() => ({ network: 'Network Graph', tree: 'Tree List', items: 'Items', buildings: 'Buildings' })[activeView.value])
const treeRows = computed<TreeRow[]>(() => {
  const suppliedNodes = new Set(Object.values(connections.value))
  const roots = nodes.value.filter(node => !suppliedNodes.has(node.id))
  const rows: TreeRow[] = []
  function visit(node: MachineNode, depth: number, path: Set<string>) {
    const recipe = recipeFor(node)
    if (!recipe) return
    const nodeRate = recipe.rate * node.machines
    rows.push({ key: `node:${node.id}:${depth}`, depth, kind: 'product', name: recipe.product, detail: `${recipe.station.replaceAll('_', ' ')} · ${amount(nodeRate)} / min`, machines: node.machines })
    if (path.has(node.id)) return
    const nextPath = new Set(path).add(node.id)
    for (const ingredient of recipe.ingredients) {
      const rate = ingredient.quantity * recipe.rate / recipe.batch * node.machines
      const supplier = nodes.value.find(candidate => candidate.id === connections.value[inputKey(node.id, ingredient.item_id)] && recipeFor(candidate)?.product_id === ingredient.item_id)
      const supplied = supplier ? network.value.connectionRows.find(link => link.to.id === node.id && link.ingredient.item_id === ingredient.item_id)?.produced ?? 0 : 0
      rows.push({ key: `input:${node.id}:${ingredient.item_id}:${depth}`, depth: depth + 1, kind: 'ingredient', name: ingredient.name, detail: `${amount(supplied)} / ${amount(rate)} per min${supplier ? ' · connected' : ' · external supply'}`, external: !supplier })
      if (supplier && !nextPath.has(supplier.id)) visit(supplier, depth + 2, nextPath)
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
    if (!building.products.includes(recipe.product)) building.products.push(recipe.product)
  }
  for (const node of nodes.value) {
    const recipe = recipeFor(node)
    if (recipe) summaries.get(recipe.station)!.machines += node.machines
  }
  const needle = viewSearch.value.trim().toLowerCase()
  return [...summaries.values()].filter(building => !needle || `${building.name} ${building.products.join(' ')}`.toLowerCase().includes(needle)).sort((a, b) => a.name.localeCompare(b.name))
})

const boardBounds = computed(() => ({
  left: Math.min(canvasExtent.value.left, ...nodes.value.map(node => node.x - 80)),
  top: Math.min(canvasExtent.value.top, ...nodes.value.map(node => node.y - 80)),
  right: Math.max(canvasExtent.value.right, ...nodes.value.map(node => node.x + 420)),
  bottom: Math.max(canvasExtent.value.bottom, ...nodes.value.map(node => node.y + 620))
}))
const boardWidth = computed(() => boardBounds.value.right - boardBounds.value.left)
const boardHeight = computed(() => boardBounds.value.bottom - boardBounds.value.top)

function centerCanvas() {
  if (!canvas.value) return
  const scale = zoom.value / 100
  if (!nodes.value.length) {
    canvas.value.scrollTo({ left: Math.max(0, -boardBounds.value.left * scale - canvas.value.clientWidth / 2), top: Math.max(0, -boardBounds.value.top * scale - canvas.value.clientHeight / 2), behavior: 'smooth' })
    return
  }
  const minX = Math.min(...nodes.value.map(node => node.x))
  const minY = Math.min(...nodes.value.map(node => node.y))
  const maxX = Math.max(...nodes.value.map(node => node.x + 300))
  const maxY = Math.max(...nodes.value.map(node => node.y + 220))
  canvas.value.scrollTo({ left: Math.max(0, ((minX + maxX) / 2 - boardBounds.value.left) * scale - canvas.value.clientWidth / 2), top: Math.max(0, ((minY + maxY) / 2 - boardBounds.value.top) * scale - canvas.value.clientHeight / 2), behavior: 'smooth' })
}
function portPosition(key: string, fallback: PortPoint) { return portPositions.value[key] ?? fallback }
function linkPath(link: Connection) {
  const start = portPosition(`output:${link.from.id}`, { x: link.from.x + 300, y: link.from.y + 128 })
  const ingredientIndex = recipeFor(link.to)?.ingredients.findIndex(item => item.item_id === link.ingredient.item_id) ?? 0
  const end = portPosition(`input:${link.key}`, { x: link.to.x, y: link.to.y + 180 + ingredientIndex * 29 })
  const direction = end.x >= start.x ? 1 : -1
  const curve = Math.max(50, Math.abs(end.x - start.x) * 0.48)
  return `M ${start.x} ${start.y} C ${start.x + direction * curve} ${start.y}, ${end.x - direction * curve} ${end.y}, ${end.x} ${end.y}`
}
</script>

<template>
  <main class="app-shell">
    <header class="topbar">
      <a class="brand" href="/" aria-label="Capital Rift Factory Planner home"><span class="brand-mark">CR</span><span>CAPITAL RIFT <small>FACTORY PLANNER</small></span></a>
      <div class="top-actions"><span class="save-state"><i /> Saved in this browser</span><button class="button subtle" :disabled="!nodes.length" @click="nodes = []; connections = {}">Clear plan</button></div>
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
          <button v-for="group in recipeGroups" :key="group.id" class="category-chip" :class="{ active: selectedCategory === group.id }" :title="group.name" @click="selectedCategory = group.id">{{ group.name }} <span>{{ group.recipes.length }}</span></button>
        </div>
        <div class="catalog-heading"><span>RECIPE CATALOGUE</span><span>{{ filteredRecipes.length }}</span></div>
        <div class="catalog-list">
          <div v-for="group in groupedRecipes" :key="group.id" class="recipe-group">
            <div class="recipe-group-heading"><span>{{ group.name }}</span><span>{{ group.recipes.length }}</span></div>
            <button v-for="recipe in group.recipes" :key="recipe.id" class="catalog-item" @click="addRecipe(recipe)">
              <span class="item-icon">{{ recipe.product.slice(0, 1).toUpperCase() }}</span>
              <span class="catalog-copy"><strong>{{ recipe.product }}</strong><small>{{ recipe.label }}</small></span>
              <span class="add-icon">+</span>
            </button>
          </div>
          <p v-if="pending" class="empty-state">Loading catalogue…</p>
          <p v-else-if="!filteredRecipes.length" class="empty-state">No matching recipes.</p>
        </div>
        <div class="sidebar-tip"><span class="tip-dot" />Click a recipe to add it. Drag machine headers to move them, or drag empty grid space to pan.</div>
      </aside>

      <section class="main-area">
        <div class="plan-toolbar">
          <div class="plan-title"><span class="crumb">FACTORY</span><span class="crumb-sep">/</span><strong>{{ viewTitle }}</strong></div>
          <div v-if="activeView === 'network'" class="toolbar-actions"><div class="zoom-controls"><button class="icon-button" :disabled="zoom <= 60" title="Zoom out" aria-label="Zoom out" @click="zoom = Math.max(60, zoom - 10)">−</button><span class="zoom-label">{{ zoom }}%</span><button class="icon-button" :disabled="zoom >= 140" title="Zoom in" aria-label="Zoom in" @click="zoom = Math.min(140, zoom + 10)">+</button></div><button class="icon-button" title="Center machines" aria-label="Center machines" @click="centerCanvas">⌖</button></div>
          <span v-else class="view-count">{{ activeView === 'tree' ? treeRows.length : activeView === 'items' ? itemBalances.length : buildingSummaries.length }} {{ activeView === 'tree' ? 'STEPS' : activeView === 'items' ? 'ITEMS' : 'BUILDINGS' }}</span>
        </div>
        <div v-show="activeView === 'network'" ref="canvas" class="canvas-viewport" :class="{ 'is-panning': panning }" @pointerdown="startPan" @pointermove="panCanvas" @pointerup="finishPan" @pointercancel="finishPan">
        <div ref="canvasBoard" class="canvas-board" :class="{ 'has-nodes': nodes.length }" :style="{ zoom: `${zoom}%`, width: `${boardWidth}px`, height: `${boardHeight}px`, backgroundPosition: `${-boardBounds.left}px ${-boardBounds.top}px` }">
            <svg class="connections" :viewBox="`${boardBounds.left} ${boardBounds.top} ${boardWidth} ${boardHeight}`" preserveAspectRatio="none" aria-label="Material flow connections">
              <g v-for="link in network.connectionRows" :key="link.key">
                <path class="flow-shadow" :d="linkPath(link)" />
                <path class="flow-line" :d="linkPath(link)" />
                <circle class="flow-dot" :cx="portPosition(`output:${link.from.id}`, { x: link.from.x + 300, y: link.from.y + 128 }).x" :cy="portPosition(`output:${link.from.id}`, { x: link.from.x + 300, y: link.from.y + 128 }).y" r="4" />
              </g>
            </svg>
            <article v-for="node in nodes" :key="node.id" class="machine-card" :style="{ left: `${node.x - boardBounds.left}px`, top: `${node.y - boardBounds.top}px` }">
              <header class="machine-head" @pointerdown.stop.prevent="startNodeMove($event, node)" @pointermove="moveNode" @pointerup="finishNodeMove" @pointercancel="finishNodeMove">
                <span class="grip" aria-hidden="true">⠿</span><span class="station-tag">{{ recipeFor(node)?.station.replaceAll('_', ' ') }}</span>
                <button class="delete-node" :aria-label="`Remove ${recipeFor(node)?.product}`" title="Remove machine" @click="removeNode(node.id)">×</button>
              </header>
              <div class="machine-body">
                <p class="node-label">PRODUCTION MACHINE</p>
                <h2>{{ recipeFor(node)?.product }}</h2>
                <div class="machine-control"><span>Machines</span><div class="stepper"><button :aria-label="`Remove one ${recipeFor(node)?.product} machine`" @click="setMachineCount(node, node.machines - 1)">−</button><input :aria-label="`${recipeFor(node)?.product} machine count`" type="number" min="1" max="999" :value="node.machines" @change="setMachineCount(node, ($event.target as HTMLInputElement).value)"><button :aria-label="`Add one ${recipeFor(node)?.product} machine`" @click="setMachineCount(node, node.machines + 1)">+</button></div></div>
                <button v-if="canExpandChain(node)" class="expand-chain" :title="`Create producer machines for ${recipeFor(node)?.product} inputs`" @pointerdown.stop @click="expandChain(node)"><span aria-hidden="true">↳</span> Expand ingredient chain</button>
                <div class="node-output"><span class="port output-port" :ref="element => setPortElement(`output:${node.id}`, element)" /><span class="port-copy"><small>OUTPUT</small><strong>{{ amount((recipeFor(node)?.rate ?? 0) * node.machines) }} <em>/ min</em></strong></span><span class="output-name">{{ recipeFor(node)?.product }}</span></div>
                <div class="input-heading"><span>INPUTS</span><span>/ MIN</span></div>
                <div v-for="ingredient in recipeFor(node)?.ingredients" :key="ingredient.item_id" class="node-input">
                  <span class="port input-port" :class="{ connected: connections[inputKey(node.id, ingredient.item_id)] }" :ref="element => setPortElement(`input:${inputKey(node.id, ingredient.item_id)}`, element)" />
                  <span class="input-name">{{ ingredient.name }}</span>
                  <strong>{{ amount(ingredient.quantity * (recipeFor(node)?.rate ?? 0) / (recipeFor(node)?.batch ?? 1) * node.machines) }}</strong>
                  <button v-if="providersFor(node, ingredient.item_id).length" class="connect-button" :class="{ linked: connections[inputKey(node.id, ingredient.item_id)] }" :title="connections[inputKey(node.id, ingredient.item_id)] ? 'Change material source' : 'Connect a producer'" @click="activeInput = activeInput === inputKey(node.id, ingredient.item_id) ? '' : inputKey(node.id, ingredient.item_id)">{{ connections[inputKey(node.id, ingredient.item_id)] ? '↔' : '○' }}</button>
                  <select v-if="activeInput === inputKey(node.id, ingredient.item_id)" class="provider-select" :value="connections[inputKey(node.id, ingredient.item_id)] ?? ''" :aria-label="`Choose source for ${ingredient.name}`" @change="setConnection(inputKey(node.id, ingredient.item_id), ($event.target as HTMLSelectElement).value)"><option value="">External supply</option><option v-for="provider in providersFor(node, ingredient.item_id)" :key="provider.id" :value="provider.id">{{ recipeFor(provider)?.product }} · {{ provider.machines }} machine{{ provider.machines === 1 ? '' : 's' }}</option></select>
                </div>
              </div>
            </article>
            <div v-if="!nodes.length" class="canvas-empty" :style="{ left: `${-boardBounds.left}px`, top: `${-boardBounds.top}px` }"><div class="empty-symbol"><span>＋</span></div><h2>Your factory starts here</h2><p>Add a recipe from the catalogue to place your first machine.</p><div class="empty-shortcuts"><kbd>Click</kbd><span>to add</span><span class="shortcut-sep">·</span><kbd>Hold + drag</kbd><span>grid to pan</span></div></div>
          </div>
        </div>
        <section v-if="activeView !== 'network'" class="data-view">
          <label v-if="activeView !== 'tree'" class="view-search"><span>⌕</span><input v-model="viewSearch" type="search" :placeholder="activeView === 'items' ? 'Search planned items' : 'Search buildings or products'"></label>
          <div v-if="activeView === 'tree'" class="tree-panel">
            <div class="table-intro"><div><p class="eyebrow">RECIPE DEPENDENCIES</p><h2>Production tree</h2></div><span>{{ nodes.length }} machines · {{ network.external.length }} raw inputs</span></div>
            <div v-if="treeRows.length" class="tree-list">
              <div v-for="row in treeRows" :key="row.key" class="tree-row" :class="[`tree-${row.kind}`, { 'is-external': row.external }]" :style="{ paddingLeft: `${14 + row.depth * 19}px` }">
                <span class="tree-marker">{{ row.kind === 'product' ? '▣' : row.external ? '○' : '↳' }}</span><strong>{{ row.name }}</strong><span class="tree-detail">{{ row.detail }}</span><span v-if="row.machines" class="tree-count">{{ row.machines }} machine{{ row.machines === 1 ? '' : 's' }}</span>
              </div>
            </div>
            <div v-else class="view-empty"><h2>No production tree yet</h2><p>Add a recipe and expand its ingredient chain to see how materials connect.</p></div>
          </div>
          <div v-else-if="activeView === 'items'" class="table-panel">
            <div class="table-intro"><div><p class="eyebrow">MATERIAL FLOW</p><h2>Item balances</h2></div><span>All rates per minute</span></div>
            <div class="table-scroll"><table class="planner-table"><thead><tr><th>Item</th><th>Produced</th><th>Required</th><th>Connected</th><th>External</th><th>Surplus</th></tr></thead><tbody>
              <tr v-for="item in itemBalances" :key="item.id"><th scope="row"><span class="table-item-icon">{{ item.name.slice(0, 1) }}</span>{{ item.name }}</th><td>{{ amount(item.produced) }}</td><td>{{ amount(item.required) }}</td><td>{{ amount(item.connected) }}</td><td :class="{ 'needs-supply': item.external > 0 }">{{ amount(item.external) }}</td><td :class="{ 'has-surplus': item.surplus > 0 }">{{ amount(item.surplus) }}</td></tr>
              <tr v-if="!itemBalances.length"><td colspan="6" class="table-empty">Add machines to see item balances.</td></tr>
            </tbody></table></div>
          </div>
          <div v-else class="table-panel">
            <div class="table-intro"><div><p class="eyebrow">PRODUCTION SITES</p><h2>Building catalogue</h2></div><span>{{ network.machineTotal }} machines in plan</span></div>
            <div class="table-scroll"><table class="planner-table"><thead><tr><th>Building</th><th>Recipes</th><th>In plan</th><th>Products made here</th></tr></thead><tbody>
              <tr v-for="building in buildingSummaries" :key="building.id"><th scope="row" class="building-name">{{ building.name }}</th><td>{{ building.recipeCount }}</td><td><span class="machine-pill">{{ building.machines }} machine{{ building.machines === 1 ? '' : 's' }}</span></td><td class="products-cell">{{ building.products.join(', ') }}</td></tr>
              <tr v-if="!buildingSummaries.length"><td colspan="4" class="table-empty">No buildings match this search.</td></tr>
            </tbody></table></div>
          </div>
        </section>
        <footer v-if="activeView === 'network'" class="canvas-footer"><span><i class="footer-dot" /> GRID SNAP ON</span><span>{{ network.connectionRows.length }} MATERIAL CONNECTION{{ network.connectionRows.length === 1 ? '' : 'S' }}</span></footer>
      </section>

      <aside class="inspector">
        <div class="inspector-top"><div><p class="eyebrow">PLAN OVERVIEW</p><h2>Network stats</h2></div></div>
        <div class="stat-grid"><div class="stat-card"><span>MACHINES</span><strong>{{ network.machineTotal }}</strong><small>across {{ nodes.length }} recipes</small></div><div class="stat-card"><span>CONNECTIONS</span><strong>{{ network.connectionRows.length }}</strong><small>material flows</small></div></div>
        <section class="summary-section"><div class="section-heading"><div><span class="section-mark import-mark">↓</span><h3>External inputs</h3></div><span class="section-count">{{ network.external.length }}</span></div>
          <div v-if="network.external.length" class="resource-list"><div v-for="item in network.external" :key="item.id" class="resource-row"><span class="resource-icon">{{ item.name.slice(0, 1) }}</span><span class="resource-name">{{ item.name }}</span><strong>{{ amount(item.amount) }} <small>/ min</small></strong></div></div>
          <p v-else class="summary-empty">Add machines to see required materials.</p>
        </section>
        <section class="summary-section surplus-section"><div class="section-heading"><div><span class="section-mark surplus-mark">↑</span><h3>Unallocated output</h3></div><span class="section-count">{{ network.surplus.length }}</span></div>
          <div v-if="network.surplus.length" class="resource-list"><div v-for="item in network.surplus" :key="item.id" class="resource-row"><span class="resource-icon">{{ item.name.slice(0, 1) }}</span><span class="resource-name">{{ item.name }}</span><strong>{{ amount(item.amount) }} <small>/ min</small></strong></div></div>
          <p v-else class="summary-empty">All production is connected.</p>
        </section>
        <div class="planner-note"><span class="note-icon">i</span><p>Connect a machine output to a matching input to balance the flow. Unconnected requirements are listed as external inputs.</p></div>
        <footer v-if="metadata" class="source-foot">{{ metadata.recipeCount }} recipes · Snapshot imported {{ new Date(metadata.retrievedAt).toLocaleDateString() }}<a href="https://github.com/mrawsky/capitalrift-tools" target="_blank" rel="noreferrer">Data source ↗</a></footer>
      </aside>
    </div>
    <div v-if="error" class="toast" role="alert">{{ error }}</div>
  </main>
</template>

<style>
@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;600;700&display=swap');
:root{font-family:'DM Sans',sans-serif;color:#e8ede9;background:#111613;font-synthesis:none;text-rendering:optimizeLegibility;font-optical-sizing:auto}*{box-sizing:border-box}body{margin:0;min-width:360px}.app-shell{height:100vh;min-height:600px;overflow:hidden;display:flex;flex-direction:column;background:#111613}.topbar{height:58px;flex:none;display:flex;align-items:center;justify-content:space-between;padding:0 21px;border-bottom:1px solid #27302b;background:#151b17}.brand{display:flex;align-items:center;gap:10px;color:#e7eee8;text-decoration:none;font-size:11px;letter-spacing:.12em;font-weight:700}.brand-mark{width:29px;height:29px;border:1px solid #536c58;border-radius:6px;display:grid;place-items:center;color:#b9d7b8;font:500 10px 'DM Mono',monospace;letter-spacing:0}.brand small{display:block;margin-top:2px;color:#7e8a80;font:9px 'DM Mono',monospace;letter-spacing:.11em}.top-actions,.toolbar-actions{display:flex;align-items:center;gap:16px}.save-state{color:#8a988d;font-size:11px;display:flex;align-items:center;gap:7px}.save-state i,.footer-dot{width:6px;height:6px;border-radius:50%;background:#76b483;display:inline-block}.button{border:1px solid #354139;background:transparent;color:#c4cec6;border-radius:5px;padding:7px 11px;font:11px 'DM Sans',sans-serif;cursor:pointer}.button:hover:not(:disabled){background:#242d27}.button:disabled{opacity:.4;cursor:default}.planner-layout{display:grid;grid-template-columns:260px minmax(440px,1fr) 285px;min-height:0;flex:1}.sidebar,.inspector{background:#171d19;min-height:0;display:flex;flex-direction:column}.sidebar{border-right:1px solid #27302b;padding:22px 14px 14px}.side-heading{display:flex;align-items:flex-start;justify-content:space-between;padding:0 5px 19px}.eyebrow{margin:0 0 6px;color:#849487;font:9px 'DM Mono',monospace;letter-spacing:.12em}.side-heading h1{font-size:18px;line-height:1.2;letter-spacing:-.03em;margin:0;font-weight:600}.node-count,.section-count{font:10px 'DM Mono',monospace;color:#9eaca0;background:#242e27;padding:4px 7px;border-radius:4px}.search-box{height:34px;display:flex;align-items:center;gap:8px;padding:0 9px;border:1px solid #313c34;background:#111713;border-radius:5px}.search-icon{font-size:19px;color:#89958b;line-height:1}.search-box input{min-width:0;flex:1;border:0;outline:none;background:transparent;color:#dbe2db;font:11px 'DM Sans',sans-serif}.search-box input::placeholder{color:#68756b}.search-box kbd,.empty-shortcuts kbd{font:9px 'DM Mono',monospace;color:#879388;border:1px solid #37423a;border-radius:3px;padding:2px 4px}.catalog-heading{display:flex;justify-content:space-between;margin:22px 5px 8px;color:#748176;font:9px 'DM Mono',monospace;letter-spacing:.1em}.catalog-heading span:last-child{color:#9eaaa0}.catalog-list{overflow:auto;min-height:0;flex:1;scrollbar-width:thin;scrollbar-color:#526553 #171d19}.catalog-list::-webkit-scrollbar{width:8px}.catalog-list::-webkit-scrollbar-track{border-radius:6px;background:#171d19}.catalog-list::-webkit-scrollbar-thumb{border:2px solid #171d19;border-radius:6px;background:#526553}.catalog-list::-webkit-scrollbar-thumb:hover{background:#769276}.catalog-item{width:100%;border:0;border-radius:5px;background:transparent;color:#dde3dd;display:flex;align-items:center;gap:9px;padding:7px 5px;text-align:left;cursor:pointer}.catalog-item:hover{background:#232c25}.item-icon,.resource-icon{width:26px;height:26px;flex:none;border:1px solid #3d4a3f;border-radius:5px;display:grid;place-items:center;background:#202a22;color:#a6c6a8;font:10px 'DM Mono',monospace}.catalog-copy{min-width:0;flex:1;display:flex;flex-direction:column;gap:3px}.catalog-copy strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;font-weight:500}.catalog-copy small{font:9px 'DM Mono',monospace;color:#7f8b81;text-transform:capitalize}.add-icon{font-size:16px;color:#79877c;opacity:0}.catalog-item:hover .add-icon{opacity:1}.empty-state{padding:14px 7px;color:#879389;font-size:11px}.sidebar-tip{border-top:1px solid #2b342d;margin-top:12px;padding:12px 5px 0;color:#849087;font-size:10px;line-height:1.5}.tip-dot{display:inline-block;width:5px;height:5px;margin:0 5px 1px 0;border-radius:50%;background:#8cac89}.main-area{min-width:0;min-height:0;display:flex;flex-direction:column;background:#101511}.plan-toolbar{height:43px;flex:none;border-bottom:1px solid #252e28;display:flex;align-items:center;justify-content:space-between;padding:0 15px}.plan-title{display:flex;align-items:center;gap:9px;font-size:11px}.crumb{font:9px 'DM Mono',monospace;color:#859186;letter-spacing:.08em}.crumb-sep{color:#4c584f}.plan-title strong{font-weight:500;color:#dbe2dc}.zoom-label{font:9px 'DM Mono',monospace;color:#859186}.icon-button,.more-button{border:1px solid #303a32;background:#1a211c;color:#b1bdb2;border-radius:4px;width:25px;height:25px;cursor:pointer}.canvas-viewport{min-height:0;flex:1;overflow:auto;scrollbar-width:none;-ms-overflow-style:none;cursor:grab;background-color:#111713}.canvas-viewport::-webkit-scrollbar{display:none}.canvas-viewport.is-panning{cursor:grabbing;user-select:none}.canvas-board{position:relative;width:2200px;height:1600px;background-image:radial-gradient(#343e35 0.75px,transparent .75px),linear-gradient(to right,rgba(48,59,50,.18) 1px,transparent 1px),linear-gradient(to bottom,rgba(48,59,50,.18) 1px,transparent 1px);background-size:24px 24px,120px 120px,120px 120px}.connections{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none}.flow-shadow{fill:none;stroke:#111613;stroke-width:6}.flow-line{fill:none;stroke:#7fb58a;stroke-width:2;stroke-dasharray:5 4;filter:drop-shadow(0 0 4px #70ac7a80)}.flow-dot{fill:#a7d5ad;stroke:#18211a;stroke-width:2}.machine-card{position:absolute;width:300px;min-height:150px;z-index:1;background:#1a211c;border:1px solid #3a463c;border-radius:7px;box-shadow:0 8px 26px #0005;color:#dce3dd}.machine-card:hover{border-color:#556651}.machine-head{height:30px;display:flex;align-items:center;gap:8px;padding:0 9px;background:#202821;border-bottom:1px solid #303a31;border-radius:6px 6px 0 0;cursor:grab;user-select:none}.machine-head:active{cursor:grabbing}.grip{color:#68766b;font-size:14px}.station-tag{font:9px 'DM Mono',monospace;text-transform:uppercase;letter-spacing:.08em;color:#9aab9b}.delete-node{margin-left:auto;border:0;background:transparent;color:#718075;font-size:18px;cursor:pointer}.delete-node:hover{color:#e3a19a}.machine-body{padding:11px 12px 10px}.node-label,.input-heading,.port-copy small{margin:0;color:#718075;font:8px 'DM Mono',monospace;letter-spacing:.1em}.machine-body h2{margin:3px 0 10px;color:#e2e8e2;font-size:14px;font-weight:600;letter-spacing:-.02em;text-transform:capitalize}.machine-control{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;color:#9aa69b;font-size:10px}.expand-chain{width:100%;display:flex;align-items:center;gap:6px;margin:0 0 9px;padding:5px 7px;border:1px solid #3a4a3c;border-radius:4px;background:#202b22;color:#a8c8aa;font:9px 'DM Sans',sans-serif;cursor:pointer}.expand-chain:hover{border-color:#668469;background:#27372a}.expand-chain span{font:12px 'DM Mono',monospace}.stepper{height:24px;display:flex;align-items:center;border:1px solid #354038;border-radius:4px;overflow:hidden;background:#151b17}.stepper button{width:24px;height:22px;border:0;background:transparent;color:#b9c4bb;cursor:pointer}.stepper button:hover{background:#2c382e}.stepper input{width:30px;border:0;outline:none;background:transparent;color:#e2e8e2;text-align:center;font:10px 'DM Mono',monospace;appearance:textfield}.stepper input::-webkit-inner-spin-button{display:none}.node-output{position:relative;display:flex;align-items:center;gap:8px;padding:7px 0;border-top:1px solid #2d372f;border-bottom:1px solid #2d372f}.port{position:absolute;width:8px;height:8px;border:2px solid #9cc69e;border-radius:50%;background:#19211b}.output-port{right:-17px}.input-port{left:-17px;border-color:#899b8c}.input-port.connected{border-color:#a7d5ad;background:#73a77b;box-shadow:0 0 7px #77ad7e}.port-copy{display:flex;flex-direction:column;gap:3px}.port-copy strong{font:11px 'DM Mono',monospace;color:#d5e4d6}.port-copy em{color:#7d8c7e;font-style:normal;font-size:9px}.output-name{margin-left:auto;color:#93ae95;font-size:10px;text-transform:capitalize}.input-heading{display:flex;justify-content:space-between;padding:10px 0 4px}.node-input{position:relative;min-height:29px;display:flex;align-items:center;gap:5px;border-bottom:1px solid #252e27;color:#b0bbb1;font-size:9px}.input-name{flex:1;text-transform:capitalize}.node-input>strong{font:9px 'DM Mono',monospace;color:#c9d3ca}.connect-button{position:absolute;left:-43px;top:5px;width:19px;height:19px;padding:0;border:1px solid transparent;border-radius:4px;background:transparent;color:#79867b;cursor:pointer}.connect-button:hover,.connect-button.linked{border-color:#455748;color:#a8d2ab;background:#253328}.provider-select{position:absolute;z-index:4;left:-194px;right:auto;top:25px;width:185px;padding:7px;border:1px solid #4a5b4b;border-radius:4px;background:#202921;color:#dce5dd;font:10px 'DM Sans',sans-serif;box-shadow:0 6px 20px #0008}.canvas-empty{position:absolute;left:50%;top:43%;transform:translate(-50%,-50%);width:340px;text-align:center;color:#869187}.empty-symbol{width:44px;height:44px;display:grid;place-items:center;margin:0 auto 14px;border:1px dashed #58675a;border-radius:11px;color:#a9c7aa;font-size:20px}.canvas-empty h2{margin:0 0 7px;color:#dce4dc;font-size:15px;font-weight:500}.canvas-empty p{margin:0;font-size:11px}.empty-shortcuts{display:flex;justify-content:center;align-items:center;gap:6px;margin-top:18px;font-size:10px;color:#8a968c}.shortcut-sep{color:#576259;margin:0 4px}.canvas-footer{height:25px;flex:none;display:flex;align-items:center;justify-content:space-between;padding:0 12px;border-top:1px solid #27302a;color:#778378;font:8px 'DM Mono',monospace;letter-spacing:.08em}.canvas-footer span:first-child{display:flex;align-items:center;gap:6px}.footer-dot{width:5px;height:5px}.inspector{border-left:1px solid #27302b;padding:20px 14px 12px;overflow:auto}.inspector-top{display:flex;justify-content:space-between;align-items:flex-start}.inspector-top h2{margin:0;font-size:16px;font-weight:600;letter-spacing:-.02em}.more-button{font-size:15px;line-height:10px}.stat-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:16px 0 24px}.stat-card{min-height:80px;border:1px solid #303a32;background:#1b221d;border-radius:5px;padding:10px}.stat-card>span{display:block;color:#77847a;font:8px 'DM Mono',monospace;letter-spacing:.08em}.stat-card strong{display:block;margin:8px 0 2px;color:#e2e8e2;font:20px 'DM Mono',monospace}.stat-card small{color:#879388;font-size:9px}.summary-section{margin:0 0 20px}.section-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:9px}.section-heading>div{display:flex;align-items:center;gap:8px}.section-heading h3{margin:0;color:#d4ddd4;font-size:11px;font-weight:500}.section-mark{width:19px;height:19px;display:grid;place-items:center;border-radius:4px;font:12px 'DM Mono',monospace}.import-mark{color:#e5bc83;background:#332b20}.surplus-mark{color:#9fcda1;background:#253329}.resource-list{display:flex;flex-direction:column}.resource-row{display:flex;align-items:center;gap:7px;min-height:37px;border-bottom:1px solid #28312a}.resource-row .resource-icon{width:22px;height:22px;font-size:9px;border-color:#39443a;background:#202821}.resource-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#bbc5bc;font-size:10px;text-transform:capitalize}.resource-row>strong{color:#d7e2d7;font:9px 'DM Mono',monospace;white-space:nowrap}.resource-row>strong small{color:#718074;font-size:8px;font-weight:400}.summary-empty{padding:10px 0;color:#78857a;font-size:10px;line-height:1.5}.planner-note{display:flex;gap:8px;margin-top:auto;padding:10px;border:1px solid #344238;border-radius:5px;background:#202a22}.note-icon{width:15px;height:15px;flex:none;border:1px solid #78967a;border-radius:50%;display:grid;place-items:center;color:#a9c6aa;font:9px Georgia,serif}.planner-note p{margin:0;color:#9aa79b;font-size:9px;line-height:1.55}.source-foot{display:flex;flex-direction:column;gap:5px;padding-top:12px;color:#6f7d71;font:8px 'DM Mono',monospace}.source-foot a{color:#9ebfa0;text-decoration:none}.toast{position:fixed;bottom:35px;left:50%;transform:translateX(-50%);padding:10px 14px;border:1px solid #805b56;border-radius:5px;background:#322321;color:#f2c5bf;font-size:11px;z-index:10}
.zoom-controls{display:flex;align-items:center;gap:7px}.zoom-controls .icon-button{font-size:13px}.icon-button:disabled{opacity:.4;cursor:default}

.view-tabs{height:43px;flex:none;display:flex;align-items:stretch;gap:5px;padding:0 20px;border-bottom:1px solid #27302b;background:#151b17}.view-tab{position:relative;padding:0 14px;border:0;background:transparent;color:#8c988e;font:11px 'DM Sans',sans-serif;cursor:pointer}.view-tab:hover{color:#dce5dd}.view-tab.active{color:#c5e0c7}.view-tab.active:after{position:absolute;right:10px;bottom:-1px;left:10px;height:2px;background:#80b587;content:''}.view-count{color:#829085;font:9px 'DM Mono',monospace;letter-spacing:.08em}.data-view{min-height:0;flex:1;overflow:auto;background:#111713}.table-panel,.tree-panel{min-height:100%;padding:20px 22px}.table-intro{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;margin:0 0 18px}.table-intro .eyebrow{margin-bottom:5px}.table-intro h2{margin:0;color:#e1e8e1;font-size:17px;font-weight:600;letter-spacing:-.025em;text-transform:capitalize}.table-intro>span{color:#7d8b7f;font:9px 'DM Mono',monospace;white-space:nowrap}.view-search{height:34px;display:flex;align-items:center;gap:8px;margin:0 0 17px;padding:0 10px;border:1px solid #303a32;border-radius:5px;background:#171e19;color:#89968b}.view-search>span{font-size:18px}.view-search input{width:100%;border:0;outline:0;background:transparent;color:#dce5dd;font:11px 'DM Sans',sans-serif}.view-search input::placeholder{color:#68766b}.table-scroll{overflow:auto;border:1px solid #2b352d;border-radius:6px}.planner-table{width:100%;border-collapse:collapse;font-size:10px;text-align:right}.planner-table thead{position:sticky;top:0;z-index:1;background:#1b241d}.planner-table th,.planner-table td{height:39px;padding:7px 12px;border-bottom:1px solid #28312a;white-space:nowrap}.planner-table thead th{color:#8c9b8d;font:8px 'DM Mono',monospace;letter-spacing:.08em;text-transform:uppercase}.planner-table tbody td{color:#c5d0c6;font:10px 'DM Mono',monospace}.planner-table tbody tr:hover{background:#19221b}.planner-table tbody th[scope=row]{color:#dbe3dc;text-align:left;font-size:10px;font-weight:500;text-transform:capitalize}.planner-table tbody th:first-child,.planner-table thead th:first-child{text-align:left}.table-item-icon{width:22px;height:22px;display:inline-grid;place-items:center;margin-right:8px;border:1px solid #39463a;border-radius:4px;background:#202920;color:#a8c8aa;font:9px 'DM Mono',monospace}.needs-supply{color:#e5bd84!important}.has-surplus{color:#a5d2a9!important}.building-name{min-width:130px}.products-cell{max-width:360px;overflow:hidden;text-overflow:ellipsis;text-align:left!important;color:#8f9d91!important;font:9px 'DM Sans',sans-serif!important}.machine-pill{display:inline-block;padding:4px 6px;border:1px solid #354438;border-radius:4px;background:#202a22;color:#acd0ae;font:9px 'DM Mono',monospace}.table-empty{padding:32px!important;color:#829085!important;text-align:center!important;font-family:'DM Sans',sans-serif!important}.tree-list{overflow:hidden;border:1px solid #2b352d;border-radius:6px}.tree-row{min-height:35px;display:flex;align-items:center;gap:9px;padding-top:5px;padding-right:12px;padding-bottom:5px;border-bottom:1px solid #242e27;color:#c5d0c6;font-size:10px}.tree-row:last-child{border-bottom:0}.tree-row:hover{background:#18211a}.tree-row strong{min-width:95px;color:#dfe6df;font-size:10px;font-weight:500;text-transform:capitalize}.tree-marker{width:14px;flex:none;color:#9ec4a1;text-align:center;font:11px 'DM Mono',monospace}.tree-ingredient .tree-marker{color:#829285}.tree-ingredient.is-external .tree-marker,.tree-ingredient.is-external .tree-detail{color:#d6b57f}.tree-detail{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#879589;font:9px 'DM Mono',monospace}.tree-count{margin-left:auto;color:#a8c8aa;font:9px 'DM Mono',monospace;white-space:nowrap}.view-empty{padding:70px 20px;text-align:center}.view-empty h2{margin:0 0 8px;color:#dce4dc;font-size:15px;font-weight:500}.view-empty p{margin:0;color:#849087;font-size:11px}
.category-strip{display:flex;gap:5px;overflow-x:auto;flex:none;margin:10px 0 1px;padding:0 0 5px;scrollbar-width:none}.category-strip::-webkit-scrollbar{display:none}.category-chip{display:flex;align-items:center;gap:6px;flex:none;padding:5px 8px;border:1px solid #303a32;border-radius:4px;background:#1a211c;color:#aeb9af;font-size:9px;text-transform:capitalize;white-space:nowrap;cursor:pointer}.category-chip:hover{border-color:#526553;color:#dce5dd}.category-chip.active{border-color:#607f61;background:#263428;color:#cae0ca}.category-chip span,.recipe-group-heading>span:last-child{color:#7e8d80;font:8px 'DM Mono',monospace}.recipe-group{margin-bottom:4px}.recipe-group-heading{display:flex;align-items:center;justify-content:space-between;padding:8px 4px 5px;color:#a6b2a7;font:8px 'DM Mono',monospace;letter-spacing:.09em;text-transform:uppercase}@media(max-width:1100px){.planner-layout{grid-template-columns:230px minmax(400px,1fr)}.inspector{display:none}.sidebar{padding-left:10px;padding-right:10px}}
@media(max-width:700px){.app-shell{height:auto;min-height:100vh;overflow:visible}.topbar{height:52px;padding:0 12px}.save-state{display:none}.view-tabs{height:40px;overflow-x:auto;padding:0 8px}.view-tab{padding:0 11px;white-space:nowrap}.planner-layout{display:flex;flex-direction:column;min-height:calc(100vh - 92px)}.sidebar{height:280px;flex:none;border-right:0;border-bottom:1px solid #27302b}.catalog-list{display:block}.sidebar-tip{display:none}.main-area{height:calc(100vh - 372px);min-height:480px}.table-panel,.tree-panel{padding:15px 12px}.tree-row{gap:6px;padding-right:8px}.tree-row strong{min-width:72px}.tree-detail{font-size:8px}.planner-table th,.planner-table td{padding:7px 8px}.plan-toolbar{padding:0 10px}.canvas-viewport{min-height:0}.inspector{display:flex;min-height:300px;border-left:0;border-top:1px solid #27302b}.machine-card{width:280px}.flow-line{stroke-dasharray:4 4}}
</style>
