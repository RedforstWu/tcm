import path from 'node:path'
import { readdir } from 'node:fs/promises'
import {
  countDisputeKinds,
  validateEntry,
  type ChenfuCase,
  type RawEntry,
  type ValidationInput,
} from './lib/chenfu-reasoning-validate.ts'
import { ensureDir, fileExists, projectRoot, readText, writeJson } from './lib/fs-utils.ts'

const HARD_REJECT_WARN_RATE = 0.2

interface MergedEntry {
  clauseId: string
  contentHash: string
  cases: ChenfuCase[]
}

async function loadInputIndex(inputDir: string): Promise<Map<string, ValidationInput>> {
  const map = new Map<string, ValidationInput>()
  if (!(await fileExists(inputDir))) return map
  for (const file of (await readdir(inputDir)).filter((name) => name.endsWith('.json'))) {
    const payload = JSON.parse(await readText(path.join(inputDir, file))) as {
      entries?: ValidationInput[]
    }
    for (const entry of payload.entries ?? []) map.set(entry.clauseId, entry)
  }
  return map
}

async function main(): Promise<void> {
  const baseDir = path.join(projectRoot(), 'data', 'annotations', 'chenfu-reasoning')
  const inputDir = path.join(baseDir, 'input')
  const outputDir = path.join(baseDir, 'output')
  await ensureDir(baseDir)

  if (!(await fileExists(outputDir))) {
    console.log('[reasoning-chenfu:validate] no output dir yet')
    return
  }

  const inputIndex = await loadInputIndex(inputDir)
  const rejects: Array<{ batch: string; clauseId: string; reason: string }> = []
  const byBook = new Map<string, MergedEntry[]>()

  for (const file of (await readdir(outputDir)).filter((name) => name.endsWith('.json')).sort()) {
    const book = file.replace(/-\d+\.json$/, '')
    let payload: { entries?: RawEntry[] }
    try {
      payload = JSON.parse(await readText(path.join(outputDir, file))) as { entries?: RawEntry[] }
    } catch (error) {
      console.error(`[reasoning-chenfu:validate] ${file} invalid JSON:`, error)
      rejects.push({ batch: file, clauseId: '*', reason: 'invalid JSON' })
      continue
    }

    let total = 0
    let hardRejected = 0
    let fieldRejects = 0
    for (const rawEntry of payload.entries ?? []) {
      total += 1
      const clauseId = typeof rawEntry.clauseId === 'string' ? rawEntry.clauseId : '?'
      const result = validateEntry(rawEntry, inputIndex.get(clauseId))
      for (const reason of result.rejects) rejects.push({ batch: file, clauseId, reason })
      fieldRejects += result.rejects.length
      if (result.hardReject) {
        hardRejected += 1
        continue
      }
      const list = byBook.get(book) ?? []
      list.push({ clauseId, contentHash: String(rawEntry.contentHash), cases: result.cases })
      byBook.set(book, list)
    }
    const rate = total === 0 ? 0 : hardRejected / total
    console.log(
      `[reasoning-chenfu:validate] ${file} entries=${total} hardRejected=${hardRejected} fieldRejects=${fieldRejects}`,
    )
    if (rate > HARD_REJECT_WARN_RATE) {
      console.warn(`[reasoning-chenfu:validate] WARN ${file} hard reject rate ${(rate * 100).toFixed(1)}%`)
    }
  }

  for (const [book, entries] of byBook) {
    const cachePath = path.join(baseDir, `${book}.json`)
    let existing: MergedEntry[] = []
    if (await fileExists(cachePath)) {
      try {
        existing = (JSON.parse(await readText(cachePath)) as { entries?: MergedEntry[] }).entries ?? []
      } catch (error) {
        console.warn(`[reasoning-chenfu:validate] ignore broken cache ${cachePath}:`, error)
      }
    }
    const merged = new Map(existing.map((entry) => [entry.clauseId, entry]))
    for (const entry of entries) merged.set(entry.clauseId, entry)
    const all = [...merged.values()].sort((left, right) => left.clauseId.localeCompare(right.clauseId))
    await writeJson(cachePath, { book, reviewStatus: 'ai-draft', entries: all })

    const cases = all.flatMap((entry) => entry.cases)
    const counts = countDisputeKinds(cases)
    console.log(
      `[reasoning-chenfu:validate] ${book} entries=${all.length} cases=${cases.length} ` +
        `误诊=${counts.misdiagnosis} 误治=${counts.mistreatment} 用药辨难=${counts.drugDoubt} ` +
        `世俗之见=${counts.commonPractice} 直述证治=${counts.none}`,
    )
  }

  await writeJson(path.join(baseDir, 'rejects.json'), {
    generatedAt: new Date().toISOString(),
    rejects,
  })
  console.log(`[reasoning-chenfu:validate] rejects=${rejects.length}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
