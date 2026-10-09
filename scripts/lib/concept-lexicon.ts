import path from 'node:path'
import type { Concept, ConceptType } from '../../src/types/ontology.ts'
import { projectRoot, readText, fileExists } from './fs-utils.ts'

export interface ConceptMatchIndex {
  concepts: Concept[]
  byId: Map<string, Concept>
  /** 表面词 → conceptId，按词长降序匹配 */
  surfaces: Array<{ surface: string; conceptId: string; type: ConceptType }>
}

let cached: ConceptMatchIndex | null = null

export async function loadConceptLexicon(root = projectRoot()): Promise<ConceptMatchIndex> {
  if (cached) return cached
  const dir = path.join(root, 'data', 'ontology', 'concepts')
  const types: ConceptType[] = [
    'symptom',
    'pulse',
    'pathogenesis',
    'channel',
    'organ',
    'method',
  ]
  const concepts: Concept[] = []
  for (const type of types) {
    const filePath = path.join(dir, `${type}.json`)
    if (!(await fileExists(filePath))) continue
    const list = JSON.parse(await readText(filePath)) as Concept[]
    concepts.push(...list)
  }

  const byId = new Map(concepts.map((c) => [c.id, c]))
  const surfaces: ConceptMatchIndex['surfaces'] = []
  const seenSurface = new Map<string, string>()

  for (const concept of concepts) {
    const labels = [concept.prefLabel, ...concept.altLabels]
    for (const surface of labels) {
      const prev = seenSurface.get(surface)
      if (prev && prev !== concept.id) {
        // 冲突时保留先写入的（文件顺序）；迁移测试会检出冲突
        continue
      }
      seenSurface.set(surface, concept.id)
      surfaces.push({ surface, conceptId: concept.id, type: concept.type })
    }
  }

  surfaces.sort((a, b) => b.surface.length - a.surface.length || a.surface.localeCompare(b.surface, 'zh'))
  cached = { concepts, byId, surfaces }
  return cached
}

export function resetConceptLexiconCache(): void {
  cached = null
}

export function matchMentions(
  text: string,
  index: ConceptMatchIndex,
  types?: ConceptType[],
): Array<{ surface: string; conceptId: string; offset: number; type: ConceptType }> {
  const allowed = types ? new Set(types) : null
  const hits: Array<{ surface: string; conceptId: string; offset: number; type: ConceptType }> = []
  const covered = new Array<boolean>(text.length).fill(false)

  for (const entry of index.surfaces) {
    if (allowed && !allowed.has(entry.type)) continue
    let from = 0
    while (from < text.length) {
      const offset = text.indexOf(entry.surface, from)
      if (offset < 0) break
      const end = offset + entry.surface.length
      let overlap = false
      for (let i = offset; i < end; i += 1) {
        if (covered[i]) {
          overlap = true
          break
        }
      }
      if (!overlap) {
        hits.push({
          surface: entry.surface,
          conceptId: entry.conceptId,
          offset,
          type: entry.type,
        })
        for (let i = offset; i < end; i += 1) covered[i] = true
      }
      from = offset + 1
    }
  }

  return hits.sort((a, b) => a.offset - b.offset)
}

export function validateConceptLexicon(concepts: Concept[]): string[] {
  const errors: string[] = []
  const ids = new Set<string>()
  const surfaceOwner = new Map<string, string>()
  for (const concept of concepts) {
    if (ids.has(concept.id)) errors.push(`duplicate concept id: ${concept.id}`)
    ids.add(concept.id)
    for (const surface of [concept.prefLabel, ...concept.altLabels]) {
      const owner = surfaceOwner.get(surface)
      if (owner && owner !== concept.id) {
        errors.push(`altLabel conflict: "${surface}" on ${owner} and ${concept.id}`)
      } else {
        surfaceOwner.set(surface, concept.id)
      }
    }
  }
  return errors
}
