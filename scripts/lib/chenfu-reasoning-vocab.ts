/** 陈傅病机推理标注的受控词表 */

export const ORGAN_TAGS = [
  '心',
  '肝',
  '脾',
  '肺',
  '肾',
  '胃',
  '胆',
  '大肠',
  '小肠',
  '膀胱',
  '三焦',
  '心包',
  '命门',
] as const

export type OrganTag = (typeof ORGAN_TAGS)[number]

export const RELATION_KINDS = ['生', '克', '乘', '侮', '移邪'] as const

export type RelationKind = (typeof RELATION_KINDS)[number]

export const DISPUTE_KINDS = [
  'misdiagnosis',
  'mistreatment',
  'drugDoubt',
  'commonPractice',
] as const

export type DisputeKind = (typeof DISPUTE_KINDS)[number]

export const DISPUTE_KIND_LABELS: Record<DisputeKind, string> = {
  misdiagnosis: '病机误诊',
  mistreatment: '误治警示',
  drugDoubt: '用药辨难',
  commonPractice: '批驳世俗之见',
}

export type WuxingElement = '木' | '火' | '土' | '金' | '水'

/** 脏腑五行归属；心包、三焦、命门按相火归火 */
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

/** 仅石室秘录允许 methodCategory；值必须出现在该条章节名中 */
export const METHOD_CATEGORY_BOOKS = ['shishi'] as const

export const REASONING_VOCAB = {
  organTags: [...ORGAN_TAGS],
  relationKinds: [...RELATION_KINDS],
  disputeKinds: [...DISPUTE_KINDS],
  disputeKindLabels: DISPUTE_KIND_LABELS,
}

export function isOrganTag(value: string): value is OrganTag {
  return (ORGAN_TAGS as readonly string[]).includes(value)
}

export function isRelationKind(value: string): value is RelationKind {
  return (RELATION_KINDS as readonly string[]).includes(value)
}

export function isDisputeKind(value: string): value is DisputeKind {
  return (DISPUTE_KINDS as readonly string[]).includes(value)
}
