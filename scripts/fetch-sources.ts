import { execFile } from 'node:child_process'
import { copyFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { ensureDir, fileExists, projectRoot, writeText, writeJson, readText } from './lib/fs-utils.ts'

const execFileAsync = promisify(execFile)

interface SourceSpec {
  id: string
  title: string
  pages: string[]
  filename: string
  /** 女科等：先抓索引页，再拼接子页 */
  stitchSubpages?: boolean
}

const SOURCES: SourceSpec[] = [
  {
    id: 'songben',
    title: '宋本伤寒论（赵开美本）',
    pages: ['傷寒論'],
    filename: 'songben-shanghan.wiki',
  },
  {
    id: 'jingui',
    title: '金匮要略',
    pages: ['金匱要略'],
    filename: 'jingui-yaolue.wiki',
  },
  {
    id: 'guilin',
    title: '桂林古本伤寒杂病论（白云阁藏本）',
    pages: ['傷寒雜病論桂林古本白云閣藏本', '傷寒雜病論_(桂林古本)', '傷寒雜病論桂林古本'],
    filename: 'guilin-guben.wiki',
  },
  {
    id: 'bianzheng',
    title: '辨证录',
    pages: ['辨證錄'],
    filename: 'bianzheng-lu.wiki',
  },
  {
    id: 'shishi',
    title: '石室秘录',
    pages: ['石室秘錄'],
    filename: 'shishi-milu.wiki',
  },
  {
    id: 'bencao',
    title: '本草新编',
    pages: ['本草新編'],
    filename: 'bencao-xinbian.wiki',
  },
  {
    id: 'funvke',
    title: '傅青主女科',
    pages: ['傅青主女科'],
    filename: 'funvke.wiki',
    stitchSubpages: true,
  },
  {
    id: 'funanke',
    title: '傅青主男科',
    pages: ['傅青主男科'],
    filename: 'funanke.wiki',
  },
  {
    id: 'shennong',
    title: '神农本草经',
    pages: ['神農本草經', '神農本草經 (孫星衍)'],
    filename: 'shennong-bencao.wiki',
  },
  {
    id: 'xinxiu',
    title: '新修本草',
    pages: ['新修本草'],
    filename: 'xinxiu-bencao.wiki',
  },
  {
    id: 'zhenglei',
    title: '证类本草',
    pages: ['證類本草', '證類本草 (四庫全書本)'],
    filename: 'zhenglei-bencao.wiki',
    stitchSubpages: true,
  },
  {
    id: 'wenbing',
    title: '温病条辨',
    pages: ['溫病條辨'],
    filename: 'wenbing-tiaobian.wiki',
    stitchSubpages: true,
  },
  {
    id: 'wenre',
    title: '温热经纬',
    pages: ['溫熱經緯'],
    filename: 'wenre-jingwei.wiki',
    stitchSubpages: true,
  },
  {
    id: 'piwei',
    title: '脾胃论',
    pages: ['脾胃論'],
    filename: 'piwei-lun.wiki',
    stitchSubpages: true,
  },
  {
    id: 'danxi',
    title: '丹溪心法',
    pages: ['丹溪心法'],
    filename: 'danxi-xinfa.wiki',
  },
  {
    id: 'rumen',
    title: '儒门事亲',
    pages: ['儒門事親 (四庫全書本)', '儒門事親'],
    filename: 'rumen-shiqin.wiki',
    stitchSubpages: true,
  },
  {
    id: 'xiaoer',
    title: '小儿药证直诀',
    pages: ['小兒藥證真訣', '小兒藥證直訣'],
    filename: 'xiaoer-yaozheng.wiki',
    stitchSubpages: true,
  },
  {
    id: 'jingyue',
    title: '景岳全书',
    pages: ['景岳全書 (四庫全書本)', '景岳全書'],
    filename: 'jingyue-quanshu.wiki',
    stitchSubpages: true,
  },
  {
    id: 'zhongxi',
    title: '医学衷中参西录',
    pages: ['醫學衷中參西錄'],
    filename: 'zhongxi-canxi.wiki',
  },
  {
    id: 'linzheng',
    title: '临证指南医案',
    pages: ['臨證指南醫案'],
    filename: 'linzheng-yian.wiki',
    stitchSubpages: true,
  },
  {
    id: 'mingyi',
    title: '名医类案',
    pages: ['名醫類案 (四庫全書本)'],
    filename: 'mingyi-leian.wiki',
    stitchSubpages: true,
  },
  {
    id: 'xumingyi',
    title: '续名医类案',
    pages: ['續名醫類案 (四庫全書本)', '續名醫類案'],
    filename: 'xumingyi-leian.wiki',
    stitchSubpages: true,
  },
  {
    id: 'yizong',
    title: '医宗金鉴·删补名医方论（组方基准）',
    pages: ['刪補名醫方論'],
    filename: 'yizong-fanglun.wiki',
  },
  {
    id: 'qianjin',
    title: '备急千金要方',
    pages: ['備急千金要方', '千金要方 (四庫全書本)'],
    filename: 'qianjin-yaofang.wiki',
    stitchSubpages: true,
  },
  {
    id: 'waitai',
    title: '外台秘要方',
    pages: ['外臺秘要方 (四庫全書本)', '外臺秘要'],
    filename: 'waitai-miyao.wiki',
    stitchSubpages: true,
  },
]

const API = 'https://zh.wikisource.org/w/api.php'
const MAX_RETRIES = 3
const USER_AGENT =
  'Mozilla/5.0 (compatible; tcm-jingfang-learn/0.1; educational research; +https://github.com/tcm)'

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchRawExport(page: string): Promise<string> {
  const url = `https://zh.wikisource.org/w/index.php?title=${encodeURIComponent(page)}&action=raw`
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/plain,*/*',
    },
  })
  if (!response.ok) {
    throw new Error(`Raw export HTTP ${response.status} for ${page}`)
  }
  const text = await response.text()
  if (!text || text.trim().length < 200) {
    throw new Error(`Empty or too short raw export for ${page}`)
  }
  return text
}

async function fetchWikitextApi(page: string): Promise<string> {
  const url = new URL(API)
  url.searchParams.set('action', 'query')
  url.searchParams.set('format', 'json')
  url.searchParams.set('prop', 'revisions')
  url.searchParams.set('rvprop', 'content')
  url.searchParams.set('rvslots', 'main')
  url.searchParams.set('titles', page)

  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
    },
  })
  if (response.status === 403 || response.status === 429) {
    throw new Error(`RateLimited ${response.status}`)
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${page}`)
  }
  const payload = (await response.json()) as {
    query?: {
      pages?: Record<
        string,
        {
          missing?: boolean
          revisions?: Array<{ slots?: { main?: { '*': string } }; ['*']?: string }>
        }
      >
    }
    error?: { info?: string }
  }
  if (payload.error) {
    throw new Error(payload.error.info ?? 'Unknown MediaWiki error')
  }
  const pages = payload.query?.pages ?? {}
  const pageData = Object.values(pages)[0]
  if (!pageData || pageData.missing) {
    throw new Error(`Page missing: ${page}`)
  }
  const revision = pageData.revisions?.[0]
  const wikitext = revision?.slots?.main?.['*'] ?? revision?.['*']
  if (!wikitext || wikitext.trim().length < 200) {
    throw new Error(`Empty or too short wikitext for ${page}`)
  }
  return wikitext
}

async function fetchWikitext(page: string): Promise<string> {
  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await fetchWikitextApi(page)
    } catch (error) {
      lastError = error
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[fetch] API attempt ${attempt}/${MAX_RETRIES} failed for ${page}:`, message)
      if (message.includes('RateLimited') || /403|429|Too Many/.test(message)) {
        try {
          console.warn(`[fetch] falling back to action=raw for ${page}`)
          return await fetchRawExport(page)
        } catch (rawError) {
          lastError = rawError
        }
      }
      await sleep(1500 * attempt)
    }
  }
  try {
    return await fetchRawExport(page)
  } catch (rawError) {
    throw lastError ?? rawError
  }
}

async function fetchWithFallback(pages: string[]): Promise<{ page: string; wikitext: string }> {
  let lastError: unknown
  for (const page of pages) {
    try {
      const wikitext = await fetchWikitext(page)
      return { page, wikitext }
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

/** 从索引页提取子页：绝对 [[书名/卷一]] 与相对 [[/卷一]]；跳过全覽 */
function extractSubpageTitles(indexText: string, rootTitle: string): string[] {
  const titles: string[] = []
  const seen = new Set<string>()
  const push = (title: string) => {
    const cleaned = title.trim().replace(/#.*$/, '')
    if (!cleaned || seen.has(cleaned)) return
    if (/全覽|全览|目錄|目录/.test(cleaned)) return
    seen.add(cleaned)
    titles.push(cleaned)
  }

  const absolute = new RegExp(
    `\\[\\[(${rootTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/[^|\\]#\\]]+)(?:\\|[^\\]]*)?\\]\\]`,
    'g',
  )
  let match: RegExpExecArray | null
  while ((match = absolute.exec(indexText)) !== null) {
    push(match[1]!)
  }

  const relative = /\[\[(\/[^|\]#]+)(?:\|[^\]]*)?\]\]/g
  while ((match = relative.exec(indexText)) !== null) {
    const rel = match[1]!.trim()
    push(`${rootTitle}${rel}`)
  }

  return titles
}

async function fetchStitched(rootPages: string[]): Promise<{ page: string; wikitext: string }> {
  const { page, wikitext: indexText } = await fetchWithFallback(rootPages)
  const subpages = extractSubpageTitles(indexText, page)
  if (subpages.length === 0) {
    // 正文已内嵌在索引页（部分导出版）
    return { page, wikitext: indexText }
  }
  const parts: string[] = [indexText]
  for (const sub of subpages) {
    console.log(`[fetch]   subpage ${sub} ...`)
    try {
      const body = await fetchWikitext(sub)
      parts.push(`\n\n<!-- SUBPAGE: ${sub} -->\n\n${body}`)
    } catch (error) {
      console.warn(`[fetch]   skip subpage ${sub}:`, error instanceof Error ? error.message : error)
    }
    await sleep(800)
  }
  return { page, wikitext: parts.join('\n') }
}

interface ManifestEntry {
  id: string
  title: string
  page: string
  filename: string
  bytes?: number
  fetchedAt?: string
  url: string
  reusedExisting?: boolean
  /** --rebuild-manifest 时 fetchedAt 取自文件修改时间（真实抓取时间未知） */
  fetchedAtEstimated?: boolean
}

const MANIFEST_FILENAME = 'manifest.json'
const MANIFEST_RELATIVE_PATH = `data/raw/${MANIFEST_FILENAME}`
const MANIFEST_NOTE = '公有领域古籍文本，来自维基文库 MediaWiki API / action=raw'
const WIKISOURCE_PAGE_URL_PREFIX = 'https://zh.wikisource.org/zh-hans/'
const SUBPAGE_MARKER_PATTERN = /<!-- SUBPAGE: ([^\n]+?) -->/
const RAW_WIKI_EXTENSION = '.wiki'

function buildPageUrl(page: string): string {
  return `${WIKISOURCE_PAGE_URL_PREFIX}${encodeURIComponent(page)}`
}

function isManifestEntry(value: unknown): value is ManifestEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.id === 'string' &&
    entry.id.length > 0 &&
    typeof entry.filename === 'string' &&
    typeof entry.title === 'string' &&
    typeof entry.page === 'string' &&
    typeof entry.url === 'string'
  )
}

/** 解析 manifest JSON 内容；结构非法返回 null，非法条目单独丢弃并告警 */
function parseManifestEntries(text: string, label: string): ManifestEntry[] | null {
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch (error) {
    console.warn(`[fetch] ${label} JSON 解析失败:`, error instanceof Error ? error.message : error)
    return null
  }
  const sources = (payload as { sources?: unknown } | null)?.sources
  if (!Array.isArray(sources)) {
    console.warn(`[fetch] ${label} 缺少 sources 数组`)
    return null
  }
  const entries: ManifestEntry[] = []
  sources.forEach((entry, index) => {
    if (isManifestEntry(entry)) entries.push(entry)
    else console.warn(`[fetch] ${label} sources[${index}] 结构非法，已忽略`)
  })
  return entries
}

/** 读取已有 manifest；不存在返回 []；损坏时备份为 manifest.json.corrupt-<时间戳> 后返回 [] */
async function readExistingManifest(manifestPath: string): Promise<ManifestEntry[]> {
  if (!(await fileExists(manifestPath))) return []
  const entries = parseManifestEntries(await readText(manifestPath), manifestPath)
  if (entries) return entries
  const backupPath = `${manifestPath}.corrupt-${Date.now()}`
  await copyFile(manifestPath, backupPath)
  console.warn(`[fetch] manifest 已损坏，原文件备份到 ${backupPath}，按空 manifest 处理`)
  return []
}

/** 按 id 合并：updates 覆盖同 id 旧条目；顺序按 SOURCES，未知 id 保留原相对顺序追加在后 */
function mergeManifestEntries(existing: ManifestEntry[], updates: ManifestEntry[]): ManifestEntry[] {
  const byId = new Map<string, ManifestEntry>()
  for (const entry of existing) byId.set(entry.id, entry)
  for (const entry of updates) byId.set(entry.id, entry)
  const order = new Map(SOURCES.map((source, index) => [source.id, index]))
  const insertion = [...byId.keys()]
  return [...byId.values()].sort((left, right) => {
    const leftOrder = order.get(left.id) ?? SOURCES.length + insertion.indexOf(left.id)
    const rightOrder = order.get(right.id) ?? SOURCES.length + insertion.indexOf(right.id)
    return leftOrder - rightOrder
  })
}

async function writeManifest(manifestPath: string, entries: ManifestEntry[]): Promise<void> {
  await writeJson(manifestPath, { sources: entries, note: MANIFEST_NOTE })
}

async function readHeadManifest(root: string): Promise<ManifestEntry[]> {
  try {
    const { stdout } = await execFileAsync('git', ['show', `HEAD:${MANIFEST_RELATIVE_PATH}`], {
      cwd: root,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    })
    return parseManifestEntries(stdout, `git HEAD:${MANIFEST_RELATIVE_PATH}`) ?? []
  } catch (error) {
    console.warn('[fetch] 读取 git HEAD 版 manifest 失败，忽略:', error instanceof Error ? error.message : error)
    return []
  }
}

async function readBookSourceUrls(root: string): Promise<Map<string, string>> {
  const booksPath = path.join(root, 'data', 'ontology', 'books.json')
  try {
    const books = JSON.parse(await readText(booksPath)) as Array<{ id?: unknown; sourceUrl?: unknown }>
    if (!Array.isArray(books)) throw new Error('books.json 根节点不是数组')
    return new Map(
      books
        .filter((book) => typeof book.id === 'string' && typeof book.sourceUrl === 'string')
        .map((book) => [book.id as string, book.sourceUrl as string]),
    )
  } catch (error) {
    console.warn(`[fetch] 读取 ${booksPath} 失败，忽略:`, error instanceof Error ? error.message : error)
    return new Map()
  }
}

/** 维基文库页面 URL → 标题（下划线还原为空格）；非维基文库 URL 返回 null */
function pageFromSourceUrl(sourceUrl: string | undefined): string | null {
  if (!sourceUrl?.startsWith(WIKISOURCE_PAGE_URL_PREFIX)) return null
  try {
    const title = decodeURIComponent(sourceUrl.slice(WIKISOURCE_PAGE_URL_PREFIX.length)).replace(/_/g, ' ')
    return title.trim() || null
  } catch {
    return null
  }
}

/** 拼接型 raw 文件含 `<!-- SUBPAGE: 根标题/子页 -->`，据此还原实际命中的根页面 */
function pageFromSubpageMarker(wikitext: string): string | null {
  const match = SUBPAGE_MARKER_PATTERN.exec(wikitext)
  if (!match) return null
  const subpage = match[1]!.trim()
  const slashIndex = subpage.indexOf('/')
  return slashIndex > 0 ? subpage.slice(0, slashIndex) : null
}

function sameWikiTitle(left: string, right: string): boolean {
  return left.replace(/_/g, ' ') === right.replace(/_/g, ' ')
}

/**
 * 不联网，根据 data/raw/*.wiki 现有文件重建 manifest。
 * 字段来源优先级：当前 manifest > git HEAD manifest > raw 文件 SUBPAGE 标记 / books.json sourceUrl > SOURCES。
 * bytes 一律取实际文件大小；fetchedAt 无记录时用文件修改时间并标记 fetchedAtEstimated。
 */
async function rebuildManifest(root: string, rawDir: string, manifestPath: string): Promise<void> {
  const current = new Map((await readExistingManifest(manifestPath)).map((entry) => [entry.id, entry]))
  const head = new Map((await readHeadManifest(root)).map((entry) => [entry.id, entry]))
  const bookUrls = await readBookSourceUrls(root)
  console.log(`[fetch] rebuild: 当前 manifest ${current.size} 条，HEAD manifest ${head.size} 条，books.json ${bookUrls.size} 条`)

  const entries: ManifestEntry[] = []
  for (const source of SOURCES) {
    const target = path.join(rawDir, source.filename)
    if (!(await fileExists(target))) {
      console.warn(`[fetch] rebuild: 缺少 ${source.filename}，跳过 ${source.id}`)
      continue
    }
    const fileStat = await stat(target)
    const prior = current.get(source.id) ?? head.get(source.id)
    const priorWithFetchedAt = [current.get(source.id), head.get(source.id)].find((item) => item?.fetchedAt)

    let page: string
    let url: string
    if (prior) {
      page = prior.page
      url = prior.url
    } else {
      const bookUrl = bookUrls.get(source.id)
      const bookPage = pageFromSourceUrl(bookUrl)
      const markerPage = pageFromSubpageMarker(await readText(target))
      if (markerPage) {
        page = markerPage
        url = bookPage && bookUrl && sameWikiTitle(bookPage, markerPage) ? bookUrl : buildPageUrl(markerPage)
      } else if (bookPage && bookUrl) {
        page = bookPage
        url = bookUrl
      } else {
        page = source.pages[0]!
        url = buildPageUrl(page)
      }
    }

    const entry: ManifestEntry = {
      id: source.id,
      title: source.title,
      page,
      filename: source.filename,
      bytes: fileStat.size,
      fetchedAt: priorWithFetchedAt?.fetchedAt ?? fileStat.mtime.toISOString(),
      url,
    }
    if (prior?.reusedExisting) entry.reusedExisting = true
    if (!priorWithFetchedAt || priorWithFetchedAt.fetchedAtEstimated) entry.fetchedAtEstimated = true
    entries.push(entry)
    console.log(`[fetch] rebuild: ${source.id} ← ${source.filename} (${fileStat.size} bytes, page=${page})`)
  }

  const knownFilenames = new Set(SOURCES.map((source) => source.filename))
  const orphanWikiFiles = (await readdir(rawDir)).filter(
    (name) => name.endsWith(RAW_WIKI_EXTENSION) && !knownFilenames.has(name),
  )
  if (orphanWikiFiles.length > 0) {
    console.warn(`[fetch] rebuild: 以下 raw 文件不在 SOURCES 中，未写入 manifest：${orphanWikiFiles.join(', ')}`)
  }
  for (const id of current.keys()) {
    if (!entries.some((entry) => entry.id === id)) {
      console.warn(`[fetch] rebuild: 当前 manifest 中的 ${id} 无对应 raw 文件，已移除`)
    }
  }

  await writeManifest(manifestPath, entries)
  console.log(`[fetch] rebuild: 已写入 ${manifestPath}（${entries.length} 条）`)
}

async function main(): Promise<void> {
  const root = projectRoot()
  const rawDir = path.join(root, 'data', 'raw')
  const manifestPath = path.join(rawDir, MANIFEST_FILENAME)
  await ensureDir(rawDir)

  const args = process.argv.slice(2)
  if (args.includes('--rebuild-manifest')) {
    await rebuildManifest(root, rawDir, manifestPath)
    return
  }

  const updates: ManifestEntry[] = []

  const only = new Set(
    args.filter((arg) => !arg.startsWith('-') && arg !== '--'),
  )
  const sources = only.size > 0 ? SOURCES.filter((source) => only.has(source.id)) : SOURCES
  if (only.size > 0) {
    console.log(`[fetch] only: ${[...only].join(', ')}`)
  }

  // 只抓部分来源时，manifest 必须与已有条目按 id 合并，不能整体覆盖；中途失败也写回已完成部分
  try {
    for (const source of sources) {
      console.log(`[fetch] ${source.title} ...`)
      const target = path.join(rawDir, source.filename)
      try {
        const { page, wikitext } = source.stitchSubpages
          ? await fetchStitched(source.pages)
          : await fetchWithFallback(source.pages)
        await writeText(target, wikitext)
        updates.push({
          id: source.id,
          title: source.title,
          page,
          filename: source.filename,
          bytes: Buffer.byteLength(wikitext, 'utf8'),
          fetchedAt: new Date().toISOString(),
          url: buildPageUrl(page),
        })
        console.log(`[fetch] wrote ${target} (${updates.at(-1)?.bytes} bytes)`)
      } catch (error) {
        if (await fileExists(target)) {
          const existing = await readText(target)
          console.warn(`[fetch] reuse existing ${target} after fetch failure:`, error)
          updates.push({
            id: source.id,
            title: source.title,
            page: source.pages[0]!,
            filename: source.filename,
            bytes: Buffer.byteLength(existing, 'utf8'),
            fetchedAt: new Date().toISOString(),
            url: buildPageUrl(source.pages[0]!),
            reusedExisting: true,
          })
        } else {
          throw error
        }
      }
      await sleep(800)
    }
  } finally {
    if (updates.length > 0) {
      const merged = mergeManifestEntries(await readExistingManifest(manifestPath), updates)
      await writeManifest(manifestPath, merged)
      console.log(`[fetch] manifest 合并 ${updates.length} 条更新，共 ${merged.length} 条`)
    }
  }
  console.log('[fetch] done')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
