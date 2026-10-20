<script setup lang="ts">
const props = defineProps<{ itemId?: string | null; name: string }>()
const failed = ref(false)
const imageUrl = computed(() => props.itemId && /^[a-z0-9_]{1,80}$/.test(props.itemId) ? `/api/items/${props.itemId}/image` : '')
watch(imageUrl, () => { failed.value = false })
</script>

<template>
  <span class="game-item-icon" aria-hidden="true">
    <img v-if="imageUrl && !failed" :src="imageUrl" alt="" loading="lazy" @error="failed = true">
    <span v-else>{{ name.slice(0, 1).toUpperCase() }}</span>
  </span>
</template>

<style scoped>
.game-item-icon{width:var(--icon-size,22px);height:var(--icon-size,22px);flex:none;display:inline-flex;align-items:center;justify-content:center;overflow:hidden;vertical-align:middle;border-radius:4px;background:#26332a;color:#a9c4ae;font:10px 'DM Mono',monospace}
.game-item-icon img{width:100%;height:100%;object-fit:contain}
</style>
