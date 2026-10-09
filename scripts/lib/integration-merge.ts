/**
 * 外部来源整合（消费端）：证据合并与判级、许可闸门、把整合结果写入条文/方剂/证型概念，
 * 以及方剂药味的他书同名方回填规则。除 loadIntegrationInputs 外均为纯函数。
 * 数据形状见 integration-contract.ts。
 */
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import type {
  BookId,
  Clause,
  Evidence,
  EvidenceLevel,
  Formula,
  FormulaHerb,
  SourceGroup,
} from '../../src/types/data.ts'
import type { Concept } from '../../src/types/ontology.ts'
import { fileExists, readText } from './fs-utils.ts'
import {
  EVIDENCE_DIR,
  INTEGRATION_DIR,
  PUBLISH_UNLICENSED_ENV,
  UNLICENSED_GROUPS,
  WITNESSES_FILE,
  type BookWitness,
  type ClauseAttributes,
  type ClauseAttributesFile,
  type EntityEvidenceRecord,
  type EvidenceField,
  type EvidenceFile,
  type EvidenceVerdict,
  type IntegratedCommentary,
  type IntegratedEntityType,
  type IntegratedSyndrome,
} from './integration-contract.ts'

export const COMMENTARIES_FILE = `${INTEGRATION_DIR}/commentaries.json`
export const SYNDROMES_FILE = `${INTEGRATION_DIR}/syndromes.json`
export const CLAUSE_ATTRIBUTES_FILE = `${INTEGRATION_DIR}/clause-attributes.json`
export const KB_EVIDENCE_FILE = `${EVIDENCE_DIR}/shanghan-kb.json`
export const COLLATION_EVIDENCE_PATTERN = `${EVIDENCE_DIR}/collation-<bookId>.json`
const COLLATION_FILE_RE = /^collation-.+\.json$/

/** 本项目自身文本所属组：所有证据记录都是「本项目 vs 见证本」，它是比对基准 */
export const BASELINE_GROUP: SourceGroup = 'wikisource'
/** 版本最可靠的独立见证组：它给出 mismatch 时，他组一致也不能判互证 */
export const AUTHORITATIVE_GROUP: SourceGroup = 'kanripo'
/**
 * 只能佐证、不能单独判 disputed 的 (组, 字段)：KB 的煎服法是整理改写，与原文相似度普遍偏低，
 * 其 mismatch 记录保留在证据中供人工审阅，但不参与判级。
 */
const ADVISORY_MISMATCH_FIELDS: Partial<Record<SourceGroup, ReadonlySet<EvidenceField>>> = {
  derived: new Set<EvidenceField>(['preparation']),
}

export function isAdvisoryMismatch(record: Pick<EntityEvidenceRecord, 'field' | 'verdict' | 'evidence'>): boolean {
  return record.verdict === 'mismatch' && ADVISORY_MISMATCH_FIELDS[record.evidence.group]?.has(record.field) === true
}

const SOURCE_GROUPS: ReadonlySet<string> = new Set<SourceGroup>([
  'wikisource',
  'kanripo',
  'web-simplified',
  'derived',
])
const EVIDENCE_FIELDS: readonly EvidenceField[] = [
  'text',
  'herbs',
  'doses',
  'preparation',
  'formulaLink',
  'quote',
  'kangpingLayer',
]
const EVIDENCE_FIELD_SET: ReadonlySet<string> = new Set(EVIDENCE_FIELDS)
const VERDICTS: ReadonlySet<string> = new Set<EvidenceVerdict>(['agree', 'variant', 'mismatch', 'missing'])
const AGREEING_VERDICTS: ReadonlySet<EvidenceVerdict> = new Set<EvidenceVerdict>(['agree', 'variant'])
const ENTITY_TYPES: ReadonlySet<string> = new Set<IntegratedEntityType>([
  'clause',
  'formula',
  'commentary',
  'syndrome',
])
const KANGPING_LAYERS: ReadonlySet<string> = new Set(['原文', '追文', '注文'])
const VARIANT_OPS: ReadonlySet<string> = new Set(['equal', 'insert', 'delete', 'replace'])
const SYNDROME_ID_PREFIX = 'syndrome.'

/**
 * 实体级判级取哪些字段：按顺序取第一个有证据的字段；其中任一为 disputed 时实体为 disputed。
 * 证型没有约定的主字段，任一字段都可参与。
 */
