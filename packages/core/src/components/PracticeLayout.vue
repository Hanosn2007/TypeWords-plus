<script setup lang="ts">
import { useSettingStore } from '../stores/setting'
import { ref } from 'vue'
import { useElementSize } from '@vueuse/core'

const settingStore = useSettingStore()
const footerRef = ref<HTMLElement | null>(null)
const { height: footerHeight } = useElementSize(footerRef)
defineProps<{
  panelLeft: string
}>()
</script>

<template>
  <div class="practice-layout flex justify-center relative" :class="!settingStore.showToolbar && 'footer-hide'">
    <div class="wrap" id="PracticeArea">
      <slot name="practice"></slot>
    </div>
    <div
      class="panel-wrap"
      :style="{ left: panelLeft }"
      :class="{ 'has-panel': settingStore.showPanel }"
      @click.self="settingStore.showPanel = false"
    >
      <slot name="panel"></slot>
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
    justify-content: center;
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
