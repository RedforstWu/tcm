import type {
  CaseDispute,
  ChenfuCase,
  ChenfuRecord,
  DisputeKind,
  OrganTag,
  WuxingElement,
} from '@/types/data'

export const DISPUTE_KIND_LABELS: Record<DisputeKind, string> = {
  misdiagnosis: '病机误诊',
  mistreatment: '误治警示',
  drugDoubt: '用药辨难',
  commonPractice: '批驳世俗之见',
}

export const DISPUTE_KIND_STYLES: Record<DisputeKind, string> = {
  misdiagnosis: 'bg-cinnabar-soft text-cinnabar',
  mistreatment: 'bg-amber-soft text-amber-900',
  drugDoubt: 'bg-teal-soft text-teal',
  commonPractice: 'bg-violet-100 text-violet-800',
}

/** 筛选用：四类辩难 + 无辩难 */
export type DisputeFilter = DisputeKind | 'none'

export const DISPUTE_FILTER_LABELS: Record<DisputeFilter, string> = {
  ...DISPUTE_KIND_LABELS,
  none: '直述证治',
}

export const WUXING_ORDER: WuxingElement[] = ['木', '火', '土', '金', '水']

export const ELEMENT_COLORS: Record<WuxingElement, string> = {
  木: '#15803d',
  火: '#b91c1c',
  土: '#a16207',
  金: '#78716c',
  水: '#1d4ed8',
}

/** 心包、三焦、命门按相火归火（与构建脚本一致） */
export const ORGAN_ELEMENT: Record<OrganTag, WuxingElement> = {
  肝: '木',
  胆: '木',
  心: '火',
  小肠: '火',
  心包: '火',
  三焦: '火',
  命门: '火',
  脾: '土',
  胃: '土',
  肺: '金',
  大肠: '金',
  肾: '水',
  膀胱: '水',
}

export const CHENFU_BOOK_LABELS: Record<ChenfuRecord['book'], string> = {
  bianzheng: '辨证录',
  funvke: '傅青主女科',
  funanke: '傅青主男科',
  shishi: '石室秘录',
}

export interface BrowserItem {
  /** 病案用 caseId；未标注条文用 clauseId */
  key: string
  record: ChenfuRecord
  caseItem?: ChenfuCase
}

/** 每个病案一项；未标注或未抽出病案的条文保留一项，以便显示「待标注」 */
export function flattenRecords(records: ChenfuRecord[]): BrowserItem[] {
  return records.flatMap<BrowserItem>((record) =>
    record.cases.length > 0
      ? record.cases.map((caseItem) => ({ key: caseItem.caseId, record, caseItem }))
      : [{ key: record.clauseId, record }],
  )
}

export interface RoutedDisputes {
  /** 「辨误」栏：病机误诊、批驳世俗之见 */
  diagnosis: CaseDispute[]
  /** 「治法」栏反例：误治警示 */
  treatment: CaseDispute[]
  /** 「方药」栏：用药辨难 */
  formula: CaseDispute[]
}

export function routeDisputes(disputes: CaseDispute[]): RoutedDisputes {
  const routed: RoutedDisputes = { diagnosis: [], treatment: [], formula: [] }
  for (const dispute of disputes) {
    if (dispute.kind === 'mistreatment') routed.treatment.push(dispute)
    else if (dispute.kind === 'drugDoubt') routed.formula.push(dispute)
    else routed.diagnosis.push(dispute)
  }
  return routed
}

export interface SymptomDisplay {
  text: string
  /** 非原文直取时的说明 */
  note?: string
  linkClauseId?: string
}

export function symptomDisplay(
  caseItem: Pick<ChenfuCase, 'symptomText' | 'symptomSource' | 'continuesFromClauseId'>,
  record: Pick<ChenfuRecord, 'heading'>,
): SymptomDisplay {
  switch (caseItem.symptomSource) {
    case 'text':
      return { text: caseItem.symptomText ?? '' }
    case 'heading':
      return { text: record.heading ?? '', note: '原文以标题为症' }
    case 'previous':
      return {
        text: '症状叙述见同门上一则',
        note: '原文切分处本则以方药起首',
        linkClauseId: caseItem.continuesFromClauseId,
      }
    default:
      return { text: '原文未述症状', note: '本则从病机或治法写起' }
  }
}

export function disputeKindsOfCase(caseItem: Pick<ChenfuCase, 'disputes'>): Set<DisputeFilter> {
  if (caseItem.disputes.length === 0) return new Set<DisputeFilter>(['none'])
  return new Set<DisputeFilter>(caseItem.disputes.map((dispute) => dispute.kind))
}

/** 病案标题：优先原文症状，截断到 maxLength 字 */
export function caseTitle(
  caseItem: Pick<ChenfuCase, 'symptomText' | 'symptomSource' | 'continuesFromClauseId'>,
  record: Pick<ChenfuRecord, 'heading'>,
  maxLength = 28,
): string {
  const { text } = symptomDisplay(caseItem, record)
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text
}
