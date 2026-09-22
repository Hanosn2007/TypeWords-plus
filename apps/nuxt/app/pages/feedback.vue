<script setup lang="ts">
import { BasePage } from '@typewords/base'
import About from '@typewords/core/components/About.vue'
import { APP_NAME, Origin } from '@typewords/core/config/env.ts'

let route = useRoute()
let title = APP_NAME + ' 反馈'
useSeoMeta({
  title: title,
  description: title,
  ogTitle: title,
  ogDescription: title,
  ogUrl: Origin + route.fullPath,
  twitterTitle: title,
  twitterDescription: title,
})
</script>

<template>
  <BasePage>
    <div class="center">
      <div class="card-white w-full max-w-232 center-col pb-10 box-border">
        <About />
      </div>
    </div>
  </BasePage>
</template>

<style scoped lang="scss"></style>
