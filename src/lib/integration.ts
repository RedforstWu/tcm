/**
 * 外部来源整合（证据链）的前端数据层：类型、加载、索引、locator 解析与中文标签。
 * 类型与 scripts/lib/integration-contract.ts 保持一致（前端不能 import scripts）。
 * 所有加载函数在数据缺失或格式错误时返回空结果，不抛错。
 */
import type { BookId, Evidence, EvidenceField, EvidenceLevel, EvidenceVerdict, SourceGroup } from '@/types/data'
import { BOOK_BY_ID } from '@/types/data'
import type { Concept } from '@/types/ontology'

export const COMMENTARIES_URL = '/data/commentaries.json'
export const KANRIPO_LICENSE = 'CC BY-SA 4.0'
export const KANRIPO_LICENSE_URL = 'https://creativecommons.org/licenses/by-sa/4.0/deed.zh-hans'
const KANRIPO_GITHUB_BASE = 'https://github.com/kanripo'

/** 对应契约 VariantSegment */
export interface VariantSegment {
  op: 'equal' | 'insert' | 'delete' | 'replace'
  local: string
  witness: string
}

/** 对应契约 CommentaryQuote */
export interface CommentaryQuote {
  text: string
  /** 在注家原书见证本中逐字（规范化后）命中 */
  verified: boolean
  evidence?: Evidence
  ratio?: number
}

/** 对应契约 IntegratedCommentary；public/data 版本不含 summary */
export interface Commentary {
  /** `commentary-<注家>-<条文号三位>` */
  id: string
  clauseId: string
  commentator: string
  sourceBook: string
  formulaIds: string[]
  quotes: CommentaryQuote[]
  evidence: Evidence[]
}

export type CommentaryIndex = ReadonlyMap<string, Commentary[]>

// ---------- 标签 ----------

export interface EvidenceLevelMeta {
  level: EvidenceLevel
  label: string
  description: string
  /** Tailwind 徽标配色 */
  badgeClass: string
}

export const EVIDENCE_LEVEL_META: Record<EvidenceLevel, EvidenceLevelMeta> = {
  single: {
    level: 'single',
    label: '单一来源',
    description: '仅见于一个来源，尚未互证',
    badgeClass: 'bg-stone-100 text-stone-600 ring-stone-200',
  },
  corroborated: {
    level: 'corroborated',
    label: '已互证',
    description: '两个不同来源组的见证本一致',
    badgeClass: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  },
  disputed: {
    level: 'disputed',
    label: '有分歧',
    description: '见证本之间存在异文或冲突，待人工核对',
    badgeClass: 'bg-amber-50 text-amber-800 ring-amber-300',
  },
}

/** 未知或缺失的等级返回 null（不显示徽标） */
export function evidenceLevelMeta(level: string | null | undefined): EvidenceLevelMeta | null {
  if (!level) return null
  return Object.prototype.hasOwnProperty.call(EVIDENCE_LEVEL_META, level)
    ? EVIDENCE_LEVEL_META[level as EvidenceLevel]
    : null
}

export const SOURCE_GROUP_LABEL: Record<SourceGroup, string> = {
  wikisource: '维基文库',
  kanripo: '漢籍リポジトリ Kanripo',
  'web-simplified': '网络流传简体本',
  derived: '二次整理库',
}

export function sourceGroupLabel(group: string): string {
  return Object.prototype.hasOwnProperty.call(SOURCE_GROUP_LABEL, group)
    ? SOURCE_GROUP_LABEL[group as SourceGroup]
    : group
}

export const EVIDENCE_FIELD_LABEL: Record<EvidenceField, string> = {
  text: '条文',
  herbs: '药味',
  doses: '剂量',
  preparation: '煎服法',
  formulaLink: '条文→方剂',
  quote: '引文',
  kangpingLayer: '康平本分层',
}

export interface EvidenceVerdictMeta {
  label: string
  /** Tailwind 文字配色 */
  textClass: string
}

export const EVIDENCE_VERDICT_META: Record<EvidenceVerdict, EvidenceVerdictMeta> = {
  agree: { label: '一致', textClass: 'text-emerald-700' },
  variant: { label: '异文', textClass: 'text-sky-700' },
  mismatch: { label: '不符', textClass: 'text-amber-800' },
  missing: { label: '未见', textClass: 'text-stone-400' },
}

function isEvidenceField(value: unknown): value is EvidenceField {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(EVIDENCE_FIELD_LABEL, value)
}

function isEvidenceVerdict(value: unknown): value is EvidenceVerdict {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(EVIDENCE_VERDICT_META, value)
}

const PERCENT = 100

/** 0..1 相似度 → 「87%」；越界或非数值返回 null */
export function formatEvidenceRatio(ratio: number | undefined): string | null {
  if (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio < 0 || ratio > 1) return null
  return `${Math.round(ratio * PERCENT)}%`
}

export const KANGPING_LAYERS = ['原文', '追文', '注文'] as const
export type KangpingLayer = (typeof KANGPING_LAYERS)[number]

