import type { ConceptType } from '@/types/ontology'

const TYPE_PREFIX: Record<string, ConceptType> = {
  symptom: 'symptom',
  pulse: 'pulse',
  pathogenesis: 'pathogenesis',
  channel: 'channel',
  organ: 'organ',
  method: 'method',
  syndrome: 'syndrome',
}

export const CONCEPT_TYPE_LABEL: Record<ConceptType, string> = {
  symptom: '症状',
  pulse: '脉象',
  pathogenesis: '病机',
  channel: '经络',
  organ: '脏腑',
  method: '治法',
  syndrome: '证型',
}

/** 未知类型原样返回，避免新类型导致崩溃 */
export function conceptTypeLabel(type: string): string {
  return Object.prototype.hasOwnProperty.call(CONCEPT_TYPE_LABEL, type)
    ? CONCEPT_TYPE_LABEL[type as ConceptType]
    : type
}

/** 由类型与规范名生成稳定概念 id，如 symptom.恶寒 */
export function makeConceptId(type: ConceptType, prefLabel: string): string {
  return `${type}.${prefLabel}`
}

export function parseConceptId(conceptId: string): { type: ConceptType; label: string } | null {
  const dot = conceptId.indexOf('.')
  if (dot <= 0) return null
  const prefix = conceptId.slice(0, dot)
  const type = TYPE_PREFIX[prefix]
  if (!type) return null
  return { type, label: conceptId.slice(dot + 1) }
}

/** 标签文本反推概念 id（默认按 symptom；脉象以「脉」开头时归 pulse） */
export function conceptIdFromLabel(
  label: string,
  preferredType?: ConceptType,
): string {
  if (preferredType) return makeConceptId(preferredType, label)
  if (label.startsWith('脉')) return makeConceptId('pulse', label)
  if (
    ['太阳', '阳明', '少阳', '太阴', '少阴', '厥阴'].includes(label)
  ) {
    return makeConceptId('channel', label)
  }
  return makeConceptId('symptom', label)
}
