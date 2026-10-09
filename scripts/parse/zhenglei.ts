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

const BOOK_ID = 'zhenglei' as BookId
const RAW_FILE = 'zhenglei-bencao.wiki'

const SKIP_TITLE_RE =
  /^(序|跋|目录|目錄|凡例|全覽|提要|校勘|附录|附錄|序例|进表|進表|叙|敘|检讨|檢討|正文)/
const VOLUME_TITLE_RE =
  /^卷|^第[一二三四五六七八九十百]+|上品|中品|下品|玉石|草木|虫兽|虫魚|虫鱼|米谷|果菜|有名未用/

function normalizeHeadings(raw: string): string {
  return cleanWikiBody(raw)
    .replace(/\r\n/g, '\n')
    .replace(/^#{4}\s+(.+)$/gm, '==== $1 ====')
    .replace(/^#{3}\s+(.+)$/gm, '=== $1 ===')
    .replace(/^#{2}\s+(.+)$/gm, '== $1 ==')
}

function normalizeHerbId(name: string): string {
  return cleanHerbDisplayName(name)
}

function shouldSkipTitle(title: string): boolean {
  const t = cleanHerbDisplayName(title) || toSimplifiedChinese(title).trim()
  return !t || SKIP_TITLE_RE.test(t) || VOLUME_TITLE_RE.test(t) || !looksLikeHerbName(t)
}

function isHerbTitle(title: string): boolean {
  const name = cleanHerbDisplayName(title)
  if (!name || SKIP_TITLE_RE.test(name) || VOLUME_TITLE_RE.test(name)) return false
  return looksLikeHerbName(name)
}

function looksLikeMonographBody(body: string): boolean {
  const head = body.slice(0, 160)
  return (
    /味[甘辛苦酸咸淡涩]/.test(head) ||
    /主治|主五脏|久服|无毒|有毒|图缺/.test(body.slice(0, 320))
  )
}

function cleanSectionBody(body: string): string {
  return toSimplifiedChinese(cleanWikiBody(body))
    .replace(/（[^）]*）/g, (m) => (m.length <= 12 ? '' : m))
    .replace(/\n+/g, '')
    .trim()
}

function buildMonograph(name: string, rawBody: string): HerbMonograph | null {
  const displayName = cleanHerbDisplayName(name)
  const herbId = normalizeHerbId(displayName)
  if (!herbId || herbId.length < 1 || herbId.length > 12) return null
  if (!looksLikeHerbName(displayName)) return null
  if (SKIP_TITLE_RE.test(displayName) || VOLUME_TITLE_RE.test(displayName)) return null
  const simplified = cleanSectionBody(rawBody)
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

/** 卷内「药名 味…」段落回退 */
function extractInlineEntries(body: string): Array<{ name: string; text: string }> {
  const simplified = toSimplifiedChinese(cleanWikiBody(body)).replace(/\r\n/g, '\n')
  const chunks = simplified
    .split(/\n\s*\n/)
    .map((part) => part.replace(/\n+/g, '').trim())
    .filter((part) => part.length >= 12)

  const entries: Array<{ name: string; text: string }> = []
  for (const chunk of chunks) {
    const match = chunk.match(/^([\u4e00-\u9fff]{1,12})\s*味/)
    if (!match) continue
    const name = cleanHerbDisplayName(match[1]!)
    if (!looksLikeHerbName(name)) continue
    if (shouldSkipTitle(name)) continue
    entries.push({ name, text: chunk })
  }
  return entries
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
 * 《证类本草》：按 ==药名== 标题切分；卷类标题则回退抽取正文药条。
 */
export async function runZhengleiParse(): Promise<{
  monographs: HerbMonograph[]
  stats: { monographCount: number }
}> {
  const raw = await readRawWiki()
  const sections = splitWikiSections(normalizeHeadings(raw))
  const monographs: HerbMonograph[] = []

  for (const section of sections) {
    const title = toSimplifiedChinese(section.title).trim()
    if (SKIP_TITLE_RE.test(title)) continue

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

  const deduped = dedupeMonographs(monographs)
  const outDir = path.join(projectRoot(), 'data', 'parsed')
  await ensureDir(outDir)
  await writeJson(path.join(outDir, `${BOOK_ID}.json`), { monographs: deduped })

  return {
    monographs: deduped,
    stats: { monographCount: deduped.length },
  }
}
