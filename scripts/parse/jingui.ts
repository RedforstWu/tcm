import path from 'node:path'
import type { Clause, Formula } from '../../src/types/data.ts'
import { extractFormulaBlocks, isFormulaNameLine, isPreparationLine } from '../lib/formula-parse.ts'
import { projectRoot, readText, writeJson } from '../lib/fs-utils.ts'
import { cleanWikiMarkup, extractChapters, toSimplifiedChinese } from '../lib/wiki.ts'

function extractLeadingFormulaMentions(clauseText: string): string[] {
  const text = toSimplifiedChinese(clauseText)
  const names = new Set<string>()
  const re = /([\u4e00-\u9fff《》]{2,16}(?:汤|散|丸|膏|煎|饮))(?:主之|方|。|$|，)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) names.add(match[1]!.replace(/《|》/g, ''))
  const yi = text.match(/宜([\u4e00-\u9fff《》]{2,16}(?:汤|散|丸|膏|煎|饮))/)
  if (yi?.[1]) names.add(yi[1].replace(/《|》/g, ''))
  return [...names]
}

function shouldSkipLine(line: string): boolean {
  if (!line) return true
  if (isFormulaNameLine(line) || isPreparationLine(line)) return true
  if (/^右[一二三四五六七八九十]/.test(line) || /^上[一二三四五六七八九十]/.test(line)) return true
  if (
    line.length < 40 &&
    /[一二三四五六七八九十半\d]+(两|升|合|枚|分)/.test(line) &&
    !/主之|宜/.test(line)
  ) {
    return true
  }
  return false
}

function looksLikeNewClause(line: string): boolean {
  return /^(问曰|师曰|太阳|阳明|少阳|太阴|少阴|厥阴|病|脉|夫|妇人|腹痛|咳|呕|黄疸|水气|痰饮|胸痹|奔豚|百合|疟|中风|历节|血痹|虚劳|肺痿|肺痈)/.test(
    line,
  )
}

export interface JinguiParseResult {
  clauses: Clause[]
  formulas: Formula[]
  stats: { chapterCount: number; clauseCount: number; formulaCount: number }
}

export function parseJinguiWiki(raw: string): JinguiParseResult {
  const cleaned = cleanWikiMarkup(raw)
  const chapters = extractChapters(cleaned).filter((chapter) => {
    const title = toSimplifiedChinese(chapter.title)
    return /第[一二三四五六七八九十]+|脉证|杂疗|禁忌/.test(title)
  })

  const clauses: Clause[] = []
  const formulas: Formula[] = []
  const formulaByName = new Map<string, Formula>()
  let chapterOrder = 0

  for (const chapter of chapters) {
    chapterOrder += 1
    const chapterTitle = toSimplifiedChinese(chapter.title).trim()
    const body = toSimplifiedChinese(chapter.body)
    const blocks = extractFormulaBlocks(body)
    for (const block of blocks) {
      const name = block.name
      if (formulaByName.has(name)) continue
      const formula: Formula = {
        id: `jingui-formula-${name}`,
        name,
        book: 'jingui',
        herbs: block.herbs,
        preparation: block.preparation,
        modifications: block.modifications,
        sourceClauseIds: [],
        chapter: chapterTitle,
      }
      formulaByName.set(name, formula)
      formulas.push(formula)
    }

    const lines = body
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    let buffer: string[] = []
    let orderInChapter = 0

    const flush = () => {
      if (buffer.length === 0) return
      const text = buffer.join('')
      buffer = []
      if (text.length < 8 || isFormulaNameLine(text)) return
      orderInChapter += 1
      const id = `jingui-${chapterOrder}-${orderInChapter}`
      const mentioned = extractLeadingFormulaMentions(text)
      const formulaIds: string[] = []
      for (const name of mentioned) {
        const formula = formulaByName.get(name)
        if (!formula) continue
        formulaIds.push(formula.id)
        if (!formula.sourceClauseIds.includes(id)) formula.sourceClauseIds.push(id)
      }
      clauses.push({
        id,
        book: 'jingui',
        chapter: chapterTitle,
        chapterOrder,
        order: orderInChapter,
        text,
        formulaIds,
        symptomTags: [],
        pulseTags: [],
        channelTags: [],
        pathogenesisTags: [],
        reviewStatus: 'ai-draft',
      })
    }

    for (const line of lines) {
      if (shouldSkipLine(line)) continue
      if (buffer.length > 0 && looksLikeNewClause(line)) flush()
      buffer.push(line)
    }
    flush()
  }

  return {
    clauses,
    formulas,
    stats: {
      chapterCount: chapterOrder,
      clauseCount: clauses.length,
      formulaCount: formulas.length,
    },
  }
}

export async function runJinguiParse(): Promise<JinguiParseResult> {
  const root = projectRoot()
  const raw = await readText(path.join(root, 'data/raw/jingui-yaolue.wiki'))
  const result = parseJinguiWiki(raw)
  await writeJson(path.join(root, 'data/parsed/jingui.json'), result)
  return result
}
