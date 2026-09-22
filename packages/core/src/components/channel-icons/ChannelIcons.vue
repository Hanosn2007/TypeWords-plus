<script setup lang="ts">
import { BaseIcon } from '@typewords/base'
import ShareIcon from './ShareIcon.vue'
import Github from './Github.vue'
withDefaults(defineProps<{ type?: 'vertical' | 'horizontal'; share?: boolean; wechat?: boolean; github?: boolean }>(), { type: 'vertical', share: true, github: true, wechat: false })
</script>
<template>
  <div class="center" :class="type === 'vertical' ? 'flex-col gap-1' : 'gap-4 flex-wrap'">
    <Github v-if="github" />
    <RouterLink to="/feedback" aria-label="本项目反馈"><BaseIcon title="本项目反馈"><IconFluentCommentEdit20Regular /></BaseIcon></RouterLink>
    <ShareIcon v-if="share" />
  </div>
</template>
