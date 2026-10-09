import type { Clause, Mention } from '../../src/types/data.ts'
import { loadConceptLexicon, matchMentions, type ConceptMatchIndex } from './concept-lexicon.ts'
import {
  PATHOGENESIS_LEXICON,
  PULSE_LEXICON,
  SYMPTOM_LEXICON,
} from './annotate-lexicon.ts'

function fallbackAnnotate(clause: Clause): Clause {
  const text = clause.text
  const symptomTags = SYMPTOM_LEXICON.filter((item) => text.includes(item))
  const pulseTags = PULSE_LEXICON.filter((item) => text.includes(item))
  const pathogenesisTags = PATHOGENESIS_LEXICON.filter((item) => text.includes(item))
  return {
    ...clause,
    symptomTags: [...new Set(symptomTags)],
    pulseTags: [...new Set(pulseTags)],
    pathogenesisTags: [...new Set(pathogenesisTags)],
    reviewStatus: 'ai-draft',
  }
}

export function annotateClauseWithIndex(clause: Clause, index: ConceptMatchIndex): Clause {
  if (index.concepts.length === 0) return fallbackAnnotate(clause)

  const hits = matchMentions(clause.text, index, [
    'symptom',
    'pulse',
    'pathogenesis',
    'channel',
  ])
  const mentions: Mention[] = hits.map((hit) => ({
    surface: hit.surface,
    conceptId: hit.conceptId,
    offset: hit.offset,
  }))
  const conceptIds = [...new Set(hits.map((hit) => hit.conceptId))]

  const prefOf = (conceptId: string) => index.byId.get(conceptId)?.prefLabel ?? conceptId.split('.').slice(1).join('.')

  const symptomTags = [
    ...new Set(hits.filter((h) => h.type === 'symptom').map((h) => prefOf(h.conceptId))),
  ]
  const pulseTags = [
    ...new Set(hits.filter((h) => h.type === 'pulse').map((h) => prefOf(h.conceptId))),
  ]
  const pathogenesisTags = [
    ...new Set(hits.filter((h) => h.type === 'pathogenesis').map((h) => prefOf(h.conceptId))),
  ]
  const channelFromText = [
    ...new Set(hits.filter((h) => h.type === 'channel').map((h) => prefOf(h.conceptId))),
  ]

  return {
    ...clause,
    symptomTags,
    pulseTags,
    pathogenesisTags,
    channelTags: clause.channelTags.length > 0 ? clause.channelTags : channelFromText,
    conceptIds,
    mentions,
    reviewStatus: 'ai-draft',
  }
}

let sharedIndex: ConceptMatchIndex | null = null

export async function prepareAnnotateIndex(): Promise<ConceptMatchIndex> {
  sharedIndex = await loadConceptLexicon()
  return sharedIndex
}

export function annotateClause(clause: Clause): Clause {
  if (!sharedIndex) return fallbackAnnotate(clause)
  return annotateClauseWithIndex(clause, sharedIndex)
}

export function annotateClauses(clauses: Clause[]): Clause[] {
  return clauses.map(annotateClause)
}

export async function annotateClausesAsync(clauses: Clause[]): Promise<Clause[]> {
  const index = await prepareAnnotateIndex()
  return clauses.map((clause) => annotateClauseWithIndex(clause, index))
}
