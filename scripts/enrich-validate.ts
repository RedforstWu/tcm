import path from 'node:path'
import { readdir } from 'node:fs/promises'
import type { HerbRole, Misjudgment } from '../src/types/data.ts'
import { isAllowedPathogenesis, isAllowedSymptom } from './lib/chenfu-vocab.ts'
import { ensureDir, fileExists, projectRoot, readText, writeJson } from './lib/fs-utils.ts'

interface LlmHerbRole {
  herbId: string
  roleText: string
  mechanism?: string
  sourceSentence: string
}

interface LlmFormula {
  formulaId: string
  herbRoles: LlmHerbRole[]
}

interface LlmEntry {
  clauseId: string
  contentHash: string
  symptomTags?: string[]
  pathogenesisTags?: string[]
  misjudgment?: Misjudgment | null
  formulas?: LlmFormula[]
}

interface InputEntry {
  clauseId: string
  contentHash: string
  text: string
  formulas: Array<{
    formulaId: string
    fangjie: string
    herbs: Array<{ herbId: string; name: string }>
  }>
}

interface Reject {
  batch: string
  clauseId: string
  reason: string
}

function normalize(text: string): string {
  return text.replace(/\s+/g, '')
}

export function validateLlmEntry(
  entry: LlmEntry,
  input: InputEntry | undefined,
): { ok: HerbRole[]; rejects: string[]; tags: { symptomTags: string[]; pathogenesisTags: string[]; misjudgment?: Misjudgment } } {
  const rejects: string[] = []
  const ok: HerbRole[] = []

  if (!input) {
    return {
      ok: [],
      rejects: ['missing input entry'],
      tags: { symptomTags: [], pathogenesisTags: [] },
    }
  }
  if (entry.contentHash !== input.contentHash) {
    rejects.push('contentHash mismatch')
  }

  const symptomTags = (entry.symptomTags ?? []).filter((tag) => {
    if (!isAllowedSymptom(tag)) {
      rejects.push(`symptomTag not in vocab: ${tag}`)
      return false
    }
    return true
  })
  const pathogenesisTags = (entry.pathogenesisTags ?? []).filter((tag) => {
    if (!isAllowedPathogenesis(tag)) {
      rejects.push(`pathogenesisTag not in vocab: ${tag}`)
      return false
    }
    return true
  })

  for (const formula of entry.formulas ?? []) {
    const inputFormula = input.formulas.find((f) => f.formulaId === formula.formulaId)
    if (!inputFormula) {
      rejects.push(`unknown formulaId: ${formula.formulaId}`)
      continue
    }
    const herbIds = new Set(inputFormula.herbs.map((h) => h.herbId))
    const fangjieNorm = normalize(inputFormula.fangjie)

    for (const role of formula.herbRoles ?? []) {
      if (!herbIds.has(role.herbId)) {
        rejects.push(`herbId not in formula: ${role.herbId}`)
        continue
      }
      if (!role.sourceSentence || !fangjieNorm.includes(normalize(role.sourceSentence))) {
        // 方解为空时允许空句；否则必须是子串
        if (inputFormula.fangjie.trim()) {
          rejects.push(`sourceSentence not in fangjie: ${role.herbId}`)
          continue
        }
      }
      if (!role.roleText?.trim()) {
        rejects.push(`empty roleText: ${role.herbId}`)
        continue
      }
      ok.push({
        id: `${formula.formulaId}__${role.herbId}__llm`,
        formulaId: formula.formulaId,
        herbId: role.herbId,
        roleText: role.roleText.trim(),
        mechanism: role.mechanism,
        sourceSentence: role.sourceSentence ?? '',
        method: 'llm',
        reviewStatus: 'ai-draft',
        model: 'grok-4.5',
      })
    }
  }

  return {
    ok,
    rejects,
    tags: {
      symptomTags,
      pathogenesisTags,
      misjudgment: entry.misjudgment ?? undefined,
    },
  }
}

async function loadInputIndex(): Promise<Map<string, InputEntry>> {
  const root = projectRoot()
  const inputDir = path.join(root, 'data', 'annotations', 'chenfu-llm', 'input')
  const map = new Map<string, InputEntry>()
  if (!(await fileExists(inputDir))) return map
  const files = (await readdir(inputDir)).filter((f) => f.endsWith('.json'))
  for (const file of files) {
    const payload = JSON.parse(await readText(path.join(inputDir, file))) as {
      entries: InputEntry[]
    }
    for (const entry of payload.entries ?? []) {
      map.set(entry.clauseId, entry)
    }
  }
  return map
}

