<script setup lang="ts">
import { useSettingStore } from '../stores/setting'
import { computed, ref } from 'vue'
import { useElementBounding, useElementSize, useLocalStorage, useWindowSize } from '@vueuse/core'

const settingStore = useSettingStore()
const footerRef = ref<HTMLElement | null>(null)
const { height: footerHeight } = useElementSize(footerRef)
const props = defineProps<{
  panelLeft: string
  adaptivePanel?: boolean
}>()
const layoutRef = ref<HTMLElement | null>(null)
const practiceSizeRef = ref<HTMLElement | null>(null)
const panelSizeRef = ref<HTMLElement | null>(null)
const gapSizeRef = ref<HTMLElement | null>(null)
const { width: availableWidth, left: layoutLeft } = useElementBounding(layoutRef)
const { width: practiceWidth } = useElementSize(practiceSizeRef)
const { width: panelWidth } = useElementSize(panelSizeRef)
const { width: gap } = useElementSize(gapSizeRef)
const preferredPanelWidth = useLocalStorage('typewords-practice-panel-width', 384)
const { width: windowWidth } = useWindowSize()
const actualPanelWidth = computed(() => Math.min(Math.max(240, Number(preferredPanelWidth.value) || 384), 600, Math.max(0, windowWidth.value - 32)))
// Measure natural widths independently of whether the panel is open, so
// docking cannot change its own threshold or oscillate when resizing.
const canDock = computed(() => props.adaptivePanel && practiceWidth.value > 0 &&
  availableWidth.value >= practiceWidth.value + panelWidth.value + gap.value * 3)
const reservedWidth = computed(() => canDock.value && settingStore.showPanel ? panelWidth.value + gap.value : 0)
const adaptiveStyle = computed(() => props.adaptivePanel ? {
  '--practice-center-x': `${layoutLeft.value + (availableWidth.value - reservedWidth.value) / 2}px`,
  '--panel-width': `${actualPanelWidth.value}px`,
  paddingRight: `${reservedWidth.value}px`,
} : {})
let resizeStart: { x: number; width: number; max: number } | null = null
function startResize(event: PointerEvent) {
  if (event.button !== 0) return
  resizeStart = {
    x: event.clientX, width: actualPanelWidth.value,
    max: canDock.value ? availableWidth.value - practiceWidth.value - gap.value * 3 : windowWidth.value - 32,
  }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  event.preventDefault()
}
function moveResize(event: PointerEvent) {
  if (!resizeStart) return
  preferredPanelWidth.value = Math.round(Math.max(240, Math.min(600, resizeStart.max, resizeStart.width + resizeStart.x - event.clientX)))
}
function endResize() { resizeStart = null }
function resizeByKey(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
  event.preventDefault()
  event.stopPropagation()
  const max = canDock.value ? availableWidth.value - practiceWidth.value - gap.value * 3 : windowWidth.value - 32
  preferredPanelWidth.value = Math.max(240, Math.min(600, max, actualPanelWidth.value + (event.key === 'ArrowLeft' ? 16 : -16)))
}
</script>

<template>
  <div ref="layoutRef" class="practice-layout flex justify-center relative" :style="adaptiveStyle"
    :class="{ 'footer-hide': !settingStore.showToolbar, 'adaptive-panel': adaptivePanel, 'panel-docked': canDock }">
    <template v-if="adaptivePanel">
      <span ref="practiceSizeRef" class="size-probe practice-size" aria-hidden="true"></span>
      <span ref="panelSizeRef" class="size-probe panel-size" aria-hidden="true"></span>
      <span ref="gapSizeRef" class="size-probe gap-size" aria-hidden="true"></span>
    </template>
    <div class="wrap" id="PracticeArea">
      <slot name="practice"></slot>
    </div>
    <div
      class="panel-wrap"
      :style="{ left: adaptivePanel ? undefined : panelLeft }"
      :class="{ 'has-panel': settingStore.showPanel }"
      @click.self="settingStore.showPanel = false"
    >
      <div v-if="adaptivePanel" class="adaptive-panel-content">
        <div v-if="settingStore.showPanel" class="panel-resize-handle" role="separator" tabindex="0"
          aria-label="调整词表宽度" aria-orientation="vertical" :aria-valuenow="Math.round(actualPanelWidth)" aria-valuemin="240" aria-valuemax="600"
          @pointerdown="startResize" @pointermove="moveResize" @pointerup="endResize" @pointercancel="endResize" @lostpointercapture="endResize" @keydown="resizeByKey"></div>
        <slot name="panel"></slot>
      </div>
      <slot v-else name="panel"></slot>
    </div>
    <div class="footer-wrap" ref="footerRef" :style="{ '--footer-height': footerHeight + 'px' }">
      <slot name="footer"></slot>
    </div>
  </div>
