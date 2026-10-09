/**
 * 通用校勘 CLI：本项目条文 × 见证本（data/ontology/witnesses.json）。
 *
 * 用法：
 *   npx tsx scripts/crosscheck/collate.ts              # witnesses.json 中的全部书目
 *   npx tsx scripts/crosscheck/collate.ts jingui piwei # 只重算指定书目，汇总报告保留其余书目的上次结果
 *
 * 输出：
 * - data/integration/evidence/collation-<bookId>.json（EvidenceFile，producer=collation；除 generatedAt 外可复现）
 * - data/integration/reports/collation-summary.json / .md（含耗时，耗时随机器波动）
 *
 * 见证本须先用 `npx tsx scripts/vendor-sources.ts <lockId>` 下载。
 */
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import type { Evidence } from '../../src/types/data.ts'
import {
  EVIDENCE_DIR,
  REPORTS_DIR,
  WITNESSES_FILE,
  type BookWitness,
  type EntityEvidenceRecord,
  type EvidenceFile,
} from '../lib/integration-contract.ts'
import {
  DEFAULT_SETTINGS,
  MIN_PIECE_LENGTH,
  MISSING_RATIO_FLOOR,
  PIECE_LENGTH,
  SHORT_NEEDLE_LENGTH,
  STRUCTURAL_GAP_MIN,
  WINDOW_FORWARD_MIN,
  buildCollationRecord,
  buildVariantSegments,
  chapterHotspots,
  classifyCollationRatio,
  clauseDiffRuns,
  collateWitness,
  collectReplacePairs,
  countGapMatches,
  evenlySample,
  mergeRankedPairs,
  prepareCollationHaystack,
  rankReplacePairs,
  roundRatio,
  tallyVerdicts,
  verdictOf,
  type ChapterHotspot,
  type CollationHaystack,
  type CollationOutcome,
  type GapScheme,
  type RankedPair,
  type ReplacePair,
  type VerdictTally,
} from '../lib/collate.ts'
import { fileExists, projectRoot, readText, writeJson, writeText } from '../lib/fs-utils.ts'
import { jobkokoEvidence, jobkokoSectionAt, parseJobkokoText, readUtf8TextFile } from '../lib/jobkoko.ts'
import { JUAN_SEPARATOR, kanripoEvidence, loadKanripoText, type KanripoJuan } from '../lib/kanripo.ts'
import { TEXT_AGREE_RATIO, TEXT_VARIANT_RATIO } from '../lib/text-normalize.ts'
import { VENDOR_LOCK_RELATIVE_PATH, parseVendorLockText, resolveSourceDir, type VendorSource } from '../lib/vendor-lock.ts'

const LOG_PREFIX = '[collate]'
const PRODUCER = 'collation'
const BOOKS_FILE = 'data/ontology/books.json'
const PARSED_DIR = 'data/parsed'
const SUMMARY_BASENAME = 'collation-summary'
/** mismatch+missing 比例超过此值列入异常书目 */
const ANOMALY_RATE = 0.3
const ANOMALY_SAMPLE_COUNT = 5
const SNIPPET_LENGTH = 60
/** 每书每见证保存的字对数（供跨书合并） */
const PAIRS_PER_WITNESS = 200
const TOP_PAIRS = 30
/** 单书耗时目标（毫秒） */
const BOOK_TIME_TARGET_MS = 60_000
const SUMMARY_VERSION = 1

/** 只比对见证本的部分卷：键为 `<bookId>:<Kanripo 仓库 id>`，值为卷号（文件名 _NNN） */
const KANRIPO_JUAN_SUBSETS: Readonly<Record<string, readonly number[]>> = {
  // 《医宗金鉴》卷二十六至三十三为《删补名医方论》卷一至卷八
  'yizong:KR3e0090': [26, 27, 28, 29, 30, 31, 32, 33],
}

interface BookMeta {
  id: string
  title: string
  order: number
}

interface ParsedClause {
  id: string
  text: string
  chapter?: string
}

interface LoadedWitness {
  witness: BookWitness
  sourceId: string
  scheme: GapScheme
  fullText: string
  description: string
  evidenceAt: (start: number, end: number) => Evidence
  missingEvidence: () => Evidence
}

