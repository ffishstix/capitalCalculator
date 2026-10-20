export default defineNuxtConfig({
  compatibilityDate: '2026-10-19',
  nitro: { preset: 'cloudflare_pages' },
  devtools: { enabled: true },
  app: { head: { title: 'CapitalRift Factory Planner', meta: [{ name: 'description', content: 'Plan Capital Rift production on a connected factory grid.' }] } }
})