</template>

<style scoped lang="scss">
.practice-layout { min-width: 0; width: 100%; }
.wrap {
  max-width: 100%;
  min-width: 0;
  transition: all var(--anim-time);
}

.footer-hide {
  .footer-wrap {
    bottom: -6rem;
  }
}

.footer-wrap {
  max-width: calc(100vw - var(--layout-aside-width, 0px) - 2rem);
  position: fixed;
  bottom: calc(env(safe-area-inset-bottom, 0px));
  transition: all var(--anim-time);
  z-index: 999;
}

.panel-wrap {
  position: fixed;
  top: 0.8rem;
  z-index: 1;
  height: calc(100vh - 1.8rem);
}

@media (max-width: 1599px) {
  .panel-wrap {
    position: fixed;
    top: 0;
    left: 0 !important;
    right: 0 !important;
    bottom: 0;
    height: 100dvh;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding: 1rem;
    box-sizing: border-box;

    // 当面板未显示时，禁用指针事件
    pointer-events: none;

    // 只有当面板显示时才添加背景蒙版并启用指针事件
    &.has-panel {
      background: rgba(0, 0, 0, 0.5);
      pointer-events: auto;
    }
  }
}

// 移动端适配
@media (max-width: 768px) {
  .wrap {
    height: calc(100vh - 6rem);
    width: 100%;
    padding: 0 1rem;
    box-sizing: border-box;
  }

  .footer-hide {
    .wrap {
      height: calc(100vh - 2rem) !important;
    }

    .footer-wrap {
      bottom: calc(-8rem + env(safe-area-inset-bottom, 0px));
    }
  }

  .footer-wrap {
    bottom: calc(0.5rem + env(safe-area-inset-bottom, 0px));
    left: 0.5rem;
    right: 0.5rem;
    width: auto;
  }
}

// A wrapped toolbar can be taller than the old fixed six-rem offset.
.footer-hide .footer-wrap { bottom: calc(-1 * var(--footer-height, 6rem)); }

// 超小屏幕适配
@media (max-width: 480px) {
  .wrap {
    height: calc(100vh - 5rem);
    padding: 0 0.5rem;
  }

  .footer-hide {
    .wrap {
      height: calc(100vh - 1.5rem) !important;
    }

    .footer-wrap {
      bottom: calc(-7rem + env(safe-area-inset-bottom, 0px));
    }
  }

  .footer-wrap {
    bottom: calc(0.3rem + env(safe-area-inset-bottom, 0px));
    left: 0.3rem;
    right: 0.3rem;
  }

  .panel-wrap {
    padding: 0.5rem;
    left: 0 !important;
    right: 0 !important;
  }
}
</style>

<style scoped lang="scss">
.adaptive-panel {
  box-sizing: border-box;
  --panel-width: min(24rem, calc(100vw - 2rem));

  .size-probe { position: absolute; height: 0; visibility: hidden; pointer-events: none; }
  .practice-size { width: var(--toolbar-width); }
  .panel-size { width: var(--panel-width); }
  .gap-size { width: 1rem; }
  .adaptive-panel-content { position: relative; width: var(--panel-width); max-width: 100%; height: 100%; }
  .panel-resize-handle {
    position: absolute; left: -5px; top: 0; bottom: 0; width: 10px; z-index: 2;
    cursor: col-resize; touch-action: none;
    &:hover, &:focus-visible { background: var(--color-link, #3b82f6); opacity: 0.6; border-radius: 6px; }
  }
  .footer-wrap { left: var(--practice-center-x); right: auto; transform: translateX(-50%); }

  .panel-wrap {
    position: fixed;
    inset: 0;
    height: 100dvh;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding: 1rem;
    box-sizing: border-box;
    pointer-events: none;
    &.has-panel { background: rgba(0, 0, 0, 0.5); pointer-events: auto; }
  }

  &.panel-docked .panel-wrap {
    top: 0.8rem;
    bottom: auto;
    left: auto !important;
    right: 1rem !important;
    width: var(--panel-width);
    height: calc(100dvh - 1.8rem);
    padding: 0;
    z-index: 1;
    background: transparent;
  }
}
@media (max-width: 768px) {
  .adaptive-panel .footer-wrap { left: 0.5rem; right: 0.5rem; transform: none; }
  .adaptive-panel .adaptive-panel-content { height: auto; }
  .adaptive-panel .panel-resize-handle { display: none; }
}
@media (max-width: 480px) {
  .adaptive-panel .panel-wrap { padding: 0.5rem; }
  .adaptive-panel .footer-wrap { left: 0.3rem; right: 0.3rem; }
}
</style>
