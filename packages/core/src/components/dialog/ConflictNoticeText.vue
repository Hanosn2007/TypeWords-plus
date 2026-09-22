<script setup lang="ts">
withDefaults(defineProps<{ type?: 'all' | 'del' | 'keyboard' }>(), { type: 'all' })
</script>
<template>
  <div class="input-help">
    <template v-if="type === 'all' || type === 'keyboard'">
      <p>先关闭弹窗，点击练习区，并确认输入法处于英文状态。若页面提示另一个标签页正在学习，请只保留一个可写的学习页面。</p>
      <p>浏览器或扩展可能抢占快捷键。可在本站设置中更改快捷键，或暂时停用有冲突的扩展后重试。请保留已保存的数据，不要清除网站存储。</p>
      <p>若仍无法输入，请到<RouterLink to="/feedback">本项目反馈</RouterLink>说明浏览器、输入法和发生问题的步骤。</p>
    </template>
    <template v-if="type === 'all' || type === 'del'">
      <p>练习区获得焦点后，删除键用于修改输入。若它触发浏览器后退，请检查浏览器或扩展的 Backspace 导航快捷键，并关闭有冲突的映射。</p>
      <p>这仍会受到浏览器和扩展设置影响；如果本站练习区已聚焦却仍异常，请反馈具体操作。</p>
    </template>
  </div>
</template>
<style scoped>.input-help { line-height: 1.8; overflow-wrap: anywhere; } p + p { margin-top: .75rem; }</style>
