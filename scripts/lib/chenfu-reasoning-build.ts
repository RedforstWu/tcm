import { createHash } from 'node:crypto'
import path from 'node:path'
import type { BookId, Clause, Formula } from '../../src/types/data.ts'
import { fileExists, readText } from './fs-utils.ts'
import type { ChenfuCase } from './chenfu-reasoning-validate.ts'
import {
  DISPUTE_KINDS,
  ORGAN_ELEMENT,
  type DisputeKind,
  type WuxingElement,
} from './chenfu-reasoning-vocab.ts'
import { normalizeFormulaName, resolveFormulaId } from './reasoning.ts'

export const CHENFU_REASONING_BOOKS = ['bianzheng', 'funvke', 'funanke', 'shishi'] as const

export type ChenfuReasoningBook = (typeof CHENFU_REASONING_BOOKS)[number]

export function reasoningContentHash(text: string, formulaParts: string[]): string {
  return createHash('sha256')
    .update(text)
    .update('\n')
    .update(formulaParts.join('\n'))
    .digest('hex')
    .slice(0, 16)
}

export function clauseReasoningHash(
  clause: Pick<Clause, 'text'>,
  clauseFormulas: Array<Pick<Formula, 'preparation' | 'fangjie'>>,
): string {
  return reasoningContentHash(
    clause.text,
    clauseFormulas.map((formula) => `${formula.preparation}\n${formula.fangjie ?? ''}`),
  )
}

export function groupFormulasByClause(formulas: Formula[]): Map<string, Formula[]> {
  const map = new Map<string, Formula[]>()
  for (const formula of formulas) {
    for (const clauseId of formula.sourceClauseIds) {
      const list = map.get(clauseId) ?? []
      list.push(formula)
      map.set(clauseId, list)
    }
  }
  return map
}

export interface ChenfuCacheEntry {
  clauseId: string
  contentHash: string
  cases: ChenfuCase[]
}

export interface ChenfuCacheFile {
  book: string
  reviewStatus: string
  entries: ChenfuCacheEntry[]
}

export interface CompareTopicInput {
  id: string
  title: string
  description?: string
  jingfang: { treeId?: string; formulaNames: string[] }
  chenfu: Array<{ book: BookId; headingPattern: string; casePattern?: string }>
}

/**
 * text：症状取自原文；heading：男科/女科以标题为症；
 * previous：原文切分错位，本则以方药起首，症状在同门上一则；none：原文未述症状
 */
export type SymptomSource = 'text' | 'heading' | 'previous' | 'none'

export interface BuiltChenfuCase extends ChenfuCase {
  caseId: string
  elements: WuxingElement[]
  symptomSource: SymptomSource
  continuesFromClauseId?: string
  /** 方药并自下一则原文（切分错位合并） */
  prescriptionFromClauseId?: string
}

/** 以标题为症的书；石室秘录、辨证录的标题是首句或「某门·第N则」，不可作症状 */
const HEADING_AS_SYMPTOM_BOOKS: ReadonlySet<string> = new Set(['funanke', 'funvke'])

export interface BuiltChenfuRecord {
  clauseId: string
  book: ChenfuReasoningBook
  chapter: string
  heading?: string
  symptomTags: string[]
  pathogenesisTags: string[]
  /** 标注缓存存在且内容哈希与当前原文一致 */
  annotated: boolean
  cases: BuiltChenfuCase[]
  /** 女科/男科 与 辨证录 的对齐条文（「另见」） */
  parallelIds: string[]
}

export interface BuiltChenfuFormula {
  id: string
  name: string
  preparation: string
  fangjie: string
}

export interface BuiltCompareFormula {
  name: string
  formulaId?: string
  /** 是否在经方推理卡片（reasoning.json formulas）中 */
  hasReasoning: boolean
}

export interface BuiltCompareTopic {
  id: string
  title: string
  description?: string
  jingfang: { treeId?: string; formulas: BuiltCompareFormula[] }
  chenfuCaseIds: string[]
}

