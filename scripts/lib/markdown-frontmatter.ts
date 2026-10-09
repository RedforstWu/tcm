import { parse as parseYaml } from 'yaml'

/** frontmatter 起止分隔行 */
export const FRONTMATTER_DELIMITER = '---'
const BYTE_ORDER_MARK = '\uFEFF'
const SECTION_HEADING_PREFIX = '## '
const CODE_FENCE_PREFIX = '```'

export type FrontmatterData = Record<string, unknown>

export interface FrontmatterSplit {
  /** `---` 之间的原始 YAML 文本；无 frontmatter 时为 null */
  frontmatterText: string | null
  /** 正文（已统一为 LF 换行） */
  body: string
}

export type FrontmatterFailureReason = 'no-frontmatter' | 'yaml-error' | 'not-mapping'

export type ParsedMarkdown =
  | { ok: true; data: FrontmatterData; body: string }
  | { ok: false; reason: FrontmatterFailureReason; message: string; body: string }

export interface MarkdownSection {
  /** `## ` 之后的标题文本（已 trim） */
  heading: string
  /** 标题下到下一个 `## ` 之前的内容，去掉首尾空行 */
  content: string
}

export interface Wikilink {
  /** 链接目标（可能带路径，如 `01_条文/太阳病/条文-012`） */
  target: string
  /** 显示名：有别名取别名，否则取目标 */
  display: string
}

/** 去 BOM、CRLF/CR → LF */
export function normalizeNewlines(text: string): string {
  const withoutBom = text.startsWith(BYTE_ORDER_MARK) ? text.slice(BYTE_ORDER_MARK.length) : text
  return withoutBom.replace(/\r\n?/g, '\n')
}

/** 拆分 `---` frontmatter 与正文；首行不是 `---` 或找不到闭合分隔行时视为无 frontmatter */
export function splitFrontmatter(text: string): FrontmatterSplit {
  const normalized = normalizeNewlines(text)
  const lines = normalized.split('\n')
  if (lines[0]?.trimEnd() !== FRONTMATTER_DELIMITER) {
    return { frontmatterText: null, body: normalized }
  }
  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    if (lines[lineIndex].trimEnd() === FRONTMATTER_DELIMITER) {
      return {
        frontmatterText: lines.slice(1, lineIndex).join('\n'),
        body: lines.slice(lineIndex + 1).join('\n'),
      }
    }
  }
  return { frontmatterText: null, body: normalized }
}