export function isKangpingLayer(value: unknown): value is KangpingLayer {
  return typeof value === 'string' && (KANGPING_LAYERS as readonly string[]).includes(value)
}

// ---------- locator ----------

export interface KanripoLocator {
  /** 如 KR3e0007 */
  repoId: string
  /** 如 SBCK */
  branch: string
  /** 三位卷号，如 001 */
  juan: string
  /** 页面/栏，如 1a；可缺 */
  page?: string
}

/** 形如 `KR3e0007_SBCK_001-1a` 或 `KR3e0007_SBCK_001` */
const KANRIPO_LOCATOR_PATTERN = /^(KR\d[a-z]\d{4})_([A-Za-z0-9-]+?)_(\d{3})(?:-([0-9]+[a-z]?))?$/

export function parseKanripoLocator(locator: string | null | undefined): KanripoLocator | null {
  if (typeof locator !== 'string') return null
  const match = KANRIPO_LOCATOR_PATTERN.exec(locator.trim())
  if (!match) return null
  const [, repoId, branch, juan, page] = match
  if (!repoId || !branch || !juan) return null
  return page ? { repoId, branch, juan, page } : { repoId, branch, juan }
}

export function kanripoFileUrl(locator: string | null | undefined): string | null {
  const parsed = parseKanripoLocator(locator)
  if (!parsed) return null
  const { repoId, branch, juan } = parsed
  return `${KANRIPO_GITHUB_BASE}/${repoId}/blob/${branch}/${repoId}_${juan}.txt`
}

/** 证据外链：目前仅 Kanripo 可由 locator 生成 */
export function evidenceHref(evidence: Pick<Evidence, 'group' | 'locator'>): string | null {
  if (evidence.group !== 'kanripo') return null
  return kanripoFileUrl(evidence.locator)
}

export function hasKanripoEvidence(evidence: ReadonlyArray<Pick<Evidence, 'group'>>): boolean {
  return evidence.some((item) => item.group === 'kanripo')
}

// ---------- 校验 ----------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : []
}

export function toEvidence(value: unknown): Evidence | null {
  if (!isRecord(value)) return null
  const sourceId = readString(value.sourceId)
  const group = readString(value.group)
  const locator = readString(value.locator)
  if (!sourceId || !group || !locator) return null
  const quote = readString(value.quote)
  const ratio = typeof value.ratio === 'number' && formatEvidenceRatio(value.ratio) !== null ? value.ratio : undefined
  return {
    sourceId,
    group: group as SourceGroup,
    locator,
    license: readString(value.license) ?? '未声明',
    ...(quote ? { quote } : {}),
    ...(isEvidenceField(value.field) ? { field: value.field } : {}),
    ...(isEvidenceVerdict(value.verdict) ? { verdict: value.verdict } : {}),
    ...(ratio === undefined ? {} : { ratio }),
  }
}

/** 过滤掉结构不完整的证据项 */
export function normalizeEvidenceList(value: unknown): Evidence[] {
  if (!Array.isArray(value)) return []
  return value.map(toEvidence).filter((item): item is Evidence => item !== null)
}

const VARIANT_OPS = new Set<VariantSegment['op']>(['equal', 'insert', 'delete', 'replace'])

/** 构建端可能在证据项上附带 variants（契约 VariantSegment[]）；缺失返回空数组 */
export function readVariantSegments(evidence: unknown): VariantSegment[] {
  if (!isRecord(evidence) || !Array.isArray(evidence.variants)) return []
  const segments: VariantSegment[] = []
  for (const item of evidence.variants) {
    if (!isRecord(item) || !VARIANT_OPS.has(item.op as VariantSegment['op'])) continue
    segments.push({
      op: item.op as VariantSegment['op'],
      local: typeof item.local === 'string' ? item.local : '',
      witness: typeof item.witness === 'string' ? item.witness : '',
    })
  }
  return segments.some((segment) => segment.op !== 'equal') ? segments : []
}

// ---------- 注家 ----------

/** 展示顺序：成无己（金）→ 柯琴（清）→ 尤怡（清），其余按名排在后面 */
export const COMMENTATOR_ORDER = ['成无己', '柯琴', '尤怡'] as const

function commentatorRank(name: string): number {
  const index = (COMMENTATOR_ORDER as readonly string[]).indexOf(name)
  return index === -1 ? COMMENTATOR_ORDER.length : index
}

/** 只保留核验通过的原句；没有可展示原句的注文丢弃 */
export function toCommentary(value: unknown): Commentary | null {
  if (!isRecord(value)) return null
  const id = readString(value.id)
  const clauseId = readString(value.clauseId)
  const commentator = readString(value.commentator)
  if (!id || !clauseId || !commentator) return null
  const quotes: CommentaryQuote[] = []
  if (Array.isArray(value.quotes)) {
    for (const raw of value.quotes) {
      if (!isRecord(raw) || raw.verified !== true) continue
      const text = readString(raw.text)
      if (!text) continue
      const evidence = toEvidence(raw.evidence)
      quotes.push({
        text,
        verified: true,
        ...(evidence ? { evidence } : {}),
        ...(typeof raw.ratio === 'number' ? { ratio: raw.ratio } : {}),
      })
    }
  }
  if (quotes.length === 0) return null
  return {
    id,
    clauseId,
    commentator,
    sourceBook: readString(value.sourceBook) ?? '',
    formulaIds: readStringArray(value.formulaIds),
    quotes,
    evidence: normalizeEvidenceList(value.evidence),
  }
}

