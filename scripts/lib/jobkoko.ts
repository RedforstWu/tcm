/**
 * jobkoko/tcm-database 简体古籍 txt 解析（见证本，来源组 `web-simplified`）。
 *
 * 文件名：`{类别字母}-{3位序号}-{书名}.txt`；目录：`古籍目录.csv`（编号,书名,作者,朝代,年份）。
 * 文件结构：
 * ```
 * <篇名>书名            ← 书级标题
 * 书名：… / 作者：… / 朝代：… / 年份：…
 * <目录>卷一\上经        ← 当前目录路径（`\` 分隔层级；可为空；每个篇名前常重复出现）
 * <篇名>丹沙            ← 章节标题
 * 内容：正文…           ← 首行带「内容：」或「属性：」标签，正文可多行
 * ```
 * 部分书没有任何 `<目录>`/`<篇名>`，正文直接跟在书级元数据之后。
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Evidence, SourceGroup } from '../../src/types/data.ts'

export const JOBKOKO_SOURCE_GROUP: SourceGroup = 'web-simplified'
/** 上游仓库未声明 LICENSE */
export const JOBKOKO_LICENSE = 'none-declared'
export const COMMIT_SHORT_LENGTH = 7

const UTF8_BOM = '\uFEFF'
const REPLACEMENT_CHAR = '\uFFFD'
/** 少量 U+FFFD 可能是上游原有坏字；达到此数量且比例超标才判定整体乱码 */
export const GARBLED_MIN_REPLACEMENT_CHARS = 3
export const GARBLED_REPLACEMENT_RATIO = 0.01
/** GBK↔UTF-8 往返转换的典型残留 */
const DOUBLE_DECODED_MOJIBAKE = '锟斤拷'

const COMMIT_RE = /^[0-9a-f]{7,40}$/i
const FILE_NAME_RE = /^([A-Za-z])-(\d{3})-(.+)\.txt$/i
const TAG_LINE_RE = /^<(篇名|目录)>(.*)$/
const META_LINE_RE = /^(书名|作者|朝代|年份)[：:](.*)$/
const CONTENT_LABEL_RE = /^(内容|属性)[：:]/
const CATALOG_PATH_SEPARATOR = '\\'
/** 上游缺字占位（如「《说文》云∶KT ，KT ，」），保留原样仅计数 */
const MISSING_CHAR_PLACEHOLDER_RE = /KT/g
/** 目录 CSV 中个别单元格误为 `<目录>` 之类的标签 */
const STRAY_TAG_CELL_RE = /^<[^<>]+>$/

export class TextDecodingError extends Error {
  readonly fileName: string

  constructor(fileName: string, message: string) {
    super(`${fileName}: ${message}`)
    this.name = 'TextDecodingError'
    this.fileName = fileName
  }
}

/** 去 BOM、统一换行为 `\n`；疑似 GBK 被按 UTF-8 解码（大量 U+FFFD）时抛出带文件名的错误 */
export function normalizeUtf8Text(text: string, fileName: string): string {
  let normalized = text.startsWith(UTF8_BOM) ? text.slice(UTF8_BOM.length) : text
  if (normalized.includes(DOUBLE_DECODED_MOJIBAKE)) {
    throw new TextDecodingError(fileName, `检测到「${DOUBLE_DECODED_MOJIBAKE}」乱码，文件可能经过错误的 GBK/UTF-8 转换`)
  }
  let replacementCount = 0
  for (const char of normalized) {
    if (char === REPLACEMENT_CHAR) replacementCount++
  }
  if (
    replacementCount >= GARBLED_MIN_REPLACEMENT_CHARS &&
    replacementCount / Math.max(normalized.length, 1) >= GARBLED_REPLACEMENT_RATIO
  ) {
    throw new TextDecodingError(
      fileName,
      `含 ${replacementCount} 个 U+FFFD 替换字符（共 ${normalized.length} 字符），疑似 GBK 编码被按 UTF-8 读取`,
    )
  }
  normalized = normalized.replace(/\r\n?/g, '\n')
  return normalized
}

/** 按 UTF-8 读取文本文件并执行 {@link normalizeUtf8Text} 检查 */
export async function readUtf8TextFile(filePath: string): Promise<string> {
  const raw = await readFile(filePath, 'utf8')
  return normalizeUtf8Text(raw, path.basename(filePath))
}

export function shortCommit(commit: string): string {
  const trimmed = commit.trim()
  if (!COMMIT_RE.test(trimmed)) {
    throw new Error(`无效的 git commit：「${commit}」（需 7–40 位十六进制）`)
  }
  return trimmed.slice(0, COMMIT_SHORT_LENGTH).toLowerCase()
}

function baseName(filePath: string): string {
  const parts = filePath.split(/[\\/]/)
  return parts[parts.length - 1] ?? filePath
}

export interface JobkokoFileNameInfo {
  /** 类别字母，如 `B` */
  category: string
  /** 3 位序号转数字，如 1 */
  serial: number
  /** 与 `古籍目录.csv` 编号一致，如 `B-001` */
  code: string
  /** 文件名中的书名 */
  title: string
}

