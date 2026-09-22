<script setup lang="ts">
import { useRouter } from 'vue-router'
import { APP_NAME } from '../config/env'

const router = useRouter()

function goHome() {
  router.push('/words')
}
</script>

<template>
  <button class="project-logo mb-2" @click="goHome" aria-label="TypeWords Plus 单词首页">{{ APP_NAME }}</button>
</template>

<style scoped lang="scss">
.project-logo {
  cursor: pointer;
  color: inherit;
  background: transparent;
  border: 0;
  font-size: 1.1rem;
  font-weight: 650;
  text-align: left;
  padding: .4rem 0;
  max-width: 100%;
}
</style>