interface WitnessSummary {
  lockId: string
  ref: string
  group: BookWitness['group']
  edition: string | null
  differentRecension: boolean
  sourceId: string
  description: string
  /** 见证本规范串长度（码点） */
  witnessChars: number
  tally: VerdictTally
  timing: { loadMs: number; prepareMs: number; collateMs: number; recordMs: number; totalMs: number }
  gaps: {
    witnessStrict: number
    witnessOptional: number
    localStrict: number
    localOptional: number
    /** 通配实际降低了距离的记录数 */
    recordsAffected: number
    /** 通配导致 verdict 改变的记录数 */
    verdictChanged: number
    /** variant 记录中与通配对齐的字数 */
    alignedGapChars: number
    /** jobkoko 清除的 `\x`/图片占位/条号排版标记数 */
    witnessMarkup: number
    /** jobkoko 已知词组转换误替换（见 JOBKOKO_CONVERSION_FIXES）修正次数 */
    witnessConversionFixes: number
  }
  strategies: Record<'exact' | 'gapExact' | 'window' | 'global' | 'pieces', number>
  /** 经全局锚定命中的记录数（含分段） */
  viaGlobal: number
  /** 含结构性插入（见证本句间多出方药/校注）的记录数与字数 */
  structuralRecords: number
  structuralChars: number
  multiHit: number
  partialPieces: number
  outOfOrder: number
  shortMissing: number
  anomaly: WitnessAnomaly | null
  replacePairs: RankedPair[]
}

interface AnomalySample {
  entityId: string
  chapter: string
  verdict: EntityEvidenceRecord['verdict']
  ratio: number | null
  bestCandidateRatio: number | null
  local: string
  witness: string
  note: string | null
}

interface WitnessAnomaly {
  rate: number
  hints: string[]
  hotspots: ChapterHotspot[]
  samples: AnomalySample[]
}

interface BookSummary {
  bookId: string
  title: string
  clauseCount: number
  skipped: string | null
  totalMs: number
  witnesses: WitnessSummary[]
}

interface SummaryFile {
  version: number
  producer: string
  generatedAt: string
  settings: Record<string, number>
  books: BookSummary[]
  topReplacePairs: RankedPair[]
}

