import { createHash } from 'node:crypto'
import path from 'node:path'
import type { Clause, Formula } from '../src/types/data.ts'
import { VOCAB } from './lib/chenfu-vocab.ts'
import { ensureDir, fileExists, projectRoot, readText, writeJson } from './lib/fs-utils.ts'
import { runFunvkeParse } from './parse/funvke.ts'
import { runFunankeParse } from './parse/funanke.ts'
import { runBianzhengParse } from './parse/bianzheng.ts'
import { runShishiParse } from './parse/shishi.ts'

const BATCH_SIZE = 30

interface EnrichInputEntry {
  clauseId: string
  contentHash: string
  book: string
  heading?: string
  text: string
  misjudgment?: Clause['misjudgment']
  formulas: Array<{
    formulaId: string
    name: string
    fangjie: string
    herbs: Array<{ herbId: string; name: string; doseRaw: string }>
  }>
}

function contentHash(text: string, fangjieParts: string[]): string {
  return createHash('sha256')
    .update(text)
    .update('\n')
    .update(fangjieParts.join('\n'))
    .digest('hex')
    .slice(0, 16)
}

async function loadMergedCache(book: string): Promise<Map<string, string>> {
  const root = projectRoot()
  const cachePath = path.join(root, 'data', 'annotations', 'chenfu-llm', `${book}.json`)
  const map = new Map<string, string>()
  if (!(await fileExists(cachePath))) return map
  try {
    const raw = JSON.parse(await readText(cachePath)) as {
      entries?: Array<{ clauseId: string; contentHash: string }>
    }
    for (const entry of raw.entries ?? []) {
      map.set(entry.clauseId, entry.contentHash)
    }
  } catch {
    // ignore
  }
  return map
}

async function prepareBook(
  book: string,
  clauses: Clause[],
  formulas: Formula[],
): Promise<number> {
  const root = projectRoot()
  const inputDir = path.join(root, 'data', 'annotations', 'chenfu-llm', 'input')
  await ensureDir(inputDir)

  const cache = await loadMergedCache(book)
  const formulaByClause = new Map<string, Formula[]>()
  for (const formula of formulas) {
    for (const clauseId of formula.sourceClauseIds) {
      const list = formulaByClause.get(clauseId) ?? []
      list.push(formula)
      formulaByClause.set(clauseId, list)
    }
  }

  const pending: EnrichInputEntry[] = []
  for (const clause of clauses) {
    const clauseFormulas = formulaByClause.get(clause.id) ?? []
    const fangjieParts = clauseFormulas.map((f) => f.fangjie ?? '')
    const hash = contentHash(clause.text, fangjieParts)
    if (cache.get(clause.id) === hash) continue
    if (clauseFormulas.length === 0) continue
    pending.push({
      clauseId: clause.id,
      contentHash: hash,
      book: clause.book,
      heading: clause.heading,
      text: clause.text,
      misjudgment: clause.misjudgment,
      formulas: clauseFormulas.map((formula) => ({
        formulaId: formula.id,
        name: formula.name,
        fangjie: formula.fangjie ?? '',
        herbs: formula.herbs.map((herb) => ({
          herbId: herb.herbId,
          name: herb.name,
          doseRaw: herb.doseRaw,
        })),
      })),
    })
  }

  // 清理旧批次
  // 写入新批次
  let batchIndex = 0
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    batchIndex += 1
    const slice = pending.slice(i, i + BATCH_SIZE)
    const filename = `${book}-${String(batchIndex).padStart(3, '0')}.json`
    await writeJson(path.join(inputDir, filename), {
      book,
      batch: batchIndex,
      promptFile: 'data/annotations/chenfu-llm/prompt.md',
      vocab: VOCAB,
      entries: slice,
    })
  }

  console.log(`[enrich:prepare] ${book} pending=${pending.length} batches=${batchIndex}`)
  return batchIndex
}

async function main(): Promise<void> {
  const bookFilter = process.argv[2] // optional: funvke

  const jobs: Array<() => Promise<number>> = []

  if (!bookFilter || bookFilter === 'funvke') {
    jobs.push(async () => {
      const r = await runFunvkeParse()
      return prepareBook('funvke', r.clauses, r.formulas)
    })
  }
  if (!bookFilter || bookFilter === 'funanke') {
    jobs.push(async () => {
      const r = await runFunankeParse()
      return prepareBook('funanke', r.clauses, r.formulas)
    })
  }
  if (!bookFilter || bookFilter === 'bianzheng') {
    jobs.push(async () => {
      const r = await runBianzhengParse()
      return prepareBook('bianzheng', r.clauses, r.formulas)
    })
  }
  if (!bookFilter || bookFilter === 'shishi') {
    jobs.push(async () => {
      const r = await runShishiParse()
      return prepareBook('shishi', r.clauses, r.formulas)
    })
  }

  for (const job of jobs) {
    await job()
  }
  console.log('[enrich:prepare] done')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
