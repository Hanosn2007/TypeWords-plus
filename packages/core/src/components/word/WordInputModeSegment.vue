<script setup lang="ts">
import { WordInputMode } from '../../types'

withDefaults(
  defineProps<{
    modelValue: WordInputMode
    ariaLabel?: string
    compact?: boolean
  }>(),
  {
    ariaLabel: '输入方式',
    compact: false,
  }
)

const emit = defineEmits<{
  'update:modelValue': [mode: WordInputMode]
}>()
</script>

<template>
  <div class="input-mode-segment" :class="{ compact }" role="radiogroup" :aria-label="ariaLabel">
    <span class="indicator" :class="{ 'is-whole': modelValue === WordInputMode.Whole }"></span>
    <button
      type="button"
      role="radio"
      :aria-checked="modelValue === WordInputMode.Classic"
      :class="{ active: modelValue === WordInputMode.Classic }"
      @click="emit('update:modelValue', WordInputMode.Classic)"
    >
      逐字母
    </button>
    <button
      type="button"
      role="radio"
      :aria-checked="modelValue === WordInputMode.Whole"
      :class="{ active: modelValue === WordInputMode.Whole }"
      @click="emit('update:modelValue', WordInputMode.Whole)"
    >
      整词
    </button>
  </div>
</template>

<style scoped lang="scss">
.input-mode-segment {
  position: relative;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  width: 8.75rem;
  height: 2rem;
  flex-shrink: 0;
  padding: 2px;
  overflow: hidden;
  border: 1px solid var(--color-line);
  border-radius: 7px;
  background: var(--color-primary);
  box-sizing: border-box;

  &.compact {
    width: 7.25rem;
    height: 1.75rem;
  }

  button {
    position: relative;
    z-index: 1;
    min-width: 0;
    padding: 0;
    border: 0;
    border-radius: 5px;
    color: var(--color-font-3);
    background: transparent;
    cursor: pointer;
    font: inherit;
    font-size: 0.8rem;
    line-height: 1;
    transition: color 0.18s ease;

    &.active {
      color: var(--color-font-1);
    }

    &:focus-visible {
      outline: 2px solid var(--color-select-bg);
      outline-offset: -2px;
    }
  }
}

.indicator {
  position: absolute;
  top: 2px;
  bottom: 2px;
  left: 2px;
  width: calc(50% - 2px);
  border-radius: 5px;
  background: var(--color-card-bg);
  box-shadow: 0 1px 3px rgb(0 0 0 / 18%);
  transition: transform 0.18s ease;

  &.is-whole {
    transform: translateX(100%);
  }
}
</style>
