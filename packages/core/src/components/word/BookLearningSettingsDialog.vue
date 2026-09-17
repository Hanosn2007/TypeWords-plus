<script setup lang="ts">
import { defineAsyncComponent } from 'vue'
import { useDisableEventListener } from '@typewords/utils'
import type { Dict } from '../../types'
import BookLearningSettings from './BookLearningSettings.vue'

const Dialog = defineAsyncComponent(() => import('@typewords/base/Dialog'))
defineProps<{ dict?: Dict }>()
const model = defineModel<boolean>({ default: false })
const emit = defineEmits<{ saved: [] }>()
useDisableEventListener(() => Boolean(model.value))
</script>

<template>
  <Dialog v-model="model" title="当前词书设置" padding>
    <div class="book-settings-dialog">
      <BookLearningSettings v-if="model" :dict="dict" @saved="model = false; emit('saved')" @cancelled="model = false" />
    </div>
  </Dialog>
</template>

<style scoped>
.book-settings-dialog { width: min(30rem, calc(100vw - 4rem)); }
</style>
