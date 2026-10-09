/**
 * 一次性：从 TS 词表常量导出 data/ontology/concepts/*.json 初稿。
 * 已存在且非空的文件不会被覆盖（可用 --force 强制）。
 */
import path from 'node:path'
import { SYMPTOM_LEXICON, PULSE_LEXICON, PATHOGENESIS_LEXICON } from './lib/annotate-lexicon.ts'
import {
  SYMPTOM_TAGS as CHENFU_SYMPTOMS,
  PATHOGENESIS_TAGS as CHENFU_PATHOGENESIS,
  ROLE_CATEGORIES,
} from './lib/chenfu-vocab.ts'
import { ORGAN_TAGS } from './lib/chenfu-reasoning-vocab.ts'
import { makeConceptId } from './lib/concept-id.ts'
import { ensureDir, fileExists, projectRoot, readText, writeJson } from './lib/fs-utils.ts'
import type { Concept, ConceptType } from '../src/types/ontology.ts'

const CHANNELS = ['太阳', '阳明', '少阳', '太阴', '少阴', '厥阴'] as const

function upsert(
  map: Map<string, Concept>,
  type: ConceptType,
  label: string,
  alt?: string,
): void {
  const id = makeConceptId(type, label)
  const existing = map.get(id)
  if (!existing) {
    map.set(id, {
      id,
      type,
      prefLabel: label,
      altLabels: alt && alt !== label ? [alt] : [],
      reviewStatus: 'ai-draft',
    })
    return
  }
  if (alt && alt !== label && !existing.altLabels.includes(alt) && alt !== existing.prefLabel) {
    existing.altLabels.push(alt)
  }
}

async function writeConceptFile(
  outDir: string,
  type: ConceptType,
  concepts: Concept[],
  force: boolean,
): Promise<void> {
  const filePath = path.join(outDir, `${type}.json`)
  if (!force && (await fileExists(filePath))) {
    const existing = JSON.parse(await readText(filePath)) as unknown[]
    if (existing.length > 0) {
      console.log(`[migrate] skip ${type}.json (already has ${existing.length} concepts)`)
      return
    }
  }
  await writeJson(
    filePath,
    concepts.sort((a, b) => a.prefLabel.localeCompare(b.prefLabel, 'zh')),
  )
  console.log(`[migrate] wrote ${type}.json (${concepts.length})`)
}

async function main(): Promise<void> {
  const force = process.argv.includes('--force')
  const root = projectRoot()
  const outDir = path.join(root, 'data', 'ontology', 'concepts')
  await ensureDir(outDir)

  const byType = new Map<ConceptType, Map<string, Concept>>()
  const ensure = (type: ConceptType) => {
    if (!byType.has(type)) byType.set(type, new Map())
    return byType.get(type)!
  }

  for (const label of SYMPTOM_LEXICON) upsert(ensure('symptom'), 'symptom', label)
  for (const label of CHENFU_SYMPTOMS) upsert(ensure('symptom'), 'symptom', label)
  for (const label of PULSE_LEXICON) upsert(ensure('pulse'), 'pulse', label)
  for (const label of PATHOGENESIS_LEXICON) {
    upsert(ensure('pathogenesis'), 'pathogenesis', label)
  }
  for (const label of CHENFU_PATHOGENESIS) {
    upsert(ensure('pathogenesis'), 'pathogenesis', label)
  }
  for (const label of CHANNELS) upsert(ensure('channel'), 'channel', label)
  for (const label of ORGAN_TAGS) upsert(ensure('organ'), 'organ', label)
  for (const label of ROLE_CATEGORIES) upsert(ensure('method'), 'method', label)

  // 常见同义：仅当 alt 尚未作为其他概念 prefLabel 时才挂上，避免冲突
  const synonymHints: Array<[ConceptType, string, string]> = [
    ['symptom', '恶寒', '畏寒'],
    ['symptom', '口渴', '大渴'],
    ['symptom', '失眠', '多眠睡'],
  ]
  for (const [type, pref, alt] of synonymHints) {
    const map = ensure(type)
    const altOwned = [...map.values()].some(
      (concept) => concept.prefLabel === alt && concept.id !== makeConceptId(type, pref),
    )
    if (altOwned) continue
    upsert(map, type, pref, alt)
  }

  for (const type of ['symptom', 'pulse', 'pathogenesis', 'channel', 'organ', 'method'] as ConceptType[]) {
    const map = byType.get(type) ?? new Map()
    await writeConceptFile(outDir, type, [...map.values()], force)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