const ENTITY_KEY_FIELDS: Record<IntegratedEntityType, readonly EvidenceField[]> = {
  clause: ['text'],
  formula: ['herbs', 'doses', 'preparation'],
  commentary: ['quote'],
  syndrome: EVIDENCE_FIELDS,
}

// ---------- 结构校验 ----------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function isValidEvidence(value: unknown): value is Evidence {
  return (
    isPlainObject(value) &&
    isNonEmptyString(value.sourceId) &&
    typeof value.group === 'string' &&
    SOURCE_GROUPS.has(value.group) &&
    isNonEmptyString(value.locator) &&
    typeof value.license === 'string'
  )
}

export function isValidEvidenceRecord(value: unknown): value is EntityEvidenceRecord {
  if (!isPlainObject(value)) return false
  if (!isNonEmptyString(value.entityId)) return false
  if (typeof value.entityType !== 'string' || !ENTITY_TYPES.has(value.entityType)) return false
  if (typeof value.field !== 'string' || !EVIDENCE_FIELD_SET.has(value.field)) return false
  if (typeof value.verdict !== 'string' || !VERDICTS.has(value.verdict)) return false
  if (value.ratio !== undefined && (typeof value.ratio !== 'number' || !Number.isFinite(value.ratio))) {
    return false
  }
  if (value.variants !== undefined && !Array.isArray(value.variants)) return false
  return isValidEvidence(value.evidence)
}

function isValidEvidenceFile(value: unknown): value is EvidenceFile {
  return isPlainObject(value) && typeof value.producer === 'string' && Array.isArray(value.records)
}

// ---------- 判级 ----------

/**
 * 单个 (实体, 字段) 的判级。
 *
 * 每条记录都是「本项目文本（wikisource 组，基准）vs 某见证本」的比对结论，所以：
 * - wikisource 组记录不计入「他组」；verdict=missing 不参与（见证本缺该段不构成反证）。
 * - agreeGroups：给出 agree/variant 的他组集合；mismatchGroups：给出 mismatch 的他组集合。
 * - 互证要求两个不同组一致。KB（derived）与 jobkoko（web-simplified）同出网络流传文本，二者
 *   彼此一致不能单独构成互证；但这里任何一条 agree 本来就是「wikisource 基准 + 该见证组」两组
 *   一致，因此 agreeGroups 中哪怕只有 derived 或 web-simplified，也已满足「两个不同组」。
 *   最终规则：agreeGroups 非空且 kanripo 组无 mismatch → corroborated。
 * - kanripo 组 mismatch：他组即使一致也判 disputed；只有 mismatch 没有任何一致 → disputed。
 * - ADVISORY_MISMATCH_FIELDS 中的 mismatch 不参与判级。
 * - 其余（无记录、只有 missing）→ single。
 */
export function classifyFieldLevel(records: readonly EntityEvidenceRecord[]): EvidenceLevel {
  const agreeGroups = new Set<SourceGroup>()
  const mismatchGroups = new Set<SourceGroup>()
  for (const record of records) {
    const group = record.evidence.group
    if (group === BASELINE_GROUP || isAdvisoryMismatch(record)) continue
    if (AGREEING_VERDICTS.has(record.verdict)) agreeGroups.add(group)
    else if (record.verdict === 'mismatch') mismatchGroups.add(group)
  }
  if (agreeGroups.size > 0) {
    return mismatchGroups.has(AUTHORITATIVE_GROUP) ? 'disputed' : 'corroborated'
  }
  if (mismatchGroups.size > 0) return 'disputed'
  return 'single'
}

/** 实体级判级；没有任何关键字段证据时返回 undefined（未比对） */
export function entityEvidenceLevel(
  entityType: IntegratedEntityType,
  fieldLevels: Partial<Record<EvidenceField, EvidenceLevel>>,
): EvidenceLevel | undefined {
  const present = ENTITY_KEY_FIELDS[entityType].filter((field) => fieldLevels[field] !== undefined)
  if (present.length === 0) return undefined
  if (present.some((field) => fieldLevels[field] === 'disputed')) return 'disputed'
  return fieldLevels[present[0]!]
}

export interface MergedEntityEvidence {
  entityId: string
  entityType: IntegratedEntityType
  records: EntityEvidenceRecord[]
  fieldLevels: Partial<Record<EvidenceField, EvidenceLevel>>
  level?: EvidenceLevel
}

export interface EvidenceMergeResult {
  byEntity: Map<string, MergedEntityEvidence>
  recordCount: number
  invalidRecordCount: number
  duplicateRecordCount: number
}

