<script setup lang="ts">

</script>

<template>
  <div class="page-container">
    <div class="page">
      <slot></slot>
    </div>
  </div>
</template>

<style scoped lang="scss">
.page-container { width: 100%; min-width: 0; display: flex; justify-content: center; }
.page {
  width: 100%;
  max-width: 76rem;
  min-width: 0;
  box-sizing: border-box;
  padding: 0 clamp(.75rem, 2vw, 2rem) 1.5rem;
  min-height: calc(100vh - 1.2rem);
  margin-top: 1.2rem;
}

// 移动端适配
@media (max-width: 768px) {
  .page {
    width: 100%;
    margin-top: 0.5rem;
    min-height: calc(100vh - 0.5rem);
    padding: 0 0.5rem;
    box-sizing: border-box;
  }
}

// 超小屏幕适配
@media (max-width: 480px) {
  .page {
    margin-top: 0.3rem;
    min-height: calc(100vh - 0.3rem);
    padding: 0 0.3rem;
  }
}
</style>
