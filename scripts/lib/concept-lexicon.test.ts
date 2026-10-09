import { describe, expect, it } from 'vitest'
import { matchMentions, validateConceptLexicon, type ConceptMatchIndex } from './concept-lexicon.ts'
import type { Concept } from '../../src/types/ontology.ts'

function indexOf(concepts: Concept[]): ConceptMatchIndex {
  const surfaces = concepts.flatMap((concept) =>
    [concept.prefLabel, ...concept.altLabels].map((surface) => ({
      surface,
      conceptId: concept.id,
      type: concept.type,
    })),
  )
  surfaces.sort((a, b) => b.surface.length - a.surface.length)
  return {
    concepts,
    byId: new Map(concepts.map((c) => [c.id, c])),
    surfaces,
  }
}

describe('validateConceptLexicon', () => {
  it('detects duplicate ids and surface conflicts', () => {
    const concepts: Concept[] = [
      {
        id: 'symptom.恶寒',
        type: 'symptom',
        prefLabel: '恶寒',
        altLabels: ['畏寒'],
        reviewStatus: 'ai-draft',
      },
      {
        id: 'symptom.恶寒',
        type: 'symptom',
        prefLabel: '恶寒',
        altLabels: [],
        reviewStatus: 'ai-draft',
      },
      {
        id: 'symptom.怕冷',
        type: 'symptom',
        prefLabel: '怕冷',
        altLabels: ['畏寒'],
        reviewStatus: 'ai-draft',
      },
    ]
    const errors = validateConceptLexicon(concepts)
    expect(errors.some((e) => e.includes('duplicate'))).toBe(true)
    expect(errors.some((e) => e.includes('conflict'))).toBe(true)
  })
})

describe('matchMentions', () => {
  it('prefers longer surfaces (恶寒 over 寒)', () => {
    const index = indexOf([
      {
        id: 'symptom.寒',
        type: 'symptom',
        prefLabel: '寒',
        altLabels: [],
        reviewStatus: 'ai-draft',
      },
      {
        id: 'symptom.恶寒',
        type: 'symptom',
        prefLabel: '恶寒',
        altLabels: [],
        reviewStatus: 'ai-draft',
      },
    ])
    const hits = matchMentions('病人恶寒发热', index, ['symptom'])
    expect(hits.map((h) => h.conceptId)).toEqual(['symptom.恶寒'])
  })
})