export function buildCommentaryIndex(raw: unknown): Map<string, Commentary[]> {
  const index = new Map<string, Commentary[]>()
  if (!Array.isArray(raw)) return index
  const seenIds = new Set<string>()
  for (const item of raw) {
    const commentary = toCommentary(item)
    if (!commentary || seenIds.has(commentary.id)) continue
    seenIds.add(commentary.id)
    const list = index.get(commentary.clauseId)
    if (list) list.push(commentary)
    else index.set(commentary.clauseId, [commentary])
  }
  for (const list of index.values()) {
    list.sort(
      (a, b) =>
        commentatorRank(a.commentator) - commentatorRank(b.commentator) ||
        a.commentator.localeCompare(b.commentator, 'zh'),
    )
  }
  return index
}

const EMPTY_INDEX: CommentaryIndex = new Map()
let commentaryIndexPromise: Promise<CommentaryIndex> | undefined

/**
 * 懒加载并缓存注家索引（clauseId → 注文）。文件不存在、返回 HTML 回退页或格式错误时得到空索引。
 * 加载失败不缓存，便于数据生成后刷新页面即可获取。
 */
export function loadCommentaryIndex(fetchImpl: typeof fetch = fetch): Promise<CommentaryIndex> {
  commentaryIndexPromise ??= (async () => {
    try {
      const response = await fetchImpl(COMMENTARIES_URL)
      // 开发服务器对缺失文件可能回退到 index.html（200 + text/html）
      const contentType = response.headers?.get('content-type') ?? ''
      if (!response.ok || contentType.includes('text/html')) {
        commentaryIndexPromise = undefined
        return EMPTY_INDEX
      }
      return buildCommentaryIndex(await response.json())
    } catch (error) {
      console.warn(`[integration] 无法读取 ${COMMENTARIES_URL}，注家区不显示`, error)
      commentaryIndexPromise = undefined
      return EMPTY_INDEX
    }
  })()
  return commentaryIndexPromise
}

/** 仅供测试重置缓存 */
export function resetIntegrationCache(): void {
  commentaryIndexPromise = undefined
}

// ---------- 条文 / 书目 ----------

/** 条文 id 前缀即书目 id（`songben-12`、`jingui-1-1`、`danxi-001-0001`） */
export function bookIdFromClauseId(clauseId: string): BookId | null {
  const dash = clauseId.indexOf('-')
  if (dash <= 0) return null
  const prefix = clauseId.slice(0, dash)
  return BOOK_BY_ID[prefix as BookId] ? (prefix as BookId) : null
}

export function clauseHref(clauseId: string, bookId?: string | null): string | null {
  const book = bookId ?? bookIdFromClauseId(clauseId)
  return book ? `/read/${book}?clause=${encodeURIComponent(clauseId)}` : null
}

// ---------- 证型 ----------

export interface SyndromeDifferential {
  targetConceptId: string
  note?: string
}

/** 对应契约 IntegratedSyndrome 中可能随 Concept(type=syndrome) 一起发布的附加字段 */
export interface SyndromeProfile {
  sixChannel?: string
  definition?: string
  mainSymptoms: string[]
  mainFormulaIds: string[]
  clauseIds: string[]
  differentials: SyndromeDifferential[]
}

/** 从概念对象上宽松读取证型附加字段；字段缺失时为空，六经可回退到 broader 中的 channel.* */
export function readSyndromeProfile(concept: Concept): SyndromeProfile {
  const raw = concept as unknown as Record<string, unknown>
  const differentials: SyndromeDifferential[] = []
  if (Array.isArray(raw.differentials)) {
    for (const item of raw.differentials) {
      if (!isRecord(item)) continue
      const targetConceptId = readString(item.targetConceptId)
      if (!targetConceptId || targetConceptId === concept.id) continue
      const note = readString(item.note)
      differentials.push(note ? { targetConceptId, note } : { targetConceptId })
    }
  }
  const broaderChannel = (concept.broader ?? [])
    .find((id) => id.startsWith('channel.'))
    ?.slice('channel.'.length)
  const sixChannel = readString(raw.sixChannel) ?? broaderChannel
  const definition = readString(raw.definition)
  return {
    ...(sixChannel ? { sixChannel } : {}),
    ...(definition ? { definition } : {}),
    mainSymptoms: readStringArray(raw.mainSymptoms),
    mainFormulaIds: readStringArray(raw.mainFormulaIds),
    clauseIds: readStringArray(raw.clauseIds),
    differentials,
  }
}

/** 六经病名 → 经络概念 id：`太阳病` → `channel.太阳` */
export function channelConceptIdFromSixChannel(sixChannel: string): string {
  return `channel.${sixChannel.replace(/病$/, '')}`
}