export function parseJobkokoFileName(fileName: string): JobkokoFileNameInfo | null {
  const match = FILE_NAME_RE.exec(baseName(fileName))
  if (!match) return null
  const category = match[1].toUpperCase()
  return {
    category,
    serial: Number(match[2]),
    code: `${category}-${match[2]}`,
    title: match[3],
  }
}

export interface JobkokoMeta {
  bookTitle: string
  author: string | null
  dynasty: string | null
  year: string | null
  /** 文件名首字母；文件名不合规范时为 null */
  category: string | null
  serial: number | null
  code: string | null
}

export interface JobkokoSection {
  title: string
  /** `<目录>` 路径深度 + 1；无目录路径的篇为 1 */
  level: number
  /** 所属 `<目录>` 路径，如 `['卷一', '上经']` */
  path: string[]
  /** 正文（已去掉首行「内容：/属性：」标签、行尾空白与首尾空行），多行以 `\n` 连接 */
  text: string
  /** 被去掉的首行标签，如 `内容` */
  label: string | null
  /** 无 `<篇名>` 的正文归入以书名为题的隐式章节，此时 fullText 不重复输出标题 */
  implicit: boolean
  /** 本节在 fullText 中的起点（标题行起点；隐式章节为正文起点） */
  startOffset: number
  /** 本节正文在 fullText 中的起点 */
  textOffset: number
}

export interface JobkokoText {
  fileName: string
  meta: JobkokoMeta
  sections: JobkokoSection[]
  /** 各节「标题\n正文」以 `\n` 连接 */
  fullText: string
  /** 正文中 `KT` 缺字占位出现次数 */
  missingCharPlaceholders: number
}

interface SectionDraft {
  title: string
  path: string[]
  lines: string[]
  label: string | null
  implicit: boolean
}

function finalizeSectionText(lines: string[]): string {
  const trimmedLines = lines.map((line) => line.trimEnd())
  let start = 0
  let end = trimmedLines.length
  while (start < end && trimmedLines[start] === '') start++
  while (end > start && trimmedLines[end - 1] === '') end--
  return trimmedLines.slice(start, end).join('\n')
}

function parseCatalogPath(value: string): string[] {
  return value
    .split(CATALOG_PATH_SEPARATOR)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

export function parseJobkokoText(text: string, options: { fileName: string }): JobkokoText {
  const fileName = baseName(options.fileName)
  const normalized = normalizeUtf8Text(text, fileName)
  const lines = normalized.split('\n')
  const fileInfo = parseJobkokoFileName(fileName)

  let lineIndex = 0
  let headerTitle: string | null = null
  const metaValues: Partial<Record<'书名' | '作者' | '朝代' | '年份', string>> = {}

  while (lineIndex < lines.length && lines[lineIndex].trim() === '') lineIndex++
  const firstTag = TAG_LINE_RE.exec(lines[lineIndex] ?? '')
  if (firstTag && firstTag[1] === '篇名') {
    headerTitle = firstTag[2].trim()
    lineIndex++
  }
  while (lineIndex < lines.length) {
    const metaMatch = META_LINE_RE.exec(lines[lineIndex].trim())
    if (!metaMatch) break
    const key = metaMatch[1] as keyof typeof metaValues
    metaValues[key] = metaMatch[2].trim()
    lineIndex++
  }

  const bookTitle = metaValues['书名'] || headerTitle || fileInfo?.title || fileName
  const meta: JobkokoMeta = {
    bookTitle,
    author: metaValues['作者'] || null,
    dynasty: metaValues['朝代'] || null,
    year: metaValues['年份'] || null,
    category: fileInfo?.category ?? null,
    serial: fileInfo?.serial ?? null,
    code: fileInfo?.code ?? null,
  }

  const drafts: SectionDraft[] = []
  let currentPath: string[] = []
  let current: SectionDraft | null = null

  for (; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]
    const tag = TAG_LINE_RE.exec(line)
    if (tag) {
      if (tag[1] === '目录') {
        currentPath = parseCatalogPath(tag[2])
        current = null
      } else {
        current = { title: tag[2].trim(), path: [...currentPath], lines: [], label: null, implicit: false }
        drafts.push(current)
      }
      continue
    }
    if (current === null) {
      if (line.trim() === '') continue
      current = { title: bookTitle, path: [...currentPath], lines: [], label: null, implicit: true }
      drafts.push(current)
    }
    if (current.label === null && current.lines.every((existing) => existing.trim() === '')) {
      const labelMatch = CONTENT_LABEL_RE.exec(line)
      if (labelMatch) {
        current.label = labelMatch[1]
        current.lines.push(line.slice(labelMatch[0].length))
        continue
      }
    }
    current.lines.push(line)
  }

  const sections: JobkokoSection[] = []
  const fullTextParts: string[] = []
  let fullTextLength = 0
  const appendPart = (part: string): number => {
    if (fullTextParts.length > 0) {
      fullTextParts.push('\n')
      fullTextLength += 1
    }
    const start = fullTextLength
    fullTextParts.push(part)
    fullTextLength += part.length
    return start
  }

  for (const draft of drafts) {
    const sectionText = finalizeSectionText(draft.lines)
    let startOffset: number
    let textOffset: number
    if (draft.implicit) {
      startOffset = appendPart(sectionText)
      textOffset = startOffset
    } else {
      startOffset = appendPart(draft.title)
      textOffset = appendPart(sectionText)
    }
    sections.push({
      title: draft.title,
      level: draft.path.length + 1,
      path: draft.path,
      text: sectionText,
      label: draft.label,
      implicit: draft.implicit,
      startOffset,
      textOffset,
    })
  }

  const fullText = fullTextParts.join('')
  if (fullText.length !== fullTextLength) {
    throw new Error(`${fileName}: fullText 长度记账不一致（${fullText.length} ≠ ${fullTextLength}）`)
  }
  const missingCharPlaceholders = fullText.match(MISSING_CHAR_PLACEHOLDER_RE)?.length ?? 0
  return { fileName, meta, sections, fullText, missingCharPlaceholders }
}