function log(message: string): void {
  console.log(`${LOG_PREFIX} ${message}`)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function resolveRepoPath(root: string, relative: string): string {
  return path.resolve(root, ...relative.split('/'))
}

async function readJsonFile<T>(filePath: string, label: string): Promise<T> {
  let text: string
  try {
    text = await readText(filePath)
  } catch (error) {
    throw new Error(`读取${label}失败（${filePath}）：${errorMessage(error)}`)
  }
  try {
    return JSON.parse(text) as T
  } catch (error) {
    throw new Error(`${label} 不是合法 JSON（${filePath}）：${errorMessage(error)}`)
  }
}

function validateWitnesses(input: unknown): BookWitness[] {
  if (!Array.isArray(input)) throw new Error(`${WITNESSES_FILE} 必须是数组`)
  const seen = new Set<string>()
  return input.map((entry, index) => {
    const witness = entry as Partial<BookWitness>
    for (const key of ['bookId', 'lockId', 'group', 'ref'] as const) {
      if (typeof witness[key] !== 'string' || witness[key]!.trim() === '') {
        throw new Error(`${WITNESSES_FILE}[${index}].${key} 缺失`)
      }
    }
    const key = `${witness.bookId}|${witness.lockId}|${witness.ref}`
    if (seen.has(key)) throw new Error(`${WITNESSES_FILE}[${index}] 重复：${key}`)
    seen.add(key)
    return witness as BookWitness
  })
}

function lockSourceFor(witness: BookWitness, sources: Map<string, VendorSource>): VendorSource {
  const source = sources.get(witness.lockId)
  if (!source) throw new Error(`${witness.bookId}：lock 中没有 ${witness.lockId}`)
  if (source.sourceGroup !== witness.group) {
    throw new Error(`${witness.bookId}：见证 group=${witness.group} 与 lock ${witness.lockId} 的 sourceGroup=${source.sourceGroup} 不一致`)
  }
  return source
}

/** 只取部分卷时重建 fullText 与 locator 查找 */
function subsetKanripo(juans: KanripoJuan[], numbers: readonly number[], label: string) {
  const wanted = new Set(numbers)
  const selected = juans.filter((juan) => juan.juanNumber !== null && wanted.has(juan.juanNumber))
  if (selected.length !== wanted.size) {
    const found = selected.map((juan) => juan.juanNumber).join(',')
    throw new Error(`${label}：卷 ${numbers.join(',')} 只找到 ${found || '无'}`)
  }
  const starts: number[] = []
  const parts: string[] = []
  let length = 0
  for (const juan of selected) {
    if (parts.length > 0) {
      parts.push(JUAN_SEPARATOR)
      length += JUAN_SEPARATOR.length
    }
    starts.push(length)
    parts.push(juan.plainText)
    length += juan.plainText.length
  }
  const locate = (offset: number): string => {
    let index = 0
    while (index + 1 < starts.length && starts[index + 1]! <= offset) index += 1
    const juan = selected[index]!
    return juan.offsetToLocator(Math.min(Math.max(0, offset - starts[index]!), juan.plainText.length))
  }
  return { fullText: parts.join(''), locate }
}

async function loadWitness(root: string, bookId: string, witness: BookWitness, sources: Map<string, VendorSource>): Promise<LoadedWitness> {
  const source = lockSourceFor(witness, sources)
  const dirAbs = resolveSourceDir(root, source)
  const hint = `请先运行 npx tsx scripts/vendor-sources.ts ${source.id}`
  if (witness.group === 'kanripo') {
    if (source.kind !== 'git-repo') throw new Error(`${source.id} 不是 git-repo`)
    if (source.repo !== `kanripo/${witness.ref}`) throw new Error(`${source.id} 的 repo=${source.repo} 与 ref=${witness.ref} 不一致`)
    if (!(await fileExists(dirAbs))) throw new Error(`${source.dir} 不存在；${hint}`)
    const text = await loadKanripoText(dirAbs, { includeFrontMatter: true })
    const subset = KANRIPO_JUAN_SUBSETS[`${bookId}:${witness.ref}`]
    const view = subset
      ? subsetKanripo(text.juans, subset, `${bookId}/${witness.ref}`)
      : { fullText: text.fullText, locate: (offset: number) => text.locate(offset).locator }
    const sourceId = kanripoEvidence(witness.ref, source.branch, source.commit, witness.ref).sourceId
    return {
      witness,
      sourceId,
      scheme: 'kanripo',
      fullText: view.fullText,
      description: `${text.title ?? witness.ref}（Kanripo ${witness.ref}@${source.branch}${subset ? `，卷 ${subset[0]}–${subset[subset.length - 1]}` : ''}）`,
      evidenceAt: (start, end) =>
        kanripoEvidence(witness.ref, source.branch, source.commit, view.locate(start), view.fullText.slice(start, end)),
      missingEvidence: () => kanripoEvidence(witness.ref, source.branch, source.commit, witness.ref),
    }
  }
  if (witness.group === 'web-simplified') {
    if (source.kind !== 'git-files') throw new Error(`${source.id} 不是 git-files`)
    if (!source.files.some((file) => file.path === witness.ref)) throw new Error(`${source.id} 的 files 中没有 ${witness.ref}`)
    const fileAbs = path.resolve(dirAbs, ...witness.ref.split('/'))
    if (!(await fileExists(fileAbs))) throw new Error(`${fileAbs} 不存在；${hint}`)
    const fileName = path.basename(fileAbs)
    const parsed = parseJobkokoText(await readUtf8TextFile(fileAbs), { fileName })
    const sourceId = jobkokoEvidence(fileName, source.commit).sourceId
    return {
      witness,
      sourceId,
      scheme: 'jobkoko',
      fullText: parsed.fullText,
      description: `${parsed.meta.bookTitle}（jobkoko ${fileName}）`,
      evidenceAt: (start, end) =>
        jobkokoEvidence(fileName, source.commit, jobkokoSectionAt(parsed, start)?.title, parsed.fullText.slice(start, end)),
      missingEvidence: () => jobkokoEvidence(fileName, source.commit),
    }
  }
  throw new Error(`${bookId}：不支持的见证 group「${witness.group}」`)
}

function snippet(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > SNIPPET_LENGTH ? `${flat.slice(0, SNIPPET_LENGTH)}…` : flat
}

function anomalyHints(summary: Omit<WitnessSummary, 'anomaly'>, hotspots: ChapterHotspot[], anomalyCount: number): string[] {
  const hints: string[] = []
  if (summary.differentRecension) hints.push('见证本属不同版本系统，异文与缺失属预期')
  const hotspotAnomalies = hotspots.reduce((sum, hotspot) => sum + hotspot.anomalies, 0)
  if (anomalyCount > 0 && hotspotAnomalies / anomalyCount >= 0.5) {
    hints.push(`异常集中在 ${hotspots.length} 个篇章（占 ${Math.round((hotspotAnomalies / anomalyCount) * 100)}%）：疑似见证本缺卷/缺篇或收录范围不同`)
  }
  if (summary.tally.mismatch > 0 && summary.partialPieces / summary.tally.mismatch >= 0.3) {
    hints.push('分段部分命中较多：本项目条文含见证本没有的句子（注文、附方或切分/合并方式不同）')
  }
  if (summary.tally.total > 0 && summary.structuralRecords / summary.tally.total >= 0.1) {
    hints.push(`${summary.structuralRecords} 条含结构性插入：本项目合并了相邻原文或把方药/校注拆到别处，见证本句间仍保留`)
  }
  if (summary.tally.missing > 0 && summary.shortMissing / summary.tally.missing >= 0.3) {
    hints.push('missing 中短条文占比高：短条文只做精确定位，多为标题、方名或“又方”之类')
  }
  if (hints.length === 0) hints.push('异常分散：以版本异文或文本质量差异为主，需人工抽查')
  return hints
}

interface WitnessRun {
  summary: WitnessSummary
  records: EntityEvidenceRecord[]
}

function collateOneWitness(
  bookId: string,
  clauses: ParsedClause[],
  loaded: LoadedWitness,
  loadMs: number,
): WitnessRun {
  const prepareStarted = performance.now()
  const haystack: CollationHaystack = prepareCollationHaystack(loaded.fullText, loaded.scheme)
  const prepareMs = performance.now() - prepareStarted

  const collateStarted = performance.now()
  const outcomes: CollationOutcome[] = collateWitness(
    clauses.map((clause) => ({ id: clause.id, text: clause.text })),
    haystack,
    DEFAULT_SETTINGS,
  )
  const collateMs = performance.now() - collateStarted

  const recordStarted = performance.now()
  const records: EntityEvidenceRecord[] = []
  const pairEntries: Array<ReplacePair & { bookId: string; entityId: string }> = []
  const strategies: WitnessSummary['strategies'] = { exact: 0, gapExact: 0, window: 0, global: 0, pieces: 0 }
  let recordsAffected = 0
  let verdictChanged = 0
  let alignedGapChars = 0
  let localStrict = 0
  let localOptional = 0
  let multiHit = 0
  let viaGlobal = 0
  let structuralRecords = 0
  let structuralChars = 0
  let partialPieces = 0
  let outOfOrder = 0
  let shortMissing = 0
  const differentRecension = loaded.witness.differentRecension === true

  outcomes.forEach((outcome) => {
    const { needle, match } = outcome
    localStrict += needle.gapCounts.strict
    localOptional += needle.gapCounts.optional
    const verdict = verdictOf(match)
    let variants
    if (verdict === 'variant') {
      const runs = clauseDiffRuns(needle, haystack, match)
      variants = buildVariantSegments(needle, haystack, match, runs)
      alignedGapChars += countGapMatches(needle, haystack, runs)
      for (const pair of collectReplacePairs(needle, haystack, runs)) pairEntries.push({ ...pair, bookId, entityId: outcome.id })
    }
    if (match.found) {
      if (match.strategy === 'exact') strategies.exact += 1
      else if (match.strategy === 'gap-exact') strategies.gapExact += 1
      else if (match.strategy === 'window') strategies.window += 1
      else if (match.strategy === 'global') strategies.global += 1
      else if (match.strategy === 'pieces') strategies.pieces += 1
      if (match.exact && match.hitCount > 1) multiHit += 1
      if (match.viaGlobal) viaGlobal += 1
      if (match.structuralGaps > 0) {
        structuralRecords += 1
        structuralChars += match.structuralChars
      }
      if (match.pieces.length > 1 && match.matchedPieces < match.pieces.length) partialPieces += 1
      if (match.outOfOrder) outOfOrder += 1
      if (match.plainRatio < match.ratio) {
        recordsAffected += 1
        if (classifyCollationRatio(match.plainRatio) !== classifyCollationRatio(match.ratio)) verdictChanged += 1
      }
    } else if (needle.effectiveLength > 0 && needle.effectiveLength < SHORT_NEEDLE_LENGTH) {
      shortMissing += 1
    }
    records.push(
      buildCollationRecord({
        entityId: outcome.id,
        needle,
        match,
        evidence: match.found ? loaded.evidenceAt(match.start, match.end) : loaded.missingEvidence(),
        variants,
        differentRecension,
      }),
    )
  })
  const recordMs = performance.now() - recordStarted

  const tally = tallyVerdicts(records)
  const base: Omit<WitnessSummary, 'anomaly'> = {
    lockId: loaded.witness.lockId,
    ref: loaded.witness.ref,
    group: loaded.witness.group,
    edition: loaded.witness.edition ?? null,
    differentRecension,
    sourceId: loaded.sourceId,
    description: loaded.description,
    witnessChars: haystack.points.length,
    tally,
    timing: {
      loadMs: Math.round(loadMs),
      prepareMs: Math.round(prepareMs),
      collateMs: Math.round(collateMs),
      recordMs: Math.round(recordMs),
      totalMs: Math.round(loadMs + prepareMs + collateMs + recordMs),
    },
    gaps: {
      witnessStrict: haystack.gapCounts.strict,
      witnessOptional: haystack.gapCounts.optional,
      localStrict,
      localOptional,
      recordsAffected,
      verdictChanged,
      alignedGapChars,
      witnessMarkup: haystack.cleanup.markup,
      witnessConversionFixes: haystack.cleanup.conversionFixes,
    },
    strategies,
    viaGlobal,
    structuralRecords,
    structuralChars,
    multiHit,
    partialPieces,
    outOfOrder,
    shortMissing,
    replacePairs: rankReplacePairs(pairEntries, PAIRS_PER_WITNESS),
  }

  const anomalyCount = tally.mismatch + tally.missing
  const anomalyRate = tally.total === 0 ? 0 : anomalyCount / tally.total
  let anomaly: WitnessAnomaly | null = null
  if (anomalyRate > ANOMALY_RATE) {
    const items = clauses.map((clause, index) => ({ chapter: clause.chapter ?? '（无篇名）', verdict: records[index]!.verdict }))
    const hotspots = chapterHotspots(items)
    const anomalousIndexes = records
      .map((record, index) => ({ record, index }))
      .filter(({ record }) => record.verdict === 'mismatch' || record.verdict === 'missing')
    const samples = evenlySample(anomalousIndexes, ANOMALY_SAMPLE_COUNT).map(({ record, index }): AnomalySample => {
      const outcome = outcomes[index]!
      return {
        entityId: record.entityId,
        chapter: clauses[index]!.chapter ?? '',
        verdict: record.verdict,
        ratio: record.ratio ?? null,
        bestCandidateRatio:
          record.verdict === 'missing' ? roundRatio(outcome.match.found ? outcome.match.ratio : outcome.match.bestRatio) : null,
        local: snippet(clauses[index]!.text),
        witness: record.evidence.quote ? snippet(record.evidence.quote) : '',
        note: record.note ?? null,
      }
    })
    anomaly = { rate: roundRatio(anomalyRate), hints: anomalyHints(base, hotspots, anomalyCount), hotspots, samples }
  }
  return { summary: { ...base, anomaly }, records }
}

/** 记录按条文顺序、再按 witnesses.json 中见证顺序排列 */
function interleave(runs: WitnessRun[], clauseCount: number): EntityEvidenceRecord[] {
  const records: EntityEvidenceRecord[] = []
  for (let index = 0; index < clauseCount; index += 1) {
    for (const run of runs) records.push(run.records[index]!)
  }
  return records
}

async function collateBook(
  root: string,
  book: BookMeta,
  witnesses: BookWitness[],
  sources: Map<string, VendorSource>,
): Promise<BookSummary> {
  const started = performance.now()
  const parsedPath = resolveRepoPath(root, `${PARSED_DIR}/${book.id}.json`)
  const base: BookSummary = { bookId: book.id, title: book.title, clauseCount: 0, skipped: null, totalMs: 0, witnesses: [] }
  if (!(await fileExists(parsedPath))) return { ...base, skipped: `缺少 ${PARSED_DIR}/${book.id}.json` }
  const parsed = await readJsonFile<{ clauses?: ParsedClause[] }>(parsedPath, `${book.id} 条文`)
  const clauses = (parsed.clauses ?? []).filter((clause) => typeof clause.id === 'string' && typeof clause.text === 'string')
  if (clauses.length === 0) return { ...base, skipped: '本项目该书无条文（药物专论 monographs 不属 clause 实体），未校勘' }
  const ids = new Set<string>()
  for (const clause of clauses) {
    if (ids.has(clause.id)) throw new Error(`${book.id}：条文 id 重复 ${clause.id}`)
    ids.add(clause.id)
  }

  const runs: WitnessRun[] = []
  for (const witness of witnesses) {
    const loadStarted = performance.now()
    const loaded = await loadWitness(root, book.id, witness, sources)
    const loadMs = performance.now() - loadStarted
    const run = collateOneWitness(book.id, clauses, loaded, loadMs)
    const { tally, timing } = run.summary
    log(
      `${book.id} × ${witness.lockId}（${witness.ref}）：${tally.total} 条 agree ${tally.agree} / variant ${tally.variant} / mismatch ${tally.mismatch} / missing ${tally.missing}，${(timing.totalMs / 1000).toFixed(1)} s`,
    )
    runs.push(run)
  }

  const evidenceFile: EvidenceFile = {
    producer: PRODUCER,
    generatedAt: new Date().toISOString(),
    sourceIds: [...new Set(runs.map((run) => run.summary.sourceId))].sort(),
    records: interleave(runs, clauses.length),
  }
  await writeJson(resolveRepoPath(root, `${EVIDENCE_DIR}/${PRODUCER}-${book.id}.json`), evidenceFile)
  const totalMs = Math.round(performance.now() - started)
  if (totalMs > BOOK_TIME_TARGET_MS) log(`警告：${book.id} 耗时 ${(totalMs / 1000).toFixed(1)} s，超过目标 ${BOOK_TIME_TARGET_MS / 1000} s`)
  return { ...base, clauseCount: clauses.length, totalMs, witnesses: runs.map((run) => run.summary) }
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

function renderMarkdown(summary: SummaryFile): string {
  const lines: string[] = []
  lines.push('# 通用校勘汇总（collation）', '')
  lines.push(`生成时间：${summary.generatedAt}`, '')
  lines.push(
    `判定：ratio ≥ ${TEXT_AGREE_RATIO} 为 agree，≥ ${TEXT_VARIANT_RATIO} 为 variant，≥ ${MISSING_RATIO_FLOOR} 为 mismatch，更低或无候选为 missing；` +
      `规范后短于 ${SHORT_NEEDLE_LENGTH} 字的条文只做精确定位；其余条文按句读分段（每段 ${MIN_PIECE_LENGTH}~${PIECE_LENGTH} 字）依次在单调窗口（向前至少 ${WINDOW_FORWARD_MIN} 字）内对齐，` +
      `前后两段都可靠命中且见证本在句读处多出 ≥ ${STRUCTURAL_GAP_MIN} 字时记为结构性插入（方药/校注），不计入 ratio，但在 note 中注明。`,
    '',
  )
  lines.push(
    '缺字通配：Kanripo `&KR…;` 实体、jobkoko `KT` 为严格通配（等于任意一个字）；汉字间孤立空格（jobkoko 与本项目）为可选通配（等于任意一个字或可零代价忽略）。' +
      '「通配改判」= 若不通配 verdict 会不同的条数。jobkoko 另在比对前清除 `\\x` 方名标记、`\\….bmp\\r` 图片占位与行首数字条号；jobkoko 与本项目文本两侧都修正词组转换误替换：「香港脚→脚气」「浓朴→厚朴」，以及该文本单元（见证本全文/单条条文）无「病人」时的「病患→病人」（quote 与异文片段保留原文）。',
    '',
  )

  lines.push('## 各书 × 见证结果', '')
  lines.push('| 书目 | 见证 | 条文 | agree | variant | mismatch | missing | 平均 ratio | 耗时 s | 缺字 见证/本项目 | 通配改判 |')
  lines.push('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
  for (const book of summary.books) {
    if (book.skipped) continue
    for (const witness of book.witnesses) {
      const { tally } = witness
      lines.push(
        `| ${book.title}（${book.bookId}） | ${escapeCell(witness.ref)}${witness.edition ? `@${witness.edition}` : ''}${witness.differentRecension ? ' ⚑' : ''} | ${tally.total} | ` +
          `${tally.agree}（${percent(tally.rates.agree)}） | ${tally.variant}（${percent(tally.rates.variant)}） | ` +
          `${tally.mismatch}（${percent(tally.rates.mismatch)}） | ${tally.missing}（${percent(tally.rates.missing)}） | ` +
          `${tally.averageRatio ?? '—'} | ${(witness.timing.totalMs / 1000).toFixed(1)} | ` +
          `${witness.gaps.witnessStrict}+${witness.gaps.witnessOptional} / ${witness.gaps.localStrict}+${witness.gaps.localOptional} | ${witness.gaps.verdictChanged} |`,
      )
    }
  }
  lines.push('', '⚑ = differentRecension（版本系统不同）。缺字列为「严格+可选」通配数。', '')

  lines.push('## 各书耗时', '')
  lines.push('| 书目 | 条文 | 总耗时 s | 各见证（读取/预处理/定位/记录 ms） |')
  lines.push('|---|---:|---:|---|')
  for (const book of summary.books) {
    if (book.skipped) continue
    const parts = book.witnesses.map(
      (witness) =>
        `${escapeCell(witness.ref)}：${witness.timing.loadMs}/${witness.timing.prepareMs}/${witness.timing.collateMs}/${witness.timing.recordMs}`,
    )
    lines.push(`| ${book.bookId} | ${book.clauseCount} | ${(book.totalMs / 1000).toFixed(1)} | ${parts.join('；')} |`)
  }
  lines.push('')

  lines.push('## 定位方式分布', '')
  lines.push('| 书目 | 见证 | 精确 | 通配精确 | 单段窗口 | 单段全局 | 分段 | 其中全局锚定 | 结构性插入 条/字 | 多处命中 | 分段部分命中 | 乱序 |')
  lines.push('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
  for (const book of summary.books) {
    for (const witness of book.witnesses) {
      const strategy = witness.strategies
      lines.push(
        `| ${book.bookId} | ${escapeCell(witness.ref)} | ${strategy.exact} | ${strategy.gapExact} | ${strategy.window} | ${strategy.global} | ${strategy.pieces} | ${witness.viaGlobal} | ${witness.structuralRecords}/${witness.structuralChars} | ${witness.multiHit} | ${witness.partialPieces} | ${witness.outOfOrder} |`,
      )
    }
  }
  lines.push('')

  lines.push(`## 异常书目（mismatch + missing > ${percent(ANOMALY_RATE)}）`, '')
  let anomalyCount = 0
  for (const book of summary.books) {
    for (const witness of book.witnesses) {
      if (!witness.anomaly) continue
      anomalyCount += 1
      lines.push(`### ${book.title}（${book.bookId}） × ${witness.ref}：${percent(witness.anomaly.rate)}`, '')
      for (const hint of witness.anomaly.hints) lines.push(`- 自动提示：${hint}`)
      if (witness.anomaly.hotspots.length > 0) {
        lines.push(
          `- 异常集中篇章：${witness.anomaly.hotspots.map((hotspot) => `${hotspot.chapter}（${hotspot.anomalies}/${hotspot.total}）`).join('、')}`,
        )
      }
      lines.push('', '| 条文 | verdict | ratio | 本项目片段 | 见证本片段 |', '|---|---|---:|---|---|')
      for (const sample of witness.anomaly.samples) {
        const ratio = sample.ratio ?? (sample.bestCandidateRatio !== null ? `（最佳候选 ${sample.bestCandidateRatio}）` : '—')
        lines.push(
          `| ${sample.entityId} | ${sample.verdict} | ${ratio} | ${escapeCell(sample.local)} | ${escapeCell(sample.witness || '—')} |`,
        )
      }
      lines.push('')
    }
  }
  if (anomalyCount === 0) lines.push('无。', '')

  lines.push(`## 高频异文字对 Top ${TOP_PAIRS}（variant 记录中等长短替换，规范字）`, '')
  lines.push('供补充 data/ontology/variant-chars.json 参考：需人工判断是异体/古今/通假，还是真实异文或繁简转换遗漏。', '')
  lines.push('| # | 本项目 | 见证本 | 次数 | 书目 | 示例条文 |', '|---:|---|---|---:|---|---|')
  summary.topReplacePairs.forEach((pair, index) => {
    lines.push(`| ${index + 1} | ${pair.local} | ${pair.witness} | ${pair.count} | ${pair.books.join('、')} | ${pair.example} |`)
  })
  lines.push('')

  const skipped = summary.books.filter((book) => book.skipped)
  if (skipped.length > 0) {
    lines.push('## 跳过的书目', '')
    for (const book of skipped) lines.push(`- ${book.title}（${book.bookId}）：${book.skipped}`)
    lines.push('')
  }
  return `${lines.join('\n')}\n`
}

async function main(): Promise<number> {
  const args = process.argv.slice(2).filter((arg) => arg !== '--')
  if (args.includes('--help') || args.includes('-h')) {
    console.log('用法：npx tsx scripts/crosscheck/collate.ts [bookId...]')
    return 0
  }
  const unknownOptions = args.filter((arg) => arg.startsWith('-'))
  if (unknownOptions.length > 0) throw new Error(`未知选项：${unknownOptions.join(' ')}`)

  const root = projectRoot()
  const lock = parseVendorLockText(await readText(resolveRepoPath(root, VENDOR_LOCK_RELATIVE_PATH)))
  const sources = new Map(lock.sources.map((source) => [source.id, source]))
  const witnesses = validateWitnesses(await readJsonFile<unknown>(resolveRepoPath(root, WITNESSES_FILE), WITNESSES_FILE))
  const books = await readJsonFile<BookMeta[]>(resolveRepoPath(root, BOOKS_FILE), BOOKS_FILE)
  const bookById = new Map(books.map((book) => [book.id, book]))
  for (const witness of witnesses) {
    if (!bookById.has(witness.bookId)) throw new Error(`${WITNESSES_FILE}：未知 bookId ${witness.bookId}`)
  }

  const registered = books.filter((book) => witnesses.some((witness) => witness.bookId === book.id)).map((book) => book.id)
  const requested = args.length > 0 ? [...new Set(args)] : registered
  const unregistered = requested.filter((id) => !registered.includes(id))
  if (unregistered.length > 0) {
    throw new Error(`以下书目未在 ${WITNESSES_FILE} 登记见证本：${unregistered.join(', ')}；可选：${registered.join(', ')}`)
  }

  const summaryJsonPath = resolveRepoPath(root, `${REPORTS_DIR}/${SUMMARY_BASENAME}.json`)
  const previous = (await fileExists(summaryJsonPath))
    ? await readJsonFile<SummaryFile>(summaryJsonPath, '上次汇总').catch(() => null)
    : null
  const bookSummaries = new Map<string, BookSummary>()
  for (const book of previous?.version === SUMMARY_VERSION ? previous.books : []) {
    if (registered.includes(book.bookId)) bookSummaries.set(book.bookId, book)
  }

  const failures: string[] = []
  for (const bookId of requested) {
    const book = bookById.get(bookId)!
    const bookWitnesses = witnesses.filter((witness) => witness.bookId === bookId)
    try {
      const summary = await collateBook(root, book, bookWitnesses, sources)
      if (summary.skipped) log(`${bookId}：跳过（${summary.skipped}）`)
      else log(`${bookId}：完成，${summary.clauseCount} 条，${(summary.totalMs / 1000).toFixed(1)} s`)
      bookSummaries.set(bookId, summary)
    } catch (error) {
      failures.push(`${bookId}：${errorMessage(error)}`)
      console.error(`${LOG_PREFIX} 错误：${bookId}：${errorMessage(error)}`)
    }
  }

  const orderedBooks = registered.map((id) => bookSummaries.get(id)).filter((book): book is BookSummary => book !== undefined)
  const summary: SummaryFile = {
    version: SUMMARY_VERSION,
    producer: PRODUCER,
    generatedAt: new Date().toISOString(),
    settings: {
      agreeRatio: TEXT_AGREE_RATIO,
      variantRatio: TEXT_VARIANT_RATIO,
      missingRatioFloor: MISSING_RATIO_FLOOR,
      shortNeedleLength: SHORT_NEEDLE_LENGTH,
      pieceLength: PIECE_LENGTH,
      minPieceLength: MIN_PIECE_LENGTH,
      structuralGapMin: STRUCTURAL_GAP_MIN,
      windowForwardMin: WINDOW_FORWARD_MIN,
      anomalyRate: ANOMALY_RATE,
    },
    books: orderedBooks,
    topReplacePairs: mergeRankedPairs(
      orderedBooks.flatMap((book) => book.witnesses.map((witness) => witness.replacePairs)),
      TOP_PAIRS,
    ),
  }
  await writeJson(summaryJsonPath, summary)
  await writeText(resolveRepoPath(root, `${REPORTS_DIR}/${SUMMARY_BASENAME}.md`), renderMarkdown(summary))
  log(`汇总已写入 ${REPORTS_DIR}/${SUMMARY_BASENAME}.json / .md`)
  if (failures.length > 0) {
    console.error(`${LOG_PREFIX} ${failures.length} 本失败：\n  ${failures.join('\n  ')}`)
    return 1
  }
  return 0
}

main()
  .then((exitCode) => {
    process.exitCode = exitCode
  })
  .catch((error: unknown) => {
    console.error(`${LOG_PREFIX} 致命错误：${errorMessage(error)}`)
    process.exitCode = 1
  })
