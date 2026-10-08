import path from 'node:path'
import { ensureDir, fileExists, projectRoot, writeText, writeJson, readText } from './lib/fs-utils.ts'

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

/** 从索引页提取 [[傅青主女科/上卷]] 一类子页链接，保持出现顺序 */
function extractSubpageTitles(indexText: string, rootTitle: string): string[] {
  const pattern = new RegExp(`\\[\\[(${rootTitle}/[^\\|\\]#\\]]+)(?:\\|[^\\]]*)?\\]\\]`, 'g')
  const titles: string[] = []
  const seen = new Set<string>()
  let match: RegExpExecArray | null
  while ((match = pattern.exec(indexText)) !== null) {
    const title = match[1]!.trim()
    if (seen.has(title)) continue
    seen.add(title)
    titles.push(title)
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
    const body = await fetchWikitext(sub)
    parts.push(`\n\n<!-- SUBPAGE: ${sub} -->\n\n${body}`)
    await sleep(800)
  }
  return { page, wikitext: parts.join('\n') }
}

async function main(): Promise<void> {
  const root = projectRoot()
  const rawDir = path.join(root, 'data', 'raw')
  await ensureDir(rawDir)

  const manifest: Array<{
    id: string
    title: string
    page: string
    filename: string
    bytes: number
    fetchedAt: string
    url: string
    reusedExisting?: boolean
  }> = []

  for (const source of SOURCES) {
    console.log(`[fetch] ${source.title} ...`)
    const target = path.join(rawDir, source.filename)
    try {
      const { page, wikitext } = source.stitchSubpages
        ? await fetchStitched(source.pages)
        : await fetchWithFallback(source.pages)
      await writeText(target, wikitext)
      manifest.push({
        id: source.id,
        title: source.title,
        page,
        filename: source.filename,
        bytes: Buffer.byteLength(wikitext, 'utf8'),
        fetchedAt: new Date().toISOString(),
        url: `https://zh.wikisource.org/zh-hans/${encodeURIComponent(page)}`,
      })
      console.log(`[fetch] wrote ${target} (${manifest.at(-1)?.bytes} bytes)`)
    } catch (error) {
      if (await fileExists(target)) {
        const existing = await readText(target)
        console.warn(`[fetch] reuse existing ${target} after fetch failure:`, error)
        manifest.push({
          id: source.id,
          title: source.title,
          page: source.pages[0]!,
          filename: source.filename,
          bytes: Buffer.byteLength(existing, 'utf8'),
          fetchedAt: new Date().toISOString(),
          url: `https://zh.wikisource.org/zh-hans/${encodeURIComponent(source.pages[0]!)}`,
          reusedExisting: true,
        })
      } else {
        throw error
      }
    }
    await sleep(800)
  }

  await writeJson(path.join(rawDir, 'manifest.json'), {
    sources: manifest,
    note: '公有领域古籍文本，来自维基文库 MediaWiki API / action=raw',
  })
  console.log('[fetch] done')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
