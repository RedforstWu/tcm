import { describe, expect, it } from 'vitest'
import { rematchConceptIdsFromTags } from './rematch-concepts.ts'
import type { Clause } from '../../src/types/data.ts'
import type { Concept } from '../../src/types/ontology.ts'

const concepts: Concept[] = [
  {
    id: 'symptom.恶寒',
    type: 'symptom',
    prefLabel: '恶寒',
    altLabels: ['畏寒'],
    reviewStatus: 'reviewed',
  },
  {
    id: 'channel.太阳',
    type: 'channel',
    prefLabel: '太阳',
    altLabels: [],
    reviewStatus: 'reviewed',
  },
]

function clause(partial: Partial<Clause> & Pick<Clause, 'id' | 'text'>): Clause {
  return {
    book: 'songben',
    chapter: '辨太阳病脉证并治',
    chapterOrder: 1,
    order: 1,
    formulaIds: [],
    symptomTags: [],
    pulseTags: [],
    channelTags: [],
    pathogenesisTags: [],
    reviewStatus: 'ai-draft',
    ...partial,
  }
}

describe('rematchConceptIdsFromTags', () => {
  it('maps known tags and altLabels', () => {
    const { clauses, unmapped } = rematchConceptIdsFromTags(
      [
        clause({
          id: 'songben-1',
          text: '恶寒发热',
          symptomTags: ['恶寒', '畏寒'],
          channelTags: ['太阳'],
        }),
      ],
      concepts,
    )
    expect(clauses[0]!.conceptIds).toEqual(['symptom.恶寒', 'channel.太阳'])
    expect(unmapped).toEqual([])
  })

  it('does not invent concept ids for unknown labels', () => {
    const { clauses, unmapped } = rematchConceptIdsFromTags(
      [
        clause({
          id: 'songben-383',
          text: '霍乱',
          channelTags: ['霍乱'],
          symptomTags: ['未知症'],
        }),
      ],
      concepts,
    )
    expect(clauses[0]!.conceptIds).toEqual([])
    expect(unmapped.map((item) => `${item.type}:${item.label}`).sort()).toEqual([
      'channel:霍乱',
      'symptom:未知症',
    ])
  })
})
