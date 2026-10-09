import path from 'node:path'
import type { BookId, HerbMonograph } from '../../src/types/data.ts'
import {
  cleanHerbDisplayName,
  looksLikeHerbName,
  parseClassicalMeta,
} from '../lib/bencao-classical.ts'
import { ensureDir, fileExists, projectRoot, readText, writeJson } from '../lib/fs-utils.ts'
import { cleanWikiBody, splitWikiSections } from '../lib/generic-wiki-parse.ts'
import { toSimplifiedChinese } from '../lib/wiki.ts'

const BOOK_ID = 'xinxiu' as BookId
const RAW_FILE = 'xinxiu-bencao.wiki'

const SKIP_TITLE_RE =
  /^(序|跋|目录|目錄|凡例|全覽|提要|校勘|附录|附錄|合药|诸病|療|疗|卷|孔|梁|陶|玉石上部|本草经|进表|進表|叙|敘|正文)/
const NON_HERB_TITLE_RE =
  /通用|上部|中部|下部|上品|中品|下品|部|卷|^第[一二三四五六七八九十百]+/

function normalizeHeadings(raw: string): string {
  return cleanWikiBody(raw)
    .replace(/\r\n/g, '\n')
    .replace(/^#{4}\s+(.+)$/gm, '==== $1 ====')
    .replace(/^#{3}\s+(.+)$/gm, '=== $1 ===')
    .replace(/^#{2}\s+(.+)$/gm, '== $1 ==')
}

function joinHardBreaks(content: string): string {
  return cleanWikiBody(content)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('')
    .replace(/\s+/g, '')
}

function normalizeHerbId(name: string): string {
  return cleanHerbDisplayName(name)
}

function shouldSkipTitle(title: string): boolean {
  const t = cleanHerbDisplayName(title) || toSimplifiedChinese(title).trim()
  if (!t || SKIP_TITLE_RE.test(t) || NON_HERB_TITLE_RE.test(t)) return true
  return !looksLikeHerbName(t)
}

function isHerbTitle(title: string): boolean {
  const name = cleanHerbDisplayName(title)
  if (!name || SKIP_TITLE_RE.test(name) || NON_HERB_TITLE_RE.test(name)) return false
  return looksLikeHerbName(name)
}

function looksLikeMonographBody(body: string): boolean {
  const head = body.slice(0, 120)
  return (
    /^味/.test(head.trim()) ||
    /味[甘辛苦酸咸淡涩]/.test(head) ||
    /主治|久服|无毒|有毒/.test(body.slice(0, 240))
  )
}

function buildMonograph(name: string, rawBody: string): HerbMonograph | null {
  const displayName = cleanHerbDisplayName(name)
  const herbId = normalizeHerbId(displayName)
  if (!herbId || herbId.length < 1 || herbId.length > 12) return null
  if (!looksLikeHerbName(displayName)) return null
  const simplified = toSimplifiedChinese(cleanWikiBody(rawBody)).replace(/\n+/g, '').trim()
  if (simplified.length < 12) return null
  if (!looksLikeMonographBody(simplified)) return null
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

/** ctext / 维基导出常见的 <篇名>…内容： 格式 */
function parsePianmingEntries(raw: string): HerbMonograph[] {
  const monographs: HerbMonograph[] = []
  const normalized = toSimplifiedChinese(raw)
  const entryRe = /<篇名>([^\n<]+)\s*\n+内容：([\s\S]*?)(?=<目录>|<篇名>|$)/g
  let match: RegExpExecArray | null
  while ((match = entryRe.exec(normalized)) !== null) {
    const rawName = match[1]!.trim()
    if (!isHerbTitle(rawName)) continue
    const joined = joinHardBreaks(match[2] ?? '')
    const item = buildMonograph(rawName, joined)
    if (item) monographs.push(item)
  }
  return monographs
}

function parseWikiHeadingEntries(raw: string): HerbMonograph[] {
  const sections = splitWikiSections(normalizeHeadings(raw))
  const monographs: HerbMonograph[] = []
  for (const section of sections) {
    if (!isHerbTitle(section.title)) continue
    const item = buildMonograph(section.title, section.body)
    if (item) monographs.push(item)
  }
  return monographs
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
 * 《新修本草》：优先按 <篇名> 药条切分；否则按 wiki 药名标题切分。
 */
export async function runXinxiuParse(): Promise<{
  monographs: HerbMonograph[]
  stats: { monographCount: number }
}> {
  const raw = await readRawWiki()
  let monographs = parsePianmingEntries(raw)
  if (monographs.length === 0) {
    monographs = parseWikiHeadingEntries(raw)
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
