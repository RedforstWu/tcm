import path from 'node:path'
import type { BookId, HerbMonograph } from '../../src/types/data.ts'
import {
  cleanHerbDisplayName,
  looksLikeHerbName,
  parseClassicalMeta,
} from '../lib/bencao-classical.ts'
import { ensureDir, fileExists, projectRoot, readText, writeJson } from '../lib/fs-utils.ts'
import { splitWikiSections } from '../lib/generic-wiki-parse.ts'
import { toSimplifiedChinese } from '../lib/wiki.ts'

const BOOK_ID = 'shennong' as BookId
const RAW_FILE = 'shennong-bencao.wiki'

const SKIP_TITLE_RE =
  /^(序|跋|目录|目錄|凡例|全覽|提要|校勘|附录|附錄|总论|總論|叙|敘|正文)/
const CATEGORY_TITLE_RE =
  /部|上品|中品|下品|上经|中经|下经|卷|^第[一二三四五六七八九十百]+/

function normalizeHeadings(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    // 「'''玉泉'''　味甘平」「…气在皮肤中。　铁，主坚肌耐痛」：本书全角空格只是版式分隔，正文保持连写
    .replace(/　+/g, '')
    .replace(/^#{4}\s+(.+)$/gm, '==== $1 ====')
    .replace(/^#{3}\s+(.+)$/gm, '=== $1 ===')
    .replace(/^#{2}\s+(.+)$/gm, '== $1 ==')
}

function stripWikiBold(text: string): string {
  return text.replace(/'{2,}/g, '')
}

function normalizeHerbId(name: string): string {
  return cleanHerbDisplayName(name)
}

function shouldSkipTitle(title: string): boolean {
  const t = toSimplifiedChinese(title).trim()
  return SKIP_TITLE_RE.test(t) || t.length === 0
}

function isHerbTitle(title: string): boolean {
  const t = toSimplifiedChinese(title).trim()
  if (shouldSkipTitle(t) || CATEGORY_TITLE_RE.test(t)) return false
  return looksLikeHerbName(t)
}

/**
 * 从三品/部类正文抽取「'''药名'''味…」或「药名味…」条目。
 * 神农本草经维基常用粗体药名：'''丹砂'''味甘微寒…
 */
function extractInlineEntries(body: string): Array<{ name: string; text: string }> {
  const simplified = toSimplifiedChinese(body).replace(/\r\n/g, '\n')
  const entries: Array<{ name: string; text: string }> = []
  const seen = new Set<string>()

  // 优先：'''药名'''味…
  const boldRe = /'''([^'\n]{1,40})'''\s*味/g
  let match: RegExpExecArray | null
  const boldStarts: Array<{ name: string; index: number; end: number }> = []
  while ((match = boldRe.exec(simplified)) !== null) {
    const rawName = match[1]!.trim()
    const name = cleanHerbDisplayName(rawName)
    if (!looksLikeHerbName(name)) continue
    if (CATEGORY_TITLE_RE.test(name) || SKIP_TITLE_RE.test(name)) continue
    if (/^药有/.test(name)) continue
    boldStarts.push({ name, index: match.index, end: match.index + match[0].length })
  }

  if (boldStarts.length > 0) {
    for (let i = 0; i < boldStarts.length; i += 1) {
      const current = boldStarts[i]!
      const next = boldStarts[i + 1]
      const sliceEnd = next?.index ?? simplified.length
      // 取到下一药名前；单药文本含药名
      const text = stripWikiBold(simplified.slice(current.index, sliceEnd))
        .replace(/\n+/g, '')
        .trim()
      if (text.length < 8) continue
      if (seen.has(current.name)) continue
      seen.add(current.name)
      entries.push({ name: current.name, text })
    }
    return entries
  }

  // 回退：去粗体后按段落「药名味」
  const plain = stripWikiBold(simplified)
  const chunks = plain
    .split(/\n\s*\n/)
    .map((part) => part.replace(/\n+/g, '').trim())
    .filter((part) => part.length >= 12)

  for (const chunk of chunks) {
    const m = chunk.match(/^([\u4e00-\u9fff]{1,14})\s*味/)
    if (!m) continue
    const name = cleanHerbDisplayName(m[1]!)
    if (!looksLikeHerbName(name)) continue
    if (CATEGORY_TITLE_RE.test(name) || SKIP_TITLE_RE.test(name)) continue
    if (/^药有/.test(name)) continue
    if (seen.has(name)) continue
    seen.add(name)
    entries.push({ name, text: chunk })
  }
  return entries
}

function buildMonograph(name: string, rawBody: string): HerbMonograph | null {
  const displayName = cleanHerbDisplayName(name)
  const herbId = normalizeHerbId(displayName)
  if (!herbId || herbId.length < 1 || herbId.length > 14) return null
  if (!looksLikeHerbName(displayName)) return null
  const simplified = stripWikiBold(toSimplifiedChinese(rawBody))
    .replace(/\n+/g, '')
    .trim()
  if (simplified.length < 8) return null
  const meta = parseClassicalMeta(simplified)
  return {
    id: `${BOOK_ID}-${herbId}`,
    herbId,
    name: displayName,
    nature: meta.nature,
    flavor: meta.flavor,
    channels: meta.channels,
    toxicity: meta.toxicity,
    summary: simplified.slice(0, 400),
    qa: [],
    rawText: simplified.slice(0, 4000),
    sourceBook: BOOK_ID,
  }
}

function dedupeMonographs(items: HerbMonograph[]): HerbMonograph[] {
  const byId = new Map<string, HerbMonograph>()
  for (const item of items) {
    const existing = byId.get(item.herbId)
    if (!existing || item.rawText.length > existing.rawText.length) {
      byId.set(item.herbId, item)
    }
  }
  return [...byId.values()]
}

async function readRawWiki(): Promise<string> {
  const filePath = path.join(projectRoot(), 'data', 'raw', RAW_FILE)
  if (!(await fileExists(filePath))) {
    throw new Error(`原始 wiki 不存在：${filePath}（请先获取 ${RAW_FILE}）`)
  }
  try {
    return await readText(filePath)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code
    if (code === 'ENOENT') {
      throw new Error(`原始 wiki 不存在：${filePath}（请先获取 ${RAW_FILE}）`)
    }
    throw error
  }
}

/**
 * 《神农本草经》：按三品/部类标题切段，从正文抽「'''药名'''味…」条目；
 * 若标题本身为药名则整段作为一条。
 */
export async function runShennongParse(): Promise<{
  monographs: HerbMonograph[]
  stats: { monographCount: number }
}> {
  const raw = await readRawWiki()
  const sections = splitWikiSections(normalizeHeadings(raw))
  const monographs: HerbMonograph[] = []

  for (const section of sections) {
    if (shouldSkipTitle(section.title)) continue

    if (isHerbTitle(section.title)) {
      const item = buildMonograph(section.title, section.body)
      if (item) monographs.push(item)
      continue
    }

    for (const entry of extractInlineEntries(section.body)) {
      const item = buildMonograph(entry.name, entry.text)
      if (item) monographs.push(item)
    }
  }

  // 无标题时：整文按粗体/段落抽药条
  if (monographs.length === 0) {
    for (const entry of extractInlineEntries(toSimplifiedChinese(raw))) {
      const item = buildMonograph(entry.name, entry.text)
      if (item) monographs.push(item)
    }
  }

  const deduped = dedupeMonographs(monographs)
  const outDir = path.join(projectRoot(), 'data', 'parsed')
  await ensureDir(outDir)
  await writeJson(path.join(outDir, `${BOOK_ID}.json`), { monographs: deduped })

  return {
    monographs: deduped,
    stats: { monographCount: deduped.length },
  }
}