function isPlainObject(value: unknown): value is FrontmatterData {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 拆分并用 `yaml` 解析 frontmatter；失败不抛异常，返回原因 */
export function parseMarkdownWithFrontmatter(text: string): ParsedMarkdown {
  const { frontmatterText, body } = splitFrontmatter(text)
  if (frontmatterText === null) {
    return { ok: false, reason: 'no-frontmatter', message: '无 frontmatter', body }
  }
  let parsed: unknown
  try {
    parsed = parseYaml(frontmatterText)
  } catch (error) {
    const firstLine = (error instanceof Error ? error.message : String(error)).split('\n')[0]
    return { ok: false, reason: 'yaml-error', message: `YAML 解析失败：${firstLine}`, body }
  }
  if (parsed === null || parsed === undefined) {
    return { ok: true, data: {}, body }
  }
  if (!isPlainObject(parsed)) {
    return { ok: false, reason: 'not-mapping', message: 'frontmatter 不是键值映射', body }
  }
  return { ok: true, data: parsed, body }
}

function trimBlankLines(lines: string[]): string {
  let start = 0
  let end = lines.length
  while (start < end && lines[start].trim() === '') start += 1
  while (end > start && lines[end - 1].trim() === '') end -= 1
  return lines.slice(start, end).join('\n')
}

/** 按 `## 标题` 切分正文；代码围栏内的 `## ` 不切分，首个标题之前的内容丢弃 */
export function splitSections(body: string): MarkdownSection[] {
  const sections: MarkdownSection[] = []
  let current: { heading: string; lines: string[] } | null = null
  let insideFence = false
  for (const line of normalizeNewlines(body).split('\n')) {
    if (line.trimStart().startsWith(CODE_FENCE_PREFIX)) insideFence = !insideFence
    if (!insideFence && line.startsWith(SECTION_HEADING_PREFIX)) {
      if (current) sections.push({ heading: current.heading, content: trimBlankLines(current.lines) })
      current = { heading: line.slice(SECTION_HEADING_PREFIX.length).trim(), lines: [] }
      continue
    }
    current?.lines.push(line)
  }
  if (current) sections.push({ heading: current.heading, content: trimBlankLines(current.lines) })
  return sections
}

/** 取标题完全相同的首个段落内容 */
export function getSection(sections: MarkdownSection[], heading: string): string | null {
  return sections.find((section) => section.heading === heading)?.content ?? null
}

/** 取标题以指定前缀开头的首个段落内容（如 `原文` 匹配 `原文（宋版）`） */
export function findSectionByPrefix(sections: MarkdownSection[], headingPrefix: string): string | null {
  return sections.find((section) => section.heading.startsWith(headingPrefix))?.content ?? null
}

/** `[[目标]]`、`[[目标|别名]]`；表格中的 `\|` 转义同样识别 */
const WIKILINK_PATTERN = /\[\[([^\]|\\]+?)(?:\\?\|([^\]]*?))?\]\]/g

function toWikilink(target: string, alias: string | undefined): Wikilink {
  const trimmedTarget = target.trim()
  const trimmedAlias = alias?.trim()
  return { target: trimmedTarget, display: trimmedAlias ? trimmedAlias : trimmedTarget }
}

/** 文本中所有 wikilink 替换为显示名 */
export function stripWikilinks(text: string): string {
  return text.replace(WIKILINK_PATTERN, (_match, target: string, alias: string | undefined) =>
    toWikilink(target, alias).display,
  )
}

/** 整个字符串恰为单个 wikilink 时解析，否则返回 null */
export function parseWikilink(text: string): Wikilink | null {
  const match = /^\[\[([^\]|\\]+?)(?:\\?\|([^\]]*?))?\]\]$/.exec(text.trim())
  return match ? toWikilink(match[1], match[2]) : null
}

/** 提取文本中全部 wikilink */
export function extractWikilinks(text: string): Wikilink[] {
  return [...text.matchAll(WIKILINK_PATTERN)].map((match) => toWikilink(match[1], match[2]))
}

/** 路径型目标取末段：`01_条文/太阳病/条文-012` → `条文-012` */
export function wikilinkBasename(target: string): string {
  const segments = target.split('/')
  return segments[segments.length - 1].trim()
}

/** 提取 `> ` 引用块各行内容（去掉 `>` 与其后一个空格），空引用行保留为空串 */
export function extractBlockquoteLines(content: string): string[] {
  const lines: string[] = []
  for (const line of normalizeNewlines(content).split('\n')) {
    const match = /^\s*>\s?(.*)$/.exec(line)
    if (match) lines.push(match[1].trimEnd())
  }
  return lines
}

/** 提取单行反引号包裹的内容（去首尾空白，忽略空串） */
export function extractBacktickSpans(text: string): string[] {
  const spans: string[] = []
  for (const match of text.matchAll(/`([^`\n]+)`/g)) {
    const span = match[1].trim()
    if (span) spans.push(span)
  }
  return spans
}

/** 列表段落 → 各项文本（去掉 `- ` / `* ` / `1. ` 标记）；非列表非空行原样保留 */
export function extractListItems(content: string): string[] {
  const items: string[] = []
  for (const line of normalizeNewlines(content).split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    items.push(trimmed.replace(/^(?:[-*+]|\d+[.)])\s+/, ''))
  }
  return items
}