/** 返回 fullText 下标所在章节（二分查找）；越界或无章节时返回 null */
export function jobkokoSectionAt(parsed: JobkokoText, offset: number): JobkokoSection | null {
  if (!Number.isInteger(offset) || offset < 0 || offset > parsed.fullText.length) return null
  const { sections } = parsed
  let low = 0
  let high = sections.length - 1
  let found = -1
  while (low <= high) {
    const mid = (low + high) >> 1
    if (sections[mid].startOffset <= offset) {
      found = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return found >= 0 ? sections[found] : null
}

export interface JobkokoCatalogEntry {
  code: string
  title: string
  author: string
  dynasty: string
  year: string
}

/** RFC 4180 风格 CSV：支持引号字段、字段内逗号/换行、`""` 转义、CRLF/LF/CR */
export function parseCsvRows(csvText: string): string[][] {
  const text = csvText.startsWith(UTF8_BOM) ? csvText.slice(UTF8_BOM.length) : csvText
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let index = 0

  const endField = () => {
    row.push(field)
    field = ''
  }
  const endRow = () => {
    endField()
    rows.push(row)
    row = []
  }

  while (index < text.length) {
    const char = text[index]
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index += 2
          continue
        }
        inQuotes = false
        index++
        continue
      }
      field += char
      index++
      continue
    }
    if (char === '"' && field === '') {
      inQuotes = true
    } else if (char === ',') {
      endField()
    } else if (char === '\r') {
      endRow()
      if (text[index + 1] === '\n') index++
    } else if (char === '\n') {
      endRow()
    } else {
      field += char
    }
    index++
  }
  if (inQuotes) {
    throw new Error('CSV 解析失败：引号未闭合')
  }
  if (field !== '' || row.length > 0) endRow()
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''))
}

const CATALOG_COLUMNS = {
  code: '编号',
  title: '书名',
  author: '作者',
  dynasty: '朝代',
  year: '年份',
} as const

export function parseJobkokoCatalog(csvText: string): JobkokoCatalogEntry[] {
  const rows = parseCsvRows(csvText)
  if (rows.length === 0) return []
  const headerCells = rows[0].map((cell) => cell.trim())
  const columnIndex = {} as Record<keyof typeof CATALOG_COLUMNS, number>
  for (const [key, label] of Object.entries(CATALOG_COLUMNS) as [keyof typeof CATALOG_COLUMNS, string][]) {
    columnIndex[key] = headerCells.indexOf(label)
  }
  if (columnIndex.code < 0 || columnIndex.title < 0) {
    throw new Error(`古籍目录 CSV 表头缺少「编号」或「书名」：${headerCells.join(',')}`)
  }
  const cellAt = (cells: string[], key: keyof typeof CATALOG_COLUMNS): string => {
    const columnPosition = columnIndex[key]
    const value = columnPosition >= 0 ? (cells[columnPosition] ?? '').trim() : ''
    return STRAY_TAG_CELL_RE.test(value) ? '' : value
  }
  const entries: JobkokoCatalogEntry[] = []
  for (const cells of rows.slice(1)) {
    const code = cellAt(cells, 'code')
    if (!code) continue
    entries.push({
      code,
      title: cellAt(cells, 'title'),
      author: cellAt(cells, 'author'),
      dynasty: cellAt(cells, 'dynasty'),
      year: cellAt(cells, 'year'),
    })
  }
  return entries
}

export function jobkokoEvidence(fileName: string, commit: string, sectionTitle?: string, quote?: string): Evidence {
  const name = baseName(fileName.trim())
  if (!name) throw new Error('jobkokoEvidence：文件名为空')
  if (name.includes('#')) throw new Error(`jobkokoEvidence：文件名含 #，无法作为 locator：${name}`)
  const title = sectionTitle?.trim()
  const evidence: Evidence = {
    sourceId: `jobkoko@${shortCommit(commit)}`,
    group: JOBKOKO_SOURCE_GROUP,
    locator: title ? `${name}#${title}` : name,
    license: JOBKOKO_LICENSE,
  }
  if (quote) evidence.quote = quote
  return evidence
}
