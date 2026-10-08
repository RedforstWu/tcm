import path from 'node:path'
import type { HerbMonograph } from '../../src/types/data.ts'
import { canonicalizeChenfuHerb } from '../lib/herb-lexicon.ts'
import { ensureDir, projectRoot, readText, writeJson } from '../lib/fs-utils.ts'
import { toSimplifiedChinese } from '../lib/wiki.ts'

/** 把本草新编硬换行拼回连续文本 */
export function joinBencaoHardBreaks(content: string): string {
  return content
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('')
    .replace(/\s+/g, '')
    // 恢复句读后的可读空格：不需要，全文无空格亦可
    .replace(/([。；！？])/g, '$1\n')
}

export function parseBencaoNatureFlavor(text: string): {
  nature?: string
  flavor?: string
  channels: string[]
  toxicity?: string
} {
  const simplified = toSimplifiedChinese(text)
  const flavorMatch = simplified.match(/味([甘辛苦酸咸淡涩]{1,6})/)
  const natureMatch = simplified.match(/气([寒热温凉平]{1,4})/)
  const channelMatch = simplified.match(/入([^。]{2,30}?)之经/)
  const toxicityMatch = simplified.match(/(无毒|有毒|小毒|大毒)/)

  const channels: string[] = []
  if (channelMatch?.[1]) {
    const raw = channelMatch[1]
    for (const part of raw.split(/[、与及和，,]/g)) {
      const organ = part.replace(/经/g, '').trim()
      if (organ && organ.length <= 3) channels.push(organ)
    }
  }

  return {
    nature: natureMatch?.[1],
    flavor: flavorMatch?.[1],
    channels,
    toxicity: toxicityMatch?.[1],
  }
}

export function parseBencaoQa(text: string): Array<{ question: string; answer: string }> {
  const simplified = toSimplifiedChinese(text)
  const qa: Array<{ question: string; answer: string }> = []
  const re = /(?:或问|问曰|问)([^曰]{4,200}?)曰[:：]?([^或问]{4,800}?)(?=(?:或问|问曰|问)|$)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(simplified)) !== null) {
    qa.push({
      question: match[1]!.trim().replace(/[？?]$/, ''),
      answer: match[2]!.trim().slice(0, 500),
    })
  }
  return qa
}

export async function runBencaoParse(): Promise<{
  monographs: HerbMonograph[]
  stats: { monographCount: number }
}> {
  const root = projectRoot()
  const raw = await readText(path.join(root, 'data', 'raw', 'bencao-xinbian.wiki'))

  const monographs: HerbMonograph[] = []
  const entryRe = /<篇名>([^\n<]+)\s*\n+内容：([\s\S]*?)(?=<目录>|<篇名>|$)/g
  let match: RegExpExecArray | null

  while ((match = entryRe.exec(raw)) !== null) {
    const rawName = match[1]!.trim()
    // 跳过序跋与非药名篇
    if (/^序|^凡例|^目录|^跋|^附|^劝|^论|^辨|^总|^卷/.test(rawName)) continue
    if (/则$|论$|说$|辨$/.test(rawName) && rawName.length > 3) continue
    const name = canonicalizeChenfuHerb(rawName)
    if (!name || name.length > 6 || name.length < 1) continue

    const joined = joinBencaoHardBreaks(match[2] ?? '')
    const simplified = toSimplifiedChinese(joined)
    const meta = parseBencaoNatureFlavor(simplified)
    // 无性味归经者多半不是药条
    if (!meta.flavor && !meta.nature && meta.channels.length === 0) continue
    const qa = parseBencaoQa(simplified)
    // 摘要：首段至第一问之前
    const summary = simplified.split(/(?:或问|问曰|问)/)[0]?.slice(0, 400) ?? simplified.slice(0, 400)

    const herbId = name.normalize('NFKC').replace(/\s+/g, '')
    monographs.push({
      id: `bencao-${herbId}`,
      herbId,
      name,
      nature: meta.nature,
      flavor: meta.flavor,
      channels: meta.channels,
      toxicity: meta.toxicity,
      summary,
      qa,
      rawText: simplified.slice(0, 4000),
      sourceBook: 'bencao',
    })
  }

  // 去重同名，保留较长原文
  const byId = new Map<string, HerbMonograph>()
  for (const item of monographs) {
    const existing = byId.get(item.herbId)
    if (!existing || item.rawText.length > existing.rawText.length) {
      byId.set(item.herbId, item)
    }
  }
  const deduped = [...byId.values()]

  const outDir = path.join(root, 'data', 'parsed')
  await ensureDir(outDir)
  await writeJson(path.join(outDir, 'bencao.json'), { monographs: deduped })

  return {
    monographs: deduped,
    stats: { monographCount: deduped.length },
  }
}
