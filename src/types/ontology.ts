import type { Evidence, EvidenceLevel, ReviewStatus } from './data'

export type ConceptType =
  | 'symptom'
  | 'pulse'
  | 'pathogenesis'
  | 'channel'
  | 'organ'
  | 'method'
  | 'syndrome'

export interface ConceptSchoolNote {
  school: string
  note: string
  sourceClauseId?: string
}

export interface SyndromeDifferentialRef {
  targetConceptId: string
  /** 鉴别要点；属二次整理库原创文字，默认不发布 */
  note?: string
}

export interface Concept {
  id: string
  type: ConceptType
  prefLabel: string
  altLabels: string[]
  broader?: string[]
  schoolNotes?: ConceptSchoolNote[]
  reviewStatus: ReviewStatus
  /** 以下仅 type=syndrome（证型）使用 */
  sixChannel?: string
  /** 二次整理库原创文字，默认不发布 */
  definition?: string
  mainSymptoms?: string[]
  mainFormulaIds?: string[]
  clauseIds?: string[]
  differentials?: SyndromeDifferentialRef[]
  evidence?: Evidence[]
  evidenceLevel?: EvidenceLevel
}

export interface UnmappedLabel {
  label: string
  type: ConceptType | 'unknown'
  sources: string[]
  count: number
}
