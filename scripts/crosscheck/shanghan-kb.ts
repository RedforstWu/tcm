import assert from 'node:assert/strict'
import path from 'node:path'
import type { Clause, Evidence, Formula } from '../../src/types/data.ts'
import {
  addMissingCharStats,
  commentaryId,
  compareDoses,
  compareEntityIds,
  compareHerbSets,
  compareText,
  createFormulaNameResolver,
  emptyMissingCharStats,
  extractDoseText,
  formulaHeadingName,
  isNearFormulaName,
  isQuoteVerified,
  judgeFormulaLink,
  locateWithWildcards,
  maskJobkokoMissingChars,
  maskKanripoMissingChars,
  mentionStrength,
  MIN_FUZZY_LOCATE_LENGTH,
  roundRatio,
  songbenClauseId,
  splitQuoteSegments,
  textVerdict,
  toVariantSegments,
  WILDCARD_CHAR,
  type ClauseFormulaContext,
  type FormulaLinkConclusion,
  type FormulaNameResolver,
  type MissingCharStats,
} from '../lib/crosscheck-shanghan.ts'
import { loadConceptLexicon, matchMentions, type ConceptMatchIndex } from '../lib/concept-lexicon.ts'
import { projectRoot, readText, writeJson, writeText } from '../lib/fs-utils.ts'
import { normalizeHerbNameForCompare, resolveKnownHerbName } from '../lib/herb-lexicon.ts'
import {
  EVIDENCE_DIR,
  INTEGRATION_DIR,
  REPORTS_DIR,
  type ClauseAttributes,
  type ClauseAttributesFile,
  type EntityEvidenceRecord,
  type EvidenceField,
  type EvidenceFile,
  type EvidenceVerdict,
  type IntegratedCommentary,
  type IntegratedSyndrome,
  type CommentaryQuote,
} from '../lib/integration-contract.ts'
import { jobkokoEvidence, jobkokoSectionAt, parseJobkokoText, readUtf8TextFile, shortCommit } from '../lib/jobkoko.ts'
import { kanripoEvidence, loadKanripoText } from '../lib/kanripo.ts'
import { KB_SOURCE_ID_PREFIX, compareZh, type KbClause, type KbCommentary, type KbFormula, type KbFormulaHerb, type KbSyndrome } from '../lib/shanghan-kb.ts'
import {
  TEXT_VARIANT_RATIO,
  locateInText,
  normalizeForCompare,
  prepareHaystack,
  similarity,
  type PreparedHaystack,
} from '../lib/text-normalize.ts'
import { cleanWikiMarkup, extractChapters, toSimplifiedChinese } from '../lib/wiki.ts'

/**
 * 《伤寒论》知识库（KB）↔ 本项目数据 / 见证本 交叉比对。
 * 输入只读：data/external/shanghan-kb、data/parsed/{songben,jingui,guilin}.json、data/raw/songben-shanghan.wiki、data/vendor。
 * 输出：data/integration/{evidence/shanghan-kb.json, commentaries.json, syndromes.json, clause-attributes.json}
 *       与 data/integration/reports/shanghan-kb-crosscheck.{json,md}。
 * 用法：npx tsx scripts/crosscheck/shanghan-kb.ts
 */

const LOG_TAG = '[crosscheck:shanghan-kb]'
const PRODUCER = 'shanghan-kb-crosscheck'
const KB_EVIDENCE_LICENSE = 'none-declared'
const LOCAL_BOOKS = ['songben', 'jingui', 'guilin'] as const
type LocalBook = (typeof LOCAL_BOOKS)[number]
const KANGPING_LAYERS = ['原文', '追文', '注文'] as const
type KangpingLayer = (typeof KANGPING_LAYERS)[number]
/** 宋本维基中条文定位时允许跳过的最多条数（防止个别行无法匹配时整体错位） */
const SECTION_MATCH_LOOKAHEAD = 5
/** 报告中原文片段的最大长度 */
const SNIPPET_MAX_LENGTH = 160
/** 展示异文时用于替代通配字符的缺字符号 */
const MISSING_CHAR_DISPLAY = '〓'
const KANRIPO_RECENSION_NOTE = '不同版本系统（成无己注本，与赵开美本异文属预期）'
/** 括注（「(一作微)」「（赵本无…）」等校注）不参与比对 */
const COMPARE_OPTIONS = { stripNotes: true } as const
const PENDING_VALUE = '待核'
const AUXILIARY_LINK_NOTE = '食材/辅料'
const SHORT_CLAUSE_NOTE = `短条文（规范字 < ${MIN_FUZZY_LOCATE_LENGTH}）仅做精确定位`

const PATHS = {
  lock: 'data/vendor/sources.lock.json',
  kbDir: 'data/external/shanghan-kb',
  songbenWiki: 'data/raw/songben-shanghan.wiki',
  kanripoShanghan: 'data/vendor/kanripo/KR3e0008@SBCK',
  jobkokoDir: 'data/vendor/jobkoko/tcm',
} as const

const JOBKOKO_FILES = {
  songben: 'S-003-伤寒论宋版.txt',
  chengWuji: 'S-017-注解伤寒论.txt',
  keQin: 'S-047-伤寒来苏集.txt',
  youYi: 'S-049-伤寒贯珠集.txt',
} as const

const LOCK_IDS = { kb: 'shanghan-kb', kanripo: 'kanripo-KR3e0008', jobkoko: 'jobkoko' } as const

// ---------------------------------------------------------------------------
// 输入
// ---------------------------------------------------------------------------

interface LockSource {
  id: string
  commit: string
  branch?: string
  dir: string
}

interface ParsedBook {
  clauses: Clause[]
  formulas: Formula[]
}

interface KbManifest {
  commit: string | null
  counts: Record<string, number>
}

