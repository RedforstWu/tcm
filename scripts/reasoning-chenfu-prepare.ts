import { readdir, unlink } from 'node:fs/promises'
import path from 'node:path'
import type { Clause, Formula } from '../src/types/data.ts'
import { clauseReasoningHash } from './lib/chenfu-reasoning-build.ts'
import { REASONING_VOCAB } from './lib/chenfu-reasoning-vocab.ts'
import { ensureDir, fileExists, projectRoot, readText, writeJson } from './lib/fs-utils.ts'

const BATCH_SIZE = 30
const BOOKS = ['funvke', 'funanke', 'shishi', 'bianzheng'] as const

export interface ReasoningInputEntry {
  clauseId: string
  contentHash: string
  book: string
  chapter: string
  heading?: string
  text: string
  formulas: Array<{
    formulaId: string
    name: string
    preparation: string
    fangjie: string
  }>
}

async function loadMergedHashes(book: string): Promise<Map<string, string>> {
  const cachePath = path.join(projectRoot(), 'data', 'annotations', 'chenfu-reasoning', `${book}.json`)
  const map = new Map<string, string>()
  if (!(await fileExists(cachePath))) return map
  try {
    const raw = JSON.parse(await readText(cachePath)) as {
      entries?: Array<{ clauseId: string; contentHash: string }>
    }
    for (const entry of raw.entries ?? []) map.set(entry.clauseId, entry.contentHash)
  } catch (error) {
    console.warn(`[reasoning-chenfu:prepare] skip broken cache ${cachePath}:`, error)
  }
  return map
}

async function prepareBook(book: string, clauses: Clause[], formulas: Formula[]): Promise<number> {
  const inputDir = path.join(projectRoot(), 'data', 'annotations', 'chenfu-reasoning', 'input')
  await ensureDir(inputDir)

  for (const file of await readdir(inputDir)) {
    if (file.startsWith(`${book}-`) && file.endsWith('.json')) {
      await unlink(path.join(inputDir, file))
    }
  }

  const cached = await loadMergedHashes(book)
  const formulaByClause = new Map<string, Formula[]>()
  for (const formula of formulas) {
    if (formula.book !== book) continue
    for (const clauseId of formula.sourceClauseIds) {
      const list = formulaByClause.get(clauseId) ?? []
      list.push(formula)
      formulaByClause.set(clauseId, list)
    }
  }

  const pending: ReasoningInputEntry[] = []
  for (const clause of clauses) {
    const clauseFormulas = formulaByClause.get(clause.id) ?? []
    const hash = clauseReasoningHash(clause, clauseFormulas)
    if (cached.get(clause.id) === hash) continue
    pending.push({
      clauseId: clause.id,
      contentHash: hash,
      book: clause.book,
      chapter: clause.chapter,
      heading: clause.heading,
      text: clause.text,
      formulas: clauseFormulas.map((formula) => ({
        formulaId: formula.id,
        name: formula.name,
        preparation: formula.preparation,
        fangjie: formula.fangjie ?? '',
      })),
    })
  }

  let batchIndex = 0
  for (let start = 0; start < pending.length; start += BATCH_SIZE) {
    batchIndex += 1
    await writeJson(path.join(inputDir, `${book}-${String(batchIndex).padStart(3, '0')}.json`), {
      book,
      batch: batchIndex,
      promptFile: 'data/annotations/chenfu-reasoning/prompt.md',
      vocab: REASONING_VOCAB,
      entries: pending.slice(start, start + BATCH_SIZE),
    })
  }
  console.log(`[reasoning-chenfu:prepare] ${book} pending=${pending.length} batches=${batchIndex}`)
  return batchIndex
}

async function main(): Promise<void> {
  const bookFilter = process.argv[2]
  const dataDir = path.join(projectRoot(), 'public', 'data')
  const formulas = JSON.parse(await readText(path.join(dataDir, 'formulas.json'))) as Formula[]
  for (const book of BOOKS) {
    if (bookFilter && bookFilter !== book) continue
    const clauses = JSON.parse(
      await readText(path.join(dataDir, `clauses-${book}.json`)),
    ) as Clause[]
    await prepareBook(book, clauses, formulas)
  }
}

const isDirectRun = process.argv[1]?.includes('reasoning-chenfu-prepare')
if (isDirectRun) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
