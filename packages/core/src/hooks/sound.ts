import { onMounted, watchEffect } from 'vue'
import { useSettingStore } from '../stores/setting'
import { ref } from 'vue'

import { ENV, PronunciationApi, SoundFileOptions } from '../config/env'

/**
 * 获取当前浏览器的 OS+浏览器 组合 key，用于 ttsVoiceMap 的索引
 * 返回如 "mac+chrome" / "windows+edge" / "ios+safari" 等固定组合
 */
export function getBrowserKey(): string {
  if (typeof navigator === 'undefined') return 'unknown+unknown'
  const ua = navigator.userAgent

  let os = 'unknown'
  if (/iPad|iPhone|iPod/.test(ua)) {
    os = 'ios'
  } else if (/Android/.test(ua)) {
    os = 'android'
  } else if (/Macintosh|Mac OS X/.test(ua)) {
    os = 'mac'
  } else if (/Windows/.test(ua)) {
    os = 'windows'
  } else if (/Linux/.test(ua)) {
    os = 'linux'
  }

  let browser = 'unknown'
  if (/Edg\//.test(ua)) {
    browser = 'edge'
  } else if (/OPR\/|Opera/.test(ua)) {
    browser = 'opera'
  } else if (/Chrome\//.test(ua)) {
    browser = 'chrome'
  } else if (/Firefox\//.test(ua)) {
    browser = 'firefox'
  } else if (/Safari\//.test(ua)) {
    browser = 'safari'
  }

  return `${os}+${browser}`
}

export function useSound(audioSrcList?: string[], audioFileLength?: number) {
  let audioList = ref<HTMLAudioElement[]>([])
  let audioLength = ref(1)
  let index = ref(0)

  onMounted(() => {
    if (audioSrcList) setAudio(audioSrcList, audioFileLength)
  })

  //这里同一个音频弄好几份是为了快速打字是，可同时发音
  function setAudio(audioSrcList2: string[], audioFileLength2?: number) {
    //@ts-ignore
    if (import.meta.server) return
    if (audioFileLength2) audioLength.value = audioFileLength2
    audioList.value = []
    for (let i = 0; i < audioLength.value; i++) {
      audioSrcList2.forEach(src => {
        const audio = new Audio(new URL(src, ENV.RESOURCE_URL).href)
        audio.preload = 'auto'
        audioList.value.push(audio)
      })
    }
    index.value = 0
  }

  function play(volume: number = 100) {
    index.value++
    const listLength = audioList.value.length
    if (!listLength) return

    const htmlAudioElement = audioList.value[index.value % listLength]
    if (!htmlAudioElement) return

    htmlAudioElement.volume = volume / 100
    // 首次播放时媒体元数据可能尚未加载，此时强制写 currentTime 会在 play() 前抛错。
    if (htmlAudioElement.currentTime > 0) htmlAudioElement.currentTime = 0
    void htmlAudioElement.play().catch(error => {
      console.warn('[useSound] audio playback failed', error)
    })
  }

  return { play, setAudio }
}

export function usePlayKeyboardAudio() {
  const settingStore = useSettingStore()
  const { play, setAudio } = useSound()

  watchEffect(() => {
    if (!SoundFileOptions.find(v => v.label === settingStore.keyboardSoundFile)) {
      settingStore.keyboardSoundFile = '机械键盘2'
    }
    let urlList = getAudioFileUrl(settingStore.keyboardSoundFile)
    setAudio(urlList, urlList.length === 1 ? 4 : 1)
  })

  function playAudio() {
    if (settingStore.keyboardSound) {
      play(settingStore.keyboardSoundVolume)
    }
  }

  return playAudio
}

export function usePlayBeep() {
  const settingStore = useSettingStore()
  const { play } = useSound([`/sound/beep.wav`], 1)

  function playAudio() {
    if (settingStore.effectSound) {
      play(settingStore.effectSoundVolume)
    }
  }

  return playAudio
}

export function usePlayCorrect() {
  const settingStore = useSettingStore()
  const { play } = useSound([`/sound/correct.wav`], 1)

  function playAudio() {
    if (settingStore.effectSound) {
      play(settingStore.effectSoundVolume)
    }
  }

  return playAudio
}

const activeWordPlayCountMap = new Map<string, number>()

export function resetActiveWordPlayCount(word: string) {
  if (!word) return
  activeWordPlayCountMap.delete(word.trim().toLowerCase())
}

