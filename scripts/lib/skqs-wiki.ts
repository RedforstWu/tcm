import { toSimplifiedChinese } from './wiki.ts'
import type { WikiSection } from './generic-wiki-parse.ts'

/** 去掉四库/维基噪声，保留可读正文 */
export function stripSkqsMarkup(raw: string): string {
  let text = raw.replace(/\r\n/g, '\n')
  // 先去掉 HTML 注释（含校对提示）
  text = text.replace(/<!--[\s\S]*?-->/g, '\n')
  // 带参数的模板（含 |）
  text = text.replace(/\{\{[^{}]*\}\}/g, (tpl) => {
    // 保留锚点标题供后续切分：用特殊标记
    const anchor = tpl.match(/\{\{SK\s*anchor\|([^}|]+)(?:\|[^}]*)?\}\}/i)
    if (anchor) return `\n@@ANCHOR:${anchor[1]!.trim()}@@\n`
    return '\n'
  })
  // 嵌套残留
  text = text.replace(/\{\{[^{}]*\}\}/g, '\n')
  text = text.replace(/<\/?poem>/gi, '\n')
  text = text.replace(/<\/?onlyinclude>/gi, '\n')
  text = text.replace(/\[\[(?:File|Image|文件|图像):[^\]]+\]\]/gi, '')
  text = text.replace(/\[\[[^\]]+\|([^\]]+)\]\]/g, '$1')
  text = text.replace(/\[\[([^\]]+)\]\]/g, '$1')
  text = text.replace(/'{2,}/g, '')
  text = text.replace(/<br\s*\/?>/gi, '\n')
  text = text.replace(/<\/?font[^>]*>/gi, '')
  text = text.replace(/-\{([^}]*)\}-/g, '$1')
  text = text.replace(/请根据四库全书扫描版校对本页[^\n]*/g, '')
  text = text.replace(/标准见[^\n]*/g, '')
  text = text.replace(/[　\t]+/g, '')
  text = text.replace(/\n{3,}/g, '\n\n')
  return text
}

function volumeMarks(text: string): Array<{ title: string; index: number; end: number }> {
  const marks: Array<{ title: string; index: number; end: number }> = []
  const subRe = /<!--\s*SUBPAGE:\s*([^\n]+?)\s*-->/g
  let match: RegExpExecArray | null
  while ((match = subRe.exec(text)) !== null) {
    const full = match[1]!.trim()
    const title = full.includes('/') ? full.slice(full.lastIndexOf('/') + 1) : full
    marks.push({ title: toSimplifiedChinese(title), index: match.index, end: match.index + match[0].length })
  }
  if (marks.length > 0) return marks

  const headerRe = /\{\{SKQS\s+header\|[^}]*?(?:section|next_link)=([^|}]+)/gi
  while ((match = headerRe.exec(text)) !== null) {
    const title = toSimplifiedChinese(match[1]!.trim())
    if (!title || title === '提要') continue
    marks.push({ title, index: match.index, end: match.index })
  }
  return marks
}

/** 四库拼接本书名（简体，含卷题中的讹字） */
const SKQS_BOOK_TITLE_SOURCE = '(?:儒门事亲|景岳全书|续?名医类案|外[台䑓][秘袐]要方?)'
/** 卷首撰者行：金张从正撰、明张介宾撰、明江瓘编、钱塘魏之琇撰、唐王焘撰 */
const SKQS_AUTHOR_SOURCE =
  '(?:[金元明眀清唐宋]|钱[塘唐])?(?:张从正|张介[宾賔]|江[瓘灌]|魏之琇|王焘)(?:撰|编|辑)'
const SKQS_JUAN_NUMBER_SOURCE = '[卷巻](?:之)?[一二三四五六七八九十百]+'
const SKQS_AUTHOR_LINE_RE = new RegExp(`^${SKQS_AUTHOR_SOURCE}$`)
/** 卷首/卷尾题：「儒门事亲卷十」「儒门事亲卷十金张从正撰」「景岳全书卷七明张介賔撰伤寒」 */
const SKQS_JUAN_TITLE_RE = new RegExp(
  `^${SKQS_BOOK_TITLE_SOURCE}${SKQS_JUAN_NUMBER_SOURCE}(?:(${SKQS_AUTHOR_SOURCE})(.*))?$`,
)
/** 页眉丛书名（简体，含 OCR 讹字：钦定四库金书、饮定四库全书） */
const SKQS_COLLECTION_TITLE_RE = /[钦饮]定四库[全金]书/g
/** 卷末分类签：<子部,医家类,景岳全书> */
const SKQS_CATEGORY_TAG_RE = /^<子部[,，][^>]*>$/