function recordKey(record: EntityEvidenceRecord): string {
  return [
    record.entityId,
    record.field,
    record.evidence.sourceId,
    record.evidence.locator,
    record.verdict,
  ].join('|')
}

/** 按 (entityId, field) 聚合所有 EvidenceFile 的记录并判级；结构不合法的记录跳过计数 */
export function mergeEvidenceFiles(files: readonly EvidenceFile[]): EvidenceMergeResult {
  const byEntity = new Map<string, MergedEntityEvidence>()
  const seen = new Set<string>()
  let recordCount = 0
  let invalidRecordCount = 0
  let duplicateRecordCount = 0
  for (const file of files) {
    for (const raw of file.records) {
      if (!isValidEvidenceRecord(raw)) {
        invalidRecordCount += 1
        continue
      }
      const key = recordKey(raw)
      if (seen.has(key)) {
        duplicateRecordCount += 1
        continue
      }
      seen.add(key)
      recordCount += 1
      const entry = byEntity.get(raw.entityId) ?? {
        entityId: raw.entityId,
        entityType: raw.entityType,
        records: [],
        fieldLevels: {},
      }
      entry.records.push(raw)
      byEntity.set(raw.entityId, entry)
    }
  }
  for (const entry of byEntity.values()) {
    const byField = new Map<EvidenceField, EntityEvidenceRecord[]>()
    for (const record of entry.records) {
      const list = byField.get(record.field) ?? []
      list.push(record)
      byField.set(record.field, list)
    }
    for (const [field, records] of byField) {
      entry.fieldLevels[field] = classifyFieldLevel(records)
    }
    const level = entityEvidenceLevel(entry.entityType, entry.fieldLevels)
    if (level) entry.level = level
  }
  return { byEntity, recordCount, invalidRecordCount, duplicateRecordCount }
}

// ---------- 许可闸门 ----------

export interface PublishGate {
  /** true 时发布未授权来源组的原文/引文/异文与 KB 整理成果（仅限本地预览） */
  publishUnlicensed: boolean
}

export const DEFAULT_PUBLISH_GATE: PublishGate = { publishUnlicensed: false }

export function resolvePublishGate(env: Record<string, string | undefined> = process.env): PublishGate {
  return { publishUnlicensed: env[PUBLISH_UNLICENSED_ENV] === '1' }
}

export function publishModeLabel(gate: PublishGate): 'default' | 'publish-unlicensed' {
  return gate.publishUnlicensed ? 'publish-unlicensed' : 'default'
}

export function isUnlicensedGroup(group: SourceGroup): boolean {
  return UNLICENSED_GROUPS.includes(group)
}

/** 未授权来源组默认去掉 quote/variants/note，保留 sourceId/group/locator/license/verdict/ratio 等元数据 */
export function gateEvidence(evidence: Evidence, gate: PublishGate): Evidence {
  if (gate.publishUnlicensed || !isUnlicensedGroup(evidence.group)) return { ...evidence }
  const { quote: _quote, variants: _variants, note: _note, ...metadata } = evidence
  return metadata
}

function sanitizeVariantSegments(value: unknown): Evidence['variants'] {
  if (!Array.isArray(value)) return undefined
  const segments = value
    .filter(
      (item): item is { op: 'equal' | 'insert' | 'delete' | 'replace'; local: unknown; witness: unknown } =>
        isPlainObject(item) && typeof item.op === 'string' && VARIANT_OPS.has(item.op),
    )
    .map((item) => ({
      op: item.op,
      local: typeof item.local === 'string' ? item.local : '',
      witness: typeof item.witness === 'string' ? item.witness : '',
    }))
  return segments.length > 0 ? segments : undefined
}

/** 证据记录 → 发布用 Evidence（带 field/verdict/ratio，并过闸门） */
export function recordToEvidence(record: EntityEvidenceRecord, gate: PublishGate): Evidence {
  const evidence: Evidence = {
    sourceId: record.evidence.sourceId,
    group: record.evidence.group,
    locator: record.evidence.locator,
    license: record.evidence.license,
    field: record.field,
    verdict: record.verdict,
  }
  if (isNonEmptyString(record.evidence.quote)) evidence.quote = record.evidence.quote
  if (typeof record.ratio === 'number') evidence.ratio = record.ratio
  if (record.verdict === 'variant') {
    const variants = sanitizeVariantSegments(record.variants)
    if (variants) evidence.variants = variants
  }
  if (isNonEmptyString(record.note)) evidence.note = record.note
  return gateEvidence(evidence, gate)
}