let isPlaying = false
let activeWordAudio: HTMLAudioElement | null = null

export function cancelWordPracticeAudio() {
  if (typeof speechSynthesis !== 'undefined') {
    speechSynthesis.pause()
    speechSynthesis.cancel()
  }
  if (activeWordAudio) {
    activeWordAudio.onended = null
    activeWordAudio.onerror = null
    activeWordAudio.pause()
    activeWordAudio.currentTime = 0
  }
  isPlaying = false
}

export function usePlayWordAudio() {
  const settingStore = useSettingStore()
  let audio = ref<HTMLAudioElement>(null)

  onMounted(() => {
    audio.value = new Audio()
  })

  function playAudio(word: string, handle: boolean = true, onEnd?: () => void) {
    if (!word || isPlaying) return
    isPlaying = true
    speechSynthesis.pause()
    speechSynthesis.cancel()
    let playbackRate = settingStore.wordSoundSpeed
    if (handle) {
      const key = word.trim().toLowerCase()
      const count = activeWordPlayCountMap.get(key) ?? 0
      if (count % 3 !== 0) {
        playbackRate = playbackRate * 0.75
      }
      activeWordPlayCountMap.set(key, count + 1)
    }
    // console.log('playAudio-handle', handle, playbackRate)

    let url = `${PronunciationApi}${word}&type=2`
    if (settingStore.soundType === 'uk') {
      url = `${PronunciationApi}${word}&type=1`
    }
    let onended = () => {
      isPlaying = false
      onEnd?.()
    }
    activeWordAudio = audio.value
    audio.value.onended = onended
    audio.value.src = url
    audio.value.volume = settingStore.wordSoundVolume / 100
    audio.value.playbackRate = playbackRate
    audio.value.play()
    audio.value.onerror = () => {
      const ttsPlay = useTTsPlayAudio()
      ttsPlay(word, { rate: playbackRate, onEnd: onended })
    }
  }

  return playAudio
}

function getVoicesAsync() {
  return new Promise(resolve => {
    const voices = speechSynthesis.getVoices()
    if (voices.length) return resolve(voices)

    speechSynthesis.onvoiceschanged = () => {
      resolve(speechSynthesis.getVoices())
    }
  })
}

export interface TTsPlayOptions {
  rate?: number
  volume?: number
  pitch?: number
  lang?: string
  onEnd?: () => void
}

export function useTTsPlayAudio() {
  const settingStore = useSettingStore()

  function play(text: string, options: TTsPlayOptions = {}) {
    if (!text || typeof speechSynthesis === 'undefined') return
    speechSynthesis.cancel() // 防止 Chrome 队列卡死
    let msg = new SpeechSynthesisUtterance(text)
    msg.rate = options.rate ?? settingStore.wordSoundSpeed
    msg.volume = options.volume ?? settingStore.wordSoundVolume / 100
    msg.pitch = options.pitch ?? 1
    msg.lang = options.lang ?? 'en-US'
    msg.onend = () => options.onEnd?.()
    msg.onerror = () => options.onEnd?.()
    getVoicesAsync().then((voices: any[]) => {
      // 优先使用用户在当前浏览器配置的声色
      const browserKey = getBrowserKey()
      const savedVoiceName = settingStore?.ttsVoiceMap?.find(v => v.key === browserKey)?.voice
      if (savedVoiceName) {
        const savedVoice = voices.find(v => v.name === savedVoiceName)
        if (savedVoice) {
          msg.voice = savedVoice
          speechSynthesis.speak(msg)
          return
        }
      }
      // 回退：优先找 Emma / US，否则取第一个英文声色
      let voiceList = voices.filter(v => v.lang === 'en-US')
      if (voiceList && voiceList.length) {
        msg.voice = voiceList.find(v => v.name.includes('US') || v.name.includes('Emma')) ?? voiceList[0]
      }
      speechSynthesis.speak(msg)
    })
  }

  return play
}

export function usePlayAudio(url: string) {
  new Audio(url).play().then(r => void 0)
}

export function getAudioFileUrl(name: string) {
  if (name === '机械键盘') {
    return [
      `/sound/key-sounds/jixie/机械0.mp3`,
      `/sound/key-sounds/jixie/机械1.mp3`,
      `/sound/key-sounds/jixie/机械2.mp3`,
      `/sound/key-sounds/jixie/机械3.mp3`,
    ]
  } else {
    return [`/sound/key-sounds/${name}.mp3`]
  }
}