export interface ChenfuBookStats {
  records: number
  annotated: number
  cases: number
  disputeCounts: Record<DisputeKind | 'none', number>
}

export interface ChenfuReasoningDataset {
  generatedAt: string
  source: string
  reviewStatus: 'ai-draft'
  records: BuiltChenfuRecord[]
  formulas: Record<string, BuiltChenfuFormula>
  compareTopics: BuiltCompareTopic[]
  stats: Record<ChenfuReasoningBook, ChenfuBookStats>
}

export interface ParallelAlignment {
  leftId: string
  rightId: string | null
}

export interface ChenfuBuildInput {
  clauses: Clause[]
  formulas: Formula[]
  caches: ChenfuCacheFile[]
  parallels: ParallelAlignment[]
  compareTopics: CompareTopicInput[]
  reasoningFormulaNames: string[]
}

/** 读取 data/annotations/chenfu-reasoning/{book}.json；缺失或损坏的书跳过 */
export async function loadChenfuCaches(projectRootDir: string): Promise<ChenfuCacheFile[]> {
  const baseDir = path.join(projectRootDir, 'data', 'annotations', 'chenfu-reasoning')
  const caches: ChenfuCacheFile[] = []
  for (const book of CHENFU_REASONING_BOOKS) {
    const cachePath = path.join(baseDir, `${book}.json`)
    if (!(await fileExists(cachePath))) continue
    try {
      const parsed = JSON.parse(await readText(cachePath)) as Partial<ChenfuCacheFile>
      caches.push({
        book,
        reviewStatus: parsed.reviewStatus ?? 'ai-draft',
        entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      })
    } catch (error) {
      console.warn(`[chenfu-reasoning] skip broken cache ${cachePath}:`, error)
    }
  }
  return caches
}

export function caseIdOf(clauseId: string, caseIndex: number): string {
  return `${clauseId}#${caseIndex}`
}

export function elementsOfCase(caseItem: Pick<ChenfuCase, 'organs'>): WuxingElement[] {
  const elements = new Set<WuxingElement>()
  for (const organ of caseItem.organs) elements.add(ORGAN_ELEMENT[organ])
  return [...elements]
}

function emptyDisputeCounts(): Record<DisputeKind | 'none', number> {
  const counts = { none: 0 } as Record<DisputeKind | 'none', number>
  for (const kind of DISPUTE_KINDS) counts[kind] = 0
  return counts
}

function compilePattern(pattern: string, topicId: string): RegExp {
  try {
    return new RegExp(pattern)
  } catch (error) {
    throw new Error(`[compare-topics] ${topicId} 正则无效: ${pattern} (${String(error)})`)
  }
}

/** 病案层可检索文本：症状、辩难、病机、治法 */
export function caseSearchText(caseItem: ChenfuCase): string {
  return [
    caseItem.symptomText ?? '',
    ...caseItem.disputes.flatMap((dispute) => [dispute.claim, dispute.rebuttal]),
    caseItem.pathogenesis ?? '',
    caseItem.treatmentPrinciple ?? '',
  ].join('\n')
}

export function resolveCompareTopics(
  topics: CompareTopicInput[],
  records: BuiltChenfuRecord[],
  formulas: Array<Pick<Formula, 'id' | 'name' | 'book'>>,
  reasoningFormulaNames: string[],
): BuiltCompareTopic[] {
  const reasoningCanonical = new Set(reasoningFormulaNames.map(normalizeFormulaName))
  const seenIds = new Set<string>()
  return topics.map((topic) => {
    if (seenIds.has(topic.id)) throw new Error(`[compare-topics] 重复 id: ${topic.id}`)
    seenIds.add(topic.id)
    if (topic.jingfang.formulaNames.length === 0) {
      throw new Error(`[compare-topics] ${topic.id} 缺少经方 formulaNames`)
    }

    const caseIds: string[] = []
    for (const rule of topic.chenfu) {
      const headingRegex = compilePattern(rule.headingPattern, topic.id)
      const caseRegex = rule.casePattern ? compilePattern(rule.casePattern, topic.id) : undefined
      for (const record of records) {
        if (record.book !== rule.book) continue
        if (!headingRegex.test(`${record.chapter}·${record.heading ?? ''}`)) continue
        for (const caseItem of record.cases) {
          if (caseRegex && !caseRegex.test(caseSearchText(caseItem))) continue
          caseIds.push(caseItem.caseId)
        }
      }
    }

    return {
      id: topic.id,
      title: topic.title,
      description: topic.description,
      jingfang: {
        treeId: topic.jingfang.treeId,
        formulas: topic.jingfang.formulaNames.map((name) => ({
          name,
          formulaId: resolveFormulaId(name, formulas),
          hasReasoning: reasoningCanonical.has(normalizeFormulaName(name)),
        })),
      },
      chenfuCaseIds: [...new Set(caseIds)],
    }
  })
}