function evidenceKey(evidence: Evidence): string {
  return [evidence.sourceId, evidence.locator, evidence.field ?? '', evidence.verdict ?? ''].join('|')
}

export function dedupeEvidence(list: readonly Evidence[]): Evidence[] {
  const seen = new Set<string>()
  const result: Evidence[] = []
  for (const evidence of list) {
    const key = evidenceKey(evidence)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(evidence)
  }
  return result
}

function gateEvidenceList(value: unknown, gate: PublishGate): Evidence[] {
  if (!Array.isArray(value)) return []
  return dedupeEvidence(value.filter(isValidEvidence).map((item) => gateEvidence(item, gate)))
}

export interface CommentaryGateResult {
  commentaries: IntegratedCommentary[]
  inputCount: number
  invalidCount: number
  /** 结构合法的输入 id（含被闸门剔除的），用于判断证据记录是否指向已知实体 */
  validIds: string[]
  /** 默认模式下没有核验通过原句而整条不发布的注文数 */
  droppedNoVerifiedQuote: number
  /** 默认模式下剔除的未核验引文数 */
  droppedUnverifiedQuotes: number
}

/**
 * 注家条目闸门：summary（KB 现代转述）永不发布；默认只发布 verified=true 的引文原句
 * （古籍原文属公有领域，证据指向注家原书见证本），没有可发布原句的注文整条剔除。
 */
export function gateCommentaries(list: readonly unknown[], gate: PublishGate): CommentaryGateResult {
  const commentaries: IntegratedCommentary[] = []
  const validIds: string[] = []
  let invalidCount = 0
  let droppedNoVerifiedQuote = 0
  let droppedUnverifiedQuotes = 0
  for (const raw of list) {
    if (
      !isPlainObject(raw) ||
      !isNonEmptyString(raw.id) ||
      !isNonEmptyString(raw.clauseId) ||
      !isNonEmptyString(raw.commentator) ||
      !Array.isArray(raw.quotes)
    ) {
      invalidCount += 1
      continue
    }
    validIds.push(raw.id)
    const quotes: IntegratedCommentary['quotes'] = []
    for (const quote of raw.quotes) {
      if (!isPlainObject(quote) || !isNonEmptyString(quote.text)) continue
      const verified = quote.verified === true
      if (!verified && !gate.publishUnlicensed) {
        droppedUnverifiedQuotes += 1
        continue
      }
      quotes.push({
        text: quote.text,
        verified,
        ...(isValidEvidence(quote.evidence) ? { evidence: gateEvidence(quote.evidence, gate) } : {}),
        ...(typeof quote.ratio === 'number' ? { ratio: quote.ratio } : {}),
      })
    }
    if (quotes.length === 0 && !gate.publishUnlicensed) {
      droppedNoVerifiedQuote += 1
      continue
    }
    commentaries.push({
      id: raw.id,
      clauseId: raw.clauseId,
      commentator: raw.commentator,
      sourceBook: typeof raw.sourceBook === 'string' ? raw.sourceBook : '',
      formulaIds: Array.isArray(raw.formulaIds) ? raw.formulaIds.filter(isNonEmptyString) : [],
      quotes,
      evidence: gateEvidenceList(raw.evidence, gate),
    })
  }
  return {
    commentaries,
    inputCount: list.length,
    invalidCount,
    validIds,
    droppedNoVerifiedQuote,
    droppedUnverifiedQuotes,
  }
}

export interface SyndromeGateResult {
  syndromes: IntegratedSyndrome[]
  inputCount: number
  invalidCount: number
  /** 结构合法的输入 conceptId（含被闸门剔除的） */
  validIds: string[]
}

function isValidSyndrome(value: unknown): value is IntegratedSyndrome {
  return (
    isPlainObject(value) &&
    isNonEmptyString(value.conceptId) &&
    value.conceptId.startsWith(SYNDROME_ID_PREFIX) &&
    isNonEmptyString(value.prefLabel)
  )
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(isNonEmptyString) : []
}

