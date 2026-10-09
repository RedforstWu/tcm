import type { ConceptType } from '../../src/types/ontology.ts'

export function makeConceptId(type: ConceptType, prefLabel: string): string {
  return `${type}.${prefLabel}`
}

export function conceptIdFromLabel(
  label: string,
  preferredType?: ConceptType,
): string {
  if (preferredType) return makeConceptId(preferredType, label)
  if (label.startsWith('脉')) return makeConceptId('pulse', label)
  if (['太阳', '阳明', '少阳', '太阴', '少阴', '厥阴'].includes(label)) {
    return makeConceptId('channel', label)
  }
  return makeConceptId('symptom', label)
}
