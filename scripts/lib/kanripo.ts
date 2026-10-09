/**
 * Kanripo（漢籍リポジトリ，CC BY-SA 4.0）mandoku 格式卷文件解析（见证本，来源组 `kanripo`）。
 *
 * 仓库布局：`<ID>_NNN.txt` 每卷一个文件（`_000` 常为序/目録），分支对应底本（SBCK/WYG/master/tls…）。
 * 已知标记及处理（plainText 视图）：
 * - `# -*- mode: … -*-`、`#+TITLE:`、`#+DATE:`、`#+PROPERTY: KEY VALUE`：文件头，解析为 header；
 *   正文中再次出现的 `#+PROPERTY: JUAN/FILE` 视为卷内分节（如 `_000` 内「序」「目録」），断段
 * - `# 注释`（如 tls 分支的 `# src:`/`# dating:`）：跳过
 * - `<pb:ID_EDITION_JUAN-頁面>`：页码锚点，去除并记录页起点 offset
 * - `¶`：原书行尾，去除；行与行直接相连
 * - 行首全角空格：缩进（低格），去除并逐行记录宽度
 * - `** 标题`（org 标题，tls 分支）：去星号，独立成段
 * - `(甲/乙)`：双行小注，`/` 为左右两列分隔，去掉 `/`、保留括号
 * - `&KR0238;`：缺字实体（Kanripo 字表），原样保留
 * - `[病-丙+(穩-禾)]`：组字式，原样保留
 * - `○`：分隔符，原样保留
 * 其余 `<tag>`、`&name;`、可疑 ASCII 标记符一律原样保留并计入 unknownMarkup。
 */
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import type { Evidence, SourceGroup } from '../../src/types/data.ts'
import { normalizeUtf8Text, readUtf8TextFile, shortCommit } from './jobkoko.ts'

export const KANRIPO_SOURCE_GROUP: SourceGroup = 'kanripo'
export const KANRIPO_LICENSE = 'CC-BY-SA-4.0'

export const LINE_END_MARK = '¶'
const FULLWIDTH_SPACE = '\u3000'
/** 行首全角空格达到此数视为低格（常为注文/小字/方药），仅作启发式，不据此删内容 */
export const ANNOTATION_MIN_INDENT = 3
/** 超过此长度的行不判为章节标题 */
export const MAX_HEADING_LENGTH = 40
/** plainText 中段落（标题/分节）之间的分隔 */
export const PARAGRAPH_SEPARATOR = '\n'
/** loadKanripoText 拼接 fullText 时卷与卷之间的分隔 */
export const JUAN_SEPARATOR = '\n'

const PAGE_BREAK_SPLIT_RE = /(<pb:[^>\s]*>)/
const PAGE_BREAK_RE = /^<pb:([^>\s]*)>$/
const LOCATOR_RE = /^(KR[0-9A-Za-z]+)_([^_]+)_(\d+)-([0-9A-Za-z]+)$/
const JUAN_FILE_RE = /^(KR[0-9A-Za-z]+)_(\d+)\.txt$/
const REPO_DIR_RE = /^(KR[0-9A-Za-z]+)@(.+)$/
const KANRIPO_ID_RE = /^KR[0-9A-Za-z]+$/
const HEADER_PROPERTY_RE = /^#\+([A-Za-z_]+):\s*(.*)$/
const ORG_HEADING_RE = /^(\*+)\s+(.*)$/
const LEADING_INDENT_RE = /^[\u3000 ]*/
const GAIJI_ENTITY_RE = /&KR\d+;/g
const OTHER_ENTITY_RE = /&(?!KR\d+;)[A-Za-z0-9_.-]+;/g
const IDS_COMPOSITION_RE = /\[[^[\]\n]*[-+][^[\]\n]*\]/g
const INLINE_NOTE_RE = /\(([^()]*)\)/g
const UNKNOWN_TAG_RE = /<(?!pb:)\/?([A-Za-z][\w-]*)[^>]*>/g
/** 去掉已知标记后仍残留的这些字符视为可疑标记 */
const SUSPICIOUS_MARKUP_CHAR_RE = /[{}|@$%^~`\\<>&#[\]/]/g
const LEADING_SEPARATOR_RE = /^[○〇]+/
const SEPARATOR_RE = /[○〇]/g
const HEADING_TAIL_RE = /(?:第[一二三四五六七八九十百千〇零]+|卷[之第]?[一二三四五六七八九十百千〇零上中下]+)$/
const FRONT_MATTER_RE = /序|目録|目录|提要|凡例|跋/
const SECTION_PROPERTY_KEYS = new Set(['JUAN', 'FILE'])

export type KnownMarkupKind =
  | 'pageBreak'
  | 'lineEnd'
  | 'indentedLine'
  | 'gaijiEntity'
  | 'idsComposition'
  | 'inlineNote'
  | 'separator'
  | 'orgHeading'
  | 'comment'
  | 'sectionProperty'

export interface KanripoHeader {
  title: string | null
  id: string | null
  baseEdition: string | null
  witness: string | null
  juan: number | null
  file: string | null
  date: string | null
  /** 文件头内全部 `#+PROPERTY:` 键值（首次出现为准），如 `CAT` */
  properties: Record<string, string>
}

