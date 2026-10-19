import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateDemandByProducer,
  calculateNetworkSummary,
  consolidateOutputNodes,
  machinesForDemand
} from '../app/utils/production-solver.js'

function makeRecipe(id, product_id, rate, ingredients = [], batch = 1) {
  return { id, label: id, station: 'test', batch, rate, product_id, product: product_id, ingredients }
}
function makeNode(id, recipeId, machines = 1) {
  return { id, recipeId, x: 0, y: 0, machines }
}

test('machine demand rounds up to whole machines without rounding exact multiples up', () => {
  assert.equal(machinesForDemand(10, 6), 2)
  assert.equal(machinesForDemand(12, 6), 2)
  assert.equal(machinesForDemand(0, 6), 1)
  assert.equal(machinesForDemand(10, 0), 1)
})

test('shared producer demand aggregates all connected consumers', () => {
  const recipes = new Map([
    ['iron', makeRecipe('iron', 'iron_ingot', 6)],
    ['gear', makeRecipe('gear', 'gear', 2, [{ item_id: 'iron_ingot', name: 'Iron Ingot', quantity: 3 }])],
    ['beam', makeRecipe('beam', 'beam', 1, [{ item_id: 'iron_ingot', name: 'Iron Ingot', quantity: 4 }])]
  ])
  const nodes = [makeNode('producer', 'iron'), makeNode('consumer-a', 'gear'), makeNode('consumer-b', 'beam')]
  const connections = { 'consumer-a:iron_ingot': 'producer', 'consumer-b:iron_ingot': 'producer' }
  assert.equal(calculateDemandByProducer(nodes, connections, recipes).get('producer'), 10)
  assert.equal(machinesForDemand(10, recipes.get('iron').rate), 2)
})

test('network summary reports partial external supply and unconnected surplus', () => {
  const recipes = new Map([
    ['iron', makeRecipe('iron', 'iron_ingot', 5)],
    ['gear', makeRecipe('gear', 'gear', 2, [{ item_id: 'iron_ingot', name: 'Iron Ingot', quantity: 4 }])]
  ])
  const nodes = [makeNode('producer', 'iron'), makeNode('consumer', 'gear')]
  const summary = calculateNetworkSummary(nodes, { 'consumer:iron_ingot': 'producer' }, recipes)
  assert.deepEqual(summary.external, [{ id: 'iron_ingot', name: 'Iron Ingot', amount: 3 }])
  assert.deepEqual(summary.surplus, [{ id: 'gear', name: 'gear', amount: 2 }])
  assert.equal(summary.connectionRows[0].produced, 5)
})

test('duplicate output nodes merge connections and size one producer for combined demand', () => {
  const recipes = new Map([
    ['iron', makeRecipe('iron', 'iron_ingot', 4)],
    ['gear', makeRecipe('gear', 'gear', 2, [{ item_id: 'iron_ingot', name: 'Iron Ingot', quantity: 3 }])],
    ['beam', makeRecipe('beam', 'beam', 1, [{ item_id: 'iron_ingot', name: 'Iron Ingot', quantity: 4 }])]
  ])
  const nodes = [makeNode('iron-a', 'iron'), makeNode('iron-b', 'iron'), makeNode('consumer-a', 'gear'), makeNode('consumer-b', 'beam')]
  const result = consolidateOutputNodes(nodes, { 'consumer-a:iron_ingot': 'iron-a', 'consumer-b:iron_ingot': 'iron-b' }, ['iron-b'], recipes)
  assert.equal(result.nodes.length, 3)
  assert.equal(result.connections['consumer-a:iron_ingot'], 'iron-a')
  assert.equal(result.connections['consumer-b:iron_ingot'], 'iron-a')
  assert.equal(result.nodes.find(node => node.id === 'iron-a').machines, 3)
  assert.deepEqual(result.selectedNodeIds, ['iron-a'])
})

test('stale and mismatched provider connections do not count as supply', () => {
  const recipes = new Map([
    ['wood', makeRecipe('wood', 'wood', 10)],
    ['gear', makeRecipe('gear', 'gear', 1, [{ item_id: 'iron_ingot', name: 'Iron Ingot', quantity: 2 }])]
  ])
  const nodes = [makeNode('wrong', 'wood'), makeNode('consumer', 'gear')]
  const summary = calculateNetworkSummary(nodes, { 'consumer:iron_ingot': 'wrong' }, recipes)
  assert.deepEqual(summary.external, [{ id: 'iron_ingot', name: 'Iron Ingot', amount: 2 }])
  assert.equal(summary.connectionRows.length, 0)
})

test('network summary handles a large shared network with linear graph traversal', () => {
  const recipesById = new Map([
    ['ore', makeRecipe('ore', 'ore_item', 1500)],
    ['part', makeRecipe('part', 'part_item', 1, [{ item_id: 'ore_item', name: 'Ore', quantity: 1 }])]
  ])
  const nodes = [
    { id: 'ore-node', recipeId: 'ore', x: 0, y: 0, machines: 1 },
    ...Array.from({ length: 1500 }, (_, index) => ({ id: `part-${index}`, recipeId: 'part', x: index, y: 0, machines: 1 }))
  ]
  const connections = Object.fromEntries(nodes.slice(1).map(node => [`${node.id}:ore_item`, 'ore-node']))
  const summary = calculateNetworkSummary(nodes, connections, recipesById)
  assert.equal(summary.machineTotal, 1501)
  assert.equal(summary.connectionRows.length, 1500)
  assert.deepEqual(summary.external, [])
  assert.deepEqual(summary.surplus, [{ id: 'part_item', name: 'part_item', amount: 1500 }])
})