/** 证型属 KB 整理成果：默认整体不发布；flag 打开时发布（含 definition 与鉴别要点） */
export function gateSyndromes(list: readonly unknown[], gate: PublishGate): SyndromeGateResult {
  const valid: IntegratedSyndrome[] = []
  let invalidCount = 0
  for (const raw of list) {
    if (!isValidSyndrome(raw)) {
      invalidCount += 1
      continue
    }
    valid.push({
      conceptId: raw.conceptId,
      prefLabel: raw.prefLabel,
      sixChannel: typeof raw.sixChannel === 'string' ? raw.sixChannel : '',
      clauseIds: stringArray(raw.clauseIds),
      mainFormulaIds: stringArray(raw.mainFormulaIds),
      mainSymptoms: stringArray(raw.mainSymptoms),
      differentials: Array.isArray(raw.differentials)
        ? raw.differentials
            .filter(
              (item): item is IntegratedSyndrome['differentials'][number] =>
                isPlainObject(item) && isNonEmptyString(item.targetConceptId),
            )
            .map((item) => ({
              targetConceptId: item.targetConceptId,
              note: typeof item.note === 'string' ? item.note : '',
            }))
        : [],
      ...(isNonEmptyString(raw.definition) ? { definition: raw.definition } : {}),
      evidence: gateEvidenceList(raw.evidence, gate),
    })
  }
  return {
    syndromes: gate.publishUnlicensed ? valid : [],
    inputCount: list.length,
    invalidCount,
    validIds: valid.map((syndrome) => syndrome.conceptId),
  }
}

export interface ClauseAttributesGateResult {
  attributes: ClauseAttributesFile
  inputCount: number
  invalidCount: number
}

/** 康平本分层属 KB 整理成果：默认不发布；flag 打开时发布 */
export function gateClauseAttributes(file: unknown, gate: PublishGate): ClauseAttributesGateResult {
  const attributes: ClauseAttributesFile = {}
  if (!isPlainObject(file)) return { attributes, inputCount: 0, invalidCount: 0 }
  let invalidCount = 0
  const entries = Object.entries(file)
  for (const [clauseId, raw] of entries) {
    if (!isPlainObject(raw)) {
      invalidCount += 1
      continue
    }
    const layer = raw.kangpingLayer
    if (layer !== undefined && (typeof layer !== 'string' || !KANGPING_LAYERS.has(layer))) {
      invalidCount += 1
      continue
    }
    if (!gate.publishUnlicensed) continue
    const value: ClauseAttributes = { evidence: gateEvidenceList(raw.evidence, gate) }
    if (layer !== undefined) value.kangpingLayer = layer as ClauseAttributes['kangpingLayer']
    attributes[clauseId] = value
  }
  return { attributes, inputCount: entries.length, invalidCount }
}

// ---------- 写入实体 ----------

function mergedEvidenceFor(
  entityId: string,
  merged: ReadonlyMap<string, MergedEntityEvidence>,
  gate: PublishGate,
): { evidence: Evidence[]; level?: EvidenceLevel } | null {
  const entry = merged.get(entityId)
  if (!entry) return null
  return {
    evidence: entry.records.map((record) => recordToEvidence(record, gate)),
    ...(entry.level ? { level: entry.level } : {}),
  }
}

export interface ApplyResult<T> {
  items: T[]
  /** 被写入证据或属性的实体 id */
  matchedIds: Set<string>
}

export function applyIntegrationToClauses(
  clauses: readonly Clause[],
  merged: ReadonlyMap<string, MergedEntityEvidence>,
  attributes: ClauseAttributesFile,
  gate: PublishGate,
): ApplyResult<Clause> {
  const matchedIds = new Set<string>()
  const items = clauses.map((clause) => {
    const fromRecords = mergedEvidenceFor(clause.id, merged, gate)
    const attribute = Object.prototype.hasOwnProperty.call(attributes, clause.id)
      ? attributes[clause.id]
      : undefined
    if (!fromRecords && !attribute) return clause
    matchedIds.add(clause.id)
    const evidence = dedupeEvidence([
      ...(clause.evidence ?? []),
      ...(fromRecords?.evidence ?? []),
      ...(attribute?.evidence ?? []).map((item) => gateEvidence(item, gate)),
    ])
    const next: Clause = { ...clause }
    if (evidence.length > 0) next.evidence = evidence
    if (fromRecords?.level) next.evidenceLevel = fromRecords.level
    if (attribute?.kangpingLayer) next.kangpingLayer = attribute.kangpingLayer
    return next
  })
  return { items, matchedIds }
}

export function applyIntegrationToFormulas(
  formulas: readonly Formula[],
  merged: ReadonlyMap<string, MergedEntityEvidence>,
  gate: PublishGate,
): ApplyResult<Formula> {
  const matchedIds = new Set<string>()
  const items = formulas.map((formula) => {
    const fromRecords = mergedEvidenceFor(formula.id, merged, gate)
    if (!fromRecords) return formula
    matchedIds.add(formula.id)
    const evidence = dedupeEvidence([...(formula.evidence ?? []), ...fromRecords.evidence])
    const next: Formula = { ...formula }
    if (evidence.length > 0) next.evidence = evidence
    if (fromRecords.level) next.evidenceLevel = fromRecords.level
    return next
  })
  return { items, matchedIds }
}

