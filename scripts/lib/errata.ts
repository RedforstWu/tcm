/**
 * 原文勘误表：`data/ontology/errata/<bookId>.json`。
 * raw 文件由抓取脚本从上游覆盖写入，不可手改；已核实的原文错误改为「勘误表 + 解析前应用」，
 * 每条记录见证本依据（sourceId / locator / quote），便于追溯。
 */
import assert from 'node:assert/strict'
import path from 'node:path'
import { projectRoot, readText } from './fs-utils.ts'

export interface ErrataBasis {
  /** 见证本来源 id，如 `jobkoko@4d4aefd` */
  sourceId: string
  /** 见证本内定位，如 `S-003-伤寒论宋版.txt#伤寒论(宋本)` */
  locator: string
  /** 见证本原句 */
  quote: string
}

export interface ErrataEntry {
  id: string
  bookId: string
  clauseNumber?: number
  /** 原始 raw 中的精确子串（含原有全角空格） */
  find: string
  /** 替换文本；空串表示删除 */
  replace: string
  basis: ErrataBasis
  note: string
}

export interface ApplyErrataResult {
  text: string
  applied: ErrataEntry[]
}

/** 每条 find 在待改文本中必须恰好出现的次数 */
export const ERRATA_REQUIRED_OCCURRENCES = 1

export function defaultErrataPath(bookId: string): string {
  return path.join(projectRoot(), 'data/ontology/errata', `${bookId}.json`)
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  assert.ok(typeof value === 'string' && value.length > 0, `[errata] ${label} 必须是非空字符串`)
}

/** 结构校验：字段完整、id 唯一、find 非空；expectedBookId 给定时校验 bookId 一致 */
export function assertErrataEntries(value: unknown, expectedBookId?: string): asserts value is ErrataEntry[] {
  assert.ok(Array.isArray(value), '[errata] 根节点必须是数组')
  const seenIds = new Set<string>()
  value.forEach((item: unknown, index: number) => {
    assert.ok(item !== null && typeof item === 'object', `[errata] 第 ${index} 项必须是对象`)
    const entry = item as Partial<ErrataEntry>
    assertNonEmptyString(entry.id, `第 ${index} 项 id`)
    const entryId = entry.id
    assert.ok(!seenIds.has(entryId), `[errata] id 重复：${entryId}`)
    seenIds.add(entryId)

    assertNonEmptyString(entry.bookId, `${entryId}.bookId`)
    if (expectedBookId !== undefined) {
      assert.equal(entry.bookId, expectedBookId, `[errata] ${entryId}.bookId 应为 ${expectedBookId}`)
    }
    if (entry.clauseNumber !== undefined) {
      assert.ok(
        Number.isInteger(entry.clauseNumber) && entry.clauseNumber > 0,
        `[errata] ${entryId}.clauseNumber 必须是正整数`,
      )
    }
    assertNonEmptyString(entry.find, `${entryId}.find`)
    assert.equal(typeof entry.replace, 'string', `[errata] ${entryId}.replace 必须是字符串`)
    assert.notEqual(entry.replace, entry.find, `[errata] ${entryId}：replace 与 find 相同，勘误无效`)

    assert.ok(entry.basis !== null && typeof entry.basis === 'object', `[errata] ${entryId}.basis 必须是对象`)
    assertNonEmptyString(entry.basis.sourceId, `${entryId}.basis.sourceId`)
    assertNonEmptyString(entry.basis.locator, `${entryId}.basis.locator`)
    assertNonEmptyString(entry.basis.quote, `${entryId}.basis.quote`)
    assertNonEmptyString(entry.note, `${entryId}.note`)
  })
}

/** 计数含重叠出现，避免「一次替换」误改相邻重复片段 */
function countOccurrences(text: string, needle: string): number {
  let count = 0
  let index = text.indexOf(needle)
  while (index >= 0) {
    count += 1
    index = text.indexOf(needle, index + 1)
  }
  return count
}

/**
 * 按表序逐条替换：每条 find 在当前文本中必须恰好出现 1 次，否则抛错（报出 id）。
 * 用切片拼接而非 String.replace，replace 中的 `$&` 等不会被当作替换模式。
 */
export function applyErrata(rawText: string, entries: readonly ErrataEntry[]): ApplyErrataResult {
  assert.equal(typeof rawText, 'string', '[errata] rawText 必须是字符串')
  assertErrataEntries(entries)
  let text = rawText
  const applied: ErrataEntry[] = []
  for (const entry of entries) {
    const occurrences = countOccurrences(text, entry.find)
    assert.equal(
      occurrences,
      ERRATA_REQUIRED_OCCURRENCES,
      `[errata] ${entry.id}：find 应恰好出现 ${ERRATA_REQUIRED_OCCURRENCES} 次，实际 ${occurrences} 次`,
    )
    const index = text.indexOf(entry.find)
    text = `${text.slice(0, index)}${entry.replace}${text.slice(index + entry.find.length)}`
    applied.push(entry)
  }
  return { text, applied }
}

export async function loadErrata(bookId: string, filePath = defaultErrataPath(bookId)): Promise<ErrataEntry[]> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readText(filePath))
  } catch (error) {
    throw new Error(`[errata] 读取失败 ${filePath}: ${String(error)}`)
  }
  assertErrataEntries(parsed, bookId)
  return parsed
}