/**
 * 剥掉卷首/卷尾题与撰者行（非正文）。返回 null 表示整行丢弃；
 * 卷题后若紧跟篇名（「…撰伤寒」），只保留篇名。
 */
export function stripSkqsVolumeTitleLine(line: string): string | null {
  const withoutCollection = line.replace(SKQS_COLLECTION_TITLE_RE, '').trim()
  if (!withoutCollection) return null
  if (SKQS_AUTHOR_LINE_RE.test(withoutCollection) || SKQS_CATEGORY_TAG_RE.test(withoutCollection)) return null
  const juan = withoutCollection.match(SKQS_JUAN_TITLE_RE)
  if (!juan) return withoutCollection
  const remainder = (juan[2] ?? '').trim()
  return remainder || null
}

/** 短于此长度的段丢弃 */
const SKQS_MIN_BLOCK_LENGTH = 24
/** 遇条目起首（一…/据…/○…）时，缓冲达到此长度才切开 */
const SKQS_ENTRY_SPLIT_MIN_LENGTH = 40
/** 过长块强制切开的长度 */
const SKQS_MAX_BLOCK_LENGTH = 900

/**
 * 将一卷正文按 SK anchor 与「一…」条目切成段落块（用双换行分隔，供 splitParagraphs）。
 */
export function chunkSkqsBody(rawBody: string): string {
  const text = toSimplifiedChinese(stripSkqsMarkup(rawBody))
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const blocks: string[] = []
  let currentTitle = ''
  /**
   * 卷题/撰者行不进输出，但其字数仍计入各切分门槛：条文 id 按段序生成，
   * 删题名若改变段界会让同卷后续 id 指向别的文本。
   */
  let buf: Array<{ kept: string; sourceLength: number }> = []
  const bufferedSourceLength = () => buf.reduce((sum, entry) => sum + entry.sourceLength, 0)

  const flush = () => {
    const joined = buf
      .map((entry) => entry.kept)
      .join('')
      .trim()
    if (joined && bufferedSourceLength() >= SKQS_MIN_BLOCK_LENGTH) {
      const prefix = currentTitle ? `【${currentTitle}】` : ''
      blocks.push(prefix + joined)
    }
    buf = []
  }

  for (const line of lines) {
    const anchor = line.match(/^@@ANCHOR:(.+?)@@$/)
    if (anchor) {
      flush()
      currentTitle = toSimplifiedChinese(anchor[1]!.trim())
      // 跳过卷名级锚点（与卷标题重复）
      if (/^景岳全书卷|^名医类案|^续名医类案|^儒门事亲/.test(currentTitle)) {
        currentTitle = ''
      }
      continue
    }

    // 条目起首：一命门… / ○… / 据河间…
    if (
      buf.length > 0 &&
      (/^[一二三四五六七八九十][^。]{0,4}/.test(line) ||
        /^[据按]/.test(line) ||
        /^○/.test(line)) &&
      bufferedSourceLength() >= SKQS_ENTRY_SPLIT_MIN_LENGTH
    ) {
      flush()
    }

    buf.push({ kept: stripSkqsVolumeTitleLine(line) ?? '', sourceLength: line.length })

    // 过长块强制切开
    if (bufferedSourceLength() >= SKQS_MAX_BLOCK_LENGTH) {
      flush()
    }
  }
  flush()

  return blocks.join('\n\n')
}

/**
 * 按 fetch 写入的 SUBPAGE 注释或 SKQS header section 切卷，
 * 卷内再按锚点/条目切段。适用于景岳/名医类案/续类案/儒门事亲等四库拼接本。
 */
export function splitSkqsVolumes(raw: string): WikiSection[] {
  const text = raw.replace(/\r\n/g, '\n')
  const marks = volumeMarks(text)

  if (marks.length === 0) {
    const body = chunkSkqsBody(text)
    return body.length > 40 ? [{ title: '正文', level: 2, body, order: 1 }] : []
  }

  const sections: WikiSection[] = []
  for (let i = 0; i < marks.length; i += 1) {
    const current = marks[i]!
    const next = marks[i + 1]
    const slice = text.slice(current.end, next?.index ?? text.length)
    if (/^提要|^目录|^目錄|^凡例/.test(current.title)) continue
    const body = chunkSkqsBody(slice)
    if (body.length < 40) continue
    sections.push({
      title: current.title,
      level: 2,
      body,
      order: sections.length + 1,
    })
  }
  return sections
}
