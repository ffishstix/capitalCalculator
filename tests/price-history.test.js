import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateHistoricalEconomics,
  forecastNextBid,
  traceOutputChain
} from '../app/utils/price-history.js'

function recipe(id, productId, rate, ingredients = []) {
  return { id, product_id: productId, product: productId, rate, batch: 1, ingredients }
}

function node(id, recipeId, machines = 1) {
  return { id, recipeId, machines }
}

function hourlyBids(count, { startBid = 100, step = 1, lastAt = Date.now() - 60 * 60 * 1000 } = {}) {
  return Array.from({ length: count }, (_, index) => ({
    at: new Date(lastAt - (count - index - 1) * 60 * 60 * 1000).toISOString(),
    bid: startBid + index * step
  }))
}

test('one output chain attributes a shared producer only up to available capacity', () => {
  const recipes = new Map([
    ['ore', recipe('ore', 'ore_item', 20)],
    ['iron', recipe('iron', 'iron_item', 3, [{ item_id: 'ore_item', name: 'Ore', quantity: 1 }])],
    ['gear', recipe('gear', 'gear_item', 1, [{ item_id: 'iron_item', name: 'Iron', quantity: 2 }])],
    ['beam', recipe('beam', 'beam_item', 1, [{ item_id: 'iron_item', name: 'Iron', quantity: 2 }])],
    ['widget', recipe('widget', 'widget_item', 1, [
      { item_id: 'gear_item', name: 'Gear', quantity: 1 },
      { item_id: 'beam_item', name: 'Beam', quantity: 1 }
    ])],
    ['other', recipe('other', 'other_item', 1, [{ item_id: 'iron_item', name: 'Iron', quantity: 1 }])]
  ])
  const nodes = [
    node('ore-node', 'ore'), node('iron-node', 'iron'),
    node('gear-node', 'gear'), node('beam-node', 'beam'),
    node('widget-node', 'widget'), node('unrelated-node', 'other')
  ]
  const connections = {
    'widget-node:gear_item': 'gear-node',
    'widget-node:beam_item': 'beam-node',
    'gear-node:iron_item': 'iron-node',
    'beam-node:iron_item': 'iron-node',
    'unrelated-node:iron_item': 'iron-node',
    'iron-node:ore_item': 'ore-node'
  }

  assert.deepEqual(traceOutputChain('widget-node', nodes, connections, recipes), {
    sales: [{ id: 'widget_item', name: 'widget_item', amount: 1 }],
    costs: [{ id: 'iron_item', name: 'Iron', amount: 1 }]
  })
})

test('a connected producer passes its own input cost through to the selected output', () => {
  const recipes = new Map([
    ['iron', recipe('iron', 'iron_item', 10, [{ item_id: 'ore_item', name: 'Ore', quantity: 2 }])],
    ['gear', recipe('gear', 'gear_item', 2, [{ item_id: 'iron_item', name: 'Iron', quantity: 3 }])]
  ])
  const flows = traceOutputChain('gear-node', [node('iron-node', 'iron'), node('gear-node', 'gear')], {
    'gear-node:iron_item': 'iron-node'
  }, recipes)

  assert.deepEqual(flows.sales, [{ id: 'gear_item', name: 'gear_item', amount: 2 }])
  assert.deepEqual(flows.costs, [{ id: 'ore_item', name: 'Ore', amount: 12 }])
})

test('historical economics leaves missing quote sides unknown at each exact hour', () => {
  const series = [
    { symbol: 'widget', points: [
      { at: '2026-10-20T09:00:00Z', bid: 10, ask: null },
      { at: '2026-10-20T10:00:00Z', bid: 11, ask: null },
      { at: '2026-10-20T11:00:00Z', bid: null, ask: 99 }
    ] },
    { symbol: 'ore', points: [
      { at: '2026-10-20T09:00:00Z', bid: null, ask: 3 },
      { at: '2026-10-20T10:00:00Z', bid: null, ask: null },
      { at: '2026-10-20T11:00:00Z', bid: 99, ask: 4 },
      { at: '2026-10-20T12:00:00Z', bid: null, ask: 5 }
    ] },
    { symbol: 'unrelated', points: [{ at: '2026-10-20T13:00:00Z', bid: 100, ask: 100 }] }
  ]
  const flows = {
    sales: [{ id: 'widget', amount: 2 }],
    costs: [{ id: 'ore', amount: 3 }]
  }

  assert.deepEqual(calculateHistoricalEconomics(series, flows), [
    { at: '2026-10-20T09:00:00Z', sales: 20, costs: 9, net: 11 },
    { at: '2026-10-20T10:00:00Z', sales: 22, costs: null, net: null },
    { at: '2026-10-20T11:00:00Z', sales: null, costs: 12, net: null },
    { at: '2026-10-20T12:00:00Z', sales: null, costs: 15, net: null }
  ])
})

test('historical economics treats an output without inputs as zero cost', () => {
  const rows = calculateHistoricalEconomics([
    { symbol: 'ore', points: [{ at: '2026-10-20T09:00:00Z', bid: 7, ask: null }] }
  ], { sales: [{ id: 'ore', amount: 2 }], costs: [] })

  assert.deepEqual(rows, [{ at: '2026-10-20T09:00:00Z', sales: 14, costs: 0, net: 14 }])
})

test('forecast produces a bounded next-hour estimate when recent drift beats a flat baseline', () => {
  const points = hourlyBids(40)
  const forecast = forecastNextBid(points)

  assert.ok(forecast)
  assert.equal(forecast.at, new Date(Date.parse(points.at(-1).at) + 60 * 60 * 1000).toISOString())
  assert.equal(forecast.estimate, 140)
  assert.equal(forecast.sampleCount, 40)
  assert.ok(forecast.low <= forecast.estimate)
  assert.ok(forecast.high >= forecast.estimate)
  assert.equal(forecast.backtestError, 0)
})

test('forecast suppresses sparse, stale, and uninformative series', () => {
  assert.equal(forecastNextBid(hourlyBids(31)), null)

  const gap = hourlyBids(40)
  gap[20] = { ...gap[20], bid: null }
  assert.equal(forecastNextBid(gap), null)

  const stale = hourlyBids(40, { lastAt: Date.now() - 4 * 60 * 60 * 1000 })
  assert.equal(forecastNextBid(stale), null)

  assert.equal(forecastNextBid(hourlyBids(40, { step: 0 })), null)
})
