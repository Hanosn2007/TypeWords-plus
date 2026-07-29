<script setup lang="ts">
import { InputNumber } from '@typewords/base'
import SettingItem from './SettingItem.vue'
import { useSettingStore } from '../../stores/setting.ts'
import { BaseButton, Switch } from '@typewords/base'
import { useRouter } from 'vue-router'
const settingStore = useSettingStore()
const router = useRouter()
</script>

<template>
  <p>
    {{ $t('fsrs_desc') }}
  </p>

  <BaseButton type="info" @click="router.push('/fsrs')"> 学习记录 </BaseButton>

  <div class="line mt-4 mb-4"></div>

  <h3 class="mt-4">逐字母阶段</h3>
  <p>按错键次数进行评级。以下阈值只作用于设置为“逐字母”的阶段。</p>

  <SettingItem :title="$t('fsrs_easy_limit')">
    {{ $t('less_or_equals') }}
    <InputNumber :min="0" :max="settingStore.fsrsGoodLimit" v-model="settingStore.fsrsEasyLimit" />
    {{ $t('times') }}
    {{ $t('wrong') }}
  </SettingItem>
  <SettingItem :title="$t('fsrs_good_limit')">
    {{ $t('less_or_equals') }}
    <InputNumber
      :min="settingStore.fsrsEasyLimit"
      :max="settingStore.fsrsHardLimit"
      v-model="settingStore.fsrsGoodLimit"
    />
    {{ $t('times') }}
    {{ $t('wrong') }}
  </SettingItem>
  <SettingItem :title="$t('fsrs_hard_limit')">
    {{ $t('less_or_equals') }}
    <InputNumber :min="settingStore.fsrsGoodLimit" :max="10" v-model="settingStore.fsrsHardLimit" />
    {{ $t('times') }}
    {{ $t('wrong') }}
  </SettingItem>

  <h3 class="mt-4">整词输入阶段</h3>
  <p>按完整作答结果评级：首次正确为 Good；首次错误后自行改正为 Hard；再次错误、查看答案或跳过为 Again。</p>

  <div class="line mt-4 mb-4"></div>

  <details>
    <summary class="mt-4 mb-4">{{ $t('fsrs_advanced') }}</summary>

    <div class="pl-8">
      <SettingItem :title="$t('fsrs_advanced_enable_fuzz')" :desc="$t('fsrs_advanced_enable_fuzz_desc')">
        <Switch v-model="settingStore.fsrsParameters.enable_fuzz" />
      </SettingItem>

      <SettingItem :title="$t('fsrs_advanced_request_retention')">
        <InputNumber v-model="settingStore.fsrsParameters.request_retention" :min="0" :max="1" />
      </SettingItem>

      <SettingItem :title="$t('fsrs_advanced_maximum_interval')">
        <InputNumber v-model="settingStore.fsrsParameters.maximum_interval" :min="0" />
      </SettingItem>

      <details>
        <summary class="mt-4 mb-4">{{ $t('fsrs_advanced_weight') }}</summary>
        <div v-for="(_, index) in settingStore.fsrsParameters.w" class="mt-4 mb-4">
          <InputNumber v-model="settingStore.fsrsParameters.w[index]" />
        </div>
      </details>
    </div>
  </details>

  <div class="line mt-4 mb-4"></div>
</template>

<style scoped lang="scss"></style>
