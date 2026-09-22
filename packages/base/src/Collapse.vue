<script setup lang="ts">
const props = defineProps<{
  q: string,
  a?: string | string[],
}>()
let show = $ref(false)
let isArray = $computed(() => typeof props.a !== 'string')
</script>

<template>
  <div class="qa-item my-6">
    <button type="button" class="question flex justify-between items-center cp font-bold text-lg" :aria-expanded="show" @click="show = !show">
      <span>{{ q }}</span>
      <IconFluentChevronLeft20Filled class="anim" :class="show?'transform-rotate-270':'transform-rotate-180'"/>
    </button>
    <div class="content mt-4 text-base" v-if="show">
      <template v-if="isArray">
        <p v-for="(v,i) in a">{{a.length>1?`${i+1}. `:''}}{{v}}</p>
      </template>
      <span v-else>{{a}}</span>
      <slot></slot>
    </div>
  </div>
</template>

<style scoped lang="scss">
.qa-item { min-width: 0; overflow-wrap: anywhere; }
.question { width: 100%; gap: 1rem; text-align: left; color: inherit; background: transparent; border: 0; padding: 0; }
.question svg { flex-shrink: 0; }
</style>
