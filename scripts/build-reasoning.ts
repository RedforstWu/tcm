/**
 * 仅构建 public/data/reasoning.json 与 reasoning-chenfu.json（依赖已有 public/data 方剂与条文）。
 * 完整流水线仍由 build-dataset.ts 一并输出。
 */
import path from 'node:path'
import type { Clause, Formula } from '../src/types/data.ts'
import {
  buildChenfuReasoningDataset,
  CHENFU_REASONING_BOOKS,
  loadChenfuCaches,
  type CompareTopicInput,
  type ParallelAlignment,
} from './lib/chenfu-reasoning-build.ts'
import { fileExists, projectRoot, readText, writeJson } from './lib/fs-utils.ts'
import {
  buildReasoningDataset,
  type FormulaReasoningInput,
  type ReasoningTreeInput,
} from './lib/reasoning.ts'

async function main(): Promise<void> {
  const root = projectRoot()
  const dataDir = path.join(root, 'public', 'data')
  const formulas = JSON.parse(await readText(path.join(dataDir, 'formulas.json'))) as Formula[]
  const books = ['songben', 'jingui', 'guilin'] as const
  const clauses: Clause[] = []
  for (const book of books) {
    const list = JSON.parse(await readText(path.join(dataDir, `clauses-${book}.json`))) as Clause[]
    clauses.push(...list)
  }
  const trees = JSON.parse(
    await readText(path.join(root, 'data', 'reasoning', 'trees.json')),
  ) as ReasoningTreeInput[]
  const formulaInputs = JSON.parse(
    await readText(path.join(root, 'data', 'reasoning', 'formulas.json')),
  ) as FormulaReasoningInput[]

  const reasoning = buildReasoningDataset(trees, formulaInputs, formulas, clauses)
  await writeJson(path.join(dataDir, 'reasoning.json'), reasoning)
  console.log(
    `[build-reasoning] trees=${reasoning.trees.length} formulas=${reasoning.formulas.length}`,
  )
  for (const formula of reasoning.formulas) {
    console.log(
      `  ${formula.formulaName} → ${formula.formulaId ?? '(未关联)'} clauses=${formula.clauseIds.length}`,
    )
  }

  const chenfuClauses: Clause[] = []
  for (const book of CHENFU_REASONING_BOOKS) {
    const list = JSON.parse(await readText(path.join(dataDir, `clauses-${book}.json`))) as Clause[]
    chenfuClauses.push(...list)
  }
  const parallelsPath = path.join(dataDir, 'parallels.json')
  let parallels: ParallelAlignment[] = []
  if (await fileExists(parallelsPath)) {
    const payload = JSON.parse(await readText(parallelsPath)) as {
      nvkeAlign?: ParallelAlignment[]
      nankeAlign?: ParallelAlignment[]
    }
    parallels = [...(payload.nvkeAlign ?? []), ...(payload.nankeAlign ?? [])]
  }
  const compareTopics = JSON.parse(
    await readText(path.join(root, 'data', 'reasoning', 'compare-topics.json')),
  ) as CompareTopicInput[]

  const chenfu = buildChenfuReasoningDataset({
    clauses: chenfuClauses,
    formulas,
    caches: await loadChenfuCaches(root),
    parallels,
    compareTopics,
    reasoningFormulaNames: formulaInputs.map((input) => input.formulaName),
  })
  await writeJson(path.join(dataDir, 'reasoning-chenfu.json'), chenfu)
  for (const [book, stat] of Object.entries(chenfu.stats)) {
    console.log(
      `[build-reasoning] chenfu ${book} records=${stat.records} annotated=${stat.annotated} cases=${stat.cases}`,
    )
  }
  for (const topic of chenfu.compareTopics) {
    console.log(`  对照 ${topic.title}: 陈傅病案 ${topic.chenfuCaseIds.length}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
