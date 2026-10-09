import path from 'node:path'
import { projectRoot, readText } from './fs-utils.ts'

export const ID_MIGRATIONS_VERSION = 1

export interface RemovedIdEntry {
  /** 新 id 空间中的归并目标 */
  mergedInto: string
  kind: string
}

export interface IdMigrationFile {
  version: typeof ID_MIGRATIONS_VERSION
  generatedAt: string
  reason: string
  /** 按书分组：旧 id → 新 id（仅列出变化项） */
  maps: Record<string, Record<string, string>>
  /** 旧 id 被删除（并入他处） */
  removed: Record<string, RemovedIdEntry>
}

export type IdMigrationStatus =
  | { status: 'mapped'; id: string }
  | { status: 'removed'; id: string; kind: string }
  | { status: 'unchanged'; id: string }

export interface IdMigrator {
  /** 旧 id → 新 id；删除项返回归并目标；未知 id 原样返回 */
  migrateId(oldId: string): string
  describe(oldId: string): IdMigrationStatus
}

export function defaultIdMigrationsPath(): string {
  return path.join(projectRoot(), 'data/ontology/id-migrations.json')
}

/** 结构校验；不合法时抛错 */
export function assertIdMigrationFile(value: unknown): asserts value is IdMigrationFile {
  if (!value || typeof value !== 'object') throw new Error('[id-migrations] 根节点必须是对象')
  const file = value as Partial<IdMigrationFile>
  if (file.version !== ID_MIGRATIONS_VERSION) {
    throw new Error(`[id-migrations] 不支持的 version: ${String(file.version)}`)
  }
  if (!file.maps || typeof file.maps !== 'object') throw new Error('[id-migrations] 缺少 maps')
  if (!file.removed || typeof file.removed !== 'object') throw new Error('[id-migrations] 缺少 removed')

  const seenOldIds = new Set<string>()
  for (const [book, map] of Object.entries(file.maps)) {
    for (const [oldId, newId] of Object.entries(map)) {
      if (typeof newId !== 'string' || !newId) {
        throw new Error(`[id-migrations] maps.${book}.${oldId} 目标非法`)
      }
      if (seenOldIds.has(oldId)) throw new Error(`[id-migrations] 旧 id 重复：${oldId}`)
      seenOldIds.add(oldId)
    }
  }
  for (const [oldId, entry] of Object.entries(file.removed)) {
    if (seenOldIds.has(oldId)) throw new Error(`[id-migrations] ${oldId} 同时出现在 maps 与 removed`)
    if (!entry || typeof entry.mergedInto !== 'string' || !entry.mergedInto) {
      throw new Error(`[id-migrations] removed.${oldId} 缺少 mergedInto`)
    }
  }
}

/**
 * 基于「旧 id 空间」一次性查表；结果不再回查，
 * 因而旧 songben-235 → songben-234 后不会再被当作旧 songben-234 二次映射。
 */
export function createIdMigrator(file: IdMigrationFile): IdMigrator {
  assertIdMigrationFile(file)
  const mapped = new Map<string, string>()
  for (const map of Object.values(file.maps)) {
    for (const [oldId, newId] of Object.entries(map)) mapped.set(oldId, newId)
  }
  const removed = new Map(Object.entries(file.removed))

  const describe = (oldId: string): IdMigrationStatus => {
    const removedEntry = removed.get(oldId)
    if (removedEntry) return { status: 'removed', id: removedEntry.mergedInto, kind: removedEntry.kind }
    const newId = mapped.get(oldId)
    if (newId !== undefined) return { status: 'mapped', id: newId }
    return { status: 'unchanged', id: oldId }
  }
  return { describe, migrateId: (oldId) => describe(oldId).id }
}

export async function loadIdMigrations(filePath = defaultIdMigrationsPath()): Promise<IdMigrationFile> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readText(filePath))
  } catch (error) {
    throw new Error(`[id-migrations] 读取失败 ${filePath}: ${String(error)}`)
  }
  assertIdMigrationFile(parsed)
  return parsed
}

export interface RewriteIdsOptions {
  /** 同时重写对象键（如以条文 id 为键的字典）；默认 true */
  rewriteKeys?: boolean
}

/**
 * 深度遍历并重写「整串等于 id」的字符串值与对象键，返回新对象，不修改入参。
 * 键重写后若与已有键冲突（如删除项并入目标已存在）则抛错，由调用方显式处理。
 */
export function rewriteIdsDeep<T>(
  value: T,
  migrateId: (oldId: string) => string,
  options: RewriteIdsOptions = {},
): T {
  const rewriteKeys = options.rewriteKeys ?? true
  const visit = (node: unknown, trail: string): unknown => {
    if (typeof node === 'string') return migrateId(node)
    if (Array.isArray(node)) return node.map((item, index) => visit(item, `${trail}[${index}]`))
    if (node && typeof node === 'object') {
      const output: Record<string, unknown> = {}
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        const nextKey = rewriteKeys ? migrateId(key) : key
        if (Object.prototype.hasOwnProperty.call(output, nextKey)) {
          throw new Error(`[id-migrations] 键冲突：${trail}.${key} → ${nextKey}`)
        }
        output[nextKey] = visit(child, `${trail}.${key}`)
      }
      return output
    }
    return node
  }
  return visit(value, '$') as T
}

export interface ClauseIdText {
  id: string
  text: string
}

export interface ClauseMergeHint {
  text: string
  mergedInto: string
  kind: string
}

/**
 * 按顺序对齐新旧两版条文（文本须逐字相同），生成 maps / removed。
 * 旧版中多出的条目必须能在 merges 中按文本找到，否则抛错。
 */
export function buildClauseIdMigration(
  oldClauses: ClauseIdText[],
  newClauses: ClauseIdText[],
  merges: ClauseMergeHint[],
): { map: Record<string, string>; removed: Record<string, RemovedIdEntry> } {
  const map: Record<string, string> = {}
  const removed: Record<string, RemovedIdEntry> = {}
  const mergeByText = new Map(merges.map((merge) => [merge.text, merge]))
  let newIndex = 0
  for (const oldClause of oldClauses) {
    const candidate = newClauses[newIndex]
    if (candidate && candidate.text === oldClause.text) {
      if (candidate.id !== oldClause.id) map[oldClause.id] = candidate.id
      newIndex += 1
      continue
    }
    const merge = mergeByText.get(oldClause.text)
    if (!merge) {
      throw new Error(`[id-migrations] 旧条文 ${oldClause.id} 无法对齐：${oldClause.text.slice(0, 24)}`)
    }
    removed[oldClause.id] = { mergedInto: merge.mergedInto, kind: merge.kind }
  }
  if (newIndex !== newClauses.length) {
    throw new Error(`[id-migrations] 新条文剩余 ${newClauses.length - newIndex} 条未对齐`)
  }
  return { map, removed }
}