export interface KanripoPage {
  /** 如 `KR3e0007_SBCK_001-1a`；首个 `<pb:>` 之前的内容用文件名主干（如 `KR3e0007_001`） */
  locator: string
  edition: string | null
  juan: number | null
  /** 叶面，如 `1a` */
  page: string | null
  /** 本页原始行（已去 `¶` 与页码标记，保留缩进与其余标记），空行为 `''` */
  lines: string[]
  /** 与 lines 一一对应的行首全角空格数 */
  indents: number[]
}

export interface KanripoHeading {
  text: string
  offset: number
  locator: string
}

export interface KanripoJuan {
  fileName: string
  /** 来自文件名 `_NNN`，否则取 header.juan */
  juanNumber: number | null
  header: KanripoHeader
  pages: KanripoPage[]
  plainText: string
  /** 与 pageStartLocators 对应的 plainText 页起点（升序） */
  pageStartOffsets: readonly number[]
  pageStartLocators: readonly string[]
  headings: KanripoHeading[]
  /** 卷内 `#+PROPERTY: FILE` 取值（含文件头），如 `SB03n0126-000金匱要略-序.` */
  fileSections: string[]
  /** `_000` 且为序/目録/提要等 */
  isFrontMatter: boolean
  markupCounts: Record<KnownMarkupKind, number>
  unknownMarkup: Record<string, number>
  offsetToLocator: (offset: number) => string
}

function emptyMarkupCounts(): Record<KnownMarkupKind, number> {
  return {
    pageBreak: 0,
    lineEnd: 0,
    indentedLine: 0,
    gaijiEntity: 0,
    idsComposition: 0,
    inlineNote: 0,
    separator: 0,
    orgHeading: 0,
    comment: 0,
    sectionProperty: 0,
  }
}

function increment(counter: Record<string, number>, key: string, amount = 1): void {
  if (amount <= 0) return
  counter[key] = (counter[key] ?? 0) + amount
}

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0
}

