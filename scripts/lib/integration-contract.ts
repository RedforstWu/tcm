/**
 * 外部来源整合的数据契约：交叉比对脚本（生产者）→ 构建（消费者）→ 前端（消费者）。
 * 只做类型与路径约定，不含逻辑；改动须同步所有生产者与消费者。
 */
import type { Evidence, SourceGroup } from '../../src/types/data.ts'

export const INTEGRATION_DIR = 'data/integration'
export const EVIDENCE_DIR = `${INTEGRATION_DIR}/evidence`
export const REPORTS_DIR = `${INTEGRATION_DIR}/reports`
export const WITNESSES_FILE = 'data/ontology/witnesses.json'

/** 未声明许可的来源组：其原文、引文、异文内容默认不写入 public/data */
export const UNLICENSED_GROUPS: readonly SourceGroup[] = ['web-simplified', 'derived']
/** 构建时设为 1 才发布未授权来源的内容（仅限本地预览） */
export const PUBLISH_UNLICENSED_ENV = 'TCM_PUBLISH_UNLICENSED'

export type IntegratedEntityType = 'clause' | 'formula' | 'commentary' | 'syndrome'

export type EvidenceField =
  | 'text'
  | 'herbs'
  | 'doses'
  | 'preparation'
  | 'formulaLink'
  | 'quote'
  | 'kangpingLayer'

/** agree/variant/mismatch 与 text-normalize 的 classifyTextMatch 一致；missing 表示见证本中找不到 */
export type EvidenceVerdict = 'agree' | 'variant' | 'mismatch' | 'missing'

export interface VariantSegment {
  op: 'equal' | 'insert' | 'delete' | 'replace'
  local: string
  witness: string
}

export interface EntityEvidenceRecord {
  /** 本项目实体 id（宋本已按 398 条编号），如 `songben-12`、`jingui-formula-乌头汤` */
  entityId: string
  entityType: IntegratedEntityType
  field: EvidenceField
  verdict: EvidenceVerdict
  /** 0..1，text-normalize.similarity */
  ratio?: number
  evidence: Evidence
  /** 仅 verdict=variant 时给出，用于展示异文 */
  variants?: VariantSegment[]
  note?: string
}

/** data/integration/evidence/<producer>.json */
export interface EvidenceFile {
  producer: string
  generatedAt: string
  sourceIds: string[]
  records: EntityEvidenceRecord[]
}

export interface CommentaryQuote {
  text: string
  /** 在注家原书见证本中逐字（规范化后）命中 */
  verified: boolean
  evidence?: Evidence
  ratio?: number
}

/** data/integration/commentaries.json 的元素；前端读取 public/data/commentaries.json（同结构） */
export interface IntegratedCommentary {
  /** `commentary-<注家>-<条文号三位>`，如 `commentary-尤怡-012` */
  id: string
  clauseId: string
  commentator: string
  sourceBook: string
  formulaIds: string[]
  quotes: CommentaryQuote[]
  /** KB 现代转述，许可受限：不得写入 public/data */
  summary?: string
  evidence: Evidence[]
}

export interface SyndromeDifferential {
  targetConceptId: string
  note: string
}

/** data/integration/syndromes.json 的元素；构建时转为 Concept(type=syndrome) 与图谱边 */
export interface IntegratedSyndrome {
  /** `syndrome.<证名>` */
  conceptId: string
  prefLabel: string
  sixChannel: string
  clauseIds: string[]
  mainFormulaIds: string[]
  mainSymptoms: string[]
  differentials: SyndromeDifferential[]
  definition?: string
  evidence: Evidence[]
}

/** data/integration/clause-attributes.json：clauseId → 附加属性 */
export interface ClauseAttributes {
  kangpingLayer?: '原文' | '追文' | '注文'
  evidence: Evidence[]
}

export type ClauseAttributesFile = Record<string, ClauseAttributes>

/** data/ontology/witnesses.json 的元素：本项目书目 → 见证本 */
export interface BookWitness {
  bookId: string
  /** 对应 data/vendor/sources.lock.json 中的条目 id */
  lockId: string
  group: SourceGroup
  /** kanripo：仓库 id；jobkoko：文件相对路径 */
  ref: string
  edition?: string
  /** 版本系统不同（如成无己注本对赵开美本），异文属预期 */
  differentRecension?: boolean
  note?: string
}
