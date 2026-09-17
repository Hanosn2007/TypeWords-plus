import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { parseLibraryImport, parseLibraryRows, parseLibraryTranslations } from '../packages/core/src/utils/libraryImport.ts'
import { VOCABULARY6000_LESSONS } from '../packages/core/src/data/vocabulary6000.ts'

// Read-only workbook extraction with the bundled spreadsheet runtime. Run with
// Node 24+; optional arguments override the source directory and runtime modules.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(process.argv[2] ?? join(root, '..', 'outputs', 'vocabulary6000'))
const runtimeModules = resolve(process.argv[3] ?? join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'))
const scratch = await mkdtemp(join(tmpdir(), 'typewords-library-seed-'))
await symlink(runtimeModules, join(scratch, 'node_modules'), 'dir')
const require = createRequire(join(scratch, 'loader.cjs'))
const { FileBlob, SpreadsheetFile } = await import(pathToFileURL(require.resolve('@oai/artifact-tool')).href)

const workbookPath = join(source, '新东方Vocabulary6000-TypeWords.xlsx')
const workbookHash = createHash('sha256').update(await readFile(workbookPath)).digest('hex')
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(workbookPath))
console.log((await workbook.inspect({ kind: 'sheet', include: 'id,name', maxChars: 1500 })).ndjson)
const [headers, ...matrix] = workbook.worksheets.getItem('单词').getUsedRange().values
assert.deepEqual(headers, ['单词', '音标①', '音标②', '翻译', '例句', '短语', '近义词', '同根词', '词源', '笔记'])
const rows = matrix.filter(row => row.some(value => value != null && value !== ''))
  .map(row => Object.fromEntries(headers.map((header, index) => [header, row[index]])))
const imported = parseLibraryRows(rows, '新东方 Vocabulary 6000')
const supplement = JSON.parse(await readFile(join(root, 'data/library/sources/vocabulary6000-official-supplement.json'), 'utf8'))
assert.deepEqual(supplement.requestedWords, ['profound', 'wholesome'])
assert.equal(supplement.response.success, true)
assert.deepEqual(supplement.response.data.missing, [])
const supplementedWords = []
for (const word of imported.content.words) {
  if (word.trans?.some(item => item.cn.trim())) continue
  assert.ok(supplement.requestedWords.includes(word.word), `Unexpected missing definition: ${word.word}`)
  const found = supplement.response.data.list.find(item => item.word === word.word)
  assert.ok(found?.trans?.length, `Supplement has no definition for ${word.word}`)
  word.trans = parseLibraryTranslations(found.trans)
  supplementedWords.push(word.word)
}
imported.missingDefinitions = imported.content.words.filter(word => !word.trans?.some(item => item.cn.trim())).length
const units = parseLibraryImport(await readFile(join(source, '新东方Vocabulary6000-单元.json'), 'utf8'), 'json').content.units
assert.deepEqual(units, VOCABULARY6000_LESSONS, 'The source Unit JSON and existing lesson data disagree.')
assert.equal(units.length, 31)
assert.ok(units.every(unit => unit.words.length === 40))
assert.equal(imported.duplicates, 0)
assert.equal(imported.content.words.length, 1240)
assert.equal(imported.missingDefinitions, 0, `Missing definitions: ${imported.content.words.filter(word => !word.trans?.some(item => item.cn)).map(word => word.word).join(', ')}`)
assert.deepEqual(imported.content.words.map(word => word.word), units.flatMap(unit => unit.words), 'Workbook and lesson order must match exactly.')
assert.ok(imported.content.words.every(word => word.trans.every(item => item.cn.trim())), 'Every translation item must have a definition.')

const content = {
  ...imported.content,
  description: '新东方词汇进阶 Vocabulary 6000，按原书 Lesson 1–31 编排，共 1240 个词。',
  category: '学校词书',
  tags: ['英语', 'Vocabulary 6000'],
  recommended: true,
  sortOrder: 10,
  units,
}
assert.deepEqual(parseLibraryImport(JSON.stringify(content), 'json').content, content, 'Public JSON must round-trip without data loss.')
assert.equal(createHash('sha256').update(await readFile(workbookPath)).digest('hex'), workbookHash, 'Source workbook must remain untouched.')
const output = join(root, 'data', 'library', 'vocabulary6000.json')
await mkdir(dirname(output), { recursive: true })
await writeFile(output, JSON.stringify(content, null, 2) + '\n')
console.log(JSON.stringify({
  output, units: units.length, words: content.words.length, missingDefinitions: imported.missingDefinitions,
  translations: content.words.reduce((total, word) => total + word.trans.length, 0),
  sentences: content.words.reduce((total, word) => total + word.sentences.length, 0),
  phonetics: content.words.filter(word => word.phonetic0 || word.phonetic1).length,
  phrases: content.words.reduce((total, word) => total + word.phrases.length, 0),
  synonyms: content.words.reduce((total, word) => total + (word.synos?.length ?? 0), 0),
  etymologies: content.words.reduce((total, word) => total + (word.etymology?.length ?? 0), 0),
  sourceWorkbookSha256: workbookHash, supplementedWords, supplementQueriedAt: supplement.queriedAt, warnings: imported.warnings,
}, null, 2))
