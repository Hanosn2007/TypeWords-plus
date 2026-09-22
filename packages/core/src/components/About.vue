<script setup lang="ts">
import { APP_NAME, GITHUB, UPSTREAM_GITHUB } from '../config/env.ts'
</script>
<template>
  <section class="project-about">
    <h1>{{ APP_NAME }}</h1>
    <p>独立维护的单词与文章练习项目。本站包含账号同步、FSRS 复习、共享词书和按单元独立续学。</p>
    <h2>问题与反馈</h2>
    <p><RouterLink to="/help">使用帮助与已知限制</RouterLink></p>
    <p>共享词书内容有误：在练习中点击“反馈词条”，或到<RouterLink to="/library-feedback">我的词书反馈</RouterLink>查看处理状态。</p>
    <p>功能、布局及建议：<a :href="GITHUB + '/issues'" target="_blank" rel="noopener noreferrer">本项目 Issues</a>。请附页面、操作步骤及浏览器缩放比例，不要公开账号密码或完整数据备份。</p>
    <h2>源码与致谢</h2>
    <p>当前维护仓库：<a :href="GITHUB" target="_blank" rel="noopener noreferrer">TypeWords-plus</a>。</p>
    <p>基于 <a :href="UPSTREAM_GITHUB" target="_blank" rel="noopener noreferrer">zyronon / TypeWords</a> 开发，保留原作者及贡献者署名和 GPL-3.0 许可证。本站账号、发布与反馈由本项目独立处理，不与上游服务互通。</p>
    <p>部分词典、语音及辅助资源仍来自外部服务。现阶段独立维护不表示所有资源都已迁到本站。</p>
  </section>
</template>
<style scoped>
.project-about { width: 100%; max-width: 48rem; min-width: 0; overflow-wrap: anywhere; line-height: 1.8; }
h1 { font-size: 1.6rem; font-weight: 700; } h2 { font-size: 1.1rem; font-weight: 650; margin-top: 1.5rem; } p { margin: .8rem 0; }
</style>
