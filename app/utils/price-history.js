/**
 * Trace the material actually needed for one output card through its selected
 * supplier links. Shared producers contribute only the amount requested by
 * this chain; their unrelated output is not sold here.
 */
export function traceOutputChain(rootId, nodes, connections, recipesById) {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const root = byId.get(rootId)
  const rootRecipe = root && recipesById.get(root.recipeId)
  if (!rootRecipe) return { sales: [], costs: [] }

  const outputRate = rootRecipe.rate * root.machines
  const costs = new Map()
  const remaining = new Map(nodes.map(node => {
    const recipe = recipesById.get(node.recipeId)
    return [node.id, (recipe?.rate ?? 0) * node.machines]
  }))

  function consume(node, rate, path) {
    const recipe = recipesById.get(node.recipeId)
    if (!recipe || rate <= 0) return
    const nextPath = new Set(path).add(node.id)
    for (const ingredient of recipe.ingredients) {
      const demand = ingredient.quantity / recipe.batch * rate
      const provider = byId.get(connections[`${node.id}:${ingredient.item_id}`])
      const providerRecipe = provider && recipesById.get(provider.recipeId)
      let covered = 0
      if (provider && providerRecipe?.product_id === ingredient.item_id && !nextPath.has(provider.id)) {
        covered = Math.min(demand, remaining.get(provider.id) ?? 0)
        remaining.set(provider.id, Math.max(0, (remaining.get(provider.id) ?? 0) - covered))
        consume(provider, covered, nextPath)
      }
      const external = demand - covered
      if (external > 0.000001) {
        const previous = costs.get(ingredient.item_id)
        costs.set(ingredient.item_id, { id: ingredient.item_id, name: ingredient.name, amount: (previous?.amount ?? 0) + external })
      }
    }
  }

  consume(root, outputRate, new Set())
  return {
    sales: [{ id: rootRecipe.product_id, name: rootRecipe.product, amount: outputRate }],
    costs: [...costs.values()].sort((a, b) => a.name.localeCompare(b.name))
  }
}

/** Join recorded quotes on their exact snapshot hour; use the opposite book side when one side is absent. */
export function calculateHistoricalEconomics(series, flows) {
  const indexed = new Map(series.map(item => [item.symbol, new Map(item.points.map(point => [point.at, point]))]))
  const symbols = new Set([...flows.sales, ...flows.costs].filter(flow => flow.amount > 0).map(flow => flow.id))
  const timestamps = [...new Set([...symbols].flatMap(symbol => [...(indexed.get(symbol)?.keys() ?? [])]))].sort()
  return timestamps.map(at => {
    const total = (rows, side) => {
      let value = 0
      for (const row of rows) {
        if (row.amount <= 0) continue
        const point = indexed.get(row.id)?.get(at)
        const price = point?.[side] ?? point?.[side === 'bid' ? 'ask' : 'bid']
        if (typeof price !== 'number' || !Number.isFinite(price)) return null
        value += price * row.amount
      }
      return value
    }
    const sales = total(flows.sales, 'bid')
    const costs = total(flows.costs, 'ask')
    return { at, sales, costs, net: sales === null || costs === null ? null : sales - costs }
  })
}

/**
 * One-hour best-bid estimate. A drift model is only used when it beats a
 * no-change baseline in recent walk-forward checks; otherwise there is no
 * forecast. The band comes from recent absolute forecast errors.
 */
export function forecastNextBid(points) {
  const valid = points.filter(point => typeof point.bid === 'number' && Number.isFinite(point.bid))
  if (valid.length < 32) return null
  const tail = valid.slice(-48)
  const times = tail.map(point => Date.parse(point.at))
  const now = Date.now()
  if (!Number.isFinite(times.at(-1)) || now - times.at(-1) > 3 * 60 * 60 * 1000) return null
  for (let i = 1; i < times.length; i++) {
    const gap = times[i] - times[i - 1]
    if (gap < 30 * 60 * 1000 || gap > 90 * 60 * 1000) return null
  }
  const prices = tail.map(point => point.bid)
  const predict = index => {
    const previous = prices.slice(index - 12, index)
    const first = previous.slice(0, 6).reduce((sum, value) => sum + value, 0) / 6
    const last = previous.slice(6).reduce((sum, value) => sum + value, 0) / 6
    const drift = Math.max(-previous.at(-1) * 0.05, Math.min(previous.at(-1) * 0.05, (last - first) / 6))
    return Math.max(0, previous.at(-1) + drift)
  }
  let modelError = 0
  let baselineError = 0
  const errors = []
  for (let i = prices.length - 12; i < prices.length; i++) {
    const estimate = predict(i)
    const actual = prices[i]
    const error = Math.abs(estimate - actual)
    modelError += error
    baselineError += Math.abs(prices[i - 1] - actual)
    errors.push(error)
  }
  if (modelError >= baselineError || baselineError === 0) return null
  const estimate = predict(prices.length)
  const meanError = errors.reduce((sum, value) => sum + value, 0) / errors.length
  const spread = Math.max(meanError * 1.96, estimate * 0.005)
  return {
    at: new Date(times.at(-1) + 60 * 60 * 1000).toISOString(),
    estimate,
    low: Math.max(0, estimate - spread),
    high: estimate + spread,
    sampleCount: tail.length,
    backtestError: modelError / errors.length
  }
}
