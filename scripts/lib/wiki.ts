import { Converter } from 'opencc-js'

const toSimplified = Converter({ from: 'tw', to: 'cn' })

/** 清洗维基文库 wikitext / 导出正文 */
export function cleanWikiMarkup(raw: string): string {
  let text = raw
  // 先保留方见/派生注，避免 {{*|…}} 被整段删光
  text = text.replace(/\{\{\*\|\s*方[見见]([^}]*)\}\}/g, '（方见$1）')
  text = text.replace(/\{\{\*\|\s*於([^}]*)\}\}/g, '（注：于$1）')
  text = text.replace(/\{\{\*\|\s*即([^}]*)\}\}/g, '（注：即$1）')
  text = text.replace(/\{\{[^{}]*\}\}/g, '')
  text = text.replace(/\{\{[^{}]*\}\}/g, '')
  text = text.replace(/-\{([^}]*)\}-/g, '$1')
  text = text.replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, '$2')
  text = text.replace(/\[\[([^\]]+)\]\]/g, '$1')
  text = text.replace(/\[https?:\/\/[^\s\]]+\s+([^\]]+)\]/g, '$1')
  text = text.replace(/\[https?:\/\/[^\s\]]+\]/g, '')
  text = text.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
  text = text.replace(/<[^>]+>/g, '')
  text = text.replace(/<!--[\s\S]*?-->/g, '')
  // 维基以 :; 既作方剂定义，也作条文内分隔
  text = text.replace(/:;+/g, '\n')
  text = text.replace(/^::/gm, '')
  text = text.replace(/\{\{\*\|[\s\S]*?\}\}/g, '')
  text = text.replace(/\u3000/g, ' ')
  text = text.replace(/\r\n/g, '\n')
  text = text.replace(/[ \t]+/g, ' ')
  text = text.replace(/ *\n */g, '\n')
  text = text.replace(/\n{3,}/g, '\n\n')
  return text.trim()
}

export function toSimplifiedChinese(text: string): string {
  return toSimplified(text)
}

export function normalizeForCompare(text: string): string {
  return toSimplifiedChinese(text).replace(/[^\u4e00-\u9fff0-9]/g, '')
}

export function extractChapters(
  text: string,
): Array<{ title: string; body: string; level: number }> {
  const lines = text.split('\n')
  const chapters: Array<{ title: string; body: string; level: number }> = []
  let current: { title: string; body: string; level: number } | null = null

  for (const line of lines) {
    const match = line.match(/^(={2,4})\s*(.+?)\s*\1?\s*$/)
    if (match) {
      if (current) chapters.push(current)
      const title = match[2]!.replace(/=+$/, '').trim()
      current = {
        title,
        body: '',
        level: match[1]!.length,
      }
      continue
    }
    // markdown-style fallback from HTML export
    const mdMatch = line.match(/^(#{2,4})\s+(.+)$/)
    if (mdMatch) {
      if (current) chapters.push(current)
      current = {
        title: mdMatch[2]!.trim(),
        body: '',
        level: mdMatch[1]!.length,
      }
      continue
    }
    if (current) {
      current.body += `${line}\n`
    }
  }
  if (current) chapters.push(current)
  return chapters
}
