/** @typedef {{ item_id: string, name: string, quantity: number }} Ingredient */
/** @typedef {{ id: string, label: string, station: string, batch: number, rate: number, product_id: string, product: string, ingredients: Ingredient[] }} Recipe */
/** @typedef {{ id: string, recipeId: string, x: number, y: number, machines: number }} MachineNode */

/**
 * Aggregate demand by connected producer in one pass through the plan.
 * @param {MachineNode[]} nodes
 * @param {Record<string, string>} connections
 * @param {Map<string, Recipe>} recipesById
 */
export function calculateDemandByProducer(nodes, connections, recipesById) {
  const nodesById = new Map(nodes.map(node => [node.id, node]))
  const demandByProducer = new Map()
  for (const consumer of nodes) {
    const recipe = recipesById.get(consumer.recipeId)
    if (!recipe) continue
    for (const ingredient of recipe.ingredients) {
      const producerId = connections[`${consumer.id}:${ingredient.item_id}`]
      const producer = producerId && nodesById.get(producerId)
      if (!producer || recipesById.get(producer.recipeId)?.product_id !== ingredient.item_id) continue
      const demand = ingredient.quantity * recipe.rate / recipe.batch * consumer.machines
      demandByProducer.set(producerId, (demandByProducer.get(producerId) ?? 0) + demand)
    }
  }
  return demandByProducer
}

/** @param {number} demand @param {number} rate */
export function machinesForDemand(demand, rate) {
  if (!Number.isFinite(rate) || rate <= 0) return 1
  return Math.max(1, Math.ceil((demand - 1e-9) / rate))
}

/**
 * Calculate external requirements and leftover production for the current graph.
 * @param {MachineNode[]} nodes
 * @param {Record<string, string>} connections
 * @param {Map<string, Recipe>} recipesById
 */
export function calculateNetworkSummary(nodes, connections, recipesById) {
  const nodesById = new Map(nodes.map(node => [node.id, node]))
  const remaining = new Map()
  const external = new Map()
  const connectionRows = []
  const machineTotal = nodes.reduce((sum, node) => sum + node.machines, 0)

  for (const node of nodes) {
    const recipe = recipesById.get(node.recipeId)
    if (recipe) remaining.set(node.id, recipe.rate * node.machines)
  }

  for (const node of nodes) {
    const recipe = recipesById.get(node.recipeId)
    if (!recipe) continue
    for (const ingredient of recipe.ingredients) {
      const demand = ingredient.quantity * recipe.rate / recipe.batch * node.machines
      const provider = nodesById.get(connections[`${node.id}:${ingredient.item_id}`])
      const providerRecipe = provider && recipesById.get(provider.recipeId)
      let supplied = 0
      if (provider && providerRecipe?.product_id === ingredient.item_id) {
        supplied = Math.min(demand, remaining.get(provider.id) ?? 0)
        remaining.set(provider.id, Math.max(0, (remaining.get(provider.id) ?? 0) - supplied))
        connectionRows.push({ key: `${node.id}:${ingredient.item_id}`, from: provider, to: node, ingredient, produced: supplied })
      }
      if (demand - supplied > 0.000001) {
        const item = external.get(ingredient.item_id) ?? { name: ingredient.name, amount: 0 }
        item.amount += demand - supplied
        external.set(ingredient.item_id, item)
      }
    }
  }

  const surplus = new Map()
  for (const node of nodes) {
    const leftover = remaining.get(node.id) ?? 0
    const recipe = recipesById.get(node.recipeId)
    if (leftover > 0.000001 && recipe) {
      const item = surplus.get(recipe.product_id) ?? { name: recipe.product, amount: 0 }
      item.amount += leftover
      surplus.set(recipe.product_id, item)
    }
  }
  const byName = (a, b) => a.name.localeCompare(b.name)
  return {
    machineTotal,
    external: [...external.entries()].map(([id, item]) => ({ id, ...item })).sort(byName),
    surplus: [...surplus.entries()].map(([id, item]) => ({ id, ...item })).sort(byName),
    connectionRows
  }
}

/**
 * Merge duplicate producers by product, retarget connections, and size shared producers.
 * @param {MachineNode[]} nodes
 * @param {Record<string, string>} connections
 * @param {string[]} selectedNodeIds
 * @param {Map<string, Recipe>} recipesById
 */
export function consolidateOutputNodes(nodes, connections, selectedNodeIds, recipesById) {
  const canonicalByProduct = new Map()
  const replacements = new Map()
  for (const node of nodes) {
    const productId = recipesById.get(node.recipeId)?.product_id
    if (!productId) continue
    const canonical = canonicalByProduct.get(productId)
    if (canonical) replacements.set(node.id, canonical.id)
    else canonicalByProduct.set(productId, node)
  }
  if (!replacements.size) return { nodes, connections, selectedNodeIds }

  const canonicalNodes = nodes.filter(node => !replacements.has(node.id))
  const canonicalById = new Map(canonicalNodes.map(node => [node.id, node]))
  const remappedConnections = {}
  for (const [key, sourceId] of Object.entries(connections)) {
    const separator = key.lastIndexOf(':')
    const originalConsumerId = key.slice(0, separator)
    const itemId = key.slice(separator + 1)
    const consumerId = replacements.get(originalConsumerId) ?? originalConsumerId
    const providerId = replacements.get(sourceId) ?? sourceId
    if (consumerId === providerId) continue
    const consumerRecipe = recipesById.get(canonicalById.get(consumerId)?.recipeId)
    if (!consumerRecipe?.ingredients.some(ingredient => ingredient.item_id === itemId)) continue
    const remappedKey = `${consumerId}:${itemId}`
    if (!remappedConnections[remappedKey] || originalConsumerId === consumerId) remappedConnections[remappedKey] = providerId
  }

  const demandByProducer = calculateDemandByProducer(canonicalNodes, remappedConnections, recipesById)
  for (const node of canonicalNodes) {
    const recipe = recipesById.get(node.recipeId)
    const demand = demandByProducer.get(node.id) ?? 0
    if (recipe?.rate && demand > 0) node.machines = machinesForDemand(demand, recipe.rate)
  }
  return {
    nodes: canonicalNodes,
    connections: remappedConnections,
    selectedNodeIds: [...new Set(selectedNodeIds.map(id => replacements.get(id) ?? id))]
  }
}