export function resolveSymptomSource(
  caseItem: Pick<ChenfuCase, 'symptomText' | 'caseIndex'>,
  clause: Pick<Clause, 'book' | 'heading'>,
  previousClauseId: string | undefined,
): { symptomSource: SymptomSource; continuesFromClauseId?: string } {
  if (caseItem.symptomText) return { symptomSource: 'text' }
  if (HEADING_AS_SYMPTOM_BOOKS.has(clause.book) && clause.heading?.trim()) {
    return { symptomSource: 'heading' }
  }
  if (clause.book === 'bianzheng' && caseItem.caseIndex === 0 && previousClauseId) {
    return { symptomSource: 'previous', continuesFromClauseId: previousClauseId }
  }
  return { symptomSource: 'none' }
}

function hasPrescription(caseItem: Pick<ChenfuCase, 'formulaIds' | 'formulaText'>): boolean {
  return caseItem.formulaIds.length > 0 || Boolean(caseItem.formulaText)
}

/**
 * 辨证录切分错位：上一则末案只有症状与辨误、下一则以其「方用」起首。
 * 上一则末案无方时，把下一则首个承上病案并入，并记录方药出处；否则保持两段独立。
 * 返回合并次数。
 */
export function mergeOrphanPrescriptions(records: BuiltChenfuRecord[]): number {
  let merged = 0
  const recordIndex = new Map(records.map((record, index) => [record.clauseId, index]))
  for (const record of records) {
    const orphan = record.cases[0]
    if (!orphan || orphan.symptomSource !== 'previous' || !orphan.continuesFromClauseId) continue
    if (!hasPrescription(orphan)) continue
    const previousIndex = recordIndex.get(orphan.continuesFromClauseId)
    if (previousIndex === undefined) continue
    const previousRecord = records[previousIndex]
    const target = previousRecord.cases.at(-1)
    if (!target || hasPrescription(target) || target.symptomSource === 'previous') continue

    const organs = [...target.organs]
    for (const organ of orphan.organs) if (!organs.includes(organ)) organs.push(organ)
    const mergedCase: BuiltChenfuCase = {
      ...target,
      disputes: [...target.disputes, ...orphan.disputes],
      pathogenesis: target.pathogenesis ?? orphan.pathogenesis,
      treatmentPrinciple: target.treatmentPrinciple ?? orphan.treatmentPrinciple,
      organs,
      relations: [...target.relations, ...orphan.relations],
      formulaIds: orphan.formulaIds,
      formulaText: orphan.formulaText,
      keySentence: orphan.keySentence,
      prescriptionFromClauseId: record.clauseId,
    }
    mergedCase.elements = elementsOfCase(mergedCase)
    previousRecord.cases[previousRecord.cases.length - 1] = mergedCase
    record.cases = record.cases.slice(1)
    merged += 1
  }
  return merged
}

function buildParallelIndex(parallels: ParallelAlignment[]): Map<string, string[]> {
  const index = new Map<string, string[]>()
  const link = (from: string, to: string): void => {
    const list = index.get(from) ?? []
    if (!list.includes(to)) list.push(to)
    index.set(from, list)
  }
  for (const alignment of parallels) {
    if (!alignment.rightId) continue
    link(alignment.leftId, alignment.rightId)
    link(alignment.rightId, alignment.leftId)
  }
  return index
}