/** 六经病名 → 经络概念 id：`太阳病` → `channel.太阳` */
export function channelConceptId(sixChannel: string): string | undefined {
  const label = sixChannel.trim().replace(/病$/, '')
  return label ? `channel.${label}` : undefined
}

/** 证型 → Concept(type=syndrome)；definition 与鉴别要点只在 flag 模式写入 */
export function syndromeToConcept(
  syndrome: IntegratedSyndrome,
  gate: PublishGate,
  merged?: ReadonlyMap<string, MergedEntityEvidence>,
  knownConceptIds?: ReadonlySet<string>,
): Concept {
  const fromRecords = merged ? mergedEvidenceFor(syndrome.conceptId, merged, gate) : null
  const channelId = syndrome.sixChannel ? channelConceptId(syndrome.sixChannel) : undefined
  const evidence = dedupeEvidence([
    ...syndrome.evidence.map((item) => gateEvidence(item, gate)),
    ...(fromRecords?.evidence ?? []),
  ])
  const concept: Concept = {
    id: syndrome.conceptId,
    type: 'syndrome',
    prefLabel: syndrome.prefLabel,
    altLabels: [],
    reviewStatus: 'ai-draft',
    mainSymptoms: [...syndrome.mainSymptoms],
    mainFormulaIds: [...syndrome.mainFormulaIds],
    clauseIds: [...syndrome.clauseIds],
    differentials: syndrome.differentials.map((item) =>
      gate.publishUnlicensed && item.note
        ? { targetConceptId: item.targetConceptId, note: item.note }
        : { targetConceptId: item.targetConceptId },
    ),
    evidence,
    evidenceLevel: fromRecords?.level ?? 'single',
  }
  if (syndrome.sixChannel) concept.sixChannel = syndrome.sixChannel
  if (channelId && (!knownConceptIds || knownConceptIds.has(channelId))) concept.broader = [channelId]
  if (gate.publishUnlicensed && syndrome.definition) concept.definition = syndrome.definition
  return concept
}

/** 合入证型概念；与词表已有 id 冲突时保留词表概念 */
export function mergeSyndromeConcepts(
  concepts: readonly Concept[],
  syndromeConcepts: readonly Concept[],
): { concepts: Concept[]; conflictIds: string[] } {
  const ids = new Set(concepts.map((concept) => concept.id))
  const conflictIds: string[] = []
  const result = [...concepts]
  for (const concept of syndromeConcepts) {
    if (ids.has(concept.id)) {
      conflictIds.push(concept.id)
      continue
    }
    ids.add(concept.id)
    result.push(concept)
  }
  return { concepts: result, conflictIds }
}

// ---------- 统计 ----------

export type EvidenceLevelCounts = Record<EvidenceLevel | 'unchecked', number>

export function countEvidenceLevelsByBook(
  entities: ReadonlyArray<{ book: string; evidenceLevel?: EvidenceLevel }>,
): Record<string, EvidenceLevelCounts> {
  const result: Record<string, EvidenceLevelCounts> = {}
  for (const entity of entities) {
    const counts = (result[entity.book] ??= { single: 0, corroborated: 0, disputed: 0, unchecked: 0 })
    counts[entity.evidenceLevel ?? 'unchecked'] += 1
  }
  return result
}

// ---------- 读取 ----------

export interface IntegrationLoadIssue {
  file: string
  error: string
}

export interface IntegrationInputs {
  evidenceFiles: Array<{ file: string; data: EvidenceFile }>
  commentaries: unknown[] | null
  syndromes: unknown[] | null
  clauseAttributes: unknown
  witnesses: BookWitness[] | null
  /** 缺失的整合文件（相对项目根） */
  missingFiles: string[]
  invalidFiles: IntegrationLoadIssue[]
}

type JsonLoad = { status: 'missing' } | { status: 'ok'; data: unknown } | { status: 'invalid'; error: string }

async function loadJson(root: string, relativePath: string): Promise<JsonLoad> {
  const absolute = path.join(root, relativePath)
  if (!(await fileExists(absolute))) return { status: 'missing' }
  try {
    return { status: 'ok', data: JSON.parse(await readText(absolute)) as unknown }
  } catch (error) {
    return { status: 'invalid', error: error instanceof Error ? error.message : String(error) }
  }
}