function baseName(filePath: string): string {
  const parts = filePath.split(/[\\/]/)
  return parts[parts.length - 1] ?? filePath
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** 二分查找：升序 starts 中最后一个 ≤ target 的下标；全部大于 target 时返回 -1 */
function findLastAtOrBefore(starts: readonly number[], target: number): number {
  let low = 0
  let high = starts.length - 1
  let found = -1
  while (low <= high) {
    const mid = (low + high) >> 1
    if (starts[mid] <= target) {
      found = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return found
}

function assertOffset(offset: number, length: number, context: string): void {
  if (!Number.isInteger(offset) || offset < 0 || offset > length) {
    throw new RangeError(`${context}: offset ${offset} 越界（有效范围 0–${length}）`)
  }
}

function applyHeaderLine(header: KanripoHeader, line: string): boolean {
  const match = HEADER_PROPERTY_RE.exec(line.trim())
  if (!match) return false
  const key = match[1].toUpperCase()
  const value = match[2].trim()
  if (key === 'TITLE') {
    header.title ??= value || null
  } else if (key === 'DATE') {
    header.date ??= value || null
  } else if (key === 'PROPERTY') {
    const spaceIndex = value.search(/\s/)
    const propertyKey = (spaceIndex < 0 ? value : value.slice(0, spaceIndex)).toUpperCase()
    const propertyValue = spaceIndex < 0 ? '' : value.slice(spaceIndex).trim()
    if (!propertyKey) return true
    if (!(propertyKey in header.properties)) header.properties[propertyKey] = propertyValue
  } else if (!(key in header.properties)) {
    header.properties[key] = value
  }
  return true
}

/** 解析卷文件开头连续的 `#` 行 */
export function parseKanripoHeader(text: string): KanripoHeader {
  const header: KanripoHeader = {
    title: null,
    id: null,
    baseEdition: null,
    witness: null,
    juan: null,
    file: null,
    date: null,
    properties: {},
  }
  for (const rawLine of stripBom(text).split(/\r?\n/)) {
    if (!rawLine.startsWith('#')) break
    applyHeaderLine(header, rawLine)
  }
  const { properties } = header
  header.id = properties.ID || null
  header.baseEdition = properties.BASEEDITION || null
  header.witness = properties.WITNESS || null
  header.file = properties.FILE || null
  const juan = Number.parseInt(properties.JUAN ?? '', 10)
  header.juan = Number.isFinite(juan) ? juan : null
  return header
}

/** 行首全角空格数（ASCII 空格不计入宽度） */
export function measureIndent(line: string): number {
  const leading = LEADING_INDENT_RE.exec(line)?.[0] ?? ''
  let width = 0
  for (const char of leading) {
    if (char === FULLWIDTH_SPACE) width++
  }
  return width
}

/**
 * 启发式：低格（行首全角空格 ≥ ANNOTATION_MIN_INDENT）且不像篇题的行，可能是注文/小字/方药。
 * 只用于标注，调用方不应据此删除内容。
 */
export function isLikelyAnnotation(line: string | { text: string; indent: number }): boolean {
  const text = typeof line === 'string' ? line : line.text
  const indent = typeof line === 'string' ? measureIndent(line) : line.indent
  const content = text.replace(LEADING_INDENT_RE, '').replaceAll(LINE_END_MARK, '').trim()
  if (!content) return false
  if (indent < ANNOTATION_MIN_INDENT) return false
  return !HEADING_TAIL_RE.test(content.replace(LEADING_SEPARATOR_RE, ''))
}

export function parseKanripoLocator(
  locator: string,
): { id: string; edition: string; juan: number; page: string } | null {
  const match = LOCATOR_RE.exec(locator)
  if (!match) return null
  return { id: match[1], edition: match[2], juan: Number(match[3]), page: match[4] }
}

function isLikelyHeading(content: string, bookTitle: string | null): boolean {
  if (content.length === 0 || content.length > MAX_HEADING_LENGTH) return false
  const candidate = content.replace(LEADING_SEPARATOR_RE, '').replace(INLINE_NOTE_RE, '')
  if (HEADING_TAIL_RE.test(candidate)) return true
  return bookTitle !== null && bookTitle.length > 0 && candidate.startsWith(bookTitle)
}

function normalizeInlineNotes(content: string): string {
  return content.replace(INLINE_NOTE_RE, (_whole, inner: string) => `(${inner.replaceAll('/', '')})`)
}

function countContentMarkup(
  content: string,
  markupCounts: Record<KnownMarkupKind, number>,
  unknownMarkup: Record<string, number>,
): void {
  const withoutIds = content.replace(IDS_COMPOSITION_RE, '')
  markupCounts.gaijiEntity += countMatches(content, GAIJI_ENTITY_RE)
  markupCounts.idsComposition += countMatches(content, IDS_COMPOSITION_RE)
  markupCounts.inlineNote += countMatches(withoutIds, INLINE_NOTE_RE)
  markupCounts.separator += countMatches(content, SEPARATOR_RE)

  for (const match of content.matchAll(UNKNOWN_TAG_RE)) increment(unknownMarkup, `<${match[1]}>`)
  for (const match of content.matchAll(OTHER_ENTITY_RE)) increment(unknownMarkup, match[0])

  const residue = withoutIds
    .replace(GAIJI_ENTITY_RE, '')
    .replace(UNKNOWN_TAG_RE, '')
    .replace(OTHER_ENTITY_RE, '')
    .replace(INLINE_NOTE_RE, (_whole, inner: string) => inner.replaceAll('/', ''))
  for (const match of residue.matchAll(SUSPICIOUS_MARKUP_CHAR_RE)) increment(unknownMarkup, `char:${match[0]}`)
  if (countMatches(withoutIds, /\(/g) !== countMatches(withoutIds, /\)/g)) increment(unknownMarkup, 'unbalancedParen')
}

function fileStemOf(fileName: string): string {
  return fileName.replace(/\.txt$/i, '')
}

/** 解析单卷文件 */
export function parseKanripoJuan(text: string, options: { fileName: string }): KanripoJuan {
  const fileName = baseName(options.fileName)
  const normalized = normalizeUtf8Text(text, fileName)
  const header = parseKanripoHeader(normalized)
  const fileMatch = JUAN_FILE_RE.exec(fileName)
  const juanNumber = fileMatch ? Number(fileMatch[2]) : header.juan

  const markupCounts = emptyMarkupCounts()
  const unknownMarkup: Record<string, number> = {}
  const pages: KanripoPage[] = []
  const headings: KanripoHeading[] = []
  const fileSections: string[] = header.file ? [header.file] : []

  const plainParts: string[] = []
  let plainLength = 0
  let pendingParagraphBreak = false
  let pendingPageLocator: string | null = null
  const pageStartOffsets: number[] = []
  const pageStartLocators: string[] = []
  let currentPage = null as KanripoPage | null

  const breakParagraph = () => {
    pendingParagraphBreak = true
  }
  const appendPlain = (segment: string): number => {
    if (pendingParagraphBreak && plainLength > 0) {
      plainParts.push(PARAGRAPH_SEPARATOR)
      plainLength += PARAGRAPH_SEPARATOR.length
    }
    pendingParagraphBreak = false
    if (pendingPageLocator !== null) {
      pageStartOffsets.push(plainLength)
      pageStartLocators.push(pendingPageLocator)
      pendingPageLocator = null
    }
    const start = plainLength
    plainParts.push(segment)
    plainLength += segment.length
    return start
  }
  const startPage = (locator: string): KanripoPage => {
    const parsedLocator = parseKanripoLocator(locator)
    const page: KanripoPage = {
      locator,
      edition: parsedLocator?.edition ?? null,
      juan: parsedLocator?.juan ?? null,
      page: parsedLocator?.page ?? null,
      lines: [],
      indents: [],
    }
    pages.push(page)
    currentPage = page
    pendingPageLocator = locator
    return page
  }
  const ensurePage = (): KanripoPage => currentPage ?? startPage(fileStemOf(fileName))

  const lines = normalized.split('\n')
  let lineIndex = 0
  while (lineIndex < lines.length && lines[lineIndex].startsWith('#')) lineIndex++

  for (; lineIndex < lines.length; lineIndex++) {
    const rawLine = lines[lineIndex]
    if (rawLine.startsWith('#')) {
      const propertyMatch = HEADER_PROPERTY_RE.exec(rawLine.trim())
      if (propertyMatch) {
        const value = propertyMatch[2].trim()
        const propertyKey = propertyMatch[1].toUpperCase() === 'PROPERTY' ? value.split(/\s+/)[0].toUpperCase() : ''
        if (SECTION_PROPERTY_KEYS.has(propertyKey)) {
          markupCounts.sectionProperty++
          if (propertyKey === 'FILE') fileSections.push(value.slice(propertyKey.length).trim())
        } else {
          increment(unknownMarkup, `#+${propertyMatch[1].toUpperCase()}${propertyKey ? ` ${propertyKey}` : ''}`)
        }
        breakParagraph()
      } else if (rawLine.startsWith('#+')) {
        increment(unknownMarkup, `#+${/^#\+(\S*)/.exec(rawLine)?.[1] ?? ''}`)
        breakParagraph()
      } else {
        markupCounts.comment++
      }
      continue
    }

    const pieces = rawLine.split(PAGE_BREAK_SPLIT_RE)
    const lineHasPageBreak = pieces.length > 1
    let isLineStart = true
    for (const piece of pieces) {
      const pageBreak = PAGE_BREAK_RE.exec(piece)
      if (pageBreak) {
        markupCounts.pageBreak++
        // 上游偶有同一页码连续出现（中间夹 `# xxx.png` 注释），沿用当前页
        if (currentPage?.locator !== pageBreak[1]) startPage(pageBreak[1])
        isLineStart = false
        continue
      }
      const lineEndCount = countMatches(piece, /¶/g)
      markupCounts.lineEnd += lineEndCount
      const rawContent = piece.replaceAll(LINE_END_MARK, '').trimEnd()
      if (rawContent.trim() === '') {
        // 仅含页码标记的行不产生空行；单独的 `¶` 记为原书空行
        if (!lineHasPageBreak && (lineEndCount > 0 || piece.length > 0)) {
          const page = ensurePage()
          page.lines.push('')
          page.indents.push(0)
        }
        if (!lineHasPageBreak) breakParagraph()
        continue
      }

      const page = ensurePage()
      const indent = isLineStart ? measureIndent(rawContent) : 0
      page.lines.push(rawContent)
      page.indents.push(indent)
      if (indent > 0) markupCounts.indentedLine++

      let content = rawContent.replace(LEADING_INDENT_RE, '')
      let orgHeading = false
      const orgMatch = isLineStart ? ORG_HEADING_RE.exec(content) : null
      if (orgMatch) {
        markupCounts.orgHeading++
        orgHeading = true
        content = orgMatch[2].trim()
      }
      countContentMarkup(content, markupCounts, unknownMarkup)
      const plainContent = normalizeInlineNotes(content)

      if (orgHeading || (isLineStart && isLikelyHeading(content, header.title))) {
        breakParagraph()
        const offset = appendPlain(plainContent)
        headings.push({ text: plainContent, offset, locator: page.locator })
        breakParagraph()
      } else {
        appendPlain(plainContent)
      }
      isLineStart = false
    }
  }

  const plainText = plainParts.join('')
  if (plainText.length !== plainLength) {
    throw new Error(`${fileName}: plainText 长度记账不一致（${plainText.length} ≠ ${plainLength}）`)
  }

  const offsetToLocator = (offset: number): string => {
    assertOffset(offset, plainText.length, fileName)
    const index = findLastAtOrBefore(pageStartOffsets, offset)
    if (index < 0) throw new RangeError(`${fileName}: 无正文，无法定位 offset ${offset}`)
    return pageStartLocators[index]
  }

  const isFrontMatter =
    juanNumber === 0 &&
    (fileSections.some((section) => FRONT_MATTER_RE.test(section)) ||
      headings.some((heading) => FRONT_MATTER_RE.test(heading.text)))

  return {
    fileName,
    juanNumber,
    header,
    pages,
    plainText,
    pageStartOffsets,
    pageStartLocators,
    headings,
    fileSections,
    isFrontMatter,
    markupCounts,
    unknownMarkup,
    offsetToLocator,
  }
}

export interface KanripoLocation {
  juan: number
  fileName: string
  locator: string
}

export interface KanripoText {
  id: string
  /** 目录名 `<id>@<branch>` 中的分支；目录名不含 `@` 时为 null */
  branch: string | null
  /** 分支名优先，其次 header 的 WITNESS / BASEEDITION */
  edition: string | null
  title: string | null
  /** 计入 fullText 的卷（按卷号升序） */
  juans: KanripoJuan[]
  /** 被单独标记、未计入 fullText 的 `_000` 序/目録卷 */
  frontMatter: KanripoJuan[]
  /** juans 的 plainText 以 JUAN_SEPARATOR 连接 */
  fullText: string
  juanStartOffsets: readonly number[]
  markupCounts: Record<KnownMarkupKind, number>
  unknownMarkup: Record<string, number>
  locate: (offset: number) => KanripoLocation
}

export interface LoadKanripoOptions {
  /** 为 true 时 `_000` 序/目録也计入 juans/fullText（默认 false） */
  includeFrontMatter?: boolean
}

/** 读取已下载的 Kanripo 仓库目录（如 `data/vendor/kanripo/KR3e0007@SBCK/`） */
export async function loadKanripoText(dir: string, options: LoadKanripoOptions = {}): Promise<KanripoText> {
  const dirName = path.basename(path.resolve(dir))
  const dirMatch = REPO_DIR_RE.exec(dirName)
  const entries = await readdir(dir)
  const juanFiles = entries
    .map((name) => ({ name, match: JUAN_FILE_RE.exec(name) }))
    .filter((entry): entry is { name: string; match: RegExpExecArray } => entry.match !== null)

  const idsInDir = [...new Set(juanFiles.map((entry) => entry.match[1]))]
  const id = dirMatch?.[1] ?? (idsInDir.length === 1 ? idsInDir[0] : null)
  if (id === null) {
    throw new Error(`${dir}: 无法确定 Kanripo 文本 ID（目录名非 <id>@<branch>，且卷文件 ID 为 ${idsInDir.join('/') || '空'}）`)
  }
  const ownFiles = juanFiles
    .filter((entry) => entry.match[1] === id)
    .map((entry) => ({ name: entry.name, juan: Number(entry.match[2]) }))
    .sort((left, right) => left.juan - right.juan)
  if (ownFiles.length === 0) {
    throw new Error(`${dir}: 未找到 ${id}_NNN.txt 卷文件`)
  }
  for (let index = 1; index < ownFiles.length; index++) {
    if (ownFiles[index].juan === ownFiles[index - 1].juan) {
      throw new Error(`${dir}: 卷号重复：${ownFiles[index - 1].name} 与 ${ownFiles[index].name}`)
    }
  }

  const parsedJuans = await Promise.all(
    ownFiles.map(async (file) => {
      const text = await readUtf8TextFile(path.join(dir, file.name))
      return parseKanripoJuan(text, { fileName: file.name })
    }),
  )

  const juans: KanripoJuan[] = []
  const frontMatter: KanripoJuan[] = []
  for (const juan of parsedJuans) {
    if (juan.isFrontMatter && !options.includeFrontMatter) frontMatter.push(juan)
    else juans.push(juan)
  }

  const juanStartOffsets: number[] = []
  const textParts: string[] = []
  let fullLength = 0
  for (const juan of juans) {
    if (textParts.length > 0) {
      textParts.push(JUAN_SEPARATOR)
      fullLength += JUAN_SEPARATOR.length
    }
    juanStartOffsets.push(fullLength)
    textParts.push(juan.plainText)
    fullLength += juan.plainText.length
  }
  const fullText = textParts.join('')

  const markupCounts = emptyMarkupCounts()
  const unknownMarkup: Record<string, number> = {}
  for (const juan of parsedJuans) {
    for (const [kind, count] of Object.entries(juan.markupCounts) as [KnownMarkupKind, number][]) {
      markupCounts[kind] += count
    }
    for (const [key, count] of Object.entries(juan.unknownMarkup)) increment(unknownMarkup, key, count)
  }

  const firstHeader = parsedJuans[0].header
  const locate = (offset: number): KanripoLocation => {
    assertOffset(offset, fullText.length, `${id} fullText`)
    const juanIndex = findLastAtOrBefore(juanStartOffsets, offset)
    if (juanIndex < 0) throw new RangeError(`${id}: 无正文卷，无法定位 offset ${offset}`)
    const juan = juans[juanIndex]
    const localOffset = Math.min(offset - juanStartOffsets[juanIndex], juan.plainText.length)
    return {
      juan: juan.juanNumber ?? juanIndex,
      fileName: juan.fileName,
      locator: juan.offsetToLocator(localOffset),
    }
  }

  return {
    id,
    branch: dirMatch?.[2] ?? null,
    edition: dirMatch?.[2] ?? firstHeader.witness ?? firstHeader.baseEdition,
    title: firstHeader.title,
    juans,
    frontMatter,
    fullText,
    juanStartOffsets,
    markupCounts,
    unknownMarkup,
    locate,
  }
}

export function kanripoEvidence(id: string, branch: string, commit: string, locator: string, quote?: string): Evidence {
  const textId = id.trim()
  const branchName = branch.trim()
  const pageLocator = locator.trim()
  if (!KANRIPO_ID_RE.test(textId)) throw new Error(`kanripoEvidence：无效的 Kanripo ID「${id}」`)
  if (!branchName || /[@#\s]/.test(branchName)) throw new Error(`kanripoEvidence：无效的分支名「${branch}」`)
  if (!pageLocator.startsWith(textId)) {
    throw new Error(`kanripoEvidence：locator「${locator}」与文本 ID ${textId} 不一致`)
  }
  const evidence: Evidence = {
    sourceId: `kanripo:${textId}@${branchName}#${shortCommit(commit)}`,
    group: KANRIPO_SOURCE_GROUP,
    locator: pageLocator,
    license: KANRIPO_LICENSE,
  }
  if (quote) evidence.quote = quote
  return evidence
}