export function buildChenfuReasoningDataset(input: ChenfuBuildInput): ChenfuReasoningDataset {
  const bookSet = new Set<string>(CHENFU_REASONING_BOOKS)
  const formulaByClause = groupFormulasByClause(
    input.formulas.filter((formula) => bookSet.has(formula.book)),
  )
  const formulaById = new Map(input.formulas.map((formula) => [formula.id, formula]))
  const cacheByClause = new Map<string, ChenfuCacheEntry>()
  for (const cache of input.caches) {
    for (const entry of cache.entries) cacheByClause.set(entry.clauseId, entry)
  }
  const parallelIndex = buildParallelIndex(input.parallels)

  const stats = {} as Record<ChenfuReasoningBook, ChenfuBookStats>
  for (const book of CHENFU_REASONING_BOOKS) {
    stats[book] = { records: 0, annotated: 0, cases: 0, disputeCounts: emptyDisputeCounts() }
  }

  const usedFormulaIds = new Set<string>()
  const records: BuiltChenfuRecord[] = []
  let previousClause: Clause | undefined
  for (const clause of input.clauses) {
    if (!bookSet.has(clause.book)) continue
    const book = clause.book as ChenfuReasoningBook
    const previousClauseId =
      previousClause &&
      previousClause.book === clause.book &&
      previousClause.chapter === clause.chapter
        ? previousClause.id
        : undefined
    previousClause = clause
    const clauseFormulas = (formulaByClause.get(clause.id) ?? []).filter(
      (formula) => formula.book === clause.book,
    )
    const cacheEntry = cacheByClause.get(clause.id)
    const annotated =
      cacheEntry !== undefined &&
      cacheEntry.contentHash === clauseReasoningHash(clause, clauseFormulas)

    const cases: BuiltChenfuCase[] = annotated
      ? cacheEntry.cases.map((caseItem) => {
          for (const formulaId of caseItem.formulaIds) {
            if (formulaById.has(formulaId)) usedFormulaIds.add(formulaId)
          }
          return {
            ...caseItem,
            formulaIds: caseItem.formulaIds.filter((formulaId) => formulaById.has(formulaId)),
            caseId: caseIdOf(clause.id, caseItem.caseIndex),
            elements: elementsOfCase(caseItem),
            ...resolveSymptomSource(caseItem, clause, previousClauseId),
          }
        })
      : []

    records.push({
      clauseId: clause.id,
      book,
      chapter: clause.chapter,
      heading: clause.heading,
      symptomTags: clause.symptomTags ?? [],
      pathogenesisTags: clause.pathogenesisTags ?? [],
      annotated,
      cases,
      parallelIds: parallelIndex.get(clause.id) ?? [],
    })
  }

  mergeOrphanPrescriptions(records)

  for (const record of records) {
    const bookStats = stats[record.book]
    bookStats.records += 1
    if (record.annotated) bookStats.annotated += 1
    bookStats.cases += record.cases.length
    for (const caseItem of record.cases) {
      if (caseItem.disputes.length === 0) bookStats.disputeCounts.none += 1
      for (const dispute of caseItem.disputes) bookStats.disputeCounts[dispute.kind] += 1
    }
  }

  const formulas: Record<string, BuiltChenfuFormula> = {}
  for (const formulaId of usedFormulaIds) {
    const formula = formulaById.get(formulaId)
    if (!formula) continue
    formulas[formulaId] = {
      id: formula.id,
      name: formula.name,
      preparation: formula.preparation,
      fangjie: formula.fangjie ?? '',
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    source: '陈士铎《辨证录》《石室秘录》、傅青主《女科》《男科》；病机链为大模型抽取草稿（ai-draft）',
    reviewStatus: 'ai-draft',
    records,
    formulas,
    compareTopics: resolveCompareTopics(
      input.compareTopics,
      records,
      input.formulas,
      input.reasoningFormulaNames,
    ),
    stats,
  }
}
