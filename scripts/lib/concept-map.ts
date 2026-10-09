import path from 'node:path'
import type { Clause } from '../../src/types/data.ts'
import type { Concept, ConceptType, UnmappedLabel } from '../../src/types/ontology.ts'
import { makeConceptId } from './concept-id.ts'
import { projectRoot, writeJson } from './fs-utils.ts'

function guessType(label: string): ConceptType | 'unknown' {
  if (label.startsWith('脉')) return 'pulse'
  if (['太阳', '阳明', '少阳', '太阴', '少阴', '厥阴'].includes(label)) return 'channel'
  return 'symptom'
}

/** 收集条文标签中未能映射到词表的表面词 */
export function collectUnmappedLabels(
  clauses: Clause[],
  concepts: Concept[],
): UnmappedLabel[] {
  const known = new Set<string>()
  for (const concept of concepts) {
    known.add(concept.prefLabel)
    for (const alt of concept.altLabels) known.add(alt)
    known.add(concept.id)
  }

  const bucket = new Map<string, UnmappedLabel>()
  const bump = (label: string, type: ConceptType | 'unknown', source: string) => {
    if (!label || known.has(label) || known.has(makeConceptId(type === 'unknown' ? 'symptom' : type, label))) {
      return
    }
    const key = `${type}:${label}`
    const current = bucket.get(key) ?? {
      label,
      type,
      sources: [],
      count: 0,
    }
    current.count += 1
    if (!current.sources.includes(source)) current.sources.push(source)
    bucket.set(key, current)
  }

  for (const clause of clauses) {
    for (const tag of clause.symptomTags) bump(tag, 'symptom', clause.id)
    for (const tag of clause.pulseTags) bump(tag, 'pulse', clause.id)
    for (const tag of clause.pathogenesisTags) bump(tag, 'pathogenesis', clause.id)
    for (const tag of clause.channelTags) bump(tag, 'channel', clause.id)
    for (const conceptId of clause.conceptIds ?? []) {
      if (!concepts.some((c) => c.id === conceptId)) {
        bump(conceptId, guessType(conceptId), clause.id)
      }
    }
  }

  return [...bucket.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh'))
}

export async function writeUnmappedReport(
  root = projectRoot(),
  unmapped: UnmappedLabel[],
): Promise<string> {
  const outPath = path.join(root, 'data', 'ontology', 'unmapped.json')
  await writeJson(outPath, {
    generatedAt: new Date().toISOString(),
    count: unmapped.length,
    items: unmapped,
  })
  return outPath
}

/** 将 LLM 标签映射到概念 id；未命中者记入 unmapped accumulator */
export function mapLabelsToConceptIds(
  labels: string[],
  type: ConceptType,
  conceptsByLabel: Map<string, Concept>,
  unmapped: Map<string, UnmappedLabel>,
  source: string,
): string[] {
  const ids: string[] = []
  for (const label of labels) {
    const hit = conceptsByLabel.get(label)
    if (hit) {
      ids.push(hit.id)
      continue
    }
    const key = `${type}:${label}`
    const current = unmapped.get(key) ?? { label, type, sources: [], count: 0 }
    current.count += 1
    if (!current.sources.includes(source)) current.sources.push(source)
    unmapped.set(key, current)
  }
  return ids
}

export function buildLabelIndex(concepts: Concept[]): Map<string, Concept> {
  const map = new Map<string, Concept>()
  for (const concept of concepts) {
    map.set(concept.prefLabel, concept)
    for (const alt of concept.altLabels) {
      if (!map.has(alt)) map.set(alt, concept)
    }
  }
  return map
}
