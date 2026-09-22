<script setup lang="ts">
import { nextTick, watch, onMounted, onUnmounted } from 'vue'

interface IProps {
  modelValue?: boolean
  width?: string
}

let props = withDefaults(defineProps<IProps>(), {
  modelValue: true,
  width: '18rem',
})
let modalRef = $ref(null)
let style = $ref<Record<string, string>>({ top: '2.4rem', bottom: 'unset' })
async function fitViewport() {
  if (!props.modelValue) return
  style = { top: '2.4rem', bottom: 'unset' }
  await nextTick()
  const modal = modalRef as HTMLElement | null
  if (!modal) return
  const rect = modal.getBoundingClientRect()
  if (rect.bottom > window.innerHeight - 8) style = { ...style, top: 'unset', bottom: '2.5rem' }
  const offset = Math.max(8 - rect.left, Math.min(0, window.innerWidth - 8 - rect.right))
  if (offset) style = { ...style, transform: `translateX(calc(-50% + ${offset}px))` }
}
onMounted(() => { fitViewport(); window.addEventListener('resize', fitViewport) })
onUnmounted(() => window.removeEventListener('resize', fitViewport))

watch(
  () => props.modelValue,
  () => fitViewport()
)
</script>

<template>
  <Transition name="fade">
    <div v-if="modelValue" ref="modalRef" class="mini-modal" :style="{ width, ...style }">
      <slot></slot>
    </div>
  </Transition>
</template>

<style lang="scss">
.mini-row-title {
  @apply text-center text-base font-bold mb-2;
  color: var(--color-font-1);
}

.mini-row {
  @apply min-h-10 flex justify-between items-center gap-space text-base text-font-1 word-break-keep-all;
  color: var(--color-font-1);
}

.mini-modal {
  max-width: calc(100vw - 2rem);
  max-height: calc(100dvh - 3rem);
  overflow: auto;
  box-sizing: border-box;
  background: var(--color-card-bg);
  padding: var(--space) 1rem;
  @apply z-9 absolute left-1/2 transform -translate-x-1/2 shadow-lg rounded-xl w-50;
}
</style>
