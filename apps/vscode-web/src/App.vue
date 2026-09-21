<script setup lang="ts">
import { onMounted } from 'vue'
import StudyUpgradeNotice from '@typewords/core/components/StudyUpgradeNotice.vue'
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'
import { useInit } from '@typewords/core/composables/useInit.ts'
import { ENV } from '@typewords/core/config/env.ts'

const init = useInit()

onMounted(() => {
  init()
  document.documentElement.className = 'dark'
  ;(function () {
    var t = document.createElement('script')
    t.src = ENV.LIBS_URL + 't.js?t=' + Date.now()
    document.head.appendChild(t)
  })()
})
</script>

<template>
  <router-view></router-view>
  <StudyUpgradeNotice />
</template>

<style scoped lang="scss"></style>
