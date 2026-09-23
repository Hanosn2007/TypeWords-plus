import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { effectScope, nextTick, reactive, ref, watch } from 'vue'
import ts from 'typescript'

// Run the component's actual watcher/reset with audio and DOM effects stubbed.
const source = readFileSync(new URL('../src/components/word/TypeWord.vue', import.meta.url), 'utf8')
const start = source.indexOf('\nwatch(\n')
const end = source.indexOf('// 同步输入和锁定状态', start)
const resetCode = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText

function fixture() {
  const props = reactive({ word: { word: 'apple' }, initialWrongTimes: 0 })
  const practiceStore = reactive({ stage: 'identify' })
  const settingStore = reactive({ wordPracticeType: 'identify', wordSound: false })
  const scope = effectScope()
  const state = scope.run(() => new Function('watch', 'ref', 'props', 'practiceStore', 'settingStore', `
    let input = 'apple', wrong = '', showFullWord = true, selectIndex = 2;
    let wordRepeatCount = 0, inputLock = true, completeSelect = true, showAllCandidates = true;
    let editingNote, noteInputValue, currentPracticeSentenceIndex, wordCompletedTime;
    let wholeFailureCount, wholeSoftError, wholeCorrectionPending, wholeAutoRearmed, wholeInputTipKey;
    const showWordResult = ref(true), wrongTimes = ref(2), highlightedSentenceIndex = ref(1);
    const WordPlayTrigger = { NewWord: 'new' }, WordPracticeType = { Dictation: 'dictation' };
    const clearJumpTimer = () => {}, cancelWordPracticeAudio = () => {};
    const resetActiveWordPlayCount = () => {}, playWord = () => {};
    const updateCurrentWordInfo = () => {}, checkCursorPosition = () => {}, focusWholeInput = () => {};
    ${resetCode}
    return {
      read: () => ({ input, inputLock, result: showWordResult.value, showFullWord, selectIndex }),
      type: value => { input = value; }
    };
  `)(watch, ref, props, practiceStore, settingStore))
  return { props, practiceStore, settingStore, state, scope }
}

for (const change of ['stage', 'type', 'word']) {
  test(`clears the previous answer on ${change} change`, async () => {
    const f = fixture()
    try {
      if (change === 'stage') f.practiceStore.stage = 'dictation'
      if (change === 'type') f.settingStore.wordPracticeType = 'dictation'
      if (change === 'word') f.props.word = { word: 'pear' }
      await nextTick()
      assert.deepEqual(f.state.read(), { input: '', inputLock: false, result: false, showFullWord: false, selectIndex: -1 })
      f.state.type('app')
      f.settingStore.wordSound = true
      await nextTick()
      assert.equal(f.state.read().input, 'app', 'ordinary settings must not erase an in-progress answer')
    } finally { f.scope.stop() }
  })
}