/** 读取生产者文件；缺失或损坏均不抛错，记入 missingFiles / invalidFiles */
export async function loadIntegrationInputs(root: string): Promise<IntegrationInputs> {
  const missingFiles: string[] = []
  const invalidFiles: IntegrationLoadIssue[] = []
  const evidenceFiles: IntegrationInputs['evidenceFiles'] = []

  let evidenceNames: string[] = []
  const evidenceDir = path.join(root, EVIDENCE_DIR)
  if (await fileExists(evidenceDir)) {
    evidenceNames = (await readdir(evidenceDir)).filter((name) => name.endsWith('.json')).sort()
  }
  for (const name of evidenceNames) {
    const relativePath = `${EVIDENCE_DIR}/${name}`
    const loaded = await loadJson(root, relativePath)
    if (loaded.status === 'ok' && isValidEvidenceFile(loaded.data)) {
      evidenceFiles.push({ file: relativePath, data: loaded.data })
    } else if (loaded.status === 'invalid') {
      invalidFiles.push({ file: relativePath, error: loaded.error })
    } else if (loaded.status === 'ok') {
      invalidFiles.push({ file: relativePath, error: 'not an EvidenceFile (producer/records)' })
    }
  }
  if (!evidenceNames.includes(path.basename(KB_EVIDENCE_FILE))) missingFiles.push(KB_EVIDENCE_FILE)
  if (!evidenceNames.some((name) => COLLATION_FILE_RE.test(name))) missingFiles.push(COLLATION_EVIDENCE_PATTERN)

  const loadArray = async (relativePath: string): Promise<unknown[] | null> => {
    const loaded = await loadJson(root, relativePath)
    if (loaded.status === 'missing') {
      missingFiles.push(relativePath)
      return null
    }
    if (loaded.status === 'invalid') {
      invalidFiles.push({ file: relativePath, error: loaded.error })
      return null
    }
    if (!Array.isArray(loaded.data)) {
      invalidFiles.push({ file: relativePath, error: 'expected JSON array' })
      return null
    }
    return loaded.data
  }

  const commentaries = await loadArray(COMMENTARIES_FILE)
  const syndromes = await loadArray(SYNDROMES_FILE)
  const witnessesRaw = await loadArray(WITNESSES_FILE)
  const witnesses = witnessesRaw
    ? witnessesRaw.filter(
        (item): item is BookWitness =>
          isPlainObject(item) && isNonEmptyString(item.bookId) && isNonEmptyString(item.lockId),
      )
    : null

  let clauseAttributes: unknown = null
  const attributesLoad = await loadJson(root, CLAUSE_ATTRIBUTES_FILE)
  if (attributesLoad.status === 'missing') missingFiles.push(CLAUSE_ATTRIBUTES_FILE)
  else if (attributesLoad.status === 'invalid') {
    invalidFiles.push({ file: CLAUSE_ATTRIBUTES_FILE, error: attributesLoad.error })
  } else if (!isPlainObject(attributesLoad.data)) {
    invalidFiles.push({ file: CLAUSE_ATTRIBUTES_FILE, error: 'expected JSON object' })
  } else {
    clauseAttributes = attributesLoad.data
  }

  return { evidenceFiles, commentaries, syndromes, clauseAttributes, witnesses, missingFiles, invalidFiles }
}

// ---------- 方剂药味回填 ----------

/** 回填供药方的药名至少这一比例须经 herb-lexicon 解析为已知药物 */
export const DONOR_MIN_KNOWN_HERB_RATIO = 0.5
/** 供药方中未收录药名允许的最大字数；更长的多为注语、服法残片 */
export const DONOR_UNKNOWN_HERB_MAX_LENGTH = 4

export interface HerbBackfillPolicy {
  /** 去掉证候/服法残片后的方剂（不得改变药味以外的字段） */
  sanitize: (formula: Formula) => Formula
  canonicalName: (name: string) => string
  donorScore: (formula: Formula) => number
  /** 来源书允许列表：donorBook 能否给 recipientBook 回填 */
  isDonorBookAllowed: (donorBook: BookId, recipientBook: BookId) => boolean
  /** 同名异方等额外禁令 */
  canDonate: (donor: Formula, recipient: Formula) => boolean
  isJunkHerbName: (name: string) => boolean
  isKnownHerbName: (name: string) => boolean
}

