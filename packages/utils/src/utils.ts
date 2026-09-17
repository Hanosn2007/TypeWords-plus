import { onUnmounted, watch, type WatchSource } from 'vue'

type EventListenerWindow = Window & { disableEventListener?: boolean }

const eventListenerLocks = new Set<symbol>()

function syncEventListenerState() {
  ;(window as EventListenerWindow).disableEventListener = eventListenerLocks.size > 0
}

//因为如果用useStartKeyboardEventListener局部变量控制，当出现多个hooks时就不行了，所以用全局变量来控制
export function useDisableEventListener(watchVal: WatchSource<unknown>) {
  if (typeof window === 'undefined') return
  const lock = Symbol('disable-event-listener')
  watch(
    watchVal,
    n => {
      if (n) eventListenerLocks.add(lock)
      else eventListenerLocks.delete(lock)
      syncEventListenerState()
    },
    { immediate: true }
  )

  onUnmounted(() => {
    eventListenerLocks.delete(lock)
    syncEventListenerState()
  })
}

export default class utils {}
