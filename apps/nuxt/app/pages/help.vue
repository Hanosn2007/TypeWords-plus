<script setup lang="ts">
import { BasePage, Collapse } from '@typewords/base'
import { APP_NAME, GITHUB, Origin } from '@typewords/core/config/env.ts'
import ConflictNoticeText from '@typewords/core/components/dialog/ConflictNoticeText.vue'
const route = useRoute()
useSeoMeta({ title: APP_NAME + ' 使用帮助', description: '账号同步、单元学习、复习与数据保存说明', ogUrl: Origin + route.fullPath })
const questions = [
  { q: '数据保存在哪里？怎么在不同设备继续学习？', a: ['学习进度先保存在当前浏览器。登录本站账号后，可在“账号与数据”页上传或取回云端进度；本站账号与原 TypeWords 服务不互通。', '自动同步在窗口失焦或页面隐藏时触发，也可以点击“立即同步”。换设备前请确认同步成功；只保存在本机的进度不会自动出现在另一台设备。', '两端同时修改产生版本冲突时，会显示比较界面，由你确认如何处理，不按设备时间自动覆盖。'] },
  { q: '进度看起来变少或不见了，怎么办？', a: ['先确认网址、浏览器、浏览器个人资料和登录账号是否与上次一致。先不要清除网站数据、重置词书或用较旧记录覆盖。', '检查“账号与数据”中的同步状态和可用的历史记录；也可以先在“账号与数据”中导出当前数据，再反馈问题。浏览器本地保存与云端同步是两件事，看到旧云端进度不一定代表本机数据已经消失。', '无痕窗口、清除网站数据、磁盘或浏览器存储空间不足都可能影响本地保存。出现保存失败提示时，先保留页面并导出数据。'] },
  { q: '刷新、关闭标签页会丢掉进度吗？', a: ['已成功写入本机的进度通常会在刷新后保留。正在输入但尚未提交的半个单词不属于已完成答题。', '仍有未保存或未同步的更改时，正常关闭或刷新可能出现浏览器离开提示。先完成保存和同步再换设备；浏览器被强制结束时不能保证显示提醒。'] },
  { q: '目前怎样安排复习？能查看记忆曲线吗？', a: ['已有 FSRS 间隔复习调度：根据答题表现计算后续复习时间，并从当前词书抽取到期词。尚未提供个人遗忘曲线或记忆保持率曲线图。', '到期复习不只限于选中的单元。“重练本单元”和“自由练习”也不等于自动到期复习。算法调度不代表已经实现完整的记忆曲线展示。'] },
  { q: '如何查看单元词表、切换单元和继续未完成的练习？', a: ['带单元的词书可点击“单元词表”查看各课单词；浏览词表不会改变本次学习范围。', '不同单元分别保存正式任务和自由练习现场。切走后再选回来可以继续；同一本书中重复出现的词仍共享学习状态和 FSRS。', '没有分课的词书仍按整本词书使用，不需要手动创建 Lesson 1。'] },
  { q: '每轮单词太多，或者学习流程太长，怎么调整？', a: ['在“当前词书设置”或任务旁的“更改”调整每轮新词。分单元词书支持“跟随单元”和自定义数量；按数量时不会跨单元补齐。', '已开始的任务保留原词表。可以选择自测、听写、默写等练习方式；阶段按钮也可跳过当前阶段，误操作后可在支持时撤销。'] },
  { q: '自由练习会修改正式进度吗？', a: ['自由练习有独立续学位置，不推进正式已学词数、不更新正式 FSRS，也不清除正在进行的正式任务。练习用时仍计入学习统计。'] },
  { q: '可以导入自己的词书吗？同学怎么找到共同使用的词书？', a: ['支持 txt、JSON、xlsx 等单词导入；带单元的 JSON 可保留单元顺序。可在个人词书中添加和编辑词条。', '管理员发布的共享词书可直接在内置书库找到。同学添加后各自保存学习进度；词条问题可在练习页“反馈词条”，处理情况在“我的词书反馈”查看。'] },
  { q: '可以练习或导入文章吗？', a: ['文章入口保留跟打、听写和导入功能。文章与单词是不同的学习流程，本次单元任务升级主要针对词书。'] },
  { q: '手机、平板和浏览器缩放支持到什么程度？', a: ['可打开网页使用。窗口变窄或浏览器放大时，内容应换行，词表侧栏改为弹层，弹窗内部可以滚动。', '完整打字学习仍以桌面浏览器和实体键盘为主要使用场景。移动端软键盘、各浏览器快捷键和长时间离线体验尚未全部验收；如有遮挡，请反馈页面、窗口大小及缩放比例。'] },
  { q: '网站收费吗？账号由谁维护？', a: ['当前本站学习功能不收费，由 TypeWords Plus 独立维护。本项目基于开源 TypeWords 发展，本站功能、账号和反馈由本项目处理。'] },
  { q: '还有哪些已知限制？', a: ['部分词典、发音和辅助资源仍依赖外部服务，资源不可用时可能影响加载；本站尚不是完整离线应用。', '跨物理设备、长期离线、移动端软键盘及缩放交互仍在持续验收。出现问题请保留现场并反馈，不会把尚未验证的能力写成已经解决。'] },
]
</script>
<template>
  <BasePage>
    <article class="card-white help-content">
      <h1 class="text-2xl font-bold">{{ APP_NAME }} 使用帮助</h1>
      <p class="mt-3 opacity-70">按本站现有功能整理 · 更新于 2026-09-22</p>
      <p class="mt-2">反馈入口：<NuxtLink to="/library-feedback">我的词书反馈</NuxtLink> · <NuxtLink to="/feedback">问题与建议</NuxtLink></p>
      <section v-for="item in questions" :key="item.q" class="help-section"><Collapse :q="item.q" :a="item.a" /></section>
      <section class="help-section"><Collapse q="无法输入或快捷键和浏览器冲突"><ConflictNoticeText type="keyboard" /></Collapse></section>
      <section class="help-section"><Collapse q="按删除键却返回上一页"><ConflictNoticeText type="del" /></Collapse></section>
      <p class="mt-4">功能问题请通过<a :href="GITHUB + '/issues'" target="_blank" rel="noopener noreferrer">本项目 Issues</a>反馈，请勿公开密码、登录令牌或完整学习数据备份。</p>
    </article>
  </BasePage>
</template>
<style scoped>
.help-content { width: 100%; max-width: 58rem; margin: 0 auto; box-sizing: border-box; overflow-wrap: anywhere; }
.help-section { border-bottom: 1px solid var(--color-line); }
</style>
