import type { Clause, Mention } from '../../src/types/data.ts'
import type { Concept, ConceptType, UnmappedLabel } from '../../src/types/ontology.ts'
import { makeConceptId } from './concept-id.ts'
import { buildLabelIndex } from './concept-map.ts'

export interface RematchResult {
  clauses: Clause[]
  unmapped: UnmappedLabel[]
}

/** 仅当标签能在词表中解析时写入 conceptIds；未命中记入 unmapped */
export function rematchConceptIdsFromTags(
  clauses: Clause[],
  concepts: Concept[],
): RematchResult {
  const byLabel = buildLabelIndex(concepts)
  const knownIds = new Set(concepts.map((c) => c.id))
  const unmappedBucket = new Map<string, UnmappedLabel>()

  const resolve = (label: string, type: ConceptType): string | null => {
    const hit = byLabel.get(label)
    if (hit) {
      if (hit.type === type || hit.prefLabel === label || hit.altLabels.includes(label)) {
        return hit.id
      }
    }
    const id = makeConceptId(type, label)
    if (knownIds.has(id)) return id
    return null
  }

  const bumpUnmapped = (label: string, type: ConceptType, source: string) => {
    const key = `${type}:${label}`
    const current = unmappedBucket.get(key) ?? { label, type, sources: [], count: 0 }
    current.count += 1
    if (!current.sources.includes(source)) current.sources.push(source)
    unmappedBucket.set(key, current)
  }

  const nextClauses = clauses.map((clause) => {
    const pairs: Array<{ type: ConceptType; label: string }> = [
      ...clause.symptomTags.map((label) => ({ type: 'symptom' as const, label })),
      ...clause.pulseTags.map((label) => ({ type: 'pulse' as const, label })),
      ...clause.pathogenesisTags.map((label) => ({ type: 'pathogenesis' as const, label })),
      ...clause.channelTags.map((label) => ({ type: 'channel' as const, label })),
    ]
    const conceptIds: string[] = []
    const mentions: Mention[] = []
    for (const { type, label } of pairs) {
      const conceptId = resolve(label, type)
      if (!conceptId) {
        bumpUnmapped(label, type, clause.id)
        continue
      }
      if (!conceptIds.includes(conceptId)) conceptIds.push(conceptId)
      const offset = clause.text.indexOf(label)
      mentions.push({
        surface: label,
        conceptId,
        offset: offset >= 0 ? offset : undefined,
      })
    }
    return { ...clause, conceptIds, mentions }
  })

  return {
    clauses: nextClauses,
    unmapped: [...unmappedBucket.values()].sort(
      (a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh'),
    ),
  }
}