/** 原书组成是否成立：至少一味药能解析为已知药物（全是注语/残片视同原书无组成） */
export function hasResolvableComposition(
  herbs: readonly FormulaHerb[],
  policy: Pick<HerbBackfillPolicy, 'isKnownHerbName'>,
): boolean {
  return herbs.some((herb) => policy.isKnownHerbName(herb.name))
}

/**
 * 供药方药味可解析：不含残片；未收录药名不超过 DONOR_UNKNOWN_HERB_MAX_LENGTH 字；
 * 已知药名比例不低于 DONOR_MIN_KNOWN_HERB_RATIO。
 */
export function isResolvableDonorHerbList(
  herbs: readonly FormulaHerb[],
  policy: Pick<HerbBackfillPolicy, 'isKnownHerbName' | 'isJunkHerbName'>,
): boolean {
  if (herbs.length === 0) return false
  let known = 0
  for (const herb of herbs) {
    if (policy.isJunkHerbName(herb.name)) return false
    if (policy.isKnownHerbName(herb.name)) {
      known += 1
    } else if (herb.name.length > DONOR_UNKNOWN_HERB_MAX_LENGTH) {
      return false
    }
  }
  return known / herbs.length >= DONOR_MIN_KNOWN_HERB_RATIO
}

export interface HerbBackfillResult {
  formulas: Formula[]
  backfilled: Array<{ recipientId: string; donorId: string }>
  /** 原书药味全不可解析、又找不到合格供药方而原样保留的方剂 */
  unresolvedOwnKept: string[]
  /** 原书药味全不可解析、已被同名方回填替换的方剂 */
  unresolvedOwnReplaced: string[]
  eligibleDonorCount: number
}

/**
 * 他书同名方回填：只在原书无组成时考虑；供药方须同名（含规范名）、来源书在允许列表、
 * 原始药味未经残片清洗且可解析。回填后标记 herbsBackfilledFrom。不做跨方链式回填。
 */
export function backfillFormulaHerbs(
  formulas: readonly Formula[],
  policy: HerbBackfillPolicy,
): HerbBackfillResult {
  const sanitized = formulas.map((formula) => policy.sanitize(formula))
  const donorsByName = new Map<string, Formula[]>()
  let eligibleDonorCount = 0
  sanitized.forEach((formula, index) => {
    const original = formulas[index]!
    if (formula.herbsBackfilledFrom) return
    if (formula.herbs.length !== original.herbs.length) return
    if (!isResolvableDonorHerbList(formula.herbs, policy)) return
    eligibleDonorCount += 1
    for (const key of new Set([formula.name, policy.canonicalName(formula.name)])) {
      if (!key) continue
      const list = donorsByName.get(key) ?? []
      list.push(formula)
      donorsByName.set(key, list)
    }
  })

  const pickDonor = (recipient: Formula): Formula | undefined => {
    const seen = new Set<string>([recipient.id])
    const candidates: Formula[] = []
    for (const key of [recipient.name, policy.canonicalName(recipient.name)]) {
      for (const candidate of donorsByName.get(key) ?? []) {
        if (seen.has(candidate.id)) continue
        seen.add(candidate.id)
        candidates.push(candidate)
      }
    }
    candidates.sort((a, b) => policy.donorScore(b) - policy.donorScore(a))
    return candidates.find(
      (candidate) =>
        policy.isDonorBookAllowed(candidate.book, recipient.book) && policy.canDonate(candidate, recipient),
    )
  }

  const backfilled: HerbBackfillResult['backfilled'] = []
  const unresolvedOwnKept: string[] = []
  const unresolvedOwnReplaced: string[] = []
  const result = sanitized.map((formula) => {
    if (hasResolvableComposition(formula.herbs, policy)) return formula
    const donor = pickDonor(formula)
    if (!donor) {
      if (formula.herbs.length > 0) unresolvedOwnKept.push(formula.id)
      return formula
    }
    if (formula.herbs.length > 0) unresolvedOwnReplaced.push(formula.id)
    backfilled.push({ recipientId: formula.id, donorId: donor.id })
    return {
      ...formula,
      herbs: donor.herbs.map((herb) => ({ ...herb })),
      preparation: formula.preparation || donor.preparation,
      modifications:
        formula.modifications.length > 0
          ? formula.modifications
          : donor.modifications.map((item) => ({ ...item })),
      herbsBackfilledFrom: donor.id,
    }
  })
  return { formulas: result, backfilled, unresolvedOwnKept, unresolvedOwnReplaced, eligibleDonorCount }
}