async function readJson<T>(root: string, relativePath: string): Promise<T> {
  const filePath = path.join(root, relativePath)
  try {
    return JSON.parse(await readText(filePath)) as T
  } catch (error) {
    throw new Error(`${LOG_TAG} 读取 ${relativePath} 失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

function requireLock(sources: LockSource[], id: string): LockSource {
  const source = sources.find((item) => item.id === id)
  if (!source) throw new Error(`${LOG_TAG} sources.lock.json 缺少 ${id}`)
  return source
}

// ---------------------------------------------------------------------------
// 见证本
// ---------------------------------------------------------------------------

type WitnessLabel = 'KB' | 'Kanripo' | 'jobkoko'

interface Witness {
  key: string
  label: WitnessLabel
  title: string
  prepared: PreparedHaystack
  /** 遮蔽前文本（与 prepared.source 等长） */
  original: string
  stats: MissingCharStats
  evidenceAt: (start: number, end: number) => Evidence
  missingEvidence: () => Evidence
  note?: string
}

function cleanQuote(text: string): string {
  return text.replace(/\s*\n\s*/g, '').trim()
}

async function loadKanripoWitness(root: string, lock: LockSource): Promise<Witness> {
  const dir = path.join(root, PATHS.kanripoShanghan)
  const text = await loadKanripoText(dir)
  const masked = maskKanripoMissingChars(text.fullText)
  if (masked.text.length !== text.fullText.length) throw new Error('Kanripo 缺字遮蔽改变了文本长度')
  const branch = text.branch ?? lock.branch ?? 'SBCK'
  return {
    key: `kanripo:${text.id}`,
    label: 'Kanripo',
    title: `${text.id}（${text.title ?? '傷寒論注釋'}）`,
    prepared: prepareHaystack(masked.text, COMPARE_OPTIONS),
    original: text.fullText,
    stats: masked.stats,
    evidenceAt: (start, end) =>
      kanripoEvidence(text.id, branch, lock.commit, text.locate(start).locator, cleanQuote(text.fullText.slice(start, end))),
    missingEvidence: () => kanripoEvidence(text.id, branch, lock.commit, text.id),
    note: KANRIPO_RECENSION_NOTE,
  }
}

async function loadJobkokoWitness(root: string, lock: LockSource, fileName: string): Promise<Witness> {
  const raw = await readUtf8TextFile(path.join(root, PATHS.jobkokoDir, fileName))
  const parsed = parseJobkokoText(raw, { fileName })
  const masked = maskJobkokoMissingChars(parsed.fullText)
  if (masked.text.length !== parsed.fullText.length) throw new Error(`${fileName} 缺字遮蔽改变了文本长度`)
  return {
    key: `jobkoko:${fileName}`,
    label: 'jobkoko',
    title: fileName,
    prepared: prepareHaystack(masked.text, COMPARE_OPTIONS),
    original: parsed.fullText,
    stats: masked.stats,
    evidenceAt: (start, end) =>
      jobkokoEvidence(
        fileName,
        lock.commit,
        jobkokoSectionAt(parsed, start)?.title,
        cleanQuote(parsed.fullText.slice(start, end)),
      ),
    missingEvidence: () => jobkokoEvidence(fileName, lock.commit),
  }
}

function displayWildcards(text: string): string {
  return text.split(WILDCARD_CHAR).join(MISSING_CHAR_DISPLAY)
}

// ---------------------------------------------------------------------------
// 宋本条文后的方剂区段
// ---------------------------------------------------------------------------

const LEADING_CLAUSE_NUMBER_RE = /^[一二三四五六七八九十百零〇]+、?/
const LEADING_ARABIC_NUMBER_RE = /^第?\d+条?/

interface SectionBuildResult {
  sections: Map<number, ClauseFormulaContext>
  matchedClauses: number
}

async function buildSongbenSections(root: string, clauses: Clause[]): Promise<SectionBuildResult> {
  const raw = await readText(path.join(root, PATHS.songbenWiki))
  const byKey = new Map<string, number[]>()
  for (const clause of clauses) {
    const key = normalizeForCompare(clause.text)
    byKey.set(key, [...(byKey.get(key) ?? []), clause.order])
  }
  const textByNumber = new Map(clauses.map((clause) => [clause.order, clause.text]))
  const drafts = new Map<number, { headings: string[]; body: string[] }>()
  let lastMatched = 0
  for (const chapter of extractChapters(cleanWikiMarkup(raw))) {
    let current: { headings: string[]; body: string[] } | null = null
    const lines = toSimplifiedChinese(chapter.body)
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
    for (const line of lines) {
      const stripped = line.replace(LEADING_CLAUSE_NUMBER_RE, '').replace(LEADING_ARABIC_NUMBER_RE, '').trim()
      const candidates = byKey.get(normalizeForCompare(stripped)) ?? []
      const matched = candidates.find((number) => number > lastMatched && number <= lastMatched + SECTION_MATCH_LOOKAHEAD)
      if (matched !== undefined) {
        lastMatched = matched
        current = { headings: [], body: [] }
        drafts.set(matched, current)
        continue
      }
      if (!current) continue
      const heading = formulaHeadingName(line)
      if (heading) current.headings.push(heading)
      else current.body.push(line)
    }
  }
  const sections = new Map<number, ClauseFormulaContext>()
  for (const [number, text] of textByNumber) {
    const draft = drafts.get(number)
    sections.set(number, {
      text,
      sectionHeadings: draft?.headings ?? [],
      sectionBody: draft?.body.join('\n') ?? '',
    })
  }
  return { sections, matchedClauses: drafts.size }
}

// ---------------------------------------------------------------------------
// 记录与审阅清单
// ---------------------------------------------------------------------------

type ReviewPriority = 1 | 2 | 3

interface ReviewItem {
  priority: ReviewPriority
  entityId: string
  field: EvidenceField
  source: WitnessLabel
  verdict: EvidenceVerdict
  ratio?: number
  conclusion?: string
  note: string
  local: string
  witness: string
  locator: string
}

interface ReviewContext {
  local: string
  witness: string
  conclusion?: string
}

function sourceLabel(evidence: Evidence): WitnessLabel {
  if (evidence.group === 'kanripo') return 'Kanripo'
  if (evidence.group === 'web-simplified') return 'jobkoko'
  return 'KB'
}

function snippet(text: string, maxLength = SNIPPET_MAX_LENGTH): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  const chars = Array.from(compact)
  return chars.length > maxLength ? `${chars.slice(0, maxLength).join('')}…` : compact
}

function reviewPriority(record: EntityEvidenceRecord, conclusion: string | undefined): ReviewPriority {
  const source = sourceLabel(record.evidence)
  switch (record.field) {
    case 'formulaLink':
      return conclusion === '本地漏' || conclusion === '需人工' ? 1 : 2
    case 'herbs':
      return record.verdict === 'mismatch' ? 1 : 2
    case 'text':
      if (source === 'KB') return 1
      return source === 'jobkoko' ? 2 : 3
    case 'doses':
      return 2
    default:
      return 3
  }
}

class RecordCollector {
  readonly records: EntityEvidenceRecord[] = []
  readonly review: ReviewItem[] = []

  push(record: EntityEvidenceRecord, context?: ReviewContext): void {
    if (record.ratio !== undefined) record.ratio = roundRatio(record.ratio)
    this.records.push(record)
    const needsReview =
      record.verdict === 'mismatch' ||
      (record.field === 'formulaLink' && context?.conclusion === '双方一致但需人工') ||
      (record.verdict === 'missing' && sourceLabel(record.evidence) === 'KB')
    if (!needsReview || !context) return
    this.review.push({
      priority: reviewPriority(record, context.conclusion),
      entityId: record.entityId,
      field: record.field,
      source: sourceLabel(record.evidence),
      verdict: record.verdict,
      ratio: record.ratio,
      conclusion: context.conclusion,
      note: record.note ?? '',
      local: snippet(context.local),
      witness: snippet(context.witness),
      locator: record.evidence.locator,
    })
  }
}

// ---------------------------------------------------------------------------
// 1. 条文比对
// ---------------------------------------------------------------------------

interface ClauseLocateStats {
  total: number
  verdicts: Record<EvidenceVerdict, number>
  wildcardHits: number
}

function emptyVerdicts(): Record<EvidenceVerdict, number> {
  return { agree: 0, variant: 0, mismatch: 0, missing: 0 }
}

interface UnlocatedClause {
  clauseId: string
  witness: string
  short: boolean
  text: string
}

function compareClauseWithKb(
  collector: RecordCollector,
  clause: Clause,
  kbClause: KbClause | undefined,
  kbEvidence: (locator: string, quote?: string) => Evidence,
  missingKb: string[],
): void {
  if (!kbClause || !kbClause.text) {
    missingKb.push(clause.id)
    return
  }
  const local = normalizeForCompare(clause.text, COMPARE_OPTIONS)
  const witness = normalizeForCompare(kbClause.text, COMPARE_OPTIONS)
  const ratio = similarity(local, witness)
  const verdict = textVerdict(ratio)
  const record: EntityEvidenceRecord = {
    entityId: clause.id,
    entityType: 'clause',
    field: 'text',
    verdict,
    ratio,
    evidence: kbEvidence(kbClause.locator, kbClause.text),
  }
  if (verdict === 'variant') record.variants = toVariantSegments(local, witness)
  if (verdict === 'mismatch') record.note = `与 KB 第 ${kbClause.number} 条原文差异较大，需人工核对编号与文本`
  collector.push(record, { local: clause.text, witness: kbClause.text })
}

function locateClauseInWitness(
  collector: RecordCollector,
  clause: Clause,
  witness: Witness,
  stats: ClauseLocateStats,
  unlocated: UnlocatedClause[],
): void {
  stats.total += 1
  const normalizedLocal = normalizeForCompare(clause.text, COMPARE_OPTIONS)
  const short = Array.from(normalizedLocal).length < MIN_FUZZY_LOCATE_LENGTH
  const hit = locateWithWildcards(clause.text, witness.prepared)
  const notes: string[] = []
  if (witness.note) notes.push(witness.note)
  if (!hit) {
    stats.verdicts.missing += 1
    if (short) notes.push(SHORT_CLAUSE_NOTE)
    unlocated.push({ clauseId: clause.id, witness: witness.title, short, text: clause.text })
    collector.push({
      entityId: clause.id,
      entityType: 'clause',
      field: 'text',
      verdict: 'missing',
      evidence: witness.missingEvidence(),
      note: notes.join('；') || undefined,
    })
    return
  }
  const verdict = textVerdict(hit.ratio)
  stats.verdicts[verdict] += 1
  if (hit.usedWildcard) {
    stats.wildcardHits += 1
    notes.push('命中区间含缺字占位（按通配比对）')
  }
  const evidence = witness.evidenceAt(hit.start, hit.end)
  const record: EntityEvidenceRecord = {
    entityId: clause.id,
    entityType: 'clause',
    field: 'text',
    verdict,
    ratio: hit.ratio,
    evidence,
  }
  if (verdict === 'variant') {
    const witnessNormalized = displayWildcards(
      normalizeForCompare(witness.prepared.source.slice(hit.start, hit.end), COMPARE_OPTIONS),
    )
    record.variants = toVariantSegments(normalizedLocal, witnessNormalized)
  }
  if (notes.length > 0) record.note = notes.join('；')
  collector.push(record, { local: clause.text, witness: evidence.quote ?? '' })
}

// ---------------------------------------------------------------------------
// 3. 条文→方剂关联
// ---------------------------------------------------------------------------

interface FormulaLinkSummary {
  conclusions: Record<FormulaLinkConclusion, number>
}

function compareFormulaLinks(
  collector: RecordCollector,
  clause: Clause,
  kbClause: KbClause | undefined,
  context: ClauseFormulaContext,
  resolver: FormulaNameResolver,
  localFormulaById: Map<string, Formula>,
  kbEvidence: (locator: string, quote?: string) => Evidence,
  summary: FormulaLinkSummary,
  danglingFormulaIds: string[],
): void {
  if (!kbClause) return
  const groups = new Map<string, { kbNames: string[]; localIds: string[] }>()
  const groupFor = (canonical: string) => {
    let group = groups.get(canonical)
    if (!group) {
      group = { kbNames: [], localIds: [] }
      groups.set(canonical, group)
    }
    return group
  }
  for (const name of kbClause.formulaNames) groupFor(resolver.canonical(name)).kbNames.push(name)
  for (const formulaId of clause.formulaIds) {
    const formula = localFormulaById.get(formulaId)
    if (!formula) danglingFormulaIds.push(`${clause.id} → ${formulaId}`)
    const name = formula?.name ?? formulaId.replace(/^songben-formula-/, '')
    groupFor(resolver.canonical(name)).localIds.push(formulaId)
  }
  const ordered = [...groups.entries()].sort((left, right) => compareText(left[0], right[0]))
  for (const [canonical, group] of ordered) {
    const strength = mentionStrength(canonical, context, resolver)
    const judgement = judgeFormulaLink(group.kbNames.length > 0, group.localIds.length > 0, strength)
    summary.conclusions[judgement.conclusion] += 1
    const label = group.kbNames[0] ?? localFormulaById.get(group.localIds[0]!)?.name ?? resolver.displayName(canonical)
    const parts = [`${label}：${judgement.conclusion}（${judgement.reason}）`]
    if (group.kbNames.length > 0) parts.push(`KB：${group.kbNames.join('、')}`)
    if (group.localIds.length > 0) parts.push(`本地：${group.localIds.join('、')}`)
    if (group.localIds.length === 0) {
      const localFormula = [...localFormulaById.values()].find((formula) => resolver.canonical(formula.name) === canonical)
      parts.push(localFormula ? `本地已有方剂 ${localFormula.id}，未关联到本条` : '本地宋本无此方剂')
    }
    const record: EntityEvidenceRecord = {
      entityId: clause.id,
      entityType: 'clause',
      field: 'formulaLink',
      verdict: judgement.verdict,
      evidence: kbEvidence(kbClause.locator, group.kbNames.length > 0 ? group.kbNames.join('、') : undefined),
      note: parts.join('；'),
    }
    const sectionPreview = [context.sectionHeadings.map((heading) => `${heading}方`).join(' '), context.sectionBody]
      .filter(Boolean)
      .join(' ')
    collector.push(record, {
      local: `${clause.text}${sectionPreview ? ` ‖ 方剂区段：${sectionPreview}` : ''}`,
      witness: group.kbNames.length > 0 ? `KB 关联方剂：${group.kbNames.join('、')}` : 'KB 未关联此方',
      conclusion: judgement.conclusion,
    })
  }
}

// ---------------------------------------------------------------------------
// 4. 方剂比对
// ---------------------------------------------------------------------------

type FormulaMatchKind = 'exact' | 'alias' | 'fuzzy'

interface FormulaMatch {
  kb: KbFormula
  book: LocalBook
  local: Formula
  kind: FormulaMatchKind
}

interface FormulaCompareSummary {
  perBook: Record<LocalBook, { kb: number; matched: number; exact: number; alias: number; fuzzy: number; notFound: number }>
  notFound: Array<{ name: string; book: LocalBook; locator: string; nearest?: string }>
  fuzzy: Array<{ kbName: string; localId: string; book: LocalBook }>
  formulaComponents: Array<{ kbName: string; components: string[] }>
  duplicateTargets: Array<{ localId: string; kbNames: string[] }>
  skippedPreparation: string[]
  /** 药味写法相近、疑为同药（药名词表缺口） */
  nearHerbNames: Array<{ formulaId: string; local: string; kb: string }>
}

function localHerbCanonical(herb: Formula['herbs'][number]): string {
  return resolveKnownHerbName(herb.name) ?? resolveKnownHerbName(herb.herbId) ?? normalizeHerbNameForCompare(herb.name)
}

function kbHerbCanonical(herb: KbFormulaHerb): string {
  const linkNoteName = herb.herbLinkNote?.split(/[（(]/)[0]?.replace(/\[\[|\]\]/g, '').trim() || null
  return (
    resolveKnownHerbName(herb.name) ??
    (herb.herbCard ? resolveKnownHerbName(herb.herbCard) : null) ??
    (linkNoteName ? resolveKnownHerbName(linkNoteName) : null) ??
    normalizeHerbNameForCompare(herb.name)
  )
}

function splitKbHerbs(
  formula: KbFormula,
  kbFormulaNames: Set<string>,
): { herbs: KbFormulaHerb[]; components: KbFormulaHerb[] } {
  const herbs: KbFormulaHerb[] = []
  const components: KbFormulaHerb[] = []
  for (const herb of formula.herbs) {
    const isFormula =
      (kbFormulaNames.has(herb.name) || (herb.herbCard !== null && kbFormulaNames.has(herb.herbCard))) &&
      resolveKnownHerbName(herb.name) === null
    if (isFormula) components.push(herb)
    else herbs.push(herb)
  }
  return { herbs, components }
}

function herbSetKey(herbs: string[]): string {
  return [...new Set(herbs)].sort().join('|')
}

function matchKbFormulas(
  kbFormulas: KbFormula[],
  localBooks: Record<LocalBook, ParsedBook>,
  resolver: FormulaNameResolver,
  kbFormulaNames: Set<string>,
  summary: FormulaCompareSummary,
): FormulaMatch[] {
  const matches: FormulaMatch[] = []
  for (const kb of kbFormulas) {
    for (const book of LOCAL_BOOKS) {
      if (!kb.sourceBooks.includes(book)) continue
      const bookSummary = summary.perBook[book]
      bookSummary.kb += 1
      const locals = localBooks[book].formulas
      const kbKey = normalizeForCompare(kb.name)
      let local = locals.find((formula) => normalizeForCompare(formula.name) === kbKey)
      let kind: FormulaMatchKind = 'exact'
      if (!local) {
        const aliasCandidates = locals
          .filter((formula) => resolver.same(formula.name, kb.name))
          .sort((left, right) => compareText(left.name, right.name))
        local = aliasCandidates[0]
        kind = 'alias'
      }
      if (!local) {
        const kbHerbs = herbSetKey(splitKbHerbs(kb, kbFormulaNames).herbs.map(kbHerbCanonical))
        local = locals
          .filter(
            (formula) =>
              isNearFormulaName(formula.name, kb.name) && herbSetKey(formula.herbs.map(localHerbCanonical)) === kbHerbs,
          )
          .sort((left, right) => compareText(left.name, right.name))[0]
        kind = 'fuzzy'
        if (local) {
          resolver.addGroup({
            names: [kb.name, local.name],
            kind: '同方异名待核',
            evidence: `KB「${kb.name}」与本地 ${book}「${local.name}」方名仅差一字且药味相同`,
          })
          summary.fuzzy.push({ kbName: kb.name, localId: local.id, book })
        }
      }
      if (!local) {
        bookSummary.notFound += 1
        const nearest = locals.find((formula) => isNearFormulaName(formula.name, kb.name))
        summary.notFound.push({ name: kb.name, book, locator: kb.locator, nearest: nearest?.id })
        continue
      }
      bookSummary.matched += 1
      bookSummary[kind] += 1
      matches.push({ kb, book, local, kind })
    }
  }
  const byTarget = new Map<string, string[]>()
  for (const match of matches) byTarget.set(match.local.id, [...(byTarget.get(match.local.id) ?? []), match.kb.name])
  for (const [localId, kbNames] of byTarget) {
    if (kbNames.length > 1) summary.duplicateTargets.push({ localId, kbNames })
  }
  return matches
}

function compareFormula(
  collector: RecordCollector,
  match: FormulaMatch,
  kbFormulaByName: Map<string, KbFormula>,
  kbFormulaNames: Set<string>,
  kbEvidence: (locator: string, quote?: string) => Evidence,
  summary: FormulaCompareSummary,
): void {
  const { kb, local } = match
  const matchNote =
    match.kind === 'exact'
      ? ''
      : match.kind === 'alias'
        ? `按异名匹配：KB「${kb.name}」↔ 本地「${local.name}」`
        : `方名模糊匹配（同药味、名差一字，需人工确认）：KB「${kb.name}」↔ 本地「${local.name}」`
  const withMatchNote = (note: string) => [matchNote, note].filter(Boolean).join('；')

  // 药味
  const { herbs: kbHerbs, components } = splitKbHerbs(kb, kbFormulaNames)
  const componentHerbs: string[] = []
  for (const component of components) {
    const componentFormula = kbFormulaByName.get(component.herbCard ?? component.name)
    if (componentFormula) componentHerbs.push(...componentFormula.herbs.map(kbHerbCanonical))
  }
  if (components.length > 0) {
    summary.formulaComponents.push({ kbName: kb.name, components: components.map((item) => item.doseRaw ?? item.name) })
  }
  const localCanonical = local.herbs.map(localHerbCanonical)
  const kbCanonical = kbHerbs.map(kbHerbCanonical)
  const herbComparison = compareHerbSets({
    local: localCanonical,
    kb: kbCanonical,
    formulaComponents: components.map((item) => item.doseRaw ?? item.name),
    componentHerbs,
    kbAuxiliary: kbHerbs
      .filter((herb) => herb.herbLinkNote?.includes(AUXILIARY_LINK_NOTE))
      .map((herb) => kbHerbCanonical(herb)),
  })
  for (const pair of herbComparison.nearPairs) {
    summary.nearHerbNames.push({ formulaId: local.id, local: pair.local, kb: pair.kb })
  }
  collector.push(
    {
      entityId: local.id,
      entityType: 'formula',
      field: 'herbs',
      verdict: herbComparison.verdict,
      ratio: herbComparison.ratio,
      evidence: kbEvidence(kb.locator, kb.herbs.map((herb) => herb.doseRaw ?? herb.name).join('、')),
      note: withMatchNote(herbComparison.note),
    },
    {
      local: local.herbs.map((herb) => herb.rawText).join('、'),
      witness: kb.herbs.map((herb) => herb.doseRaw ?? herb.name).join('、'),
    },
  )

  // 剂量
  const localByCanonical = new Map<string, Formula['herbs'][number]>()
  local.herbs.forEach((herb, index) => {
    if (!localByCanonical.has(localCanonical[index]!)) localByCanonical.set(localCanonical[index]!, herb)
  })
  const pairs = kbHerbs.flatMap((herb, index) => {
    const canonical = kbCanonical[index]!
    const localHerb = localByCanonical.get(canonical)
    if (!localHerb) return []
    const localDose = extractDoseText(localHerb.rawText, canonical, resolveKnownHerbName)
    const kbDose = herb.doseText && !herb.doseText.includes(PENDING_VALUE) ? herb.doseText : null
    return [{ herb: canonical, local: localDose || null, kb: kbDose }]
  })
  const doseComparison = compareDoses(pairs)
  if (doseComparison) {
    const differenceText = doseComparison.differences
      .map((item) => `${item.herb}：本地「${item.local}」/KB「${item.kb}」${item.level === 'variant' ? '（数量同，修治/注语异）' : ''}`)
      .join('；')
    collector.push(
      {
        entityId: local.id,
        entityType: 'formula',
        field: 'doses',
        verdict: doseComparison.verdict,
        ratio: doseComparison.ratio,
        evidence: kbEvidence(kb.locator, kbHerbs.map((herb) => herb.doseRaw ?? herb.name).join('、')),
        note: withMatchNote(differenceText || `${doseComparison.compared} 味剂量一致`),
      },
      {
        local: local.herbs.map((herb) => herb.rawText).join('、'),
        witness: kbHerbs.map((herb) => herb.doseRaw ?? herb.name).join('、'),
      },
    )
  }

  // 煎服法
  const kbPreparation = kb.preparationBody ?? kb.preparation
  if (!kbPreparation || !local.preparation) {
    summary.skippedPreparation.push(`${local.id}（${!kbPreparation ? 'KB' : '本地'}无煎服法）`)
    return
  }
  const localNormalized = normalizeForCompare(local.preparation)
  const kbNormalized = normalizeForCompare(kbPreparation)
  const ratio = similarity(localNormalized, kbNormalized)
  const verdict = textVerdict(ratio)
  const record: EntityEvidenceRecord = {
    entityId: local.id,
    entityType: 'formula',
    field: 'preparation',
    verdict,
    ratio,
    evidence: kbEvidence(kb.locator, kbPreparation),
  }
  if (verdict === 'variant') record.variants = toVariantSegments(localNormalized, kbNormalized)
  const note = withMatchNote(kb.preparationBody ? '取 KB 正文「## 煎服法」' : '')
  if (note) record.note = note
  collector.push(record, { local: local.preparation, witness: kbPreparation })
}

// ---------------------------------------------------------------------------
// 5. 注家引文核验
// ---------------------------------------------------------------------------

interface CommentatorStats {
  cards: number
  quotes: number
  verified: number
  wildcardHits: number
  /** 含省略号、按片段核验的引文数 */
  segmented: number
  /** 未在本家见证本核到、却在其他注家见证本中命中的引文数 */
  misattributed: number
  /** 严格核验未通过、合并证/症后通过的引文数（已计入 verified；仅注家引文核验放宽证/症） */
  zhengZhengOnly: number
  /** 按命中见证本统计 */
  byWitness: Record<string, number>
}

interface SuspectedMisattribution {
  id: string
  quote: string
  /** 实际命中的其他注家见证本 */
  foundIn: string
  ratio: number
}

interface QuoteMatch {
  witness: Witness
  /** 首个片段在见证本中的位置（用于证据 locator） */
  start: number
  end: number
  /** 各片段比率的最小值 */
  ratio: number
  usedWildcard: boolean
}

const zhengMergedHaystacks = new WeakMap<Witness, PreparedHaystack>()

function zhengMergedHaystack(witness: Witness): PreparedHaystack {
  let prepared = zhengMergedHaystacks.get(witness)
  if (!prepared) {
    prepared = prepareHaystack(witness.prepared.source, { ...COMPARE_OPTIONS, mergeZhengZheng: true })
    zhengMergedHaystacks.set(witness, prepared)
  }
  return prepared
}

/** 引文全部片段都在同一见证本中定位到才算命中；比率取各片段最小值 */
function matchQuoteSegments(segments: string[], witness: Witness, prepared: PreparedHaystack): QuoteMatch | null {
  if (segments.length === 0) return null
  let first: { start: number; end: number } | null = null
  let ratio = 1
  let usedWildcard = false
  for (const segment of segments) {
    const hit = locateWithWildcards(segment, prepared)
    if (!hit) return null
    first ??= { start: hit.start, end: hit.end }
    ratio = Math.min(ratio, hit.ratio)
    usedWildcard ||= hit.usedWildcard
  }
  assert(first, '引文片段非空时必有首个命中')
  return { witness, start: first.start, end: first.end, ratio: roundRatio(ratio), usedWildcard }
}

function bestQuoteMatch(
  segments: string[],
  witnesses: Witness[],
  haystackOf: (witness: Witness) => PreparedHaystack,
): QuoteMatch | null {
  let best: QuoteMatch | null = null
  for (const witness of witnesses) {
    const match = matchQuoteSegments(segments, witness, haystackOf(witness))
    if (match && (!best || match.ratio > best.ratio)) best = match
    if (best && isQuoteVerified(best.ratio)) break
  }
  return best
}

/** 未在本家见证本中核到的引文，再到其他注家见证本中查找（KB 混入他家注语的情况） */
function findInOtherWitnesses(segments: string[], own: Witness[], all: Witness[]): QuoteMatch | null {
  const others = all.filter((witness) => !own.includes(witness))
  const match = bestQuoteMatch(segments, others, (witness) => witness.prepared)
  return match && isQuoteVerified(match.ratio) ? match : null
}

/** 引文是否就是所注条文的经文（经文各家皆引，不能据此判为误归） */
function isClauseQuote(quote: string, clauseText: string | undefined): boolean {
  if (!clauseText) return false
  const normalizedQuote = normalizeForCompare(quote, COMPARE_OPTIONS)
  const normalizedClause = normalizeForCompare(clauseText, COMPARE_OPTIONS)
  if (!normalizedQuote) return false
  if (normalizedClause.includes(normalizedQuote)) return true
  return locateInText(normalizedQuote, normalizedClause, { minRatio: TEXT_VARIANT_RATIO }) !== null
}

function verifyCommentaries(
  commentaries: KbCommentary[],
  witnessesByCommentator: Map<string, Witness[]>,
  commentaryWitnesses: Witness[],
  clauseTextByNumber: Map<number, string>,
  resolver: FormulaNameResolver,
  songbenFormulas: Formula[],
  kbEvidence: (locator: string, quote?: string) => Evidence,
): {
  output: IntegratedCommentary[]
  stats: Record<string, CommentatorStats>
  unmappedFormulaNames: string[]
  idCollisions: string[]
  unknownCommentators: string[]
  skipped: string[]
  failedQuotes: Array<{ id: string; quote: string; ratio: number | null }>
  misattributions: SuspectedMisattribution[]
} {
  const output: IntegratedCommentary[] = []
  const stats: Record<string, CommentatorStats> = {}
  const unmapped = new Set<string>()
  const idCollisions: string[] = []
  const unknownCommentators = new Set<string>()
  const skipped: string[] = []
  const failedQuotes: Array<{ id: string; quote: string; ratio: number | null }> = []
  const misattributions: SuspectedMisattribution[] = []
  const seenIds = new Set<string>()
  for (const card of commentaries) {
    const commentator = card.commentator?.trim()
    if (!commentator) {
      skipped.push(`${card.locator}：缺注家名`)
      continue
    }
    let id: string
    let clauseId: string
    try {
      id = commentaryId(commentator, card.clauseNumber)
      clauseId = songbenClauseId(card.clauseNumber)
    } catch (error) {
      skipped.push(`${card.locator}：${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    if (seenIds.has(id)) {
      idCollisions.push(`${id}（${card.locator}）`)
      continue
    }
    seenIds.add(id)
    const commentatorStats = (stats[commentator] ??= {
      cards: 0,
      quotes: 0,
      verified: 0,
      wildcardHits: 0,
      segmented: 0,
      misattributed: 0,
      zhengZhengOnly: 0,
      byWitness: {},
    })
    commentatorStats.cards += 1
    const witnesses = witnessesByCommentator.get(commentator) ?? []
    if (witnesses.length === 0) unknownCommentators.add(commentator)
    const quotes: CommentaryQuote[] = []
    for (const quoteText of card.quotes) {
      commentatorStats.quotes += 1
      const segments = splitQuoteSegments(quoteText)
      if (segments.length > 1) commentatorStats.segmented += 1
      const strict = bestQuoteMatch(segments, witnesses, (witness) => witness.prepared)
      const zhengMerged =
        strict && isQuoteVerified(strict.ratio) ? null : bestQuoteMatch(segments, witnesses, zhengMergedHaystack)
      const passedOnlyWithZhengMerge = zhengMerged !== null && isQuoteVerified(zhengMerged.ratio)
      const best = passedOnlyWithZhengMerge ? zhengMerged : strict
      const ratio = best ? best.ratio : null
      const verified = isQuoteVerified(ratio)
      const quote: CommentaryQuote = { text: quoteText, verified }
      if (ratio !== null) quote.ratio = ratio
      if (verified && best) {
        quote.evidence = best.witness.evidenceAt(best.start, best.end)
        commentatorStats.verified += 1
        if (passedOnlyWithZhengMerge) commentatorStats.zhengZhengOnly += 1
        commentatorStats.byWitness[best.witness.title] = (commentatorStats.byWitness[best.witness.title] ?? 0) + 1
        if (best.usedWildcard) commentatorStats.wildcardHits += 1
      } else {
        const elsewhere = isClauseQuote(quoteText, clauseTextByNumber.get(card.clauseNumber))
          ? null
          : findInOtherWitnesses(segments, witnesses, commentaryWitnesses)
        if (elsewhere) {
          misattributions.push({ id, quote: quoteText, foundIn: elsewhere.witness.title, ratio: elsewhere.ratio })
          commentatorStats.misattributed += 1
        } else {
          failedQuotes.push({ id, quote: quoteText, ratio })
        }
      }
      quotes.push(quote)
    }
    const formulaIds: string[] = []
    for (const name of card.formulaNames) {
      const local = songbenFormulas.find((formula) => resolver.same(formula.name, name))
      if (local) {
        if (!formulaIds.includes(local.id)) formulaIds.push(local.id)
      } else {
        unmapped.add(name)
      }
    }
    const item: IntegratedCommentary = {
      id,
      clauseId,
      commentator,
      sourceBook: card.sourceBook ?? '',
      formulaIds,
      quotes,
      evidence: [kbEvidence(card.locator)],
    }
    if (card.summary) item.summary = card.summary
    output.push(item)
  }
  output.sort(
    (left, right) =>
      compareEntityIds(left.clauseId, right.clauseId) || compareZh(left.commentator, right.commentator),
  )
  return {
    output,
    stats,
    unmappedFormulaNames: [...unmapped].sort(compareText),
    idCollisions,
    unknownCommentators: [...unknownCommentators].sort(compareText),
    skipped,
    failedQuotes,
    misattributions,
  }
}

// ---------------------------------------------------------------------------
// 6. 证型
// ---------------------------------------------------------------------------

interface SymptomMapping {
  labels: string[]
  mapped: boolean
  partial: string[]
}

function mapSymptomTerm(term: string, index: ConceptMatchIndex, surfaceToId: Map<string, string>): SymptomMapping {
  const exact = surfaceToId.get(term)
  if (exact) return { labels: [index.byId.get(exact)?.prefLabel ?? term], mapped: true, partial: [] }
  const hits = matchMentions(term, index, ['symptom', 'pulse'])
  const coveredLength = hits.reduce((total, hit) => total + hit.surface.length, 0)
  const labels = hits.map((hit) => index.byId.get(hit.conceptId)?.prefLabel ?? hit.surface)
  if (hits.length > 0 && coveredLength === term.length) return { labels, mapped: true, partial: [] }
  return { labels: [term], mapped: false, partial: labels }
}

function buildSyndromes(
  syndromes: KbSyndrome[],
  resolver: FormulaNameResolver,
  localBooks: Record<LocalBook, ParsedBook>,
  conceptIndex: ConceptMatchIndex,
  kbEvidence: (locator: string, quote?: string) => Evidence,
): {
  output: IntegratedSyndrome[]
  unmappedFormulas: Array<{ syndrome: string; formula: string }>
  unmappedSymptoms: Array<{ syndrome: string; symptom: string; partial: string[] }>
  unknownDifferentials: Array<{ syndrome: string; target: string }>
  invalidClauses: Array<{ syndrome: string; clause: number }>
  mappedSymptomCount: number
  totalSymptomCount: number
} {
  const surfaceToId = new Map<string, string>()
  for (const entry of conceptIndex.surfaces) {
    if (entry.type === 'symptom' || entry.type === 'pulse') {
      if (!surfaceToId.has(entry.surface)) surfaceToId.set(entry.surface, entry.conceptId)
    }
  }
  const syndromeNames = new Set(syndromes.map((item) => item.name))
  const unmappedFormulas: Array<{ syndrome: string; formula: string }> = []
  const unmappedSymptoms: Array<{ syndrome: string; symptom: string; partial: string[] }> = []
  const unknownDifferentials: Array<{ syndrome: string; target: string }> = []
  const invalidClauses: Array<{ syndrome: string; clause: number }> = []
  let mappedSymptomCount = 0
  let totalSymptomCount = 0
  const output: IntegratedSyndrome[] = []
  for (const syndrome of syndromes) {
    const clauseIds: string[] = []
    for (const number of syndrome.clauseNumbers) {
      try {
        clauseIds.push(songbenClauseId(number))
      } catch {
        invalidClauses.push({ syndrome: syndrome.name, clause: number })
      }
    }
    const mainFormulaIds: string[] = []
    for (const name of syndrome.mainFormulas) {
      let found: Formula | undefined
      for (const book of LOCAL_BOOKS) {
        found = localBooks[book].formulas.find((formula) => resolver.same(formula.name, name))
        if (found) break
      }
      if (found) {
        if (!mainFormulaIds.includes(found.id)) mainFormulaIds.push(found.id)
      } else {
        unmappedFormulas.push({ syndrome: syndrome.name, formula: name })
      }
    }
    const mainSymptoms: string[] = []
    for (const term of syndrome.mainSymptoms) {
      totalSymptomCount += 1
      const mapping = mapSymptomTerm(term, conceptIndex, surfaceToId)
      if (mapping.mapped) mappedSymptomCount += 1
      else unmappedSymptoms.push({ syndrome: syndrome.name, symptom: term, partial: mapping.partial })
      for (const label of mapping.labels) if (!mainSymptoms.includes(label)) mainSymptoms.push(label)
    }
    const differentials = syndrome.differentials.map((item) => {
      if (!syndromeNames.has(item.target)) unknownDifferentials.push({ syndrome: syndrome.name, target: item.target })
      return { targetConceptId: `syndrome.${item.target}`, note: item.note ?? '' }
    })
    const record: IntegratedSyndrome = {
      conceptId: `syndrome.${syndrome.name}`,
      prefLabel: syndrome.name,
      sixChannel: syndrome.sixChannel ?? '',
      clauseIds,
      mainFormulaIds,
      mainSymptoms,
      differentials,
      evidence: [kbEvidence(syndrome.locator)],
    }
    if (syndrome.definition) record.definition = syndrome.definition
    output.push(record)
  }
  output.sort((left, right) => compareZh(left.conceptId, right.conceptId))
  return {
    output,
    unmappedFormulas,
    unmappedSymptoms,
    unknownDifferentials,
    invalidClauses,
    mappedSymptomCount,
    totalSymptomCount,
  }
}

// ---------------------------------------------------------------------------
// 报告
// ---------------------------------------------------------------------------

function compareRecords(left: EntityEvidenceRecord, right: EntityEvidenceRecord): number {
  return (
    compareText(left.entityType, right.entityType) ||
    compareEntityIds(left.entityId, right.entityId) ||
    compareText(left.field, right.field) ||
    compareText(left.evidence.sourceId, right.evidence.sourceId) ||
    compareText(left.evidence.locator, right.evidence.locator) ||
    compareText(left.note ?? '', right.note ?? '')
  )
}

function verdictDistribution(records: EntityEvidenceRecord[]): Record<string, Record<string, Record<EvidenceVerdict, number>>> {
  const distribution: Record<string, Record<string, Record<EvidenceVerdict, number>>> = {}
  for (const record of records) {
    const byField = (distribution[record.field] ??= {})
    const bySource = (byField[sourceLabel(record.evidence)] ??= emptyVerdicts())
    bySource[record.verdict] += 1
  }
  return distribution
}

function percent(numerator: number, denominator: number): string {
  if (denominator === 0) return '—'
  return `${((numerator / denominator) * 100).toFixed(1)}%`
}

function mdCell(text: string | number | undefined): string {
  if (text === undefined) return ''
  return String(text).replace(/\|/g, '｜').replace(/\r?\n/g, ' ')
}

const FIELD_LABEL: Record<EvidenceField, string> = {
  text: '条文文本',
  herbs: '药味',
  doses: '剂量',
  preparation: '煎服法',
  formulaLink: '条文→方剂',
  quote: '引文',
  kangpingLayer: '康平层次',
}

interface ReportData {
  generatedAt: string
  producer: string
  sources: Record<string, string>
  counts: Record<string, number>
  verdicts: Record<string, Record<string, Record<EvidenceVerdict, number>>>
  clauseLocate: Record<string, ClauseLocateStats & { located: number; rate: string }>
  sectionMatchedClauses: number
  unlocated: UnlocatedClause[]
  missingKbClauses: string[]
  missingChars: Record<string, MissingCharStats>
  formulaLink: FormulaLinkSummary & { danglingFormulaIds: string[] }
  formulas: FormulaCompareSummary
  commentaries: {
    stats: Record<string, CommentatorStats & { rate: string }>
    unmappedFormulaNames: string[]
    idCollisions: string[]
    unknownCommentators: string[]
    skipped: string[]
    failedQuoteSamples: Array<{ id: string; quote: string; ratio: number | null }>
    failedQuoteCount: number
    misattributions: SuspectedMisattribution[]
  }
  syndromes: {
    count: number
    unmappedFormulas: Array<{ syndrome: string; formula: string }>
    unmappedSymptoms: Array<{ syndrome: string; symptom: string; partial: string[] }>
    unknownDifferentials: Array<{ syndrome: string; target: string }>
    invalidClauses: Array<{ syndrome: string; clause: number }>
    symptomMappingRate: string
  }
  kangping: { written: number; distribution: Record<string, number>; skipped: Array<{ clauseId: string; value: string | null }> }
  aliases: { accepted: Array<{ names: string[]; kind: string; evidence: string }>; rejected: Array<{ formula: string; alias: string; reason: string }> }
  dataIssues: string[]
  suggestedScripts: Record<string, string>
  reviewQueue: ReviewItem[]
}

const FAILED_QUOTE_SAMPLE_LIMIT = 60

function renderMarkdown(report: ReportData): string {
  const lines: string[] = []
  const push = (...items: string[]) => lines.push(...items)
  push('# 《伤寒论》知识库（KB）交叉比对审阅清单', '')
  push(
    '> KB（yanghuide13350/shanghan-lun-knowledge-base）未声明许可、全部标注「待核」，此处只作候选标注。',
    '> 本清单由 `scripts/crosscheck/shanghan-kb.ts` 生成，请勿手改；判定结果请回写到数据源或异名表。',
    '',
    `生成时间：${report.generatedAt}`,
    '',
  )
  push('## 来源版本', '')
  for (const [key, value] of Object.entries(report.sources)) push(`- ${key}：\`${value}\``)
  push('')

  push('## 一、裁决分布', '')
  push('| 字段 | 比对对象 | 一致 agree | 异文 variant | 不符 mismatch | 未见 missing |', '| --- | --- | --- | --- | --- | --- |')
  for (const [field, bySource] of Object.entries(report.verdicts)) {
    for (const [source, verdicts] of Object.entries(bySource)) {
      push(
        `| ${FIELD_LABEL[field as EvidenceField] ?? field} | ${source} | ${verdicts.agree} | ${verdicts.variant} | ${verdicts.mismatch} | ${verdicts.missing} |`,
      )
    }
  }
  push('')

  push('## 二、条文在见证本中的定位', '')
  push('| 见证本 | 条文数 | 已定位 | 定位率 | agree | variant | mismatch | missing | 含缺字通配命中 |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const [title, stats] of Object.entries(report.clauseLocate)) {
    push(
      `| ${mdCell(title)} | ${stats.total} | ${stats.located} | ${stats.rate} | ${stats.verdicts.agree} | ${stats.verdicts.variant} | ${stats.verdicts.mismatch} | ${stats.verdicts.missing} | ${stats.wildcardHits} |`,
    )
  }
  push('', `宋本维基中定位到方剂区段的条文：${report.sectionMatchedClauses}/398。`, '')
  const shortUnlocated = report.unlocated.filter((item) => item.short)
  const longUnlocated = report.unlocated.filter((item) => !item.short)
  push(`### 未定位的短条文（规范字 < ${MIN_FUZZY_LOCATE_LENGTH}，仅做精确定位）`, '')
  if (shortUnlocated.length === 0) push('无。')
  else for (const item of shortUnlocated) push(`- ${item.clauseId} @ ${item.witness}：${item.text}`)
  push('', '### 未定位的其他条文', '')
  if (longUnlocated.length === 0) push('无。')
  else for (const item of longUnlocated) push(`- ${item.clauseId} @ ${item.witness}：${snippet(item.text, 80)}`)
  push('')

  push('## 三、缺字处理统计', '')
  push('| 见证本 | 缺字实体 &KR…; | 组字式 | KT 占位 | 孤立空格 |', '| --- | --- | --- | --- | --- |')
  for (const [title, stats] of Object.entries(report.missingChars)) {
    push(`| ${mdCell(title)} | ${stats.gaijiEntity} | ${stats.idsComposition} | ${stats.ktPlaceholder} | ${stats.isolatedSpace} |`)
  }
  push(
    '',
    '处理方式：比对前把上述占位等长替换为私用区字符 U+E000，比对时视为通配（可配任一字，也可被跳过，代价为 0）；展示异文时以「〓」表示。',
    '',
  )

  push('## 四、需人工判定清单', '')
  push('优先级：1＝本地数据可能有误或 KB 与原文冲突，须先判；2＝剂量/KB 多出的关联/简体本异文；3＝煎服法与成注本异文（多属版本差异）。', '')
  for (const priority of [1, 2, 3] as const) {
    const items = report.reviewQueue.filter((item) => item.priority === priority)
    push(`### 优先级 ${priority}（${items.length} 条）`, '')
    if (items.length === 0) {
      push('无。', '')
      continue
    }
    push('| # | 实体 | 字段 | 对象 | 裁决 | 比率 | 说明 | 本地原文 | 对方原文 | 定位 |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
    items.forEach((item, index) => {
      push(
        `| ${index + 1} | ${mdCell(item.entityId)} | ${FIELD_LABEL[item.field]} | ${item.source} | ${item.conclusion ?? item.verdict} | ${item.ratio ?? ''} | ${mdCell(item.note)} | ${mdCell(item.local)} | ${mdCell(item.witness)} | ${mdCell(item.locator)} |`,
      )
    })
    push('')
  }

  push('## 五、条文→方剂关联结论', '')
  for (const [conclusion, count] of Object.entries(report.formulaLink.conclusions)) push(`- ${conclusion}：${count}`)
  if (report.formulaLink.danglingFormulaIds.length > 0) {
    push('', `本地 formulaIds 指向不存在的方剂：${report.formulaLink.danglingFormulaIds.join('；')}`)
  }
  push('')

  push('## 六、方剂匹配', '')
  push('| 书 | KB 方数 | 匹配 | 精确 | 异名 | 模糊 | 未找到 |', '| --- | --- | --- | --- | --- | --- | --- |')
  for (const [book, stats] of Object.entries(report.formulas.perBook)) {
    push(`| ${book} | ${stats.kb} | ${stats.matched} | ${stats.exact} | ${stats.alias} | ${stats.fuzzy} | ${stats.notFound} |`)
  }
  push('', '### KB 方剂在本地同书中未找到', '')
  if (report.formulas.notFound.length === 0) push('无。')
  else for (const item of report.formulas.notFound) push(`- ${item.book}：${item.name}（${item.locator}）${item.nearest ? `；近似：${item.nearest}` : ''}`)
  push('', '### 模糊匹配（方名差一字、药味相同，需人工确认是否同方）', '')
  if (report.formulas.fuzzy.length === 0) push('无。')
  else for (const item of report.formulas.fuzzy) push(`- ${item.book}：KB「${item.kbName}」↔ ${item.localId}`)
  push('', '### KB 以方为药的成分（未作药味比较）', '')
  if (report.formulas.formulaComponents.length === 0) push('无。')
  else for (const item of report.formulas.formulaComponents) push(`- ${item.kbName}：${item.components.join('、')}`)
  push('', '### 疑同药（药名写法差异，药名词表未能统一）', '')
  if (report.formulas.nearHerbNames.length === 0) push('无。')
  else for (const item of report.formulas.nearHerbNames) push(`- ${item.formulaId}：本地「${item.local}」≈ KB「${item.kb}」`)
  if (report.formulas.duplicateTargets.length > 0) {
    push('', '### 多个 KB 方剂匹配到同一本地方剂', '')
    for (const item of report.formulas.duplicateTargets) push(`- ${item.localId} ← ${item.kbNames.join('、')}`)
  }
  push('')

  push('## 七、注家引文核验', '')
  push(
    '| 注家 | 卡片 | 引文 | 核验通过 | 通过率 | 疑误归他家 | 仅证/症之别 | 分段核验 | 含缺字通配 | 命中见证本 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  )
  for (const [commentator, stats] of Object.entries(report.commentaries.stats)) {
    const byWitness = Object.entries(stats.byWitness)
      .map(([title, count]) => `${title}:${count}`)
      .join('；')
    push(
      `| ${commentator} | ${stats.cards} | ${stats.quotes} | ${stats.verified} | ${stats.rate} | ${stats.misattributed} | ${stats.zhengZhengOnly} | ${stats.segmented} | ${stats.wildcardHits} | ${mdCell(byWitness)} |`,
    )
  }
  push(
    '',
    '核验规则：引文规范化后在该注家原书见证本中精确命中，或通配相似度 ≥ 0.95，记 verified=true；含「……」的引文拆段，各段都命中同一见证本才算通过，比率取最小值。',
    '「疑误归他家」：本家见证本中核不到、却在其他注家原书中命中（且不是所注条文经文）的引文，提示 KB 把他家注语归到了此注家名下。',
    '「仅证/症之别」：严格核验未通过、合并证/症后通过的引文（KB 把原书「症」改作「证」）；注家引文核验放宽证/症，这些引文记 verified=true 并计入核验通过；条文与方剂比对仍区分证/症。',
    '',
  )
  push(`### 疑误归他家的引文（${report.commentaries.misattributions.length} 句）`, '')
  if (report.commentaries.misattributions.length === 0) push('无。')
  else {
    push('| 注家卡 | 引文 | 实际命中 | 比率 |', '| --- | --- | --- | --- |')
    for (const item of report.commentaries.misattributions) {
      push(`| ${item.id} | ${mdCell(snippet(item.quote, 80))} | ${mdCell(item.foundIn)} | ${item.ratio} |`)
    }
  }
  push('')
  if (report.commentaries.unmappedFormulaNames.length > 0) {
    push(`注家卡关联方剂在本地宋本中找不到：${report.commentaries.unmappedFormulaNames.join('、')}`, '')
  }
  if (report.commentaries.idCollisions.length > 0) push(`注家卡 id 冲突：${report.commentaries.idCollisions.join('；')}`, '')
  if (report.commentaries.unknownCommentators.length > 0) {
    push(`无对应见证本的注家：${report.commentaries.unknownCommentators.join('、')}`, '')
  }
  push(`### 未通过核验的引文（共 ${report.commentaries.failedQuoteCount} 句，列前 ${FAILED_QUOTE_SAMPLE_LIMIT} 句，按比率升序）`, '')
  push('| 注家卡 | 引文 | 最佳比率 |', '| --- | --- | --- |')
  for (const item of report.commentaries.failedQuoteSamples) push(`| ${item.id} | ${mdCell(snippet(item.quote, 80))} | ${item.ratio ?? '未定位'} |`)
  push('')

  push('## 八、证型映射', '')
  push(`证型 ${report.syndromes.count} 个；主症映射率 ${report.syndromes.symptomMappingRate}。`, '')
  push('### 主方找不到本地方剂', '')
  if (report.syndromes.unmappedFormulas.length === 0) push('无。')
  else for (const item of report.syndromes.unmappedFormulas) push(`- ${item.syndrome}：${item.formula}`)
  push('', '### 主症未映射到概念（保留原词）', '')
  if (report.syndromes.unmappedSymptoms.length === 0) push('无。')
  else {
    for (const item of report.syndromes.unmappedSymptoms) {
      push(`- ${item.syndrome}：${item.symptom}${item.partial.length > 0 ? `（部分可映射：${item.partial.join('、')}）` : ''}`)
    }
  }
  if (report.syndromes.unknownDifferentials.length > 0) {
    push('', '### 鉴别目标不是 KB 证型', '')
    for (const item of report.syndromes.unknownDifferentials) push(`- ${item.syndrome} → ${item.target}`)
  }
  push('')

  push('## 九、康平层次', '')
  push(`写入 ${report.kangping.written} 条：${Object.entries(report.kangping.distribution).map(([key, value]) => `${key} ${value}`).join('，')}。`)
  if (report.kangping.skipped.length > 0) {
    push('', `未写入（取值不在 原文/追文/注文 中）：${report.kangping.skipped.map((item) => `${item.clauseId}=${item.value ?? '空'}`).join('、')}`)
  }
  push('')

  push('## 十、方名异名表', '')
  push('| 方名组 | 类型 | 依据 |', '| --- | --- | --- |')
  for (const item of report.aliases.accepted) push(`| ${mdCell(item.names.join(' / '))} | ${item.kind} | ${mdCell(item.evidence)} |`)
  push('', '### 未采纳的 KB 异名', '')
  for (const item of report.aliases.rejected) push(`- ${item.formula} ≠ ${item.alias}：${item.reason}`)
  push('')

  push('## 十一、数据问题', '')
  if (report.dataIssues.length === 0) push('无。')
  else for (const issue of report.dataIssues) push(`- ${issue}`)
  push('')

  push('## 十二、建议加入 package.json 的脚本', '')
  push('```json')
  for (const [name, command] of Object.entries(report.suggestedScripts)) push(`"${name}": "${command}"`)
  push('```', '')
  return `${lines.join('\n')}\n`
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const root = projectRoot()
  const lock = await readJson<{ sources: LockSource[] }>(root, PATHS.lock)
  const kbLock = requireLock(lock.sources, LOCK_IDS.kb)
  const kanripoLock = requireLock(lock.sources, LOCK_IDS.kanripo)
  const jobkokoLock = requireLock(lock.sources, LOCK_IDS.jobkoko)
  const kbSourceId = `${KB_SOURCE_ID_PREFIX}@${shortCommit(kbLock.commit)}`
  const kbEvidence = (locator: string, quote?: string): Evidence => {
    const evidence: Evidence = { sourceId: kbSourceId, group: 'derived', locator, license: KB_EVIDENCE_LICENSE }
    if (quote) evidence.quote = quote
    return evidence
  }

  const kbManifest = await readJson<KbManifest>(root, `${PATHS.kbDir}/manifest.json`)
  const dataIssues: string[] = []
  if (kbManifest.commit !== kbLock.commit) {
    dataIssues.push(`KB 导入 commit ${kbManifest.commit ?? '未知'} 与 sources.lock.json ${kbLock.commit} 不一致`)
  }
  const kbClauses = await readJson<KbClause[]>(root, `${PATHS.kbDir}/clauses.json`)
  const kbFormulas = await readJson<KbFormula[]>(root, `${PATHS.kbDir}/formulas.json`)
  const kbSyndromes = await readJson<KbSyndrome[]>(root, `${PATHS.kbDir}/syndromes.json`)
  const kbCommentaries = await readJson<KbCommentary[]>(root, `${PATHS.kbDir}/commentaries.json`)
  const localBooks = {} as Record<LocalBook, ParsedBook>
  for (const book of LOCAL_BOOKS) localBooks[book] = await readJson<ParsedBook>(root, `data/parsed/${book}.json`)
  const songben = localBooks.songben
  const songbenClauses = [...songben.clauses].sort((left, right) => left.order - right.order)
  if (songbenClauses.length !== 398) dataIssues.push(`本地宋本条文数 ${songbenClauses.length} ≠ 398`)
  songbenClauses.forEach((clause, index) => {
    if (clause.id !== `songben-${index + 1}`) dataIssues.push(`本地宋本第 ${index + 1} 条 id 为 ${clause.id}`)
  })
  console.log(`${LOG_TAG} KB 条文 ${kbClauses.length}、方剂 ${kbFormulas.length}、证型 ${kbSyndromes.length}、注家卡 ${kbCommentaries.length}`)

  const resolver = createFormulaNameResolver(
    kbFormulas,
    LOCAL_BOOKS.flatMap((book) => localBooks[book].formulas.map((formula) => formula.name)),
  )
  const kbFormulaNames = new Set(kbFormulas.map((formula) => formula.name))
  const kbFormulaByName = new Map(kbFormulas.map((formula) => [formula.name, formula]))

  console.log(`${LOG_TAG} 读取见证本…`)
  const kanripo = await loadKanripoWitness(root, kanripoLock)
  const jobkokoSongben = await loadJobkokoWitness(root, jobkokoLock, JOBKOKO_FILES.songben)
  const jobkokoCheng = await loadJobkokoWitness(root, jobkokoLock, JOBKOKO_FILES.chengWuji)
  const jobkokoKe = await loadJobkokoWitness(root, jobkokoLock, JOBKOKO_FILES.keQin)
  const jobkokoYou = await loadJobkokoWitness(root, jobkokoLock, JOBKOKO_FILES.youYi)
  const allWitnesses = [kanripo, jobkokoSongben, jobkokoCheng, jobkokoKe, jobkokoYou]
  const missingChars: Record<string, MissingCharStats> = {}
  const missingTotal = emptyMissingCharStats()
  for (const witness of allWitnesses) {
    missingChars[witness.title] = witness.stats
    addMissingCharStats(missingTotal, witness.stats)
  }
  missingChars['合计'] = missingTotal

  const collector = new RecordCollector()

  // 1. 条文
  console.log(`${LOG_TAG} 条文比对…`)
  const kbClauseByNumber = new Map(kbClauses.map((clause) => [clause.number, clause]))
  const missingKbClauses: string[] = []
  const unlocated: UnlocatedClause[] = []
  const locateStats = new Map<Witness, ClauseLocateStats>(
    [kanripo, jobkokoSongben].map((witness) => [witness, { total: 0, verdicts: emptyVerdicts(), wildcardHits: 0 }]),
  )
  for (const clause of songbenClauses) {
    compareClauseWithKb(collector, clause, kbClauseByNumber.get(clause.order), kbEvidence, missingKbClauses)
    for (const [witness, stats] of locateStats) locateClauseInWitness(collector, clause, witness, stats, unlocated)
  }

  // 2. 康平层次
  const clauseAttributes: ClauseAttributesFile = {}
  const kangpingDistribution: Record<string, number> = {}
  const kangpingSkipped: Array<{ clauseId: string; value: string | null }> = []
  for (const kbClause of [...kbClauses].sort((left, right) => left.number - right.number)) {
    let clauseId: string
    try {
      clauseId = songbenClauseId(kbClause.number)
    } catch {
      kangpingSkipped.push({ clauseId: `KB#${kbClause.number}`, value: kbClause.kangpingLayer })
      continue
    }
    const layer = kbClause.kangpingLayer
    if (!layer || !(KANGPING_LAYERS as readonly string[]).includes(layer)) {
      kangpingSkipped.push({ clauseId, value: layer })
      continue
    }
    const attributes: ClauseAttributes = { kangpingLayer: layer as KangpingLayer, evidence: [kbEvidence(kbClause.locator)] }
    clauseAttributes[clauseId] = attributes
    kangpingDistribution[layer] = (kangpingDistribution[layer] ?? 0) + 1
  }

  // 4. 方剂（先于关联比对：模糊匹配会补充异名）
  console.log(`${LOG_TAG} 方剂比对…`)
  const formulaSummary: FormulaCompareSummary = {
    perBook: {
      songben: { kb: 0, matched: 0, exact: 0, alias: 0, fuzzy: 0, notFound: 0 },
      jingui: { kb: 0, matched: 0, exact: 0, alias: 0, fuzzy: 0, notFound: 0 },
      guilin: { kb: 0, matched: 0, exact: 0, alias: 0, fuzzy: 0, notFound: 0 },
    },
    notFound: [],
    fuzzy: [],
    formulaComponents: [],
    duplicateTargets: [],
    skippedPreparation: [],
    nearHerbNames: [],
  }
  const matches = matchKbFormulas(kbFormulas, localBooks, resolver, kbFormulaNames, formulaSummary)
  for (const match of matches) compareFormula(collector, match, kbFormulaByName, kbFormulaNames, kbEvidence, formulaSummary)

  // 3. 条文→方剂
  console.log(`${LOG_TAG} 条文→方剂关联…`)
  const { sections, matchedClauses } = await buildSongbenSections(root, songbenClauses)
  if (matchedClauses < songbenClauses.length) {
    dataIssues.push(`宋本维基中仅 ${matchedClauses}/${songbenClauses.length} 条定位到方剂区段，其余条文只按本文判定`)
  }
  const localFormulaById = new Map(songben.formulas.map((formula) => [formula.id, formula]))
  const linkSummary: FormulaLinkSummary = {
    conclusions: { 双方一致: 0, 双方一致但需人工: 0, 本地漏: 0, 'KB 多': 0, 'KB 漏': 0, 需人工: 0 },
  }
  const danglingFormulaIds: string[] = []
  for (const clause of songbenClauses) {
    compareFormulaLinks(
      collector,
      clause,
      kbClauseByNumber.get(clause.order),
      sections.get(clause.order)!,
      resolver,
      localFormulaById,
      kbEvidence,
      linkSummary,
      danglingFormulaIds,
    )
  }

  // 5. 注家
  console.log(`${LOG_TAG} 注家引文核验（${kbCommentaries.reduce((total, card) => total + card.quotes.length, 0)} 句）…`)
  const witnessesByCommentator = new Map<string, Witness[]>([
    ['成无己', [jobkokoCheng, kanripo]],
    ['柯琴', [jobkokoKe]],
    ['尤怡', [jobkokoYou]],
  ])
  const commentaryResult = verifyCommentaries(
    kbCommentaries,
    witnessesByCommentator,
    [jobkokoCheng, kanripo, jobkokoKe, jobkokoYou],
    new Map(songbenClauses.map((clause) => [clause.order, clause.text])),
    resolver,
    songben.formulas,
    kbEvidence,
  )

  // 6. 证型
  const conceptIndex = await loadConceptLexicon(root)
  const syndromeResult = buildSyndromes(kbSyndromes, resolver, localBooks, conceptIndex, kbEvidence)

  // 数据问题（本地）
  for (const formula of songben.formulas) {
    if (formula.sourceClauseIds.length === 0) dataIssues.push(`本地 ${formula.id} 无 sourceClauseIds（条文未关联到该方）`)
    if (formula.herbs.length === 0) dataIssues.push(`本地 ${formula.id} 无药味`)
  }
  for (const formula of kbFormulas) {
    if (formula.herbs.length === 0) dataIssues.push(`KB ${formula.locator} 组成为空`)
  }
  for (const item of formulaSummary.notFound) {
    if (item.book === 'songben') dataIssues.push(`KB 宋本方「${item.name}」在本地宋本中不存在（可能漏建）`)
  }

  // 输出
  const records = [...collector.records].sort(compareRecords)
  const sourceIds = [...new Set(records.map((record) => record.evidence.sourceId))].sort(compareText)
  const generatedAt = new Date().toISOString()
  const evidenceFile: EvidenceFile = { producer: PRODUCER, generatedAt, sourceIds, records }

  const located = (stats: ClauseLocateStats) => stats.total - stats.verdicts.missing
  const clauseLocate: ReportData['clauseLocate'] = {}
  for (const [witness, stats] of locateStats) {
    clauseLocate[witness.title] = { ...stats, located: located(stats), rate: percent(located(stats), stats.total) }
  }
  const commentaryStats: ReportData['commentaries']['stats'] = {}
  for (const commentator of Object.keys(commentaryResult.stats).sort(compareZh)) {
    const stats = commentaryResult.stats[commentator]!
    commentaryStats[commentator] = { ...stats, rate: percent(stats.verified, stats.quotes) }
  }
  const reviewQueue = [...collector.review].sort(
    (left, right) =>
      left.priority - right.priority ||
      compareText(left.field, right.field) ||
      (left.ratio ?? -1) - (right.ratio ?? -1) ||
      compareEntityIds(left.entityId, right.entityId) ||
      compareText(left.source, right.source) ||
      compareText(left.note, right.note),
  )
  const failedQuoteSamples = [...commentaryResult.failedQuotes]
    .sort((left, right) => (left.ratio ?? -1) - (right.ratio ?? -1) || compareEntityIds(left.id, right.id) || compareText(left.quote, right.quote))
    .slice(0, FAILED_QUOTE_SAMPLE_LIMIT)

  const report: ReportData = {
    generatedAt,
    producer: PRODUCER,
    sources: {
      KB: kbSourceId,
      Kanripo: `${kanripoLock.id}@${kanripoLock.commit}`,
      jobkoko: `${jobkokoLock.id}@${jobkokoLock.commit}`,
    },
    counts: {
      records: records.length,
      kbClauses: kbClauses.length,
      kbFormulas: kbFormulas.length,
      kbCommentaries: kbCommentaries.length,
      kbSyndromes: kbSyndromes.length,
      commentariesWritten: commentaryResult.output.length,
      syndromesWritten: syndromeResult.output.length,
      clauseAttributesWritten: Object.keys(clauseAttributes).length,
      reviewItems: reviewQueue.length,
    },
    verdicts: verdictDistribution(records),
    clauseLocate,
    sectionMatchedClauses: matchedClauses,
    unlocated: unlocated.sort((left, right) => compareEntityIds(left.clauseId, right.clauseId) || compareText(left.witness, right.witness)),
    missingKbClauses,
    missingChars,
    formulaLink: { ...linkSummary, danglingFormulaIds },
    formulas: formulaSummary,
    commentaries: {
      stats: commentaryStats,
      unmappedFormulaNames: commentaryResult.unmappedFormulaNames,
      idCollisions: commentaryResult.idCollisions,
      unknownCommentators: commentaryResult.unknownCommentators,
      skipped: commentaryResult.skipped,
      failedQuoteSamples,
      failedQuoteCount: commentaryResult.failedQuotes.length,
      misattributions: [...commentaryResult.misattributions].sort(
        (left, right) => compareEntityIds(left.id, right.id) || compareText(left.quote, right.quote),
      ),
    },
    syndromes: {
      count: syndromeResult.output.length,
      unmappedFormulas: syndromeResult.unmappedFormulas,
      unmappedSymptoms: syndromeResult.unmappedSymptoms,
      unknownDifferentials: syndromeResult.unknownDifferentials,
      invalidClauses: syndromeResult.invalidClauses,
      symptomMappingRate: percent(syndromeResult.mappedSymptomCount, syndromeResult.totalSymptomCount),
    },
    kangping: { written: Object.keys(clauseAttributes).length, distribution: kangpingDistribution, skipped: kangpingSkipped },
    aliases: {
      accepted: resolver.acceptedAliases.map((item) => ({ names: item.names, kind: item.kind, evidence: item.evidence })),
      rejected: resolver.rejectedAliases.map((item) => ({ ...item })),
    },
    dataIssues,
    suggestedScripts: { 'data:crosscheck:shanghan': 'tsx scripts/crosscheck/shanghan-kb.ts' },
    reviewQueue,
  }

  await writeJson(path.join(root, EVIDENCE_DIR, 'shanghan-kb.json'), evidenceFile)
  await writeJson(path.join(root, INTEGRATION_DIR, 'commentaries.json'), commentaryResult.output)
  await writeJson(path.join(root, INTEGRATION_DIR, 'syndromes.json'), syndromeResult.output)
  await writeJson(path.join(root, INTEGRATION_DIR, 'clause-attributes.json'), clauseAttributes)
  await writeJson(path.join(root, REPORTS_DIR, 'shanghan-kb-crosscheck.json'), report)
  await writeText(path.join(root, REPORTS_DIR, 'shanghan-kb-crosscheck.md'), renderMarkdown(report))

  console.log(`${LOG_TAG} 证据记录 ${records.length} 条；需人工 ${reviewQueue.length} 条`)
  for (const [field, bySource] of Object.entries(report.verdicts)) {
    for (const [source, verdicts] of Object.entries(bySource)) console.log(`${LOG_TAG}   ${field} × ${source}：${JSON.stringify(verdicts)}`)
  }
  for (const [title, stats] of Object.entries(clauseLocate)) console.log(`${LOG_TAG} 条文定位 ${title}：${stats.located}/${stats.total}（${stats.rate}）`)
  for (const [name, stats] of Object.entries(commentaryStats)) console.log(`${LOG_TAG} 注家 ${name}：${stats.verified}/${stats.quotes}（${stats.rate}）`)
  console.log(`${LOG_TAG} 方剂未找到 ${formulaSummary.notFound.length}；模糊匹配 ${formulaSummary.fuzzy.length}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
