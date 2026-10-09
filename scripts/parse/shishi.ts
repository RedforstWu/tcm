import path from 'node:path'
import type { Clause, Formula } from '../../src/types/data.ts'
import { extractChenfuFormulaBlocks } from '../lib/chenfu-formula.ts'
import { extractShishiFormulaBlocks } from '../lib/shishi-formula.ts'
import {
  buildHerbLexicon,
  extractBencaoHerbNames,
} from '../lib/herb-lexicon.ts'
import { ensureDir, projectRoot, readText, writeJson } from '../lib/fs-utils.ts'
import { toSimplifiedChinese } from '../lib/wiki.ts'

/** 「=== 肥治法 ===」「== 卷二 ==」等 wiki 标题行属于下一节，不应留在上一条正文末尾 */
function stripWikiHeadings(text: string): string {
  return text
    .replace(/^\s*==+[^=\n]+==+\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * 《石室秘录》：== 卷一 == / === 正医法 === / 论某病……
 * 正文多为「天师曰」对话体，方药嵌在段落中。
 */
export async function runShishiParse(): Promise<{
  clauses: Clause[]
  formulas: Formula[]
  stats: { chapterCount: number; clauseCount: number; formulaCount: number }
}> {
  const root = projectRoot()
  const raw = await readText(path.join(root, 'data', 'raw', 'shishi-milu.wiki'))
  let bencaoNames: string[] = []
  try {
    const bencao = await readText(path.join(root, 'data', 'raw', 'bencao-xinbian.wiki'))
    bencaoNames = extractBencaoHerbNames(bencao)
  } catch {
    bencaoNames = []
  }
  const lexicon = buildHerbLexicon(bencaoNames)
  const text = toSimplifiedChinese(raw)

  const clauses: Clause[] = []
  const formulas: Formula[] = []

  const methodRe = /^===\s*(.+?法)\s*===\s*$/gm
  const methods: Array<{ title: string; index: number }> = []
  let match: RegExpExecArray | null
  while ((match = methodRe.exec(text)) !== null) {
    methods.push({ title: match[1]!.trim(), index: match.index + match[0].length })
  }

  for (let mi = 0; mi < methods.length; mi += 1) {
    const method = methods[mi]!
    const end = mi + 1 < methods.length ? methods[mi + 1]!.index : text.length
    let body = text.slice(method.index, end)

    // 目录行：'''论肺经生痈 论久嗽...'''
    body = body.replace(/^'''[^']+'''\s*/m, '')

    // 按「论某某」或「天师曰」切条
    const topicRe = /(?:^|\n)((?:论|論)[^\n]{2,40}|(?:天师曰|張公曰|华君曰)[^\n]*)/g
    const topics: Array<{ title: string; index: number }> = []
    while ((match = topicRe.exec(body)) !== null) {
      topics.push({
        title: match[1]!.trim().slice(0, 40),
        index: match.index + (match[0].startsWith('\n') ? 1 : 0),
      })
    }

    // 长度阈值按含标题行的原始片段判断，以保持既有 clauseId 不漂移（链接与 LLM 标注依赖它）
    const segments: Array<{ title: string; text: string }> = []
    if (topics.length === 0) {
      if (body.trim().length > 40) {
        segments.push({ title: method.title, text: stripWikiHeadings(body) })
      }
    } else {
      for (let ti = 0; ti < topics.length; ti += 1) {
        const start = topics[ti]!.index
        const stop = ti + 1 < topics.length ? topics[ti + 1]!.index : body.length
        const seg = body.slice(start, stop).trim()
        if (seg.length > 30) {
          segments.push({ title: topics[ti]!.title, text: stripWikiHeadings(seg) })
        }
      }
    }

    for (let si = 0; si < segments.length; si += 1) {
      const seg = segments[si]!
      const clauseId = `shishi-${String(clauses.length + 1).padStart(4, '0')}`
      const anonymousPrefix = `${method.title}·第${si + 1}则`
      let blocks = extractShishiFormulaBlocks(seg.text, { anonymousPrefix, lexicon })

      if (blocks.length === 0) {
        // 少数条目为「药（剂量）」括号写法，尝试在「用」字后插入方用标记交给通用解析器
        let normalized = seg.text
        if (!/方用/.test(normalized) && /[（(][^）)]*(?:两|兩|钱|錢)/.test(normalized)) {
          normalized = normalized.replace(
            /(?:用|方)\s*(?=[\u4e00-\u9fff]{1,8}[（(])/,
            '方用\n',
          )
        }
        blocks = extractChenfuFormulaBlocks(normalized, { anonymousPrefix, lexicon })
      }

      const formulaIds: string[] = []
      let mainFormulaId: string | undefined
      for (let fi = 0; fi < blocks.length; fi += 1) {
        const block = blocks[fi]!
        const formulaId = `shishi-formula-${clauseId}-${fi + 1}`
        if (fi === 0) mainFormulaId = formulaId
        formulaIds.push(formulaId)
        formulas.push({
          id: formulaId,
          name: block.name,
          book: 'shishi',
          herbs: block.herbs,
          preparation: block.preparation,
          modifications: [],
          sourceClauseIds: [clauseId],
          chapter: method.title,
          doseSystem: 'qing',
          role: block.role,
          alternateOf: block.role === 'alternate' ? mainFormulaId : undefined,
          derivedFrom: block.derivedFrom,
          fangjie: block.fangjie,
          anonymous: block.anonymous,
        })
      }

      clauses.push({
        id: clauseId,
        book: 'shishi',
        chapter: method.title,
        chapterOrder: mi + 1,
        order: si + 1,
        text: seg.text.slice(0, 2000),
        formulaIds,
        symptomTags: [],
        pulseTags: [],
        channelTags: [],
        pathogenesisTags: [],
        reviewStatus: 'ai-draft',
        heading: seg.title,
      })
    }
  }

  const outDir = path.join(root, 'data', 'parsed')
  await ensureDir(outDir)
  await writeJson(path.join(outDir, 'shishi.json'), { clauses, formulas })

  return {
    clauses,
    formulas,
    stats: {
      chapterCount: methods.length,
      clauseCount: clauses.length,
      formulaCount: formulas.length,
    },
  }
}