async function main(): Promise<void> {
  const root = projectRoot()
  const outputDir = path.join(root, 'data', 'annotations', 'chenfu-llm', 'output')
  const baseDir = path.join(root, 'data', 'annotations', 'chenfu-llm')
  await ensureDir(baseDir)

  const inputIndex = await loadInputIndex()
  const rejects: Reject[] = []
  const byBook = new Map<
    string,
    {
      entries: Array<{
        clauseId: string
        contentHash: string
        symptomTags: string[]
        pathogenesisTags: string[]
        misjudgment?: Misjudgment
        herbRoles: HerbRole[]
      }>
    }
  >()

  const batchStats = new Map<string, { total: number; rejected: number }>()

  if (!(await fileExists(outputDir))) {
    console.log('[enrich:validate] no output dir yet')
    await writeJson(path.join(baseDir, 'rejects.json'), { rejects: [] })
    return
  }

  const files = (await readdir(outputDir)).filter((f) => f.endsWith('.json'))
  for (const file of files) {
    const book = file.replace(/-\d+\.json$/, '')
    const payload = JSON.parse(await readText(path.join(outputDir, file))) as {
      entries?: LlmEntry[]
    }
    const stats = batchStats.get(file) ?? { total: 0, rejected: 0 }

    for (const entry of payload.entries ?? []) {
      stats.total += 1
      const input = inputIndex.get(entry.clauseId)
      const result = validateLlmEntry(entry, input)
      const roleRejects = result.rejects.filter((r) =>
        r.includes('herbId') || r.includes('sourceSentence') || r.includes('roleText') || r.includes('formulaId') || r.includes('contentHash') || r.includes('missing'),
      )
      // 标签拒收不整条作废；角色全无且有严重错误则计拒收
      if (roleRejects.includes('missing input entry') || roleRejects.includes('contentHash mismatch')) {
        stats.rejected += 1
        for (const reason of roleRejects) {
          rejects.push({ batch: file, clauseId: entry.clauseId, reason })
        }
        continue
      }
      for (const reason of result.rejects) {
        rejects.push({ batch: file, clauseId: entry.clauseId, reason })
      }

      const bucket = byBook.get(book) ?? { entries: [] }
      bucket.entries.push({
        clauseId: entry.clauseId,
        contentHash: entry.contentHash,
        symptomTags: result.tags.symptomTags,
        pathogenesisTags: result.tags.pathogenesisTags,
        misjudgment: result.tags.misjudgment,
        herbRoles: result.ok,
      })
      byBook.set(book, bucket)
    }
    batchStats.set(file, stats)
  }

  for (const [file, stats] of batchStats) {
    const rate = stats.total === 0 ? 0 : stats.rejected / stats.total
    console.log(
      `[enrich:validate] ${file} total=${stats.total} hardRejected=${stats.rejected} rate=${(rate * 100).toFixed(1)}%`,
    )
    if (rate > 0.2 && stats.total > 0) {
      console.warn(`[enrich:validate] WARN ${file} reject rate > 20%, re-run subagent after prompt fix`)
    }
  }

  for (const [book, payload] of byBook) {
    // 合并已有缓存
    const cachePath = path.join(baseDir, `${book}.json`)
    let existing: typeof payload.entries = []
    if (await fileExists(cachePath)) {
      try {
        const prev = JSON.parse(await readText(cachePath)) as { entries?: typeof payload.entries }
        existing = prev.entries ?? []
      } catch {
        existing = []
      }
    }
    const map = new Map(existing.map((e) => [e.clauseId, e]))
    for (const entry of payload.entries) {
      map.set(entry.clauseId, entry)
    }
    await writeJson(cachePath, {
      book,
      model: 'grok-4.5',
      reviewStatus: 'ai-draft',
      entries: [...map.values()],
    })
    console.log(`[enrich:validate] wrote ${cachePath} entries=${map.size}`)
  }

  await writeJson(path.join(baseDir, 'rejects.json'), { rejects, generatedAt: new Date().toISOString() })
  console.log(`[enrich:validate] rejects=${rejects.length}`)
}

const isDirectRun = process.argv[1]?.includes('enrich-validate')
if (isDirectRun) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
